// Reports — Phase 10 R1.
//
//   GET  /authoring/reports                        the catalogue, with freshness
//   GET  /authoring/reports/snapshots              captured snapshots
//   GET  /authoring/reports/snapshots/:snapshotId  one snapshot, with its header block
//   GET  /authoring/reports/:dataset               one dataset
//   GET  /authoring/reports/:dataset/export        the same dataset as CSV
//   POST /authoring/reports/:dataset/snapshots     capture it
//
// ROUTE ORDER MATTERS HERE. `/reports/snapshots` is registered BEFORE
// `/reports/:dataset`, because Fastify would otherwise match `snapshots` as a
// dataset name and answer a list request with a validation failure.
//
// ONE QUERY PATH (B1). The dataset route, the export route and the snapshot
// route all call `runDataset` with a scope built the same way. There is no
// second path that could apply a different window, a different scope or a
// different suppression — which is what makes "the dashboard and its export
// can never disagree" a property of the code rather than a promise.
//
// AUTHORIZATION, and why these three policies:
//
//   * the READ is `report.read`, already held by the Reporting User, the Report
//     Publisher, the Manager, the Auditor and the administrator. No new key.
//   * the EXPORT is `report.export`, a separate grant, for the same reason the
//     Audit Explorer separates them: reading a dataset on screen and taking a
//     copy of it off the platform are different acts, and §8.1 requires the
//     export itself to be audited.
//   * a SNAPSHOT is `report.create`. It writes a durable record that others
//     will read, which is a different authority from looking at a screen.
//
// SCOPE IS A PREDICATE, NOT A FILTER (D5/B2). `ctx.scope.domainIds` is empty
// for an unrestricted subject, which the dataset layer takes as `null`; a
// restricted subject's list goes into the SQL. A row outside scope is never in
// memory, so it can never be counted into a total by accident.

import { z } from 'zod';
import type { FastifyReply } from 'fastify';
import {
  DATASETS,
  DATASET_DEFINITIONS,
  MAX_DATASET_ROWS,
  captureSnapshot,
  isDatasetName,
  listSnapshots,
  readAllFreshness,
  readFreshness,
  readCachedDataset,
  readSnapshot,
  refreshAllModels,
  recordCacheHit,
  runDataset,
  toDatasetCsv,
  writeCachedDataset,
  type DatasetName,
  type DatasetRequest,
  type DatasetResult,
  type ReadOnlyDb,
  type RefreshDb,
} from '@knowzy/reporting';
import type { ErrorCode } from '@knowzy/shared-types';
import { systemClock } from '@knowzy/observability';
import { createAuditWriter } from '@knowzy/database';
import { defineRoute, type RouteContext, type RouteDeps } from '../http/route.js';
import { toProblem } from '../http/problem.js';

const problemReply = (
  reply: FastifyReply,
  ctx: RouteContext,
  instance: string,
  code: ErrorCode,
  detail: string,
): FastifyReply => {
  const problem = toProblem({ code, correlationId: ctx.correlationId, instance, detail });
  return reply.status(problem.status).type('application/problem+json').send(problem);
};

const DatasetParams = z.object({ dataset: z.string() });

const Query = z.object({
  windowDays: z.coerce.number().int().min(1).max(365).optional(),
  pageSize: z.coerce.number().int().min(1).max(MAX_DATASET_ROWS).optional(),
});

/**
 * The caller's scope, in the shape the dataset layer wants.
 *
 * `DataScope` uses EMPTY to mean unrestricted (authorization §5), and the
 * dataset layer uses `null`. Translating in one place stops the two
 * conventions meeting inside a SQL predicate, where "empty list" would match
 * nothing and silently return an empty report to an administrator.
 */
const scopeOf = (ctx: RouteContext) => ({
  domainIds: ctx.scope.domainIds.length === 0 ? null : [...ctx.scope.domainIds],
  sourceIds: ctx.scope.sourceIds.length === 0 ? null : [...ctx.scope.sourceIds],
});

const requestOf = (
  ctx: RouteContext,
  dataset: DatasetName,
  query: z.infer<typeof Query>,
  minimumGroupSize: number,
): DatasetRequest => ({
  name: dataset,
  scope: scopeOf(ctx),
  minimumGroupSize,
  ...(query.windowDays === undefined ? {} : { windowDays: query.windowDays }),
  ...(query.pageSize === undefined ? {} : { pageSize: query.pageSize }),
});

