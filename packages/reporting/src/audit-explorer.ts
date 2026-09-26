// The Audit Explorer read model — authoring-portal.md §10, audit-model.md §7.
//
// The first Phase 10 read model, and the one with the most to read: the store
// already holds 64,479 events written by every milestone since M1.
//
// Two properties of the audit store shape everything here:
//
//   1. REDACTION HAPPENED AT WRITE TIME. audit-model.md §7 is explicit that
//      auditors read audit data UNSCOPED, and that this is safe precisely
//      because no secret, token or document body was ever written. So this read
//      model does NOT re-filter by scope, and it does not redact on display —
//      doing either would give an auditor partial visibility, and an auditor
//      with partial visibility cannot audit.
//
//   2. THE STORE IS APPEND-ONLY AND SEVEN YEARS DEEP. Every query is bounded:
//      a window, a page size, and a cap. An explorer that could ask for
//      everything would eventually ask for everything.
//
// Raw SQL lives here by permission: repository-structure.md §5 reserves it for
// this package and the similarity module. It is parameterized throughout —
// every filter value is bound, never interpolated.

import type { AuditAction, AuditCategory, AuditOutcome } from '@knowzy/shared-types';

/**
 * The minimal database surface this module needs.
 *
 * Declared structurally rather than imported: `@knowzy/reporting` does not
 * depend on `@knowzy/database`, and a read model that took a full Prisma client
 * would be able to write.
 */
export interface ReadOnlyDb {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
}

export interface AuditFilters {
  readonly from?: Date | undefined;
  readonly to?: Date | undefined;
  readonly actorUserId?: string | undefined;
  readonly action?: string | undefined;
  /** A family prefix such as `AUTHORING.GENERATION`, matched as `FAMILY.%`. */
  readonly family?: string | undefined;
  readonly category?: AuditCategory | undefined;
  readonly entityType?: string | undefined;
  readonly entityId?: string | undefined;
  readonly outcome?: AuditOutcome | undefined;
  readonly correlationId?: string | undefined;
  readonly page?: number | undefined;
  readonly pageSize?: number | undefined;
}

export interface AuditRow {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly action: string;
  readonly category: string;
  readonly outcome: string;
  readonly severity: string;
  readonly actorType: string;
  readonly actorUserId: string | null;
  readonly actorDisplayName: string;
  readonly actorRoles: readonly string[];
  readonly entityType: string;
  readonly entityId: string | null;
  readonly entityLabel: string | null;
  readonly correlationId: string;
  readonly portal: string | null;
  /** Present on a denial. Never a stack trace. */
  readonly denyReason: string | null;
}

export interface AuditDetail extends AuditRow {
  readonly requestId: string | null;
  readonly ipAddress: string | null;
  readonly policyName: string | null;
  readonly domainId: string | null;
  readonly sourceId: string | null;
  readonly detail: Readonly<Record<string, unknown>>;
  readonly previousValue: unknown;
  readonly newValue: unknown;
  /** Every event sharing this correlation id, oldest first (§10). */
  readonly trace: readonly {
    readonly eventId: string;
    readonly occurredAt: string;
    readonly action: string;
    readonly outcome: string;
    readonly actorDisplayName: string;
  }[];
}

