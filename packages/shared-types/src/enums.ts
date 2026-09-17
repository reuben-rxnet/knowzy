// Every enumeration in data-model.md §11, plus the supporting enums named in
// §3–§10. All values exist from the first migration, including those whose
// feature ships later: adding a value to a PostgreSQL enum is cheap, changing
// stored history is not.
//
// Each enum is declared once as a const tuple, so the Zod schema, the TypeScript
// union, and the value list used by the Prisma parity test cannot drift.

import { z } from 'zod';

// ---------------------------------------------------------------- identity

export const USER_STATUS = ['ACTIVE', 'SUSPENDED', 'DEPROVISIONED'] as const;
export const UserStatusSchema = z.enum(USER_STATUS);
export type UserStatus = z.infer<typeof UserStatusSchema>;

export const PORTAL_SCOPE = ['AUTHORING', 'LIVE', 'BOTH'] as const;
export const PortalScopeSchema = z.enum(PORTAL_SCOPE);
export type PortalScope = z.infer<typeof PortalScopeSchema>;

export const USER_SOURCE_ACCESS_MODE = ['ALLOW', 'DENY'] as const;
export const UserSourceAccessModeSchema = z.enum(USER_SOURCE_ACCESS_MODE);
export type UserSourceAccessMode = z.infer<typeof UserSourceAccessModeSchema>;

// ------------------------------------------------------------ taxonomy

export const COGNITIVE_LEVEL = ['RECALL', 'APPLICATION', 'ANALYSIS'] as const;
export const CognitiveLevelSchema = z.enum(COGNITIVE_LEVEL);
export type CognitiveLevel = z.infer<typeof CognitiveLevelSchema>;

export const OBJECTIVE_STATUS = ['ACTIVE', 'DEPRECATED'] as const;
export const ObjectiveStatusSchema = z.enum(OBJECTIVE_STATUS);
export type ObjectiveStatus = z.infer<typeof ObjectiveStatusSchema>;

// ------------------------------------------------------- knowledge sources

export const SOURCE_TYPE = [
  'SHAREPOINT',
  'MOCK',
  'CONFLUENCE',
  'SERVICENOW',
  'SQL_DATABASE',
  'REST_API',
  'AZURE_BLOB',
  'FILE_REPOSITORY',
  'INTERNAL_KNOWLEDGE_API',
  'MCP_GENERIC',
] as const;
export const SourceTypeSchema = z.enum(SOURCE_TYPE);
export type SourceType = z.infer<typeof SourceTypeSchema>;

/** Adapters registered in release 1. Selecting any other type returns SOURCE_TYPE_NOT_AVAILABLE. */
export const RELEASE_1_SOURCE_TYPES: readonly SourceType[] = ['SHAREPOINT', 'MOCK'];

export const PERMISSION_MODE = ['DELEGATED_OBO', 'APP_ONLY_SITES_SELECTED'] as const;
export const PermissionModeSchema = z.enum(PERMISSION_MODE);
export type PermissionMode = z.infer<typeof PermissionModeSchema>;

export const AUTH_METHOD = ['MANAGED_IDENTITY', 'CLIENT_CREDENTIALS', 'ON_BEHALF_OF'] as const;
export const AuthMethodSchema = z.enum(AUTH_METHOD);
export type AuthMethod = z.infer<typeof AuthMethodSchema>;

export const CONNECTION_STATUS = ['UNTESTED', 'HEALTHY', 'DEGRADED', 'FAILED'] as const;
export const ConnectionStatusSchema = z.enum(CONNECTION_STATUS);
export type ConnectionStatus = z.infer<typeof ConnectionStatusSchema>;

export const SYNC_MODE = ['INCREMENTAL', 'FULL', 'HEALTH_CHECK'] as const;
export const SyncModeSchema = z.enum(SYNC_MODE);
export type SyncMode = z.infer<typeof SyncModeSchema>;

export const SYNC_TRIGGER = ['MANUAL', 'SCHEDULE', 'SYSTEM'] as const;
export const SyncTriggerSchema = z.enum(SYNC_TRIGGER);
export type SyncTrigger = z.infer<typeof SyncTriggerSchema>;

export const SYNC_OUTCOME = ['RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED'] as const;
export const SyncOutcomeSchema = z.enum(SYNC_OUTCOME);
export type SyncOutcome = z.infer<typeof SyncOutcomeSchema>;

