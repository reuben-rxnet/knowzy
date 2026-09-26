// The Audit Explorer — authoring-portal.md §10.
//
//   GET /authoring/governance/audit             filtered page + facets + counts
//   GET /authoring/governance/audit/:eventId    one event with its correlated trace
//   POST /authoring/governance/audit/export     the filtered set as CSV, audited
//
// AUTHORIZATION. Reading is `audit.read`, held by the Auditor and the KNOWZY
// Administrator. Exporting is `audit.export`, a separate grant: taking a copy
// of a seven-year store off the platform is a different act from looking at it,
// and audit-model.md §7 requires the export itself to be audited.
//
// UNSCOPED BY DESIGN. audit-model.md §7: "Auditors read audit data unscoped —
// redaction at write time is what makes that safe, and an auditor with partial
// visibility cannot audit." So this route does not filter by the caller's data
// scope, and that is a deliberate, documented exception rather than an
// oversight. It is safe only because no secret, token or document body was
// ever written.
//
// The export returns the CSV as a STRING in a JSON body rather than as a
// `text/csv` response, so every route in this API keeps one response shape and
// the browser download stays a client concern. The filename and row count come
// with it, so the UI states what it is handing over.

import { z } from 'zod';
import type { FastifyReply } from 'fastify';
import { getAuditEvent, getAuditEvents, getAuditFacets, toAuditCsv } from '@knowzy/reporting';
import type { ErrorCode } from '@knowzy/shared-types';
import { createAuditWriter } from '@knowzy/database';
import { systemClock } from '@knowzy/observability';
import { defineRoute, type RouteContext } from '../http/route.js';
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

/** A date that is absent, or a real one. An unparseable date is a refusal. */
const isoDate = z
  .string()
  .datetime({ offset: true })
  .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
  .optional();

const FilterSchema = z.object({
  from: isoDate,
  to: isoDate,
  actorUserId: z.string().uuid().optional(),
  action: z.string().max(120).optional(),
  family: z.string().max(60).optional(),
  category: z.enum(['ADMIN', 'AUTHORING', 'LEARNING', 'REPORT', 'PLATFORM']).optional(),
  entityType: z.string().max(60).optional(),
  entityId: z.string().max(120).optional(),
  outcome: z.enum(['SUCCESS', 'FAILURE', 'DENIED']).optional(),
  correlationId: z.string().max(120).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

/** Empty strings arrive from an HTML select; they mean "no filter". */
const clean = (query: unknown): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries((query ?? {}) as Record<string, unknown>).filter(
      ([, value]) => value !== '' && value !== undefined,
    ),
  );

const toFilters = (parsed: z.infer<typeof FilterSchema>) => ({
  ...(parsed.from === undefined ? {} : { from: new Date(parsed.from) }),
  ...(parsed.to === undefined ? {} : { to: new Date(parsed.to) }),
  ...(parsed.actorUserId === undefined ? {} : { actorUserId: parsed.actorUserId }),
  ...(parsed.action === undefined ? {} : { action: parsed.action }),
  ...(parsed.family === undefined ? {} : { family: parsed.family }),
  ...(parsed.category === undefined ? {} : { category: parsed.category }),
  ...(parsed.entityType === undefined ? {} : { entityType: parsed.entityType }),
  ...(parsed.entityId === undefined ? {} : { entityId: parsed.entityId }),
  ...(parsed.outcome === undefined ? {} : { outcome: parsed.outcome }),
  ...(parsed.correlationId === undefined ? {} : { correlationId: parsed.correlationId }),
  ...(parsed.page === undefined ? {} : { page: parsed.page }),
  ...(parsed.pageSize === undefined ? {} : { pageSize: parsed.pageSize }),
});

export const auditRoutes = [
  defineRoute({
    method: 'GET',
    url: '/api/v1/authoring/governance/audit',
    policy: 'governance.audit.read',
    portal: 'AUTHORING',
    summary: 'A filtered page of audit events, with facets and outcome counts.',
    handler: async (ctx, request, reply, deps) => {
      const parsed = FilterSchema.safeParse(clean(request.query));
      if (!parsed.success) {
        return problemReply(
          reply,
          ctx,
          request.url,
          'VALIDATION_FAILED',
          'A filter value was not understood. Dates must be ISO-8601 or YYYY-MM-DD.',
        );
      }

      const page = await getAuditEvents(deps.prisma, toFilters(parsed.data));
      const facets = await getAuditFacets(deps.prisma);
      return { ...page, facets };
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/api/v1/authoring/governance/audit/:eventId',
    policy: 'governance.audit.read',
    portal: 'AUTHORING',
    summary: 'One audit event with every event sharing its correlation id.',
    handler: async (ctx, request, reply, deps) => {
      const params = z.object({ eventId: z.string().uuid() }).safeParse(request.params);
      if (!params.success) {
        return problemReply(
          reply,
          ctx,
          request.url,
          'VALIDATION_FAILED',
          'An event id is required.',
        );
      }

      const event = await getAuditEvent(deps.prisma, params.data.eventId);
      if (event === null) {
        return problemReply(reply, ctx, request.url, 'NOT_FOUND', 'No such audit event.');
      }
      return event;
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/api/v1/authoring/governance/audit/export',
    policy: 'governance.audit.export',
    portal: 'AUTHORING',
    summary: 'The filtered set as CSV. The export is itself audited.',
    handler: async (ctx, request, reply, deps) => {
      const parsed = FilterSchema.safeParse(clean(request.body));
      if (!parsed.success) {
        return problemReply(
          reply,
          ctx,
          request.url,
          'VALIDATION_FAILED',
          'A filter value was not understood.',
        );
      }

      // The export takes the full page cap rather than the screen's page size:
      // an export of 50 rows when the filter matched 4,000 would be a quietly
      // wrong file, and a truncated export must say so.
      const filters = { ...toFilters(parsed.data), page: 1, pageSize: 200 };
      const page = await getAuditEvents(deps.prisma, filters);
      const csv = toAuditCsv(page.rows);

      const auditWriter = createAuditWriter({ clock: systemClock });
      await auditWriter.write(deps.prisma, {
        action: 'REPORT.RUN.EXPORTED',
        outcome: 'SUCCESS',
        actorType: 'USER',
        actorUserId: ctx.subject.userId,
        actorDisplayName: ctx.subject.displayName,
        actorRoles: [...ctx.subject.roles],
        entityType: 'AuditExport',
        entityId: null,
        entityLabel: 'audit-explorer',
        correlationId: ctx.correlationId,
        requestId: ctx.requestId,
        portal: 'AUTHORING',
        detail: {
          reportKey: 'audit-explorer',
          format: 'CSV',
          rowCount: page.rows.length,
          matchedCount: page.total,
          truncated: page.truncated,
          windowFrom: page.windowFrom,
          windowTo: page.windowTo,
        },
      });

      return {
        filename: `knowzy-audit-${page.windowFrom.slice(0, 10)}-to-${page.windowTo.slice(0, 10)}.csv`,
        rowCount: page.rows.length,
        matchedCount: page.total,
        // Stated, not hidden: a file holding 200 of 4,000 matched rows is a
        // different artifact from the whole set, and whoever opens it later
        // cannot tell unless the screen said so.
        truncated: page.truncated,
        csv,
      };
    },
  }),
];
