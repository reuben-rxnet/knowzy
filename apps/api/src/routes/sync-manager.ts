// SharePoint Sync Manager — the reads and the batch action its dashboard needs.
//
//   GET  /authoring/sync/overview    workflows, KPIs and activity in one read
//   POST /authoring/sync/sync-all    synchronize every eligible source
//
// WHAT THIS MODULE IS CAREFUL ABOUT, stated first because the screen it feeds
// is an operations console and an operations console that lies is worse than
// no console:
//
//   * Every figure is a count of rows that exist. There are no trends, no
//     "vs last month", no projections. Nothing in this platform stores KPI
//     history, so nothing here can compute a comparison.
//   * `PENDING` is only reported where a schedule really exists and a next run
//     is really stored. Until SYNC-M3 wrote a scheduler, that number would
//     have been a guess.
//   * The product synchronizes sources INTO Knowzy. It does not replicate one
//     SharePoint location into another, and no field here pretends otherwise.
//
// Scope trimming is the caller's own `scope.sourceIds` (P3), applied in the
// query rather than after it: a source outside the caller's allow-list is
// absent, not filtered from a payload it was already in.

import { z } from 'zod';
import { systemClock } from '@knowzy/observability';
import { nextRunAt, revalidatePreparedVersions, scheduleOf } from '@knowzy/domain';
import { defineRoute, type RouteContext, type RouteDeps } from '../http/route.js';
import { toProblem } from '../http/problem.js';
import type { FastifyReply } from 'fastify';
import { sourceWorkflowStatus, type ErrorCode } from '@knowzy/shared-types';
import type { McpClient } from '../mcp/client.js';

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

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const sourceScope = (ctx: RouteContext) =>
  ctx.scope.sourceIds.length > 0 ? { id: { in: [...ctx.scope.sourceIds] } } : {};

/** A run, reduced to what an operator reads in a table. */
interface RunView {
  readonly syncId: string;
  readonly outcome: string;
  readonly mode: string;
  readonly trigger: string;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly durationMs: number | null;
  readonly scanned: number;
  readonly added: number;
  readonly modified: number;
  readonly unchanged: number;
  readonly failed: number;
  readonly skipped: number;
  readonly extractedChars: number;
  readonly errorSummary: unknown;
}

const runView = (row: {
  id: string;
  outcome: string;
  mode: string;
  trigger: string;
  startedAt: Date;
  completedAt: Date | null;
  durationMs: number | null;
  itemsScanned: number;
  itemsAdded: number;
  itemsModified: number;
  itemsUnchanged: number;
  itemsFailed: number;
  itemsSkipped: number;
  extractedCharCount: number;
  errorSummary: unknown;
}): RunView => ({
  syncId: row.id,
  outcome: row.outcome,
  mode: row.mode,
  trigger: row.trigger,
  startedAt: row.startedAt.toISOString(),
  completedAt: row.completedAt?.toISOString() ?? null,
  durationMs: row.durationMs,
  scanned: row.itemsScanned,
  added: row.itemsAdded,
  modified: row.itemsModified,
  unchanged: row.itemsUnchanged,
  failed: row.itemsFailed,
  skipped: row.itemsSkipped,
  extractedChars: row.extractedCharCount,
  errorSummary: row.errorSummary,
});

// The workflow status is derived by `sourceWorkflowStatus` in
// @knowzy/shared-types, shared with Reports → Knowledge Source Health so the two
// screens cannot disagree about the same source.

