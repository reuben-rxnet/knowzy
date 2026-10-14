// Audit event shape (audit-model.md §3) and the 28-family action taxonomy (§2).
//
// The writer takes a typed event, not a free-form object, so redaction is not a
// filter that can be forgotten (§5). `detail` keys are allow-listed per action
// (H3) — the allow-list lives with the writer in @knowzy/observability.

import { z } from 'zod';

export const AUDIT_CATEGORIES = ['ADMIN', 'AUTHORING', 'LEARNING', 'REPORT', 'PLATFORM'] as const;
export const AuditCategorySchema = z.enum(AUDIT_CATEGORIES);
export type AuditCategory = z.infer<typeof AuditCategorySchema>;

export const AUDIT_OUTCOMES = ['SUCCESS', 'FAILURE', 'DENIED'] as const;
export const AuditOutcomeSchema = z.enum(AUDIT_OUTCOMES);
export type AuditOutcome = z.infer<typeof AuditOutcomeSchema>;

export const AUDIT_SEVERITIES = ['INFO', 'NOTICE', 'WARNING', 'HIGH'] as const;
export const AuditSeveritySchema = z.enum(AUDIT_SEVERITIES);
export type AuditSeverity = z.infer<typeof AuditSeveritySchema>;

export const ACTOR_TYPES = ['USER', 'SYSTEM', 'MODEL'] as const;
export const ActorTypeSchema = z.enum(ACTOR_TYPES);
export type ActorType = z.infer<typeof ActorTypeSchema>;

// ---------------------------------------------------------------------------
// Action taxonomy — 30 families (ADMIN.COMPETENCY added 2026-09-29,
// AUTHORING.DOCUMENT_PREPARATION 2026-10-14). Actions are `FAMILY.ACTION`.
// ---------------------------------------------------------------------------

