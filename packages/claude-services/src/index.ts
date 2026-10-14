// @knowzy/claude-services
//
// Prompt registry and versioning, untrusted-content framing, structured output
// parsing, evidence verification, token accounting.
//
// Boundary: B4 — may not reach a database client, transitively. The prompt
// layer has no data access, so it cannot widen retrieval. Everything here is a
// pure function over text that was handed to it.
//
// The live Anthropic client lands with Phase 4; the port and the deterministic
// local generator are here so the zero-credential path works end to end and the
// gate chain is exercised for real.

export {
  verifyEvidence,
  trigramSimilarity,
  EVIDENCE_MIN_CHARS,
  EVIDENCE_MAX_CHARS,
  STANDARD_SIMILARITY_FLOOR,
  type EvidenceResult,
  type EvidenceVerified,
  type EvidenceRejected,
  type EvidenceFailureCode,
  type EvidenceSection,
  type VerifyEvidenceArgs,
} from './evidence.js';

export {
  GeneratedQuestionSchema,
  GenerationOutputSchema,
  InsufficientEvidenceSchema,
  OPTION_KEYS,
  OUTPUT_SCHEMA_VERSION,
  type GeneratedQuestion,
  type GenerationOutput,
  type InsufficientEvidence,
  type OptionKey,
} from './output-schema.js';

export {
  checkIntegrity,
  optionDistinctness,
  type IntegrityFailure,
  type IntegrityFailureReason,
} from './integrity.js';

export {
  computeConfidence,
  CONFIDENCE_WEIGHTS,
  type ConfidenceArgs,
  type ConfidenceComponents,
  type ConfidenceResult,
} from './confidence.js';

export {
  frameGenerationPrompt,
  GENERATION_TOOL_GRANT,
  type FramedPrompt,
  type FramedSection,
  type FramingArgs,
} from './framing.js';

export {
  createDeterministicGenerator,
  type GenerateArgs,
  type GenerateResult,
  type InsufficientSection,
  type QuestionGenerator,
} from './generator.js';

export const PACKAGE_NAME = '@knowzy/claude-services' as const;

export {
  canonicalPromptBody,
  promptBodyHash,
  CANONICAL_PROMPT_NONCE,
  PROMPT_BODY_SHA256,
  PROMPT_SEMANTIC_VERSION,
} from './prompt-version.js';

export {
  PROVIDER_CATALOGUE,
  createDeterministicProvider,
  isGroundingSafe,
  type ExecutionContext,
  type GenerationProvider,
  type ProviderCapabilities,
  type ProviderGenerateResult,
} from './provider.js';

export {
  createGeneratorRegistry,
  ProviderRefusedError,
  type GeneratorRegistry,
  type ProviderFactory,
  type RegistryInput,
} from './registry.js';

export {
  REQUIRED_SETTINGS,
  mayProbe,
  missingSettings,
  outcomeOf,
  settingsFingerprint,
  validateProvider,
  type SecretCheck,
  type ValidateProviderInput,
  type ValidateProviderResult,
} from './validation.js';

// OPENAI-CODEX-00: readiness, not generation.
export {
  OPENAI_DEFAULT_BASE_URL,
  OPENAI_DEFAULT_HOSTS,
  checkOpenAIReadiness,
  type CheckReadinessArgs,
  type ReadinessLimits,
  type ReadinessResult,
} from './openai.js';

export { deriveReadiness, type DeriveReadinessInput } from './readiness.js';

// OPENAI-CODEX-01: generation. Proposals only; every gate still applies.
export {
  OPENAI_API_STYLES,
  OPENAI_GENERATION_PROVIDER_VERSION,
  OPENAI_RESPONSE_SCHEMA,
  OpenAIGenerationError,
  createOpenAIGenerationProvider,
  mapModelAnswer,
  type CreateOpenAIGenerationProviderArgs,
  type OpenAIApiStyle,
  type OpenAICallConfig,
} from './openai-generation.js';

/** The five capabilities a provider declares, in the administration screen's names. */
export { declaredCapabilities } from './declared.js';

export {
  assessProviderHealth,
  type HealthAssessment,
  type HealthSample,
  type HealthThresholds,
} from './health.js';

export {
  CHARS_PER_TOKEN_ESTIMATE,
  COST_SCALE,
  PROMPT_OVERHEAD_TOKENS,
  addTokens,
  estimateInputTokens,
  aggregateCost,
  computeCost,
  emptyTokenAccount,
  observableCost,
  resolvePrice,
  tokenAccount,
  unobservableCost,
  type CostInput,
} from './accounting.js';

// GATEWAY-M1: one request builder for readiness and generation.
export {
  authFromSettings,
  classifyTransportError,
  endpointPermission,
  providerFetch,
  sanitizeUrl,
  type ProviderAuth,
  type ProviderEndpoint,
  type TransportFailureCause,
} from './provider-request.js';

// AI Document Studio: readiness for purpose DOCUMENT_RESTRUCTURE (Slice 2),
// and the preparers (M3): OpenAI, which is AI, and the local-only test
// preparer, which is not.
export {
  evaluateRestructureReadiness,
  restructureCapability,
  RESTRUCTURING_CLIENTS,
} from './restructure-readiness.js';
export type { RestructureReadinessInput } from './restructure-readiness.js';
export {
  createOpenAIPreparer,
  createTestPreparer,
  estimatePreparationTokens,
  framePreparationPrompt,
  OPENAI_PREPARATION_SCHEMA,
  PREPARATION_PROMPT_SHA256,
  preparationPromptHash,
  PREPARATION_PROMPT_VERSION,
  PREPARATION_SYSTEM_PROMPT,
  PREPARATION_TOOL_GRANT,
  PreparationError,
} from './document-preparation.js';
export type {
  DocumentPreparer,
  OpenAIPreparationConfig,
  PreparationErrorCode,
  PreparationRequest,
  PreparationResult,
  PreparationSection,
} from './document-preparation.js';