/**
 * The minimum group size in force.
 *
 * Read from configuration where one is set, and clamped upward only by the
 * suppression engine — so a configured 2 becomes 5 there rather than here. Two
 * enforcement points on purpose: a privacy floor that exists in one place is
 * one refactor away from not existing.
 */
const minimumGroupSizeFor = async (deps: RouteDeps): Promise<number> => {
  const row = await deps.prisma.applicationConfiguration.findFirst({
    where: { key: 'reporting.minimumGroupSize', scope: 'PLATFORM', scopeId: null },
    select: { value: true },
  });
  const value = row?.value;
  return typeof value === 'number' ? value : 5;
};

/**
 * Runs a dataset, through the cache.
 *
 * The freshness read happens first and unconditionally, because the `asOf` it
 * returns is part of the cache key: an entry cannot outlive the refresh that
 * replaced its data, because a new `asOf` simply misses.
 */
const runCached = async (
  deps: RouteDeps,
  request: DatasetRequest,
): Promise<{ result: DatasetResult; cached: boolean }> => {
  const db = deps.prisma as unknown as ReadOnlyDb;
  const definition = DATASET_DEFINITIONS[request.name];

  // Through the read-model package, not raw SQL here: C4 forbids raw SQL in the
  // API, and the same function the dataset uses guarantees the `asOf` in the
  // cache KEY is the one the cached payload was built under.
  const { asOf } = await readFreshness(db, definition.models);

  const cached = await readCachedDataset(db, request, asOf);
  if (cached !== null) {
    await recordCacheHit(deps.prisma as unknown as RefreshDb, request, asOf);
    return { result: cached.result, cached: true };
  }

  const result = await runDataset(db, request);
  await writeCachedDataset(deps.prisma as unknown as RefreshDb, request, result);
  return { result, cached: false };
};