export interface AuditPage {
  readonly rows: readonly AuditRow[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly windowFrom: string;
  readonly windowTo: string;
  /** Counts by outcome over the FILTERED set, for the summary tiles. */
  readonly outcomeCounts: Readonly<Record<string, number>>;
  /** The busiest actions in the filtered window, for the facet list. */
  readonly topActions: readonly { readonly action: string; readonly count: number }[];
  /** Whether the filtered set exceeds what one page can show. */
  readonly truncated: boolean;
}

/** A page is capped: an explorer that can ask for everything eventually does. */
export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 50;
/** Default window. Stated on the screen rather than implying "all time". */
export const DEFAULT_WINDOW_DAYS = 30;

interface Bound {
  readonly clauses: readonly string[];
  readonly values: readonly unknown[];
  readonly from: Date;
  readonly to: Date;
}

/**
 * Build the WHERE clause with positional parameters.
 *
 * Every value is bound. The only thing interpolated into SQL anywhere in this
 * module is a parameter INDEX, which is generated here and never derived from
 * input — the difference between a parameterized query and a clever one.
 */
const bind = (filters: AuditFilters): Bound => {
  const to = filters.to ?? new Date();
  const from = filters.from ?? new Date(to.getTime() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const clauses: string[] = ['occurred_at >= $1', 'occurred_at <= $2'];
  const values: unknown[] = [from, to];
  const next = (): string => `$${values.length + 1}`;

  if (filters.actorUserId !== undefined) {
    clauses.push(`actor_user_id = ${next()}::uuid`);
    values.push(filters.actorUserId);
  }
  if (filters.action !== undefined) {
    clauses.push(`action = ${next()}`);
    values.push(filters.action);
  }
  if (filters.family !== undefined) {
    clauses.push(`action LIKE ${next()}`);
    values.push(`${filters.family}.%`);
  }
  if (filters.category !== undefined) {
    clauses.push(`category = ${next()}`);
    values.push(filters.category);
  }
  if (filters.entityType !== undefined) {
    clauses.push(`entity_type = ${next()}`);
    values.push(filters.entityType);
  }
  if (filters.entityId !== undefined) {
    clauses.push(`entity_id = ${next()}`);
    values.push(filters.entityId);
  }
  if (filters.outcome !== undefined) {
    clauses.push(`outcome = ${next()}`);
    values.push(filters.outcome);
  }
  if (filters.correlationId !== undefined) {
    clauses.push(`correlation_id = ${next()}`);
    values.push(filters.correlationId);
  }

  return { clauses, values, from, to };
};

const ROW_COLUMNS = `
  id::text                AS "eventId",
  occurred_at             AS "occurredAt",
  action,
  category,
  outcome,
  severity,
  actor_type              AS "actorType",
  actor_user_id::text     AS "actorUserId",
  actor_display_name      AS "actorDisplayName",
  actor_roles             AS "actorRoles",
  entity_type             AS "entityType",
  entity_id::text         AS "entityId",
  entity_label            AS "entityLabel",
  correlation_id          AS "correlationId",
  portal,
  deny_reason             AS "denyReason"
`;

const iso = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : String(value);

const toRow = (raw: Record<string, unknown>): AuditRow => ({
  eventId: String(raw['eventId']),
  occurredAt: iso(raw['occurredAt']),
  action: String(raw['action']),
  category: String(raw['category']),
  outcome: String(raw['outcome']),
  severity: String(raw['severity']),
  actorType: String(raw['actorType']),
  actorUserId: raw['actorUserId'] === null ? null : String(raw['actorUserId']),
  actorDisplayName: String(raw['actorDisplayName'] ?? ''),
  actorRoles: Array.isArray(raw['actorRoles']) ? (raw['actorRoles'] as string[]) : [],
  entityType: String(raw['entityType']),
  entityId: raw['entityId'] === null ? null : String(raw['entityId']),
  entityLabel: raw['entityLabel'] === null ? null : String(raw['entityLabel']),
  correlationId: String(raw['correlationId']),
  portal: raw['portal'] === null ? null : String(raw['portal']),
  denyReason: raw['denyReason'] === null ? null : String(raw['denyReason']),
});

export const getAuditEvents = async (
  db: ReadOnlyDb,
  filters: AuditFilters = {},
): Promise<AuditPage> => {
  const { clauses, values, from, to } = bind(filters);
  const where = clauses.join(' AND ');
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, filters.pageSize ?? DEFAULT_PAGE_SIZE));
  const page = Math.max(1, filters.page ?? 1);
  const offset = (page - 1) * pageSize;

  const rows = await db.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT ${ROW_COLUMNS}
       FROM audit_event
      WHERE ${where}
      ORDER BY occurred_at DESC, id DESC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    ...values,
    pageSize,
    offset,
  );

  const [count] = await db.$queryRawUnsafe<{ total: bigint | number }[]>(
    `SELECT count(*)::bigint AS total FROM audit_event WHERE ${where}`,
    ...values,
  );
  const total = Number(count?.total ?? 0);

  const outcomes = await db.$queryRawUnsafe<{ outcome: string; count: bigint | number }[]>(
    `SELECT outcome, count(*)::bigint AS count
       FROM audit_event
      WHERE ${where}
      GROUP BY outcome`,
    ...values,
  );

  const actions = await db.$queryRawUnsafe<{ action: string; count: bigint | number }[]>(
    `SELECT action, count(*)::bigint AS count
       FROM audit_event
      WHERE ${where}
      GROUP BY action
      ORDER BY count DESC
      LIMIT 8`,
    ...values,
  );

  return {
    rows: rows.map(toRow),
    total,
    page,
    pageSize,
    windowFrom: from.toISOString(),
    windowTo: to.toISOString(),
    outcomeCounts: Object.fromEntries(outcomes.map((row) => [row.outcome, Number(row.count)])),
    topActions: actions.map((row) => ({ action: row.action, count: Number(row.count) })),
    truncated: total > page * pageSize,
  };
};

/**
 * One event, with its correlated trace.
 *
 * The trace is the §10 requirement that makes this an explorer rather than a
 * log viewer: every event sharing a correlation id, in order, across API, MCP
 * and the job runner — so "what did this one click actually do?" is answerable.
 */