export const SYNC_FAILURE_PHASE = ['LISTING', 'DOWNLOAD', 'EXTRACTION', 'INDEXING'] as const;
export const SyncFailurePhaseSchema = z.enum(SYNC_FAILURE_PHASE);
export type SyncFailurePhase = z.infer<typeof SyncFailurePhaseSchema>;

export const SYNC_FAILURE_STATE = [
  'PENDING_RETRY',
  'QUARANTINED',
  'DISMISSED',
  'RESOLVED',
] as const;
export const SyncFailureStateSchema = z.enum(SYNC_FAILURE_STATE);
export type SyncFailureState = z.infer<typeof SyncFailureStateSchema>;

// ------------------------------------------------------------- documents

export const DOCUMENT_STATUS = ['ACTIVE', 'DELETED', 'ARCHIVED'] as const;
export const DocumentStatusSchema = z.enum(DOCUMENT_STATUS);
export type DocumentStatus = z.infer<typeof DocumentStatusSchema>;

export const EXTRACTION_STATUS = [
  'PENDING',
  'EXTRACTED',
  'EMPTY',
  'UNSUPPORTED',
  'FAILED',
  'TOO_LARGE',
  'QUARANTINED',
] as const;
export const ExtractionStatusSchema = z.enum(EXTRACTION_STATUS);
export type ExtractionStatus = z.infer<typeof ExtractionStatusSchema>;

export const INDEXING_STATUS = ['PENDING', 'INDEXED', 'FAILED', 'SKIPPED'] as const;
export const IndexingStatusSchema = z.enum(INDEXING_STATUS);
export type IndexingStatus = z.infer<typeof IndexingStatusSchema>;

export const COVERAGE_STATUS = [
  'NOT_COVERED',
  'PARTIALLY_COVERED',
  'COVERED',
  'MODIFIED',
  'NON_ASSESSABLE',
] as const;
export const CoverageStatusSchema = z.enum(COVERAGE_STATUS);
export type CoverageStatus = z.infer<typeof CoverageStatusSchema>;

export const SECTION_MATCH_RULE = ['KEY', 'HASH', 'SIMILARITY', 'NEW', 'REMOVED'] as const;
export const SectionMatchRuleSchema = z.enum(SECTION_MATCH_RULE);
export type SectionMatchRule = z.infer<typeof SectionMatchRuleSchema>;

export const DOCUMENT_TYPE = [
  'PDF',
  'DOCX',
  'PPTX',
  'XLSX',
  'SHAREPOINT_PAGE',
  'TXT',
  'HTML',
] as const;
export const DocumentTypeSchema = z.enum(DOCUMENT_TYPE);
export type DocumentType = z.infer<typeof DocumentTypeSchema>;

// ------------------------------------------------------------ generation

export const GENERATION_SCOPE = [
  'ENTIRE_DOCUMENT',
  'MODIFIED_SECTIONS_ONLY',
  'UNCOVERED_SECTIONS_ONLY',
  'OBJECTIVES',
  'SELECTED_SECTIONS',
] as const;
export const GenerationScopeSchema = z.enum(GENERATION_SCOPE);
export type GenerationScope = z.infer<typeof GenerationScopeSchema>;

export const GENERATION_REASON_CODE = [
  'NEW_KNOWLEDGE',
  'CONTENT_CHANGED',
  'COVERAGE_GAP',
  'NEW_OBJECTIVE',
  'PUBLISHER_REQUESTED',
] as const;
export const GenerationReasonCodeSchema = z.enum(GENERATION_REASON_CODE);
export type GenerationReasonCode = z.infer<typeof GenerationReasonCodeSchema>;

export const GENERATION_STATUS = [
  'NOT_PROCESSED',
  'DRAFTS_PENDING',
  'HAS_APPROVED',
  'HAS_PUBLISHED',
  'MODIFIED_SINCE_GENERATION',
  'EXCLUDED',
] as const;
export const GenerationStatusSchema = z.enum(GENERATION_STATUS);
export type GenerationStatus = z.infer<typeof GenerationStatusSchema>;

export const PREFLIGHT_RECOMMENDATION = [
  'VIEW_EXISTING',
  'REUSE_EXISTING',
  'GENERATE_ADDITIONAL',
  'REGENERATE',
  'GENERATE_NEW',
] as const;
export const PreflightRecommendationSchema = z.enum(PREFLIGHT_RECOMMENDATION);
export type PreflightRecommendation = z.infer<typeof PreflightRecommendationSchema>;

