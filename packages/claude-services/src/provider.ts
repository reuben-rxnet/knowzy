// The generation provider contract — MULTI_PROVIDER_GENERATION_ARCHITECTURE.md §2.
//
// A provider drafts questions. It decides nothing else: scoring, approval,
// publication and eligibility never call a model, whichever provider produced
// the draft, and every candidate passes the same unmodified gate chain.
//
// The design rule this file exists to enforce is honest capability
// declaration, copied from adapter template rule P1 — "emulating a capability
// is a contract violation". A provider states what it can do and the platform
// REFUSES what it cannot, rather than substituting something that looks
// similar. A silent fallback to another provider or another execution mode
// would make a job's recorded provenance false, which is worse than a refusal
// an author can read.

import type { GenerationExecutionMode, GenerationProviderId } from '@knowzy/shared-types';
import {
  createDeterministicGenerator,
  type GenerateArgs,
  type GenerateResult,
} from './generator.js';

export interface ProviderCapabilities {
  /**
   * The provider performs NO retrieval of its own: it sees only what the
   * prompt contains.
   *
   * This is the eligibility gate for grounded generation, and it is the
   * reason this interface exists. The platform guarantees that a question is
   * answerable from ONE supplied section and cites a span verified
   * character-by-character against that section's text. A provider that
   * grounds its own answers in a corpus the platform did not supply — a
   * Copilot reaching Microsoft Graph, for instance — either quotes something
   * the platform cannot verify (safe: the candidate is refused) or writes a
   * question shaped by content the author never selected while quoting the
   * section (not safe: the span verifies, scope enforcement passes, and
   * nothing in the gate chain detects it).
   *
   * The second case is a confidentiality problem rather than a quality one, so
   * a provider that cannot declare `true` here is not eligible at all.
   */
  readonly retrievalFree: boolean;
  readonly supportedExecutionModes: readonly GenerationExecutionMode[];
  /** False when token counts are the platform's own estimate. */
  readonly reportsTokenUsage: boolean;
  /**
   * Whether a per-call monetary cost is observable AT ALL.
   *
   * False for a licence-based provider, where there is no marginal cost to
   * compute, and false for any user-managed run, where the spend lands on the
   * author's account and the platform cannot see the billed amount. A cost
   * recorded in those cases would be invented.
   */
  readonly reportsCost: boolean;
  readonly supportsStructuredOutput: boolean;
  /**
   * Tools granted to a generation call. Typed `false` so a provider cannot
   * declare otherwise: `framing.ts` grants none and an injected
   * "call this tool" must have nothing to call.
   */
  readonly grantsTools: false;
  readonly maxInputTokens: number;
  /**
   * Whether THIS BUILD can generate questions with the provider.
   *
   * Distinct from every field above, which describe the provider: this one
   * describes the platform's client. OPENAI-CODEX-00 registers an OpenAI
   * client that validates readiness and cannot generate, and the registry
   * turns `false` here into UNAVAILABLE so it can never be activated.
   */
  readonly supportsGeneration: boolean;
  /** Whether the provider's API can stream a response. Declared, not used. */
  readonly supportsStreaming: boolean;
}

export interface ExecutionContext {
  readonly mode: GenerationExecutionMode;
  /** Whose entitlement is consumed. Required in USER_MANAGED, else null. */
  readonly onBehalfOfUserId: string | null;
  readonly correlationId: string;
}

export interface ProviderGenerateResult extends GenerateResult {
  readonly providerId: GenerationProviderId;
  readonly providerVersion: string;
  /**
   * False when `inputTokens`/`outputTokens` were estimated rather than
   * reported. A cost derived from an estimate is an estimate of an estimate,
   * and a comparison of "tokens per accepted question" across a reported and
   * an estimated arm is meaningless unless the difference is visible.
   */
  readonly tokenUsageReported: boolean;
}

export interface GenerationProvider {
  readonly providerId: GenerationProviderId;
  readonly capabilities: ProviderCapabilities;
  /** Resolved from the generation profile, never hardcoded (T-30). */
  readonly modelId: string;
  readonly providerVersion: string;
  generate(args: GenerateArgs, context: ExecutionContext): Promise<ProviderGenerateResult>;
}

/**
 * Declared capabilities for every provider the platform knows about,
 * INCLUDING the ones that are not registered.
 *
 * Declaration and registration are deliberately separate. This catalogue says
 * what a provider would be able to do; the registry says whether it can be
 * used here and now. Keeping them apart is what lets the platform refuse a
 * provider with a specific reason — unregistered, wrong mode, missing
 * credential, not grounding-safe — instead of a single unhelpful "unavailable".
 */