export const syncManagerRoutes = [
  defineRoute({
    method: 'GET',
    url: '/api/v1/authoring/sync/overview',
    policy: 'source.read',
    portal: 'AUTHORING',
    summary: 'Sync Manager dashboard: workflows, KPI counts, and recent activity.',
    handler: async (ctx, _request, _reply, deps) => {
      const now = new Date();
      const since = new Date(now.getTime() - THIRTY_DAYS_MS);

      const sources = await deps.prisma.knowledgeSource.findMany({
        where: sourceScope(ctx),
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
        include: {
          paths: {
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              containerName: true,
              folderPath: true,
              isActive: true,
              lastSuccessfulSyncAt: true,
            },
          },
          _count: { select: { documents: true } },
          syncRuns: {
            orderBy: { startedAt: 'desc' },
            take: 5,
            select: {
              id: true,
              outcome: true,
              mode: true,
              trigger: true,
              startedAt: true,
              completedAt: true,
              durationMs: true,
              itemsScanned: true,
              itemsAdded: true,
              itemsModified: true,
              itemsUnchanged: true,
              itemsFailed: true,
              itemsSkipped: true,
              extractedCharCount: true,
              errorSummary: true,
            },
          },
        },
      });

      const workflows = sources.map((source) => {
        const runs = source.syncRuns.map(runView);
        const lastRun = runs[0] ?? null;
        const lastSuccessful = runs.find((run) => run.outcome === 'SUCCEEDED') ?? null;
        const running = runs.filter((run) => run.outcome === 'RUNNING').length;
        const schedule = scheduleOf(source.syncSchedule);

        return {
          sourceId: source.id,
          name: source.name,
          description: source.description,
          sourceType: source.sourceType,
          isActive: source.isActive,
          archivedAt: source.archivedAt?.toISOString() ?? null,
          usableForGeneration: source.usableForGeneration,
          connectionStatus: source.connectionStatus,
          connectionStatusAt: source.connectionStatusAt?.toISOString() ?? null,
          documentCount: source._count.documents,
          paths: source.paths.map((path) => ({
            pathId: path.id,
            containerName: path.containerName,
            folderPath: path.folderPath,
            isActive: path.isActive,
            lastSuccessfulSyncAt: path.lastSuccessfulSyncAt?.toISOString() ?? null,
          })),
          schedule: {
            ...schedule,
            nextRunAt: nextRunAt(schedule, lastRun?.startedAt ?? null, now)?.toISOString() ?? null,
          },
          status: sourceWorkflowStatus({
            isActive: source.isActive,
            archivedAt: source.archivedAt,
            runningCount: running,
            lastOutcome: lastRun?.outcome ?? null,
            scheduleMode: schedule.mode,
          }),
          lastRun,
          lastSuccessfulRun: lastSuccessful,
          recentRuns: runs,
        };
      });

      // Counted over the same trimmed source set, so a KPI can never describe
      // a source the caller cannot see.
      const visibleIds = sources.map((source) => source.id);
      const runCounts = await deps.prisma.knowledgeSourceSync.groupBy({
        by: ['outcome'],
        where: { sourceId: { in: visibleIds }, startedAt: { gte: since } },
        _count: { _all: true },
      });
      const countOf = (outcome: string): number =>
        runCounts.find((row) => row.outcome === outcome)?._count._all ?? 0;

      const activity = await deps.prisma.knowledgeSourceSync.findMany({
        where: { sourceId: { in: visibleIds } },
        orderBy: { startedAt: 'desc' },
        take: 25,
        select: {
          id: true,
          sourceId: true,
          outcome: true,
          mode: true,
          trigger: true,
          startedAt: true,
          completedAt: true,
          durationMs: true,
          itemsScanned: true,
          itemsAdded: true,
          itemsModified: true,
          itemsUnchanged: true,
          itemsFailed: true,
          itemsSkipped: true,
          extractedCharCount: true,
          errorSummary: true,
          source: { select: { name: true } },
        },
      });

      return {
        asOf: now.toISOString(),
        windowDays: 30,
        workflows,
        kpis: {
          configuredSources: workflows.length,
          activeSources: workflows.filter((workflow) => workflow.isActive).length,
          // Every count below is over the 30-day window, and the window is in
          // the payload so the screen can say so rather than implying "ever".
          successfulRuns: countOf('SUCCEEDED'),
          partialRuns: countOf('PARTIAL'),
          failedRuns: countOf('FAILED'),
          runningRuns: countOf('RUNNING'),
          // Real only: a source that is active, not archived, and carries a
          // stored next run. A MANUAL source is never pending.
          pendingScheduled: workflows.filter(
            (workflow) =>
              workflow.isActive &&
              workflow.archivedAt === null &&
              workflow.schedule.mode !== 'MANUAL' &&
              workflow.schedule.nextRunAt !== null,
          ).length,
          documentsIndexed: workflows.reduce((sum, workflow) => sum + workflow.documentCount, 0),
        },
        connection: {
          // The service's own health, not a probe: this is what the platform
          // knows without going to the network.
          healthyConnections: workflows.filter(
            (workflow) => workflow.connectionStatus === 'HEALTHY',
          ).length,
          degradedConnections: workflows.filter((workflow) =>
            ['DEGRADED', 'UNTESTED'].includes(workflow.connectionStatus),
          ).length,
          failedConnections: workflows.filter((workflow) => workflow.connectionStatus === 'FAILED')
            .length,
          lastCheckedAt:
            workflows
              .map((workflow) => workflow.connectionStatusAt)
              .filter((value): value is string => value !== null)
              .sort()
              .at(-1) ?? null,
        },
        activity: activity.map((row) => ({
          ...runView(row),
          sourceId: row.sourceId,
          sourceName: row.source.name,
        })),
      };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/api/v1/authoring/sync/sync-all',
    policy: 'source.sync',
    portal: 'AUTHORING',
    summary: 'Synchronizes every eligible source, one result per source, failures isolated.',
    handler: async (ctx, request, reply, deps) => {
      const body = z
        .object({ mode: z.enum(['FULL', 'INCREMENTAL']).default('FULL') })
        .strict()
        .safeParse(request.body ?? {});
      if (!body.success) {
        return problemReply(reply, ctx, request.url, 'VALIDATION_FAILED', 'Invalid sync mode.');
      }

      // ELIGIBILITY, stated: active, not archived, and with at least one
      // configured path. A source with no path has nothing to scan, and
      // "synchronized 0 of 0" reads like a success.
      const eligible = await deps.prisma.knowledgeSource.findMany({
        where: {
          ...sourceScope(ctx),
          isActive: true,
          archivedAt: null,
          paths: { some: { isActive: true } },
        },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      });

      const skipped = await deps.prisma.knowledgeSource.findMany({
        where: {
          ...sourceScope(ctx),
          OR: [{ isActive: false }, { archivedAt: { not: null } }, { paths: { none: {} } }],
        },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, isActive: true, archivedAt: true },
      });

      // A source already running is NOT started again. pg-boss protects the
      // scheduled path; this protects the human one, and the two have to agree
      // or a Sync All during a scheduled run would double-scan.
      const running = await deps.prisma.knowledgeSourceSync.findMany({
        where: { sourceId: { in: eligible.map((source) => source.id) }, outcome: 'RUNNING' },
        select: { sourceId: true },
      });
      const alreadyRunning = new Set(running.map((row) => row.sourceId));

      const results: {
        sourceId: string;
        sourceName: string;
        outcome: string;
        detail: string;
        counts?: Readonly<Record<string, number>>;
      }[] = [];

      for (const source of eligible) {
        if (alreadyRunning.has(source.id)) {
          results.push({
            sourceId: source.id,
            sourceName: source.name,
            outcome: 'ALREADY_RUNNING',
            detail: 'A synchronization is already in progress for this source.',
          });
          continue;
        }

        // FAILURE ISOLATION: one source that cannot be reached must not stop
        // the rest. Sequential on purpose -- the adapters share a connection
        // budget and a parallel fan-out is how a batch turns into a throttle.
        try {
          const run = await (deps as RouteDeps & { mcp: McpClient }).mcp.call<{
            outcome: string;
            scanned: number;
            added: number;
            modified: number;
            unchanged: number;
            failed: number;
            skipped: number;
            extractedChars: number;
          }>({
            tool: 'synchronize_knowledge_source',
            subject: ctx.subject,
            scope: ctx.scope,
            portal: ctx.portal,
            correlationId: ctx.correlationId,
            requestId: ctx.requestId,
            arguments: { sourceId: source.id, mode: body.data.mode },
          });
          results.push({
            sourceId: source.id,
            sourceName: source.name,
            outcome: run.outcome,
            detail: `${run.scanned} scanned, ${run.added} added, ${run.modified} modified, ${run.failed} failed, ${run.skipped} skipped.`,
            counts: {
              scanned: run.scanned,
              added: run.added,
              modified: run.modified,
              unchanged: run.unchanged,
              failed: run.failed,
              skipped: run.skipped,
              extractedChars: run.extractedChars,
            },
          });
        } catch (error) {
          results.push({
            sourceId: source.id,
            sourceName: source.name,
            outcome: 'FAILED',
            detail: error instanceof Error ? error.message.slice(0, 400) : 'Unknown failure.',
          });
        }
      }

      // AI Document Studio M3 (§11.6): a changed original flags the versions
      // prepared from it, here rather than at the next Studio visit.
      await revalidatePreparedVersions({
        prisma: deps.prisma,
        clock: systemClock,
        correlationId: ctx.correlationId,
      });
      return {
        requestedMode: body.data.mode,
        requested: eligible.length,
        succeeded: results.filter((result) => result.outcome === 'SUCCEEDED').length,
        partial: results.filter((result) => result.outcome === 'PARTIAL').length,
        failed: results.filter((result) => result.outcome === 'FAILED').length,
        alreadyRunning: results.filter((result) => result.outcome === 'ALREADY_RUNNING').length,
        results,
        // Reported, not hidden: an operator who pressed "Sync All" needs to
        // know which sources it deliberately left alone.
        skipped: skipped.map((source) => ({
          sourceId: source.id,
          sourceName: source.name,
          reason:
            source.archivedAt !== null
              ? 'The source is archived.'
              : !source.isActive
                ? 'The source is paused.'
                : 'The source has no configured path to scan.',
        })),
      };
    },
  }),
];
