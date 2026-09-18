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

export const PACKAGE_NAME = '@knowzy/domain' as const;
