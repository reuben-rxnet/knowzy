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
  // `providerId` and `changedFields` added 2026-09-24 for the per-provider
  // token limits an administrator sets from Governance -> AI Usage & Budgets:
  // previousValue/newValue carry the whole record, and these two say which
  // provider and which ceilings the person actually touched.
  // NEVER a credential reference. `credentialConfigured` is a boolean saying
  // whether one is recorded, which is all any screen shows and all an auditor
  // needs -- the reference names a secret, and a seven-year store is the last
  // place it should be reconstructable from.
  'ADMIN.CONFIGURATION.PROVIDER_UPDATED': [
    'key',
    'scope',
    'valueType',
    'providerId',
    'changedFields',
    'enabled',
    'credentialConfigured',
  ],
  // AI Document Studio, Slice 2. The reference is retained for the same reason
  // as approvalReference above; the previous one on a REPLACED, so the change
  // of record is readable from the row itself.
  'ADMIN.CONFIGURATION.PURPOSE_APPROVAL_RECORDED': ['purpose', 'providerId', 'approvalReference'],
  'ADMIN.CONFIGURATION.PURPOSE_APPROVAL_REPLACED': [
    'purpose',
    'providerId',
    'approvalReference',
    'previousApprovalReference',
  ],
  'ADMIN.CONFIGURATION.PURPOSE_APPROVAL_REMOVED': [
    'purpose',
    'providerId',
    'previousApprovalReference',
  ],
  'ADMIN.CONFIGURATION.PURPOSE_STATUS_EVALUATED': [
    'purpose',
    'state',
    'providerStates',
    'transformationImplemented',
  ],
  'ADMIN.CONFIGURATION.PROVIDER_APPROVAL_CHANGED': [
    'key',
    'scope',
    'valueType',
    'providerId',
    'approved',
    // WHERE the approval is recorded -- a document id or a ticket. Retained on
    // purpose: the question asked in nine months is "who cleared this, and on
    // the strength of what", and a boolean cannot answer the second half.
    'approvalReference',
  ],
  'ADMIN.CONFIGURATION.PROVIDER_ACTIVATED': [
    'key',
    'scope',
    'valueType',
    'providerId',
    'previousProviderId',
  ],
  'ADMIN.CONFIGURATION.PROVIDER_VALIDATED': [
    'providerId',
    // `validationOutcome`, not `outcome`: the event already HAS an outcome
    // column, and two different meanings under one name in one row is how a
    // query returns the wrong thing quietly.
    'validationOutcome',
    'providerState',
    'failedChecks',
    'notAttemptedChecks',
    // OPENAI-CODEX-00: which checks PASSED (the live ones are real now), the
    // readiness it produced, and what the endpoint answered. Never a key,
    // never a reference, never a provider's error message.
    'passedChecks',
    'readinessState',
    'endpointHost',
    'httpStatus',
  ],
  // P-5 -- the Secret Resolution Layer. Fingerprints and sources, never a
  // reference and never a value: `audit_event` has never held either.
  'ADMIN.CONFIGURATION.SECRET_REFERENCE_CREATED': [
    'providerId',
    'referenceSource',
    'referenceFingerprint',
  ],
  'ADMIN.CONFIGURATION.SECRET_REFERENCE_UPDATED': [
    'providerId',
    // REPLACED or REMOVED.
    'change',
    'referenceSource',
    'referenceFingerprint',
    'previousReferenceFingerprint',
  ],
  'ADMIN.CONFIGURATION.SECRET_VALIDATED': [
    'providerId',
    'referenceSource',
    'referenceFingerprint',
    // RESOLVED, NOT_FOUND, SOURCE_UNAVAILABLE, SOURCE_FORBIDDEN, INVALID_REFERENCE.
    'resolutionStatus',
    'purpose',
    'durationMs',
  ],
  'ADMIN.CONFIGURATION.PROVIDER_ENABLED': ['providerId', 'previouslyEnabled'],
  'ADMIN.CONFIGURATION.PROVIDER_DISABLED': ['providerId', 'previouslyEnabled'],
  'ADMIN.CONFIGURATION.UPDATED': [
    'key',
    'scope',
    'scopeId',
    'valueType',
    'providerId',
    'changedFields',
  ],
  // M2. Counts and outcomes only: no document name, no heading, no extracted
  // text. A sync row is kept for years, so it records HOW MUCH happened, never
  // WHAT the documents said.
  'ADMIN.SOURCE.CONNECTION_TESTED': ['ok', 'durationMs', 'checks'],
  'ADMIN.SOURCE.SYNC_COMPLETED': [
    'mode',
    'scanned',
    'added',
    'modified',
    'unchanged',
    'deleted',
    'failed',
    // Kept apart from `failed` in the audit too, so a seven-year row can still
    // distinguish "something went wrong" from "the configuration excluded it".
    'skipped',
    'extractedChars',
    // The scheduler's fields on a completed run, so a scheduled sync and a
    // manual one are distinguishable years later.
    'trigger',
    'scheduleMode',
  ],
  // Source workflow administration (SYNC-M2). Every key here is configuration
  // or a count -- never a credential, never a connection string. `changedFields`
  // is what makes an UPDATED row readable years later, and `hadLineage` records
  // why a DELETE was permitted at all.
  'ADMIN.SOURCE.CREATED': ['sourceType', 'scheduleMode', 'isActive'],
  'ADMIN.SOURCE.UPDATED': ['changedFields', 'scheduleMode', 'timezone'],
  'ADMIN.SOURCE.ACTIVATED': ['isActive', 'connectionStatus'],
  'ADMIN.SOURCE.DEACTIVATED': ['isActive', 'connectionStatus'],
  'ADMIN.SOURCE.ARCHIVED': ['sourceType', 'documents', 'draftQuestions', 'publishedQuestions'],
  'ADMIN.SOURCE.DELETED': ['sourceType', 'hadLineage'],
  'ADMIN.SOURCE.PATH_MODIFIED': ['change', 'containerName', 'folderPath'],
  'ADMIN.SOURCE.SYNC_STARTED': ['trigger', 'scheduleMode'],
  'ADMIN.SOURCE.SYNC_FAILED': [
    'mode',
    'scanned',
    'failed',
    'skipped',
    // The scheduler's own fields. `reaped` marks a run closed out because
    // the process that owned it died -- see the reaper in apps/jobs.
    'trigger',
    'scheduleMode',
    'exhaustedAfterAttempts',
    'reaped',
    'ageMinutes',
  ],
  'ADMIN.FEATUREFLAG.ENABLED': ['key', 'environment', 'ceiling'],
  'ADMIN.FEATUREFLAG.DISABLED': ['key', 'environment'],
  'ADMIN.FEATUREFLAG.ROLLOUT_CHANGED': ['key', 'environment'],
  // REPORT.RUN.EXPORTED — the audited export (audit-model.md §7). Counts and
  // the window, never the exported CONTENT: an export of audit rows recorded
  // inside an audit row would double the store every time somebody pressed the
  // button.
  'REPORT.RUN.EXPORTED': [
    'reportKey',
    'format',
    'rowCount',
    'matchedCount',
    'truncated',
    'windowFrom',
    'windowTo',
    // Added by Phase 10 R1, for a DATASET export. The Audit Explorer's export
    // and a report dataset's export are the same action, so they share one
    // allow-list: two entries under one key means the second silently wins and
    // the first one's keys start being dropped as `_droppedKeys`.
    'suppressedCellCount',
    'minimumGroupSize',
    'asOf',
  ],
  // The organizational catalogues. Same keys as the domain and topic actions:
  // the code, the name, the activation state and WHICH FIELDS changed -- never
  // a description body, which is prose an administrator can rewrite freely.
  'ADMIN.COMPETENCY.IMPORT_APPLIED': [
    'frameworkCode',
    'versionLabel',
    'profileCode',
    'outcome',
    'categoriesCreated',
    'competenciesCreated',
    'aliasesCreated',
    'levelsCreated',
    'provenanceCreated',
    'findingCount',
    'personRowsSkipped',
  ],
  // COMPETENCY-M2. Codes, names, states and WHICH FIELDS changed -- never a
  // description or rationale body, and never a person: the only people these
  // rows name are the administrators acting, in the actor fields.
  'ADMIN.COMPETENCY.CATEGORY_CREATED': [
    'frameworkCode',
    'code',
    'name',
    'kind',
    'status',
    'changedFields',
  ],
  'ADMIN.COMPETENCY.CATEGORY_UPDATED': [
    'frameworkCode',
    'code',
    'name',
    'kind',
    'status',
    'changedFields',
  ],
  'ADMIN.COMPETENCY.COMPETENCY_CREATED': [
    'frameworkCode',
    'code',
    'name',
    'status',
    'changedFields',
  ],
  'ADMIN.COMPETENCY.COMPETENCY_UPDATED': [
    'frameworkCode',
    'code',
    'name',
    'status',
    'changedFields',
  ],
  'ADMIN.COMPETENCY.ALIAS_CREATED': [
    'frameworkCode',
    'subject',
    'contextCode',
    'alias',
    'decision',
    'status',
    'changedFields',
  ],
  'ADMIN.COMPETENCY.ALIAS_UPDATED': [
    'frameworkCode',
    'subject',
    'contextCode',
    'alias',
    'decision',
    'status',
    'changedFields',
  ],
  'ADMIN.COMPETENCY.VERSION_CREATED': [
    'frameworkCode',
    'versionLabel',
    'origin',
    'definitionsSha256',
    'editorCount',
    'supersededVersionLabel',
  ],
  'ADMIN.COMPETENCY.VERSION_APPROVED': [
    'frameworkCode',
    'versionLabel',
    'origin',
    'definitionsSha256',
    'editorCount',
    'supersededVersionLabel',
  ],
  'ADMIN.COMPETENCY.TARGET_PROPOSED': [
    'jobRoleCode',
    'competencyCode',
    'targetLevelCode',
    'status',
    'frameworkVersionLabel',
    'changedFields',
  ],
  'ADMIN.COMPETENCY.TARGET_UPDATED': [
    'jobRoleCode',
    'competencyCode',
    'targetLevelCode',
    'status',
    'frameworkVersionLabel',
    'changedFields',
  ],
  'ADMIN.COMPETENCY.TARGET_APPROVED': [
    'jobRoleCode',
    'competencyCode',
    'targetLevelCode',
    'status',
    'frameworkVersionLabel',
    'changedFields',
  ],
  'ADMIN.COMPETENCY.TARGET_RETIRED': [
    'jobRoleCode',
    'competencyCode',
    'targetLevelCode',
    'status',
    'frameworkVersionLabel',
    'changedFields',
  ],
  'ADMIN.TAXONOMY.DEPARTMENT_CREATED': ['code', 'name', 'isActive'],
  'ADMIN.TAXONOMY.DEPARTMENT_UPDATED': ['code', 'name', 'isActive', 'changedFields'],
  'ADMIN.TAXONOMY.ROLE_CREATED': ['code', 'name', 'isActive'],
  'ADMIN.TAXONOMY.ROLE_UPDATED': ['code', 'name', 'isActive', 'changedFields'],
  'ADMIN.RETENTION.EXECUTED': ['target', 'removedCount', 'evaluatedAt', 'cutoff'],
  // Taxonomy administration. `code` is declared because it is the one field
  // that becomes permanent -- it appears in every published QuestionID -- so
  // the row that created it has to carry it. `changedFields` is what makes an
  // update readable years later: the row cannot otherwise say whether a
  // deactivation or a rename happened.
  'ADMIN.TAXONOMY.DOMAIN_CREATED': ['code', 'name', 'isActive'],
  'ADMIN.TAXONOMY.DOMAIN_UPDATED': ['code', 'name', 'isActive', 'changedFields'],
  'ADMIN.TAXONOMY.TOPIC_CREATED': ['domainCode', 'slug', 'name', 'isActive'],
  'ADMIN.TAXONOMY.TOPIC_UPDATED': ['domainCode', 'slug', 'name', 'isActive', 'changedFields'],
  'ADMIN.TAXONOMY.TOPIC_RENAMED': ['domainCode', 'slug', 'name', 'previousName'],
  'ADMIN.USER.PROVISIONED': ['entraObjectId', 'source'],
  'ADMIN.USER.RECONCILED': ['added', 'flaggedForRemoval'],
  // M3 generation. Counts, ids, hashes, and scores only — no question text, no
  // option text, no evidence span. `sectionKey` is a hash, not a heading, so it
  // identifies the section without reproducing anything from the document.
  'AUTHORING.GENERATION.PREFLIGHT_RUN': ['documentCount', 'recommendation'],
  'AUTHORING.GENERATION.PREFLIGHT_VIEW': ['chosenAction'],
  'AUTHORING.GENERATION.REQUESTED': [
    'scope',
    'documentCount',
    'sectionCount',
    'requestedQuestionCount',
    'preflightId',
  ],
  'AUTHORING.GENERATION.REGENERATION_REQUESTED': [
    'scope',
    'documentCount',
    'sectionCount',
    'requestedQuestionCount',
    'preflightId',
  ],
  'AUTHORING.GENERATION.JOB_COMPLETED': [
    'jobStatus',
    'requestedQuestionCount',
    'acceptedQuestionCount',
    'rejectionCounts',
    'modelId',
    'inputTokenCount',
    'outputTokenCount',
    'providerId',
    'providerVersion',
    'executionMode',
    'tokenUsageReported',
    // Cost, and whether a cost could be known at all. `costObservable: false`
    // with a null amount is the honest record for a per-seat licence or a
    // user-managed run; writing 0 there would fabricate a measurement.
    'estimatedCost',
    'measuredCost',
    'costObservable',
    'attemptCount',
    // OPENAI-CODEX-01: a provider that broke ends the job FAILED with the
    // CLASS of the error (RATE_LIMIT, TIMEOUT, MALFORMED_OUTPUT, ...), never
    // its message, and the pre-call estimate beside the measurement.
    'errorClass',
    'estimatedInputTokens',
    'surplusCandidates',
  ],
  'AUTHORING.GENERATION.JOB_REFUSED': [
    'refusalReason',
    'refusalDetail',
    'providerId',
    'executionMode',
    // The limit and what was observed against it, together: "budget exhausted"
    // with no numbers is unactionable, and an author cannot plan around it.
    'limitName',
    'limitValue',
    'observedValue',
    'budgetWindow',
    'requestedQuestionCount',
    'attemptCount',
  ],
  'AUTHORING.GENERATION.PROVIDER_CALL_RETRIED': [
    'providerId',
    'attempt',
    'maxAttempts',
    'errorClass',
    'delayMs',
  ],
  'AUTHORING.GENERATION.JOB_FAILED': [
    'jobStatus',
    'requestedQuestionCount',
    'acceptedQuestionCount',
    'rejectionCounts',
    'modelId',
    'inputTokenCount',
    'outputTokenCount',
    'providerId',
    'providerVersion',
    'executionMode',
    'tokenUsageReported',
    // The generation service writes ONE detail object for both JOB_COMPLETED
    // and JOB_FAILED, so adding the cost keys to one list and not the other
    // dropped them on every failed job -- found 2026-09-24 by reading the
    // `_droppedKeys` column instead of trusting the tests, which had asserted
    // the COMPLETED and REFUSED rows and not this one.
    'estimatedCost',
    'measuredCost',
    'costObservable',
    'attemptCount',
    // OPENAI-CODEX-01, and in BOTH lists for the reason given above -- the
    // first edit added these to JOB_COMPLETED only, and the dropped-keys test
    // caught it on the new failure path.
    'errorClass',
    'estimatedInputTokens',
    'surplusCandidates',
  ],
  // M4 review and approval. Counts, ids, hashes, decisions and field NAMES —
  // never question text, option text, evidence spans, or comment bodies. The
  // comment lives on QuestionReview and the diff on DraftQuestionVersion;
  // audit-model.md §8 keeps both out of a seven-year store.
  'AUTHORING.QUESTION.EDITED': [
    'version',
    'changedFields',
    'evidenceReverified',
    'reviewKind',
    'reviewOutcome',
  ],
  // CODES, never ids: a uuid cannot be resolved against a catalogue that has
  // since been re-curated, and the code is what a past report grouped by.
  // A snapshot's SUPPRESSION FIGURES are retained on purpose: a capture that
  // withheld cells and one that withheld none are different artifacts, and a
  // year later this row is the only record of which was taken.
  'REPORT.RUN.MODELS_REFRESHED': ['refreshed', 'failed', 'models', 'durationMs'],
  'REPORT.RUN.SNAPSHOT_CAPTURED': [
    'reportKey',
    'rowCount',
    'suppressedCellCount',
    'minimumGroupSize',
    'asOf',
  ],
  'AUTHORING.QUESTION.FILING_CHANGED': [
    'version',
    'changedFields',
    'departmentCode',
    'jobRoleCode',
  ],
  'AUTHORING.QUESTION.SUBMITTED': ['version', 'gatesPassed', 'evaluatedGateCount'],
  'AUTHORING.QUESTION.APPROVED': ['version', 'gatesPassed', 'evaluatedGateCount', 'breakGlass'],
  'AUTHORING.QUESTION.APPROVAL_OVERRIDE': [
    'version',
    'gatesPassed',
    'evaluatedGateCount',
    'breakGlass',
  ],
  'AUTHORING.QUESTION.CHANGES_REQUESTED': ['version'],
  'AUTHORING.QUESTION.REJECTED': ['version'],
  'AUTHORING.QUESTION.ARCHIVED': ['version'],
  'AUTHORING.QUESTION.DUPLICATE_DISPOSITIONED': ['disposition'],
  'AUTHORING.QUESTION.REUSED': ['includeAnswerKey', 'bankItemId'],
  // G6 names exactly what a publish audit must carry: "the item ID, ETag,
  // version, field set written, and correlation ID". Dropping any of them would
  // make the audit unable to answer "what did we write, and where".
  'AUTHORING.QUESTION.PUBLISHED': [
    'bankItemId',
    'bankETag',
    'publishedVersion',
    'operationType',
    'fieldCount',
    'bankType',
    'batchSize',
    'publishedCount',
    'failedCount',
    'dryRun',
  ],
  'AUTHORING.QUESTION.RETIRED': ['bankItemId', 'bankETag', 'publishedVersion', 'operationType'],
  'AUTHORING.QUESTION.CREATED': [
    'jobId',
    'sectionKey',
    'evidenceMode',
    'confidenceScore',
    'maxSimilarityScore',
  ],
  // A question lifted out of an uploaded question bank. The locator is where
  // to look in the file; the document name identifies the file. No question
  // text and no option text, for the same reason as every other action here.
  'AUTHORING.QUESTION.IMPORTED': [
    'importLocator',
    'importStrategy',
    'sourceDocumentName',
    'confidenceScore',
  ],
  'AUTHORING.QUESTION.IMPORT_RUN': [
    'sourceDocumentName',
    'importStrategy',
    'detectedCount',
    'validCount',
    'invalidCount',
    'createdCount',
    'rejectedCount',
  ],
  // contentHash identifies WHICH content was extracted without reproducing any
  // of it, which is what makes an extraction traceable without putting document
  // text in the audit store.
  'AUTHORING.DOCUMENT.CONTENT_EXTRACTED': [
    'status',
    'charCount',
    'sectionCount',
    'truncated',
    'contentHash',
  ],
  // M6 assessment and session. Counts, ids, scores, and bands — never a
  // question, an option, or a learner's CHOICE. audit-model.md §8 keeps
  // per-answer content out of a seven-year store; it lives on QuizResponse with
  // a two-year retention.
  'AUTHORING.ASSESSMENT.CREATED': ['questionCount', 'strategy', 'topicCount'],
  'AUTHORING.ASSESSMENT.SUBMITTED': [],
  'AUTHORING.ASSESSMENT.APPROVED': [],
  'AUTHORING.ASSESSMENT.PUBLISHED': ['versionNumber', 'poolSize', 'questionCount', 'strategy'],
  'LEARNING.SESSION.CREATED': [
    'assessmentVersionId',
    'attemptNumber',
    'totalQuestions',
    'strategy',
    'poolSize',
  ],
  'LEARNING.SESSION.ANSWER_SAVED': ['presentationIndex', 'revision', 'writeSequence'],
  'LEARNING.SESSION.RECOVERED': ['recoveryCount'],
  'LEARNING.SESSION.EXPIRED': ['expiryPolicy', 'scored'],
  'LEARNING.SESSION.COMPLETED': ['totalQuestions', 'answeredCount'],
  'LEARNING.RESULT.SCORED': [
    'percentageScore',
    'passed',
    'proficiencyBand',
    'totalQuestions',
    'correctAnswers',
    'unansweredCount',
    'scoringEngineVersion',
    'resultState',
  ],
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
  // All three provider WRITES carry previous and new value. PROVIDER_VALIDATED
  // does not: a validation changes nothing, so a diff would be two copies of
  // the same state pretending something moved.
  'ADMIN.CONFIGURATION.PROVIDER_UPDATED',
  'ADMIN.CONFIGURATION.PROVIDER_APPROVAL_CHANGED',
  'ADMIN.CONFIGURATION.PROVIDER_ACTIVATED',
  'ADMIN.CONFIGURATION.PURPOSE_APPROVAL_RECORDED',
  'ADMIN.CONFIGURATION.PURPOSE_APPROVAL_REPLACED',
  'ADMIN.CONFIGURATION.PURPOSE_APPROVAL_REMOVED',
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
  // A question's filing is what a past report grouped by, so previous AND new
  // must both be present for the grouping to be reconstructable.
  'AUTHORING.QUESTION.FILING_CHANGED',
  'ADMIN.TAXONOMY.TOPIC_MERGED',
  'ADMIN.TAXONOMY.TOPIC_RENAMED',
  'ADMIN.TAXONOMY.TOPIC_UPDATED',
  // H2: an update to an org catalogue carries previous and new value, exactly
  // as a domain update does. A code change is the one edit that can invalidate
  // a historical grouping, so it must be reconstructable.
  'ADMIN.TAXONOMY.DEPARTMENT_UPDATED',
  'ADMIN.TAXONOMY.ROLE_UPDATED',
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