export const PROVIDER_CATALOGUE: Readonly<Record<GenerationProviderId, ProviderCapabilities>> =
  Object.freeze({
    DETERMINISTIC_LOCAL: {
      retrievalFree: true,
      // No credential and no entitlement, so the mode is a formality: it runs
      // in process. Declared PLATFORM_MANAGED because that is what "the
      // platform ran it" means.
      supportedExecutionModes: ['PLATFORM_MANAGED'],
      reportsTokenUsage: false,
      // Genuinely zero rather than unknown, which is a different thing from
      // the providers below and is why `reportsCost` is true here.
      reportsCost: true,
      supportsStructuredOutput: true,
      grantsTools: false,
      maxInputTokens: Number.MAX_SAFE_INTEGER,
      supportsGeneration: true,
      supportsStreaming: false,
    },
    ANTHROPIC: {
      retrievalFree: true,
      // PLATFORM_MANAGED only, and this is not a simplification.
      //
      // Anthropic has no on-behalf-of flow, and a claude.ai subscription is
      // not an API credential. The only "user-managed" form would be an author
      // supplying a personal API key — a separate entitlement they must obtain
      // — which would make the platform custodian of per-person credentials.
      // Architecture §0.1 and §4.4.
      supportedExecutionModes: ['PLATFORM_MANAGED'],
      reportsTokenUsage: true,
      reportsCost: true,
      supportsStructuredOutput: true,
      grantsTools: false,
      maxInputTokens: 180_000,
      supportsGeneration: false,
      supportsStreaming: true,
    },
    OPENAI: {
      retrievalFree: true,
      // PLATFORM_MANAGED only, for the same reason as Anthropic rather than a
      // different one: there is no on-behalf-of flow, and the only
      // "user-managed" form would be an author's personal API key, which
      // architecture §4.4 refuses in v1 -- the platform will not become
      // custodian of per-person credentials.
      supportedExecutionModes: ['PLATFORM_MANAGED'],
      reportsTokenUsage: true,
      reportsCost: true,
      supportsStructuredOutput: true,
      grantsTools: false,
      maxInputTokens: 128_000,
      // A readiness client exists (OPENAI-CODEX-00); generation does not.
      supportsGeneration: false,
      supportsStreaming: true,
    },
    MICROSOFT_COPILOT: {
      // FALSE, pending investigation, and therefore ineligible.
      //
      // Microsoft 365 Copilot grounds its answers in the user's Microsoft
      // Graph content by design. Until it can be demonstrably invoked without
      // that grounding, it cannot satisfy the platform's evidence contract.
      // This is declared false rather than left out so the refusal names the
      // real reason (PROVIDER_NOT_GROUNDING_SAFE) instead of pretending the
      // provider is merely unfinished. Architecture §0.2, blocker P-2.
      retrievalFree: false,
      // Copilot is licensed per user and reached with delegated Entra tokens,
      // so user-managed is its NATIVE mode — the opposite of Anthropic.
      supportedExecutionModes: ['USER_MANAGED'],
      reportsTokenUsage: false,
      // A per-seat licence has no marginal per-call cost to report.
      reportsCost: false,
      supportsStructuredOutput: false,
      grantsTools: false,
      maxInputTokens: 100_000,
      supportsGeneration: false,
      supportsStreaming: false,
    },
    AZURE_OPENAI: {
      retrievalFree: true,
      supportedExecutionModes: ['PLATFORM_MANAGED', 'USER_MANAGED'],
      reportsTokenUsage: true,
      reportsCost: true,
      supportsStructuredOutput: true,
      grantsTools: false,
      maxInputTokens: 120_000,
      supportsGeneration: false,
      supportsStreaming: true,
    },
    GEMINI: {
      retrievalFree: true,
      supportedExecutionModes: ['PLATFORM_MANAGED'],
      reportsTokenUsage: true,
      reportsCost: true,
      supportsStructuredOutput: true,
      grantsTools: false,
      maxInputTokens: 120_000,
      supportsGeneration: false,
      supportsStreaming: true,
    },
  });

/**
 * Whether a provider may be used for grounded generation at all.
 *
 * Exported as a named predicate rather than inlined, because it is the one
 * capability check that is about correctness rather than availability, and a
 * contract test asserts it is applied.
 */
export const isGroundingSafe = (capabilities: ProviderCapabilities): boolean =>
  capabilities.retrievalFree;

/** The deterministic generator, presented as a provider. */
export const createDeterministicProvider = (): GenerationProvider => {
  const generator = createDeterministicGenerator();
  return {
    providerId: 'DETERMINISTIC_LOCAL',
    capabilities: PROVIDER_CATALOGUE.DETERMINISTIC_LOCAL,
    modelId: generator.modelId,
    // The generator's own identity, not a model version. Named honestly: there
    // is no model here and the provenance must not suggest one.
    providerVersion: 'knowzy-deterministic-local-1',
    async generate(args: GenerateArgs, _context: ExecutionContext) {
      const result = await generator.generate(args);
      return {
        ...result,
        providerId: 'DETERMINISTIC_LOCAL' as const,
        providerVersion: 'knowzy-deterministic-local-1',
        // Estimated from prompt length, which the generator says in its own
        // comment. Reported as an estimate so a token comparison cannot
        // silently treat it as measured.
        tokenUsageReported: false,
      };
    },
  };
};
