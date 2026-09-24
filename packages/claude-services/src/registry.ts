// The generation provider registry — architecture.md §9.0 rules 1–3.
//
// Declaration and registration are separate, and this file is where the
// difference is made visible. `PROVIDER_CATALOGUE` says what a provider WOULD
// be able to do; the registry says whether it can be used here and now, and
// if not, which of five named states it is in and what would change it.
//
// The pattern is copied from `createAdapterRegistry` for knowledge sources
// rather than invented: registration is explicit and closed, an unregistered
// id resolves to a refusal and never to a fallback, and environment
// prohibitions are enforced at construction. The precedent's own words —
// "registering a stand-in that returned fixture data would make a
// misconfigured production source look like a working one".
//
// Nothing here performs I/O. A registry is a decision over declared facts:
// what is implemented, what is approved, what is configured, what is
// grounding-safe. That is why it can be written and tested in full before any
// provider client exists.

import {
  isGroundingSafe,
  PROVIDER_CATALOGUE,
  createDeterministicProvider,
  type GenerationProvider,
  type ProviderCapabilities,
} from './provider.js';
import {
  GENERATION_PROVIDER,
  type ErrorCode,
  type GenerationExecutionMode,
  type GenerationProviderId,
  type GenerationRefusalReason,
  type ProviderState,
  type ProviderStateAssessment,
} from '@knowzy/shared-types';

/**
 * A refusal to provide a provider, carrying everything a caller needs to
 * record and render it without re-deriving anything.
 *
 * It is an error class rather than a result union because every call site must
 * handle it: a caller that ignored a refusal and generated anyway is the one
 * failure mode this whole file exists to prevent.
 */
export class ProviderRefusedError extends Error {
  override readonly name = 'ProviderRefusedError';
  constructor(
    readonly providerId: GenerationProviderId,
    readonly refusalReason: GenerationRefusalReason,
    readonly code: ErrorCode,
    readonly detail: string,
  ) {
    super(detail);
  }
}

/** Builds a provider instance. Absent means "not implemented in this build". */
export type ProviderFactory = (modelId: string) => GenerationProvider;

export interface RegistryInput {
  /**
   * Which providers have a client in this build.
   *
   * The deterministic provider is added unconditionally below and cannot be
   * removed — architecture.md §9.0 rule 5. Passing factories is how a future
   * milestone registers a real provider without touching this file.
   */
  readonly factories?: Readonly<Partial<Record<GenerationProviderId, ProviderFactory>>>;
  /** `llm.activeProvider`. */
  readonly activeProvider: GenerationProviderId;
  /** `llm.approvedProviders` — a recorded data-processing approval. */
  readonly approvedProviders: readonly GenerationProviderId[];
  /**
   * Whether a credential reference resolves for each provider.
   *
   * A boolean, never the credential: this package may not hold one, and a
   * registry that could read a secret would be a registry worth attacking.
   */
  readonly credentialPresent?: Readonly<Partial<Record<GenerationProviderId, boolean>>>;
  /** Versions observed on past runs, for display. Never invented. */
  readonly observedVersions?: Readonly<Partial<Record<GenerationProviderId, string | null>>>;
}

interface StateDecision {
  readonly state: ProviderState;
  readonly reason: string;
  readonly refusalReason: GenerationRefusalReason | null;
  readonly code: ErrorCode | null;
}

/**
 * Resolve the single state of one provider.
 *
 * THE ORDER IS THE POLICY, and it is deliberately most-permanent first, so the
 * reason an operator reads is the one they can least easily change:
 *
 *   1. capability   — no approval or credential can make an ungrounded
 *                     provider safe for grounded generation
 *   2. approval     — a signature, not an engineering task
 *   3. implemented  — a build, not a configuration
 *   4. credential   — configuration, the cheapest thing to fix
 *
 * Reversing 1 and 2 would tell somebody to go and get Copilot approved for a
 * use it can never satisfy.
 */
