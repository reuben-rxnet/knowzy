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
  validateProvider,
  type ValidateProviderInput,
  type ValidateProviderResult,
} from './validation.js';

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