export const reportRoutes = [
  defineRoute({
    method: 'GET',
    url: '/api/v1/authoring/reports',
    policy: 'reporting.dataset.read',
    portal: 'AUTHORING',
    summary:
      'The report catalogue: grain, metrics with their formulas, and each model’s freshness.',
    handler: async (ctx, _request, _reply, deps) => {
      const freshness = await readAllFreshness(deps.prisma as unknown as ReadOnlyDb);

      return {
        asOf: systemClock.now().toISOString(),
        minimumGroupSize: await minimumGroupSizeFor(deps),
        canExport: ctx.subject.permissions.includes('report.export'),
        canSnapshot: ctx.subject.permissions.includes('report.create'),
        reports: DATASETS.map((name) => {
          const definition = DATASET_DEFINITIONS[name];
          return {
            name: definition.name,
            title: definition.title,
            grain: definition.grain,
            windowed: definition.windowed,
            drillThrough: definition.drillThrough,
            suppressed: definition.suppression !== undefined,
            models: definition.models,
            dimensions: definition.dimensions,
            metrics: definition.metrics,
          };
        }),
        // The ledger verbatim. A panel needs the failure detail to say "failing
        // since" rather than "failed", and D4 requires the previous data to
        // stay readable while it does.
        models: freshness,
      };
    },
  }),

  // Registered BEFORE `/:dataset`, or `refresh` is matched as a dataset name.
  defineRoute({
    method: 'POST',
    url: '/api/v1/authoring/reports/refresh',
    policy: 'reporting.refresh',
    portal: 'AUTHORING',
    summary: 'Refreshes the reporting read models now, rather than waiting for the schedule.',
    handler: async (ctx, _request, _reply, deps) => {
      // A RECOMPUTE, which is why it is not the read permission. The scheduled
      // job does the same thing every fifteen minutes; this exists so an
      // administrator who has just changed something does not have to wait, and
      // so the Refresh control on the dashboard means something.
      const started = systemClock.now();
      const outcomes = await refreshAllModels(deps.prisma as unknown as RefreshDb);
      const refreshed = outcomes.filter((outcome) => outcome.status === 'READY').length;
      const failed = outcomes.filter((outcome) => outcome.status === 'FAILED').length;

      await createAuditWriter({ clock: systemClock }).write(deps.prisma, {
        action: 'REPORT.RUN.MODELS_REFRESHED',
        outcome: failed > 0 ? 'FAILURE' : 'SUCCESS',
        actorType: 'USER',
        actorUserId: ctx.subject.userId,
        actorDisplayName: ctx.subject.displayName,
        actorRoles: [...ctx.subject.roles],
        entityType: 'ReportRun',
        entityId: 'reporting.read-models',
        correlationId: ctx.correlationId,
        requestId: ctx.requestId,
        portal: 'AUTHORING',
        detail: {
          refreshed,
          failed,
          models: outcomes.map((outcome) => outcome.model),
          durationMs: systemClock.now().getTime() - started.getTime(),
        },
      });

      // A partial failure is reported, not thrown: four refreshed models are
      // worth having, and the ledger already carries which one did not.
      return { refreshed, failed, outcomes };
    },
  }),

  // Registered BEFORE `/:dataset`, or `snapshots` is matched as a dataset name.
  defineRoute({
    method: 'GET',
    url: '/api/v1/authoring/reports/snapshots',
    policy: 'reporting.dataset.read',
    portal: 'AUTHORING',
    summary: 'Captured snapshots, newest first.',
    handler: async (_ctx, request, _reply, deps) => {
      const query = z
        .object({
          report: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(100).optional(),
        })
        .safeParse(request.query ?? {});
      const report =
        query.success && query.data.report !== undefined && isDatasetName(query.data.report)
          ? query.data.report
          : null;
      return {
        snapshots: await listSnapshots(
          deps.prisma as unknown as ReadOnlyDb,
          report,
          query.success ? (query.data.limit ?? 25) : 25,
        ),
      };
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/api/v1/authoring/reports/snapshots/:snapshotId',
    policy: 'reporting.dataset.read',
    portal: 'AUTHORING',
    summary: 'One snapshot with its header block and the rows as captured.',
    handler: async (ctx, request, reply, deps) => {
      const params = z.object({ snapshotId: z.string().uuid() }).safeParse(request.params);
      if (!params.success) {
        return problemReply(
          reply,
          ctx,
          request.url,
          'VALIDATION_FAILED',
          'A snapshot id is required.',
        );
      }
      const snapshot = await readSnapshot(
        deps.prisma as unknown as ReadOnlyDb,
        params.data.snapshotId,
      );
      if (snapshot === null) {
        return problemReply(
          reply,
          ctx,
          request.url,
          'NOT_FOUND',
          'No snapshot with that id exists.',
        );
      }
      return snapshot;
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/api/v1/authoring/reports/:dataset',
    policy: 'reporting.dataset.read',
    portal: 'AUTHORING',
    summary: 'One dataset, scoped and suppressed inside the read model, with asOf and formulas.',
    handler: async (ctx, request, reply, deps) => {
      const params = DatasetParams.safeParse(request.params);
      const query = Query.safeParse(request.query ?? {});
      if (!params.success || !isDatasetName(params.data.dataset) || !query.success) {
        return problemReply(
          reply,
          ctx,
          request.url,
          'VALIDATION_FAILED',
          `A known report is required. Known reports: ${DATASETS.join(', ')}.`,
        );
      }

      const { result, cached } = await runCached(
        deps,
        requestOf(ctx, params.data.dataset, query.data, await minimumGroupSizeFor(deps)),
      );
      return { ...result, cached };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/api/v1/authoring/reports/:dataset/export',
    policy: 'reporting.export',
    portal: 'AUTHORING',
    summary: 'The same dataset as CSV, with the header block, and audited.',
    handler: async (ctx, request, reply, deps) => {
      const params = DatasetParams.safeParse(request.params);
      // The window arrives in the BODY here, because this is a POST. Same
      // schema, so an export cannot accept a window the screen cannot.
      const body = Query.safeParse(request.body ?? {});
      if (!params.success || !isDatasetName(params.data.dataset) || !body.success) {
        return problemReply(
          reply,
          ctx,
          request.url,
          'VALIDATION_FAILED',
          `A known report is required. Known reports: ${DATASETS.join(', ')}.`,
        );
      }

      const datasetRequest = requestOf(
        ctx,
        params.data.dataset,
        body.data,
        await minimumGroupSizeFor(deps),
      );
      // The SAME function the screen calls. The export re-evaluates the
      // exporter's own scope at export time (§8.1) rather than reusing
      // anything captured earlier.
      const { result } = await runCached(deps, datasetRequest);

      const csv = toDatasetCsv(result, {
        exporterDisplayName: ctx.subject.displayName,
        exportedAt: systemClock.now(),
        effectiveScope:
          datasetRequest.scope.domainIds === null
            ? 'All domains'
            : `${datasetRequest.scope.domainIds.length} domain(s)`,
      });

      // §8.1: the export itself is audited, with what it contained and how much
      // was withheld. An export nobody can account for is the one that turns up
      // in an incident.
      await createAuditWriter({ clock: systemClock }).write(deps.prisma, {
        action: 'REPORT.RUN.EXPORTED',
        outcome: 'SUCCESS',
        actorType: 'USER',
        actorUserId: ctx.subject.userId,
        actorDisplayName: ctx.subject.displayName,
        actorRoles: [...ctx.subject.roles],
        entityType: 'ReportRun',
        entityId: params.data.dataset,
        entityLabel: result.title,
        correlationId: ctx.correlationId,
        requestId: ctx.requestId,
        portal: 'AUTHORING',
        detail: {
          // `reportKey`, the name the existing allow-list uses. A near-duplicate
          // `report` would be dropped and appear as `_droppedKeys`.
          reportKey: params.data.dataset,
          format: 'CSV',
          rowCount: result.rowCount,
          suppressedCellCount: result.suppressedCellCount,
          minimumGroupSize: result.minimumGroupSize,
          asOf: result.asOf,
        },
      });

      // The CSV as a STRING, not as a byte stream with a disposition header.
      // The portal turns it into a download in the browser, which keeps one
      // response shape across the API and means the export is audited before
      // the bytes exist -- the same arrangement the Audit Explorer uses.
      const stamp = systemClock.now().toISOString().slice(0, 10);
      return {
        filename: `knowzy-${params.data.dataset}-${stamp}.csv`,
        csv,
        rowCount: result.rowCount,
        suppressedCellCount: result.suppressedCellCount,
        asOf: result.asOf,
      };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/api/v1/authoring/reports/:dataset/snapshots',
    policy: 'reporting.snapshot',
    portal: 'AUTHORING',
    summary: 'Captures the dataset as it stands, with its header block. Not a publication.',
    handler: async (ctx, request, reply, deps) => {
      const params = DatasetParams.safeParse(request.params);
      const body = z
        .object({
          label: z.string().min(3).max(200),
          reason: z.string().max(500).optional(),
          windowDays: z.coerce.number().int().min(1).max(365).optional(),
        })
        .strict()
        .safeParse(request.body ?? {});
      if (!params.success || !isDatasetName(params.data.dataset) || !body.success) {
        return problemReply(
          reply,
          ctx,
          request.url,
          'VALIDATION_FAILED',
          'A known report and a label of at least three characters are required.',
        );
      }

      const datasetRequest = requestOf(
        ctx,
        params.data.dataset,
        { windowDays: body.data.windowDays },
        await minimumGroupSizeFor(deps),
      );
      const { result } = await runCached(deps, datasetRequest);

      // REFUSED rather than stored with a fabricated timestamp. A snapshot of a
      // model that has never refreshed would carry an `asOf` of nothing, and a
      // snapshot's whole value is that it says when it was true.
      if (result.asOf === null) {
        return problemReply(
          reply,
          ctx,
          request.url,
          'VALIDATION_FAILED',
          'This report’s read models have never been refreshed, so there is nothing to capture ' +
            'and no point in time to record it against. Wait for the next refresh.',
        );
      }

      const snapshotId = await captureSnapshot(deps.prisma as unknown as RefreshDb, {
        report: params.data.dataset,
        label: body.data.label,
        reason: body.data.reason ?? null,
        result,
        scope: {
          domainIds: datasetRequest.scope.domainIds,
          sourceIds: datasetRequest.scope.sourceIds,
          minimumGroupSize: result.minimumGroupSize,
        },
        capturedByUserId: ctx.subject.userId,
        correlationId: ctx.correlationId,
      });

      await createAuditWriter({ clock: systemClock }).write(deps.prisma, {
        action: 'REPORT.RUN.SNAPSHOT_CAPTURED',
        outcome: 'SUCCESS',
        actorType: 'USER',
        actorUserId: ctx.subject.userId,
        actorDisplayName: ctx.subject.displayName,
        actorRoles: [...ctx.subject.roles],
        entityType: 'ReportSnapshot',
        entityId: snapshotId,
        entityLabel: body.data.label,
        correlationId: ctx.correlationId,
        requestId: ctx.requestId,
        portal: 'AUTHORING',
        detail: {
          reportKey: params.data.dataset,
          rowCount: result.rowCount,
          suppressedCellCount: result.suppressedCellCount,
          minimumGroupSize: result.minimumGroupSize,
          asOf: result.asOf,
        },
      });

      return { snapshotId, report: params.data.dataset, asOf: result.asOf };
    },
  }),
];
