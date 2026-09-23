// @knowzy/domain
//
// Domain services: generation governance, review and approval, assessment,
// scoring, badges, and certificates.
//
// Boundary: B3 — domain services speak adapter INTERFACES only, transitively.
// No Graph type, no SharePoint field name, and no adapter vocabulary reaches
// this layer. That is why the normalization pipeline lives in
// @knowzy/shared-types rather than in @knowzy/content-extraction.

export {
  resolveGenerationScope,
  scopeSectionKeys,
  GenerationScopeEmptyError,
  GenerationSelectionRequiredError,
  MAX_DOCUMENTS_PER_JOB,
  type ResolvedGenerationScope,
  type ResolveScopeArgs,
  type ScopedDocument,
  type ScopedSection,
} from './generation/scope.js';

export {
  runPreflight,
  DocumentNotReadyError,
  PREFLIGHT_TTL_MS,
  type PreflightResult,
  type DocumentPreflight,
  type RunPreflightArgs,
} from './generation/preflight.js';

export {
  assessDuplicate,
  scoreSimilarity,
  SIMILARITY_WEIGHTS,
  type ComparableQuestion,
  type DuplicateThresholds,
  type DuplicateVerdict,
  type SimilarityMatch,
} from './generation/similarity.js';

export {
  createGenerationJob,
  GenerationPreconditionError,
  PreflightRequiredError,
  type CreatedJob,
  type CreateJobArgs,
} from './generation/job-creation.js';

export {
  runGenerationJob,
  ContentDriftError,
  type GenerationProfileSettings,
  type GenerationRejection,
  type GenerationRunContext,
  type GenerationRunResult,
  type RunGenerationArgs,
} from './generation/generation-service.js';

// ------------------------------------------------------------ review (M4)

export {
  evaluateApprovalGates,
  gateResultsForAudit,
  type GateCode,
  type GateEvaluation,
  type GatePolicyState,
  type GateResult,
  type GateSourceState,
  type GateSubject,
} from './review/gates.js';

export {
  evaluateApprovalSeparation,
  evaluatePublishSeparation,
  BreakGlassNotPermittedError,
  DEFAULT_SEPARATION_POLICIES,
  type SeparationDecision,
  type SeparationPolicies,
} from './review/separation-of-duties.js';

export {
  availableTransitions,
  findTransition,
  requireTransition,
  APPROVAL_QUEUE_STATUSES,
  AUTHOR_QUEUE_STATUSES,
  CommentRequiredError,
  TRANSITIONS,
  TransitionNotPermittedError,
  type AvailableTransition,
  type TransitionRule,
} from './review/transitions.js';

export {
  addReview,
  dispositionDuplicate,
  evaluateGatesForQuestion,
  transitionQuestion,
  GatesFailedError,
  PermissionRequiredError,
  QuestionNotFoundError,
  type ActorContext,
  type ReviewDeps,
  type TransitionResult,
} from './review/review-service.js';

export {
  editDraftQuestion,
  readVersionHistory,
  EvidenceBrokenByEditError,
  NotEditableError,
  type EditResult,
  type FieldDiff,
  type QuestionEdit,
  type VersionHistoryEntry,
} from './review/versioning.js';

export {
  operationKeyFor,
  publishApprovedQuestions,
  retirePublishedQuestion,
  PublishNotPermittedError,
  type PublishBatchResult,
  type PublishItemOutcome,
  type PublishTarget,
} from './review/publishing.js';

// -------------------------------------------------------- assessment (M6)

export {
  assertValidBandSet,
  bandFor,
  percentageOf,
  roundHalfAwayFromZero,
  scoreSession,
  DEFAULT_PROFICIENCY_BANDS,
  InvalidBandSetError,
  SCORING_ENGINE_VERSION,
  type ObjectiveScore,
  type ProficiencyBandDefinition,
  type ScoreArgs,
  type ScoreResult,
  type SnapshotQuestion,
  type SnapshotResponse,
  type TopicScore,
} from './assessment/scoring.js';

export {
  allocateEvenly,
  createSeededRandom,
  intersectWithSnapshot,
  onePerCluster,
  seededShuffle,
  selectQuestions,
  PoolInsufficientError,
  type EligibleQuestion,
  type SelectionConfig,
  type SelectionResult,
  type SnapshotMember,
} from './assessment/selection.js';

export {
  createAssessment,
  evaluatePool,
  publishAssessmentVersion,
  transitionAssessmentVersion,
  validateAssessmentVersion,
  AssessmentConfigError,
  AssessmentNotFoundError,
  type CreateAssessmentArgs,
  type CreatedAssessment,
  type PoolEvaluation,
  type PoolMember,
  type PublishedAssessment,
  type ValidationResult,
} from './assessment/assessment-service.js';

export {
  assertNoAnswerKey,
  completeSession,
  currentQuestion,
  deriveSessionId,
  expireSession,
  readResult,
  recordSessionRecovery,
  resumeSession,
  startSession,
  submitAnswer,
  toLearnerQuestion,
  NotEligibleError,
  SequenceConflictError,
  SessionNotActiveError,
  SessionNotFoundError,
  type CompletionResult,
  type CurrentQuestionResult,
  type LearnerContext,
  type ResultView,
  type SessionDeps,
  type StartedSession,
  type SubmitAnswerResult,
} from './assessment/session-service.js';

export const PACKAGE_NAME = '@knowzy/domain' as const;

export {
  runQuestionImport,
  type ImportRejection,
  type ImportRunResult,
  type ImportTargetDocument,
  type ImportTargetSection,
  type RunImportArgs,
} from './import/import-service.js';

export {
  createDomain,
  createTopic,
  normalizeDescription,
  normalizeDisplayName,
  normalizeDomainCode,
  readTaxonomy,
  topicSlug,
  updateDomain,
  updateTopic,
  TaxonomyError,
  type CreateDomainArgs,
  type CreateTopicArgs,
  type DomainRow,
  type TaxonomyActor,
  type TaxonomyDeps,
  type TaxonomyQuery,
  type TopicRow,
  type UpdateDomainArgs,
  type UpdateTopicArgs,
} from './taxonomy/taxonomy-service.js';

export {
  resolveImportTaxonomy,
  taxonomyResolver,
  type DetectedTaxonomy,
  type MappingStatus,
  type ResolveArgs,
  type ResolveResult,
  type TaxonomyCatalogueDomain,
  type TaxonomyMappingChoice,
  type TaxonomyResolution,
} from './taxonomy/import-mapping.js';

export {
  describeSchedule,
  dueRunKey,
  intervalMsOf,
  isDue,
  nextRunAt,
  requireSchedule,
  scheduleOf,
  MANUAL_SCHEDULE,
  ScheduleInvalidError,
  SyncScheduleSchema,
  SYNC_SCHEDULE_MODES,
  type SyncSchedule,
  type SyncScheduleMode,
} from './sync/schedule.js';

export {
  addSourcePath,
  createSource,
  hasLineage,
  isWithinRoot,
  lineageOf,
  modifySourcePath,
  requireAllowedLocalRoot,
  retireSource,
  setSourceActive,
  updateSource,
  SourceAdminError,
  type CreateSourceArgs,
  type LineageCounts,
  type PathArgs,
  type SourceActor,
  type SourceAdminDeps,
  type SourceRow,
  type UpdateSourceArgs,
} from './sync/source-administration.js';