export const AUDIT_FAMILIES = {
  // ------------------------------------------------ ADMIN — 10 families
  'ADMIN.SOURCE': [
    'CREATED',
    'UPDATED',
    'PATH_MODIFIED',
    'ACTIVATED',
    'DEACTIVATED',
    'ARCHIVED',
    'DELETED',
    'RESTRICTIONS_CHANGED',
    'CONNECTION_TESTED',
    'SYNC_STARTED',
    'SYNC_COMPLETED',
    'SYNC_FAILED',
    'SYNC_CANCELLED',
    'DOCUMENT_FAILURE_DISMISSED',
  ],
  'ADMIN.ACCESS': [
    'ROLE_GRANTED',
    'ROLE_REVOKED',
    'SCOPE_CHANGED',
    'PORTAL_ACCESS_CHANGED',
    'SOURCE_ACCESS_CHANGED',
    'EXPORTED',
    'BOOTSTRAPPED',
  ],
  'ADMIN.USER': [
    'PROVISIONED',
    'RECONCILED',
    'SUSPENDED',
    'REACTIVATED',
    'DEPROVISIONED',
    'PSEUDONYMIZED',
  ],
  'ADMIN.CONFIGURATION': [
    'UPDATED',
    // AI provider administration, 2026-09-26. Four acts, kept apart because
    // they answer different questions and carry different risk:
    //
    //   PROVIDER_UPDATED           endpoint, model, credential reference, on/off
    //   PROVIDER_APPROVAL_CHANGED  the data-processing approval, with its reference
    //   PROVIDER_ACTIVATED         which provider generation actually uses
    //   PROVIDER_VALIDATED         a recorded readiness check
    //
    // Collapsing the approval into PROVIDER_UPDATED would bury the one act a
    // reviewer needs to find by itself: "who decided this provider was legally
    // cleared, and on the strength of what record".
    'PROVIDER_UPDATED',
    'PROVIDER_APPROVAL_CHANGED',
    'PROVIDER_ACTIVATED',
    'PROVIDER_VALIDATED',
    // P-5 and OPENAI-CODEX-00, 2026-09-27. Each a separate act because each is
    // a separate question a reviewer asks: "when did this provider start
    // pointing at a different secret", "did the secret resolve when somebody
    // tested it", "who switched it on". None carries a secret or a reference:
    // a REFERENCE FINGERPRINT (sha-256, 16 hex) identifies which one.
    'SECRET_REFERENCE_CREATED',
    'SECRET_REFERENCE_UPDATED',
    'SECRET_VALIDATED',
    'PROVIDER_ENABLED',
    'PROVIDER_DISABLED',
    // AI Document Studio, Slice 2: the DOCUMENT_RESTRUCTURE purpose approval.
    // Three acts rather than one CHANGED, because "who first cleared this",
    // "who changed the record it rests on" and "who withdrew it" are three
    // different questions. STATUS_EVALUATED records each evaluation of the
    // Studio's readiness, as PREFLIGHT_VIEW records a preflight being read.
    'PURPOSE_APPROVAL_RECORDED',
    'PURPOSE_APPROVAL_REPLACED',
    'PURPOSE_APPROVAL_REMOVED',
    'PURPOSE_STATUS_EVALUATED',
  ],
  'ADMIN.FIELDMAPPING': ['CREATED', 'UPDATED', 'VALIDATED', 'ACTIVATED', 'RETIRED'],
  'ADMIN.QUESTIONBANK': ['PROVISIONED', 'VERIFIED', 'RECONCILED', 'RECONCILE_DECISION_APPLIED'],
  'ADMIN.TAXONOMY': [
    'DOMAIN_CREATED',
    'DOMAIN_UPDATED',
    'TOPIC_CREATED',
    // TOPIC_UPDATED covers a description or an activation change, where
    // TOPIC_RENAMED would be a false statement about what changed. Activation
    // is an update carrying `isActive` and `changedFields`, not an action of
    // its own: a reader asks "what changed about this topic", and one action
    // per field would spread that answer across four vocabularies.
    'TOPIC_UPDATED',
    'TOPIC_MERGED',
    'TOPIC_RENAMED',
    // The organizational axes, added 2026-09-26. Same family as domains and
    // topics because they are the same KIND of act -- an administrator curating
    // a catalogue questions are filed under -- and an auditor asking "who
    // changed the taxonomy" should not have to know there are two families.
    'DEPARTMENT_CREATED',
    'DEPARTMENT_UPDATED',
    'ROLE_CREATED',
    'ROLE_UPDATED',
    'RETIRED',
  ],
  'ADMIN.RETENTION': ['EXECUTED'],
  'ADMIN.FEATUREFLAG': ['ENABLED', 'DISABLED', 'ROLLOUT_CHANGED'],
  // COMPETENCY-M0/M1 (2026-09-29): one event per apply of a structure-only
  // competency import, including a NO_CHANGES re-apply. Counts only -- the
  // importer reads no person row, so there is nothing else it could carry.
  // COMPETENCY-M2 (2026-10-07): the catalogue, versions and role targets, in
  // the SAME family -- an auditor asking "who changed the competency framework"
  // should find the import and the screen in one place. Deactivation is an
  // UPDATED carrying `status`, as it is for taxonomy.
  'ADMIN.COMPETENCY': [
    'IMPORT_APPLIED',
    'CATEGORY_CREATED',
    'CATEGORY_UPDATED',
    'COMPETENCY_CREATED',
    'COMPETENCY_UPDATED',
    'ALIAS_CREATED',
    'ALIAS_UPDATED',
    'VERSION_CREATED',
    'VERSION_APPROVED',
    'TARGET_PROPOSED',
    'TARGET_UPDATED',
    'TARGET_APPROVED',
    'TARGET_RETIRED',
  ],

  // --------------------------------------------- AUTHORING — 9 families
  'AUTHORING.DOCUMENT': [
    'SELECTED',
    'EXCLUDED',
    'EXCLUSION_REMOVED',
    'SECTION_ASSESSABILITY_CHANGED',
    'CONTENT_EXTRACTED',
  ],
  // AI Document Studio M3 (AI_DOCUMENT_STUDIO_ARCHITECTURE.md §11.9).
  'AUTHORING.DOCUMENT_PREPARATION': [
    'UPLOAD_ACCEPTED',
    'UPLOAD_REFUSED',
    'PREPARATION_COMPLETED',
    'PREPARATION_FAILED',
    'PREPARATION_REFUSED',
    'VERSION_SAVED',
    'AI_VERSION_RESTORED',
    'ADDED_TO_REPOSITORY',
    'VERSION_SUPERSEDED',
    'REVALIDATION_REQUIRED',
    'VERSION_REJECTED',
    'DOWNLOADED',
  ],
  'AUTHORING.GENERATION': [
    'PREFLIGHT_RUN',
    'PREFLIGHT_VIEW',
    'REQUESTED',
    'REGENERATION_REQUESTED',
    'JOB_STARTED',
    'JOB_COMPLETED',
    'JOB_FAILED',
    // A control-layer DECISION: a budget, a concurrency cap, an unapproved or
    // unregistered provider, an exhausted retry. Distinct from JOB_FAILED
    // because an auditor asking "did the controls hold?" must be able to count
    // refusals without counting outages, and the detail names which control
    // fired with the limit and the observed value beside it.
    'JOB_REFUSED',
    'JOB_CANCELLED',
    'CANDIDATE_REJECTED',
    // One row per retried attempt, carrying the class and the delay, so a
    // retry storm is reconstructable after the fact rather than inferred from
    // a token bill.
    'PROVIDER_CALL_RETRIED',
  ],
  'AUTHORING.QUESTION': [
    'CREATED',
    'IMPORTED',
    'IMPORT_RUN',
    'EDITED',
    // A change of DEPARTMENT or ROLE, added 2026-09-26. Distinct from EDITED
    // because EDITED means the question's CONTENT moved and carries an
    // evidence re-verification with it; re-filing touches no text and
    // re-verifies nothing, and an auditor counting content edits must not have
    // to subtract the re-filings.
    'FILING_CHANGED',
    'SUBMITTED',
    'APPROVED',
    'REJECTED',
    'CHANGES_REQUESTED',
    'PUBLISHED',
    'RETIRED',
    'ARCHIVED',
    'REUSED',
    'REVALIDATION_FLAGGED',
    'REVALIDATION_CONFIRMED',
    'APPROVAL_OVERRIDE',
    'DUPLICATE_DISPOSITIONED',
    'EVIDENCE_REVERIFIED',
  ],
  'AUTHORING.REVIEW': [
    'COMMENT_ADDED',
    'SME_ENDORSED',
    'SME_ENDORSEMENT_INVALIDATED',
    'BULK_OPERATION_EXECUTED',
  ],
  'AUTHORING.QUESTION_SET': ['CREATED', 'UPDATED', 'DELETED'],
  'AUTHORING.ASSESSMENT': [
    'CREATED',
    'VERSION_CREATED',
    'VERSION_UPDATED',
    'SUBMITTED',
    'APPROVED',
    'PUBLISHED',
    'UNPUBLISHED',
    'ARCHIVED',
    'POOL_EVALUATED',
  ],
  'AUTHORING.OBJECTIVE': ['CREATED', 'UPDATED', 'DEPRECATED', 'SECTION_MAPPING_CONFIRMED'],
  'AUTHORING.PROFILE': ['CREATED', 'UPDATED', 'PROMPT_VERSION_CREATED', 'PROMPT_VERSION_RETIRED'],

  // ---------------------------------------------- LEARNING — 5 families
  'LEARNING.SESSION': [
    'CREATED',
    'QUESTIONS_LOADED',
    'ANSWER_SAVED',
    'COMPLETED',
    'EXPIRED',
    'ABANDONED',
    'RECOVERED',
    'TIME_EXTENSION_GRANTED',
  ],
  'LEARNING.RESULT': ['SCORED', 'VIEWED', 'VOIDED', 'SUPERSEDED'],
  'LEARNING.RECOMMENDATION': ['GENERATED', 'VIEWED', 'COMPLETED', 'DISMISSED', 'NO_SOURCE_FOUND'],
  'LEARNING.BADGE': ['AWARDED', 'REVOKED'],
  'LEARNING.CERTIFICATE': ['ISSUED', 'DOWNLOADED', 'VERIFIED', 'EXPIRED', 'REVOKED'],

  // ------------------------------------------------ REPORT — 3 families
  'REPORT.DEFINITION': ['CREATED', 'UPDATED', 'DELETED'],
  'REPORT.RUN': [
    'EXECUTED',
    'EXPORTED',
    'EXPORT_DOWNLOADED',
    // A deliberate, named capture of what a report said at a moment (Phase 10
    // R1). Distinct from EXPORTED, which sends a copy off the platform, and
    // distinct from a PUBLICATION, which is a definition plus an audience
    // re-rendered per viewer (reporting.md 8.2 U1).
    'SNAPSHOT_CAPTURED',
    // An on-demand read-model refresh. Audited because it is work somebody
    // asked for out of schedule, and because "why was the data different at
    // 14:05" is a question the answer to is usually "somebody refreshed it".
    'MODELS_REFRESHED',
  ],
  'REPORT.PUBLICATION': [
    'SUBMITTED',
    'APPROVED',
    'PUBLISHED',
    'RETIRED',
    'ARCHIVED',
    'AUDIENCE_CHANGED',
  ],

  // ---------------------------------------------- PLATFORM — 3 families
  'PLATFORM.AUTH': [
    'SIGN_IN_SUCCEEDED',
    'SIGN_IN_FAILED',
    'TOKEN_REJECTED',
    'SESSION_EXPIRED',
    'PORTAL_ACCESS_DENIED',
  ],
  'PLATFORM.SECURITY': [
    'AUTHORIZATION_DENIED',
    'ENVELOPE_VERIFICATION_FAILED',
    'RESPONSE_SHAPE_VIOLATION',
    'RATE_LIMIT_EXCEEDED',
    'ENUMERATION_SUSPECTED',
    'PROMPT_CANARY_DETECTED',
    'BREAK_GLASS_USED',
  ],
  'PLATFORM.JOB': [
    'CLAIMED',
    'SUCCEEDED',
    'FAILED',
    'RETRIED',
    'QUARANTINED',
    'CONSISTENCY_DRIFT_DETECTED',
  ],
} as const satisfies Record<string, readonly [string, ...string[]]>;