/**
 * The two preflight outcomes that the "regeneration avoided" metric counts —
 * generation-governance.md §10.2.
 */
export const REGENERATION_AVOIDED_ACTIONS: readonly PreflightRecommendation[] = [
  'VIEW_EXISTING',
  'REUSE_EXISTING',
];

export const JOB_STATE = [
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'PARTIAL',
  'FAILED',
  'CANCELLED',
] as const;
export const JobStateSchema = z.enum(JOB_STATE);
export type JobState = z.infer<typeof JobStateSchema>;

export const REJECTION_REASON = [
  'SCHEMA_INVALID',
  'EVIDENCE_UNVERIFIED',
  'DUPLICATE',
  'INSUFFICIENT_EVIDENCE',
  'OPTION_DUPLICATE',
  'ANSWER_INVALID',
  'QUESTION_INCOMPLETE',
] as const;
export const RejectionReasonSchema = z.enum(REJECTION_REASON);
export type RejectionReason = z.infer<typeof RejectionReasonSchema>;

export const CHANGE_KIND = ['GENERATED', 'EDITED', 'REVALIDATED', 'PUBLISHED'] as const;
export const ChangeKindSchema = z.enum(CHANGE_KIND);
export type ChangeKind = z.infer<typeof ChangeKindSchema>;

// -------------------------------------------------------------- questions

export const QUESTION_TYPE = [
  'MULTIPLE_CHOICE_4',
  'MULTI_SELECT',
  'TRUE_FALSE',
  'SHORT_ANSWER',
  'SCENARIO_ORDERING',
] as const;
export const QuestionTypeSchema = z.enum(QUESTION_TYPE);
export type QuestionType = z.infer<typeof QuestionTypeSchema>;

/** ADR-014: release 1 ships one type. The others are reserved, not implemented. */
export const RELEASE_1_QUESTION_TYPES: readonly QuestionType[] = ['MULTIPLE_CHOICE_4'];

export const QUESTION_STATUS = [
  'GENERATED',
  'DRAFT',
  'AUTHOR_REVIEW',
  'SUBMITTED_FOR_APPROVAL',
  'CHANGES_REQUESTED',
  'APPROVED',
  'PUBLISHED',
  'REJECTED',
  'RETIRED',
  'ARCHIVED',
] as const;
export const QuestionStatusSchema = z.enum(QUESTION_STATUS);
export type QuestionStatus = z.infer<typeof QuestionStatusSchema>;

export const EVIDENCE_MODE = ['STRICT', 'STANDARD'] as const;
export const EvidenceModeSchema = z.enum(EVIDENCE_MODE);
export type EvidenceMode = z.infer<typeof EvidenceModeSchema>;

export const REVALIDATION_REASON = [
  'CONTENT_CHANGED',
  'SOURCE_DELETED',
  'SOURCE_SECTION_REMOVED',
] as const;
export const RevalidationReasonSchema = z.enum(REVALIDATION_REASON);
export type RevalidationReason = z.infer<typeof RevalidationReasonSchema>;

export const DUPLICATE_DISPOSITION = ['DISTINCT', 'DUPLICATE'] as const;
export const DuplicateDispositionSchema = z.enum(DUPLICATE_DISPOSITION);
export type DuplicateDisposition = z.infer<typeof DuplicateDispositionSchema>;

export const REVIEW_KIND = ['AUTHOR', 'SME', 'REVIEWER'] as const;
export const ReviewKindSchema = z.enum(REVIEW_KIND);
export type ReviewKind = z.infer<typeof ReviewKindSchema>;

export const REVIEW_OUTCOME = ['ENDORSED', 'CHANGES_REQUESTED', 'REJECTED', 'COMMENTED'] as const;
export const ReviewOutcomeSchema = z.enum(REVIEW_OUTCOME);
export type ReviewOutcome = z.infer<typeof ReviewOutcomeSchema>;

export const APPROVAL_DECISION = ['APPROVED', 'REJECTED', 'CHANGES_REQUESTED'] as const;
export const ApprovalDecisionSchema = z.enum(APPROVAL_DECISION);
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

// ------------------------------------------------------------ question bank