const decideState = (
  providerId: GenerationProviderId,
  capabilities: ProviderCapabilities,
  input: RegistryInput,
): StateDecision => {
  if (!isGroundingSafe(capabilities)) {
    return {
      state: 'BLOCKED_BY_CAPABILITY',
      reason:
        'This provider performs its own retrieval, so a question it drafts cannot be grounded in the selected sections alone. No approval or credential changes that.',
      refusalReason: 'PROVIDER_BLOCKED_BY_CAPABILITY',
      code: 'PROVIDER_NOT_GROUNDING_SAFE',
    };
  }

  if (!input.approvedProviders.includes(providerId)) {
    return {
      state: 'BLOCKED_BY_APPROVAL',
      reason:
        'No data-processing approval is recorded for this provider. Add it to llm.approvedProviders once the approval exists.',
      refusalReason: 'PROVIDER_BLOCKED_BY_APPROVAL',
      code: 'PROVIDER_NOT_APPROVED',
    };
  }

  const factory = input.factories?.[providerId];
  if (factory === undefined) {
    return {
      state: 'UNAVAILABLE',
      reason: 'No client for this provider is implemented in this build.',
      refusalReason: 'PROVIDER_NOT_REGISTERED',
      code: 'PROVIDER_NOT_REGISTERED',
    };
  }

  if (input.credentialPresent?.[providerId] === false) {
    return {
      state: 'BLOCKED_BY_CONFIGURATION',
      reason: 'The credential reference for this provider does not resolve in this environment.',
      refusalReason: 'PROVIDER_BLOCKED_BY_CONFIGURATION',
      code: 'PROVIDER_CREDENTIAL_UNAVAILABLE',
    };
  }

  return {
    state: 'AVAILABLE',
    reason: 'Registered, approved and configured.',
    refusalReason: null,
    code: null,
  };
};

export interface GeneratorRegistry {
  /** Every DECLARED provider with its state — including the unusable ones. */
  describe(): readonly ProviderStateAssessment[];
  assess(providerId: GenerationProviderId): ProviderStateAssessment;
  /**
   * The provider for a job, or a refusal naming why.
   *
   * Never returns a different provider from the one asked for, and never
   * silently changes the execution mode. A substitution would make the
   * provenance recorded on the job false.
   */
  forJob(args: {
    readonly providerId?: GenerationProviderId;
    readonly executionMode: GenerationExecutionMode;
    readonly modelId: string;
  }): GenerationProvider;
  readonly activeProvider: GenerationProviderId;
}

export const createGeneratorRegistry = (input: RegistryInput): GeneratorRegistry => {
  // The deterministic provider is registered in EVERY environment, forever:
  // the zero-credential path, the control arm of every comparison, and the
  // reason the gate chain is known to work. It is merged under the caller's
  // factories rather than over them so a future real provider cannot
  // accidentally displace it.
  const factories: Readonly<Partial<Record<GenerationProviderId, ProviderFactory>>> = {
    DETERMINISTIC_LOCAL: () => createDeterministicProvider(),
    ...(input.factories ?? {}),
  };
  const resolved: RegistryInput = { ...input, factories };

  const assess = (providerId: GenerationProviderId): ProviderStateAssessment => {
    const capabilities = PROVIDER_CATALOGUE[providerId];
    const decision = decideState(providerId, capabilities, resolved);
    return {
      providerId,
      state: decision.state,
      reason: decision.reason,
      registered: factories[providerId] !== undefined,
      approved: resolved.approvedProviders.includes(providerId),
      groundingSafe: capabilities.retrievalFree,
      supportedExecutionModes: capabilities.supportedExecutionModes,
      reportsTokenUsage: capabilities.reportsTokenUsage,
      reportsCost: capabilities.reportsCost,
      maxInputTokens: capabilities.maxInputTokens,
      providerVersion: resolved.observedVersions?.[providerId] ?? null,
    };
  };

  return {
    activeProvider: input.activeProvider,

    describe: () => GENERATION_PROVIDER.map(assess),

    assess,

    forJob: ({ providerId, executionMode, modelId }) => {
      const wanted = providerId ?? input.activeProvider;
      const capabilities = PROVIDER_CATALOGUE[wanted];
      const decision = decideState(wanted, capabilities, resolved);

      if (decision.refusalReason !== null && decision.code !== null) {
        throw new ProviderRefusedError(
          wanted,
          decision.refusalReason,
          decision.code,
          decision.reason,
        );
      }

      // Mode is checked AFTER availability and separately, because "this
      // provider cannot run user-managed" and "this provider is not approved"
      // send an operator to two different places.
      if (!capabilities.supportedExecutionModes.includes(executionMode)) {
        throw new ProviderRefusedError(
          wanted,
          'EXECUTION_MODE_UNSUPPORTED',
          'PROVIDER_MODE_NOT_SUPPORTED',
          `This provider supports ${capabilities.supportedExecutionModes.join(' and ')}, not ${executionMode}.`,
        );
      }

      const factory = factories[wanted];
      if (factory === undefined) {
        // Unreachable while decideState checks registration first, and kept
        // because the alternative to an explicit throw here is a non-null
        // assertion that would hide a future reordering of those checks.
        throw new ProviderRefusedError(
          wanted,
          'PROVIDER_NOT_REGISTERED',
          'PROVIDER_NOT_REGISTERED',
          'No client for this provider is implemented in this build.',
        );
      }
      return factory(modelId);
    },
  };
};