export type AuditFamily = keyof typeof AUDIT_FAMILIES;
export const AUDIT_FAMILY_KEYS = Object.keys(AUDIT_FAMILIES) as readonly AuditFamily[];

/** The full `FAMILY.ACTION` union, derived so the two can never disagree. */
export type AuditAction = {
  [F in AuditFamily]: `${F}.${(typeof AUDIT_FAMILIES)[F][number]}`;
}[AuditFamily];

export const AUDIT_ACTIONS: readonly AuditAction[] = AUDIT_FAMILY_KEYS.flatMap((family) =>
  AUDIT_FAMILIES[family].map((action) => `${family}.${action}` as AuditAction),
);

export const auditFamilyOf = (action: AuditAction): AuditFamily =>
  action.split('.').slice(0, 2).join('.') as AuditFamily;

export const auditCategoryOf = (action: AuditAction): AuditCategory =>
  action.split('.')[0] as AuditCategory;

/**
 * Actions that page rather than dashboard — audit-model.md §2.5.
 */
export const HIGH_SEVERITY_ACTIONS: readonly AuditAction[] = [
  'PLATFORM.SECURITY.RESPONSE_SHAPE_VIOLATION',
  'PLATFORM.SECURITY.ENVELOPE_VERIFICATION_FAILED',
  'PLATFORM.SECURITY.PROMPT_CANARY_DETECTED',
  'PLATFORM.SECURITY.BREAK_GLASS_USED',
];

