// Audit event construction — audit-model.md §3 and §5.
//
// The writer takes a TYPED event, not a free-form object, so redaction is not
// a filter that can be forgotten (U4). This module builds and redacts the row;
// @knowzy/database performs the insert inside the caller's transaction, which
// is what makes the audit write share the transaction of the state change it
// describes (U1).

import {
  AUDIT_ACTIONS,
  AUDIT_EVENT_SCHEMA_VERSION,
  HIGH_SEVERITY_ACTIONS,
  auditCategoryOf,
  auditFamilyOf,
  type AuditAction,
  type AuditCategory,
  type AuditEventInput,
  type AuditOutcome,
  type AuditSeverity,
} from '@knowzy/shared-types';
import type { Clock } from './clock.js';
import { classifyUserAgent, redact, truncateIp } from './redaction.js';

const ACTION_SET: ReadonlySet<string> = new Set<string>(AUDIT_ACTIONS);
const HIGH_SEVERITY_SET: ReadonlySet<string> = new Set<string>(HIGH_SEVERITY_ACTIONS);

/**
 * Detail keys permitted on every action. Identifiers, counts, codes, and
 * outcomes — never content, never a value.
 */
const UNIVERSAL_DETAIL_KEYS: readonly string[] = [
  'reason',
  'reasonCode',
  'errorCode',
  'count',
  'durationMs',
  'attemptCount',
  'version',
  'previousStatus',
  'newStatus',
  'mode',
  'trigger',
  'scheduleKey',
  'clientTraceId',
];

/**
 * Per-action allow-lists — H3. Anything not listed here or in
 * UNIVERSAL_DETAIL_KEYS is dropped, and the drop is recorded, so the rule
 * fails closed: a new action logs identifiers until someone declares what else
 * it may carry.
 *
 * Phase 1 declares the actions Phase 1 emits. Later phases extend this table
 * alongside the behaviour that needs it.
 */
const DETAIL_ALLOWLIST: Partial<Record<AuditAction, readonly string[]>> = {
  'ADMIN.ACCESS.BOOTSTRAPPED': ['entraObjectIds', 'roleKey'],
  'ADMIN.ACCESS.ROLE_GRANTED': ['roleKey', 'targetUserId'],
  'ADMIN.ACCESS.ROLE_REVOKED': ['roleKey', 'targetUserId'],
  'ADMIN.ACCESS.SCOPE_CHANGED': ['dimension', 'targetUserId', 'added', 'removed'],
  'ADMIN.ACCESS.PORTAL_ACCESS_CHANGED': ['targetUserId', 'authoring', 'live'],
  'ADMIN.CONFIGURATION.UPDATED': ['key', 'scope', 'scopeId', 'valueType'],
  'ADMIN.FEATUREFLAG.ENABLED': ['key', 'environment', 'ceiling'],
  'ADMIN.FEATUREFLAG.DISABLED': ['key', 'environment'],
  'ADMIN.FEATUREFLAG.ROLLOUT_CHANGED': ['key', 'environment'],
  'ADMIN.RETENTION.EXECUTED': ['target', 'removedCount', 'evaluatedAt', 'cutoff'],
  'ADMIN.TAXONOMY.DOMAIN_CREATED': ['code', 'name'],
  'ADMIN.TAXONOMY.TOPIC_CREATED': ['domainCode', 'slug'],
  'ADMIN.USER.PROVISIONED': ['entraObjectId', 'source'],
  'ADMIN.USER.RECONCILED': ['added', 'flaggedForRemoval'],
  'PLATFORM.AUTH.SIGN_IN_SUCCEEDED': ['portal'],
  'PLATFORM.AUTH.SIGN_IN_FAILED': ['portal', 'stage'],
  'PLATFORM.AUTH.TOKEN_REJECTED': ['reasonDetail'],
  'PLATFORM.AUTH.PORTAL_ACCESS_DENIED': ['portal'],
  'PLATFORM.SECURITY.AUTHORIZATION_DENIED': ['policyName', 'route', 'permission'],
  'PLATFORM.SECURITY.RESPONSE_SHAPE_VIOLATION': ['route', 'offendingKey'],
  'PLATFORM.SECURITY.ENVELOPE_VERIFICATION_FAILED': ['tool', 'reasonDetail'],
  'PLATFORM.SECURITY.RATE_LIMIT_EXCEEDED': ['route', 'routeClass'],
  'PLATFORM.SECURITY.BREAK_GLASS_USED': ['policyName', 'justificationLength'],
  'PLATFORM.JOB.CLAIMED': ['jobType', 'jobRunId'],
  'PLATFORM.JOB.SUCCEEDED': ['jobType', 'jobRunId', 'itemsProcessed'],
  'PLATFORM.JOB.FAILED': ['jobType', 'jobRunId'],
  'PLATFORM.JOB.RETRIED': ['jobType', 'jobRunId'],
  'PLATFORM.JOB.QUARANTINED': ['jobType', 'jobRunId'],
  'PLATFORM.JOB.CONSISTENCY_DRIFT_DETECTED': ['checkKey', 'findingCount'],
};