export const getAuditEvent = async (
  db: ReadOnlyDb,
  eventId: string,
): Promise<AuditDetail | null> => {
  const [row] = await db.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT ${ROW_COLUMNS},
            request_id      AS "requestId",
            ip_address::text AS "ipAddress",
            policy_name     AS "policyName",
            domain_id::text AS "domainId",
            source_id::text AS "sourceId",
            detail,
            previous_value  AS "previousValue",
            new_value       AS "newValue"
       FROM audit_event
      WHERE id = $1::uuid`,
    eventId,
  );
  if (row === undefined) return null;

  const trace = await db.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT id::text AS "eventId", occurred_at AS "occurredAt", action, outcome,
            actor_display_name AS "actorDisplayName"
       FROM audit_event
      WHERE correlation_id = $1
      ORDER BY occurred_at ASC, id ASC
      LIMIT 50`,
    String(row['correlationId']),
  );

  return {
    ...toRow(row),
    requestId: row['requestId'] === null ? null : String(row['requestId']),
    ipAddress: row['ipAddress'] === null ? null : String(row['ipAddress']),
    policyName: row['policyName'] === null ? null : String(row['policyName']),
    domainId: row['domainId'] === null ? null : String(row['domainId']),
    sourceId: row['sourceId'] === null ? null : String(row['sourceId']),
    detail: (row['detail'] ?? {}) as Record<string, unknown>,
    previousValue: row['previousValue'] ?? null,
    newValue: row['newValue'] ?? null,
    trace: trace.map((entry) => ({
      eventId: String(entry['eventId']),
      occurredAt: iso(entry['occurredAt']),
      action: String(entry['action']),
      outcome: String(entry['outcome']),
      actorDisplayName: String(entry['actorDisplayName'] ?? ''),
    })),
  };
};

/**
 * The facets the filter controls offer.
 *
 * Read from the STORE rather than from the action registry, and the difference
 * matters: the registry lists 159 declared actions, of which a fraction have
 * ever been written. Offering a filter value that can only ever return nothing
 * wastes the reader's time and makes the screen look broken.
 */
export const getAuditFacets = async (
  db: ReadOnlyDb,
  windowDays = DEFAULT_WINDOW_DAYS,
): Promise<{
  readonly actions: readonly string[];
  readonly families: readonly string[];
  readonly entityTypes: readonly string[];
  readonly actors: readonly { readonly userId: string; readonly displayName: string }[];
}> => {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const actions = await db.$queryRawUnsafe<{ action: string }[]>(
    `SELECT DISTINCT action FROM audit_event WHERE occurred_at >= $1 ORDER BY action`,
    since,
  );
  const entityTypes = await db.$queryRawUnsafe<{ entity_type: string }[]>(
    `SELECT DISTINCT entity_type FROM audit_event WHERE occurred_at >= $1 ORDER BY entity_type`,
    since,
  );
  const actors = await db.$queryRawUnsafe<{ userId: string; displayName: string }[]>(
    `SELECT DISTINCT actor_user_id::text AS "userId", actor_display_name AS "displayName"
       FROM audit_event
      WHERE occurred_at >= $1 AND actor_user_id IS NOT NULL
      ORDER BY "displayName"`,
    since,
  );

  const families = [
    ...new Set(
      actions.map((row) => row.action.split('.').slice(0, 2).join('.')).filter((f) => f.length > 0),
    ),
  ].sort();

  return {
    actions: actions.map((row) => row.action),
    families,
    entityTypes: entityTypes.map((row) => row.entity_type),
    actors,
  };
};

/**
 * The CSV of a filtered set, for the audited export (§10).
 *
 * Formula injection is prevented by prefixing any cell that begins with a
 * formula character — `reporting.md` requires it, and a CSV opened in Excel is
 * the one place a stored `=HYPERLINK(...)` becomes code. `detail` is
 * deliberately NOT exported: it is a JSON object per row, it would make the
 * file unreadable, and the detail view exists for reading it.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

export const auditCsvCell = (value: unknown): string => {
  const text = value === null || value === undefined ? '' : String(value);
  const guarded = FORMULA_START.test(text) ? `'${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
};

export const AUDIT_CSV_HEADER = [
  'occurredAt',
  'action',
  'category',
  'outcome',
  'severity',
  'actorDisplayName',
  'actorRoles',
  'entityType',
  'entityLabel',
  'correlationId',
  'portal',
  'denyReason',
] as const;

export const toAuditCsv = (rows: readonly AuditRow[]): string => {
  const header = AUDIT_CSV_HEADER.map(auditCsvCell).join(',');
  const body = rows.map((row) =>
    [
      row.occurredAt,
      row.action,
      row.category,
      row.outcome,
      row.severity,
      row.actorDisplayName,
      row.actorRoles.join(' '),
      row.entityType,
      row.entityLabel,
      row.correlationId,
      row.portal,
      row.denyReason,
    ]
      .map(auditCsvCell)
      .join(','),
  );
  return [header, ...body].join('\r\n');
};

/** Re-exported so a caller can type a filter without importing shared-types. */
export type { AuditAction };