export const PUBLISH_OPERATION_TYPE = ['CREATE', 'UPDATE', 'RETIRE'] as const;
export const PublishOperationTypeSchema = z.enum(PUBLISH_OPERATION_TYPE);
export type PublishOperationType = z.infer<typeof PublishOperationTypeSchema>;

export const PUBLISH_OPERATION_STATE = [
  'PENDING',
  'IN_FLIGHT',
  'SUCCEEDED',
  'ALREADY_PUBLISHED',
  'FAILED',
] as const;
export const PublishOperationStateSchema = z.enum(PUBLISH_OPERATION_STATE);
export type PublishOperationState = z.infer<typeof PublishOperationStateSchema>;

export const RECONCILIATION_STATE = [
  'IN_SYNC',
  'MISSING_REMOTE',
  'MISSING_LOCAL',
  'VERSION_DRIFT',
  'STATUS_DRIFT',
  'FIELD_DRIFT',
] as const;
export const ReconciliationStateSchema = z.enum(RECONCILIATION_STATE);
export type ReconciliationState = z.infer<typeof ReconciliationStateSchema>;

export const PUBLISHED_REFERENCE_STATUS = ['PUBLISHED', 'RETIRED', 'SUPERSEDED'] as const;
export const PublishedReferenceStatusSchema = z.enum(PUBLISHED_REFERENCE_STATUS);
export type PublishedReferenceStatus = z.infer<typeof PublishedReferenceStatusSchema>;

export const FIELD_MAPPING_PROFILE_STATUS = ['DRAFT', 'VALIDATED', 'ACTIVE', 'RETIRED'] as const;
export const FieldMappingProfileStatusSchema = z.enum(FIELD_MAPPING_PROFILE_STATUS);
export type FieldMappingProfileStatus = z.infer<typeof FieldMappingProfileStatusSchema>;

// ------------------------------------------------------------ assessments

export const ASSESSMENT_STATUS = ['DRAFT', 'ACTIVE', 'ARCHIVED'] as const;
export const AssessmentStatusSchema = z.enum(ASSESSMENT_STATUS);
export type AssessmentStatus = z.infer<typeof AssessmentStatusSchema>;

export const ASSESSMENT_VERSION_STATUS = [
  'DRAFT',
  'UNDER_REVIEW',
  'APPROVED',
  'PUBLISHED',
  'UNPUBLISHED',
  'ARCHIVED',
] as const;
export const AssessmentVersionStatusSchema = z.enum(ASSESSMENT_VERSION_STATUS);
export type AssessmentVersionStatus = z.infer<typeof AssessmentVersionStatusSchema>;

export const SELECTION_STRATEGY = [
  'FIXED_SET',
  'RANDOM_POOL',
  'TOPIC_BALANCED',
  'TOPIC_DISTRIBUTION',
] as const;
export const SelectionStrategySchema = z.enum(SELECTION_STRATEGY);
export type SelectionStrategy = z.infer<typeof SelectionStrategySchema>;

export const SESSION_MODE = ['SCORED', 'PRACTICE'] as const;
export const SessionModeSchema = z.enum(SESSION_MODE);
export type SessionMode = z.infer<typeof SessionModeSchema>;

export const SESSION_STATUS = ['IN_PROGRESS', 'COMPLETED', 'EXPIRED', 'ABANDONED'] as const;
export const SessionStatusSchema = z.enum(SESSION_STATUS);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const EXPIRY_POLICY = ['SCORE_PARTIAL', 'VOID'] as const;
export const ExpiryPolicySchema = z.enum(EXPIRY_POLICY);
export type ExpiryPolicy = z.infer<typeof ExpiryPolicySchema>;

export const RESULT_STATE = ['SCORED', 'EXPIRED', 'ABANDONED', 'VOIDED'] as const;
export const ResultStateSchema = z.enum(RESULT_STATE);
export type ResultState = z.infer<typeof ResultStateSchema>;

/**
 * Only SCORED results are eligible for recognition and for reporting —
 * badges-and-certificates.md §2.2 L7 and reporting.md §5.1 Q3.
 */
export const REPORTABLE_RESULT_STATES: readonly ResultState[] = ['SCORED'];

export const PROFICIENCY_BAND = [
  'EXPERT',
  'PROFICIENT',
  'DEVELOPING',
  'NEEDS_IMPROVEMENT',
  'CRITICAL_KNOWLEDGE_GAP',
] as const;
export const ProficiencyBandSchema = z.enum(PROFICIENCY_BAND);
export type ProficiencyBand = z.infer<typeof ProficiencyBandSchema>;