// ---------------------------------------------------------------------------
// Record shape — audit-model.md §3
// ---------------------------------------------------------------------------

export const AUDIT_EVENT_SCHEMA_VERSION = 1;

export const AuditEventSchema = z.object({
  id: z.string().uuid(),
  occurredAt: z.string().datetime(),

  // Action
  action: z.string(),
  family: z.string(),
  category: AuditCategorySchema,
  outcome: AuditOutcomeSchema,
  severity: AuditSeveritySchema,

  // Actor — snapshots, not foreign keys resolved at read time (H1)
  actorType: ActorTypeSchema,
  actorUserId: z.string().uuid().nullable(),
  actorDisplayName: z.string().nullable(),
  actorRoles: z.array(z.string()),
  onBehalfOfUserId: z.string().uuid().nullable(),

  // Subject
  entityType: z.string(),
  entityId: z.string().nullable(),
  entityLabel: z.string().nullable(),
  domainId: z.string().uuid().nullable(),
  sourceId: z.string().uuid().nullable(),

  // What changed — configuration/scope/role/taxonomy/flag changes only (H2)
  previousValue: z.unknown().nullable(),
  newValue: z.unknown().nullable(),
  detail: z.record(z.unknown()),

  // Provenance
  correlationId: z.string(),
  requestId: z.string().nullable(),
  portal: z.enum(['AUTHORING', 'LIVE', 'SYSTEM']).nullable(),
  ipAddress: z.string().nullable(),
  userAgentClass: z.string().nullable(),
  policyName: z.string().nullable(),
  denyReason: z.string().nullable(),
  errorCode: z.string().nullable(),
  schemaVersion: z.number().int(),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

/** What a caller supplies; the writer derives family, category, and provenance. */
export const AuditEventInputSchema = z.object({
  action: z.string(),
  outcome: AuditOutcomeSchema.default('SUCCESS'),
  severity: AuditSeveritySchema.optional(),
  actorType: ActorTypeSchema.default('USER'),
  actorUserId: z.string().uuid().nullable().default(null),
  actorDisplayName: z.string().nullable().default(null),
  actorRoles: z.array(z.string()).default([]),
  onBehalfOfUserId: z.string().uuid().nullable().default(null),
  entityType: z.string(),
  entityId: z.string().nullable().default(null),
  entityLabel: z.string().nullable().default(null),
  domainId: z.string().uuid().nullable().default(null),
  sourceId: z.string().uuid().nullable().default(null),
  previousValue: z.unknown().nullable().default(null),
  newValue: z.unknown().nullable().default(null),
  detail: z.record(z.unknown()).default({}),
  correlationId: z.string(),
  requestId: z.string().nullable().default(null),
  portal: z.enum(['AUTHORING', 'LIVE', 'SYSTEM']).nullable().default(null),
  ipAddress: z.string().nullable().default(null),
  userAgentClass: z.string().nullable().default(null),
  policyName: z.string().nullable().default(null),
  denyReason: z.string().nullable().default(null),
  errorCode: z.string().nullable().default(null),
});
export type AuditEventInput = z.input<typeof AuditEventInputSchema>;