/** Actions for which previousValue/newValue are populated — H2. */
const VALUE_DIFF_ACTIONS: ReadonlySet<string> = new Set<string>([
  'ADMIN.CONFIGURATION.UPDATED',
  'ADMIN.FEATUREFLAG.ENABLED',
  'ADMIN.FEATUREFLAG.DISABLED',
  'ADMIN.FEATUREFLAG.ROLLOUT_CHANGED',
  'ADMIN.FIELDMAPPING.CREATED',
  'ADMIN.FIELDMAPPING.UPDATED',
  'ADMIN.FIELDMAPPING.ACTIVATED',
  'ADMIN.FIELDMAPPING.RETIRED',
  'ADMIN.ACCESS.ROLE_GRANTED',
  'ADMIN.ACCESS.ROLE_REVOKED',
  'ADMIN.ACCESS.SCOPE_CHANGED',
  'ADMIN.ACCESS.PORTAL_ACCESS_CHANGED',
  'ADMIN.ACCESS.SOURCE_ACCESS_CHANGED',
  'ADMIN.TAXONOMY.DOMAIN_UPDATED',
  'ADMIN.TAXONOMY.TOPIC_MERGED',
  'ADMIN.TAXONOMY.TOPIC_RENAMED',
  'ADMIN.SOURCE.UPDATED',
  'ADMIN.SOURCE.RESTRICTIONS_CHANGED',
  'ADMIN.SOURCE.PATH_MODIFIED',
]);

export class UnknownAuditActionError extends Error {
  constructor(action: string) {
    super(
      `Unknown audit action "${action}". Add it to the taxonomy in ` +
        `@knowzy/shared-types (audit-model.md §2) before emitting it.`,
    );
    this.name = 'UnknownAuditActionError';
  }
}

/** The row shape handed to the database layer for insertion. */
export interface AuditEventRow {
  action: string;
  family: string;
  category: AuditCategory;
  outcome: AuditOutcome;
  severity: AuditSeverity;
  actorType: 'USER' | 'SYSTEM' | 'MODEL';
  actorUserId: string | null;
  actorDisplayName: string | null;
  actorRoles: string[];
  onBehalfOfUserId: string | null;
  entityType: string;
  entityId: string | null;
  entityLabel: string | null;
  domainId: string | null;
  sourceId: string | null;
  previousValue: unknown;
  newValue: unknown;
  detail: Record<string, unknown>;
  correlationId: string;
  requestId: string | null;
  portal: 'AUTHORING' | 'LIVE' | 'SYSTEM' | null;
  ipAddress: string | null;
  userAgentClass: string | null;
  policyName: string | null;
  denyReason: string | null;
  errorCode: string | null;
  schemaVersion: number;
  occurredAt: Date;
}