export const GAP_STATE = ['GAP', 'NO_GAP', 'INSUFFICIENT_EVIDENCE'] as const;
export const GapStateSchema = z.enum(GAP_STATE);
export type GapState = z.infer<typeof GapStateSchema>;

export const RECOMMENDATION_DISPOSITION = ['NEW', 'VIEWED', 'COMPLETED', 'DISMISSED'] as const;
export const RecommendationDispositionSchema = z.enum(RECOMMENDATION_DISPOSITION);
export type RecommendationDisposition = z.infer<typeof RecommendationDispositionSchema>;

// ------------------------------------------------------------ recognition

export const BADGE_TRIGGER = ['RESULT_SCORED', 'RECOMMENDATION_COMPLETED', 'PERIODIC'] as const;
export const BadgeTriggerSchema = z.enum(BADGE_TRIGGER);
export type BadgeTrigger = z.infer<typeof BadgeTriggerSchema>;

export const CERTIFICATE_STATUS = ['ISSUED', 'EXPIRED', 'REVOKED'] as const;
export const CertificateStatusSchema = z.enum(CERTIFICATE_STATUS);
export type CertificateStatus = z.infer<typeof CertificateStatusSchema>;

/** Returned by public verification as a category, never as free text — §6 W7. */
export const REVOKE_REASON_CATEGORY = [
  'SUPERSEDED',
  'RESULT_VOIDED',
  'ADMINISTRATIVE',
  'ERROR_IN_ISSUANCE',
] as const;
export const RevokeReasonCategorySchema = z.enum(REVOKE_REASON_CATEGORY);
export type RevokeReasonCategory = z.infer<typeof RevokeReasonCategorySchema>;

// -------------------------------------------------------------- platform

export const NOTIFICATION_CHANNEL = ['IN_APP', 'EMAIL', 'TEAMS'] as const;
export const NotificationChannelSchema = z.enum(NOTIFICATION_CHANNEL);
export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;

/** Only IN_APP is delivered in release 1 — knowledge-source-administration.md §8. */
export const RELEASE_1_NOTIFICATION_CHANNELS: readonly NotificationChannel[] = ['IN_APP'];

export const NOTIFICATION_STATE = ['PENDING', 'DELIVERED', 'READ', 'DISMISSED', 'FAILED'] as const;
export const NotificationStateSchema = z.enum(NOTIFICATION_STATE);
export type NotificationState = z.infer<typeof NotificationStateSchema>;

export const CONFIGURATION_SCOPE = [
  'PLATFORM',
  'DOMAIN',
  'SOURCE',
  'PROFILE',
  'ASSESSMENT',
] as const;
export const ConfigurationScopeSchema = z.enum(CONFIGURATION_SCOPE);
export type ConfigurationScope = z.infer<typeof ConfigurationScopeSchema>;

export const REPORT_STATUS = [
  'DRAFT',
  'UNDER_REVIEW',
  'APPROVED',
  'PUBLISHED',
  'RETIRED',
  'ARCHIVED',
] as const;
export const ReportStatusSchema = z.enum(REPORT_STATUS);
export type ReportStatus = z.infer<typeof ReportStatusSchema>;

export const EXPORT_FORMAT = ['CSV', 'XLSX', 'PDF'] as const;
export const ExportFormatSchema = z.enum(EXPORT_FORMAT);
export type ExportFormat = z.infer<typeof ExportFormatSchema>;

export const FINDING_STATE = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'] as const;
export const FindingStateSchema = z.enum(FINDING_STATE);
export type FindingState = z.infer<typeof FindingStateSchema>;

export const KNOWZY_ENV = ['local', 'dev', 'test', 'prod'] as const;
export const KnowzyEnvSchema = z.enum(KNOWZY_ENV);
export type KnowzyEnv = z.infer<typeof KnowzyEnvSchema>;

/** Registry partition for MCP tools and API scopes — mcp-tools.md §3.1 E5/E6. */
export const PORTAL_CONTEXT = ['AUTHORING', 'LIVE', 'SYSTEM'] as const;
export const PortalContextSchema = z.enum(PORTAL_CONTEXT);
export type PortalContext = z.infer<typeof PortalContextSchema>;