const defaultSeverity = (action: string, outcome: AuditOutcome): AuditSeverity => {
  if (HIGH_SEVERITY_SET.has(action)) return 'HIGH';
  if (outcome === 'DENIED') return 'WARNING';
  if (outcome === 'FAILURE') return 'WARNING';
  return 'INFO';
};

const filterDetail = (action: string, detail: Record<string, unknown>): Record<string, unknown> => {
  const allowed = new Set<string>([
    ...UNIVERSAL_DETAIL_KEYS,
    ...(DETAIL_ALLOWLIST[action as AuditAction] ?? []),
  ]);

  const out: Record<string, unknown> = {};
  const dropped: string[] = [];

  for (const [key, value] of Object.entries(detail)) {
    if (allowed.has(key)) {
      out[key] = value;
    } else {
      dropped.push(key);
    }
  }

  if (dropped.length > 0) {
    // Recorded rather than silently swallowed: a dropped key is a signal that
    // the allow-list needs extending, and hiding it would make H3 invisible.
    out['_droppedKeys'] = dropped.sort();
  }

  return out;
};

export interface BuildAuditEventOptions {
  readonly clock: Clock;
  /** Raw user agent; classified and discarded (§5). */
  readonly userAgent?: string | null;
}

/**
 * Builds a redacted, taxonomy-validated audit row.
 *
 * Throws UnknownAuditActionError for an undeclared action. That is deliberate:
 * U1 couples the audit write to the state change, so an unknown action fails
 * the transition rather than producing an unattributable record.
 */
export const buildAuditEvent = (
  input: AuditEventInput,
  options: BuildAuditEventOptions,
): AuditEventRow => {
  const action = input.action;
  if (!ACTION_SET.has(action)) {
    throw new UnknownAuditActionError(action);
  }

  const typedAction = action as AuditAction;
  const outcome: AuditOutcome = input.outcome ?? 'SUCCESS';
  const carriesValueDiff = VALUE_DIFF_ACTIONS.has(action);

  return {
    action,
    family: auditFamilyOf(typedAction),
    category: auditCategoryOf(typedAction),
    outcome,
    severity: input.severity ?? defaultSeverity(action, outcome),

    actorType: input.actorType ?? 'USER',
    actorUserId: input.actorUserId ?? null,
    actorDisplayName: input.actorDisplayName ?? null,
    actorRoles: [...(input.actorRoles ?? [])],
    onBehalfOfUserId: input.onBehalfOfUserId ?? null,

    entityType: input.entityType,
    entityId: input.entityId ?? null,
    entityLabel: input.entityLabel ?? null,
    domainId: input.domainId ?? null,
    sourceId: input.sourceId ?? null,

    // H2 — value diffs only for the actions that declare them. Question content
    // never lands here; the field-level diff lives in draft_question_version.
    previousValue: carriesValueDiff ? redact(input.previousValue ?? null) : null,
    newValue: carriesValueDiff ? redact(input.newValue ?? null) : null,

    detail: redact(filterDetail(action, input.detail ?? {})) as Record<string, unknown>,

    correlationId: input.correlationId,
    requestId: input.requestId ?? null,
    portal: input.portal ?? null,
    ipAddress: truncateIp(input.ipAddress ?? null),
    userAgentClass: input.userAgentClass ?? classifyUserAgent(options.userAgent ?? null),
    policyName: input.policyName ?? null,
    denyReason: input.denyReason ?? null,
    errorCode: input.errorCode ?? null,
    schemaVersion: AUDIT_EVENT_SCHEMA_VERSION,
    occurredAt: options.clock.now(),
  };
};

export const isKnownAuditAction = (action: string): action is AuditAction => ACTION_SET.has(action);

export { DETAIL_ALLOWLIST, UNIVERSAL_DETAIL_KEYS, VALUE_DIFF_ACTIONS };
