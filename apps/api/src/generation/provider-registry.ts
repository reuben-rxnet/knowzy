// The generation provider registry — MULTI_PROVIDER_GENERATION_ARCHITECTURE.md §1, §3.2.
//
// Lives in the API app because that is where a job runs and where a provider
// credential resolves: `ANTHROPIC_API_KEY_REF` is declared for `api` and
// `jobs`, and the MCP server must not hold it (the C6 pattern).
//
// The whole point of this module is the REFUSALS. Every path that cannot
// produce the provider the caller asked for returns a named error rather than
// a substitute:
//
//   * falling back to another provider would spend a different budget and make
//     the job's recorded provenance false;
//   * falling back to another execution MODE would spend the platform's money
//     while the provenance claims the author's entitlement, or vice versa;
//   * falling back to the deterministic generator would put template-engine
//     questions in a batch an author believes a model wrote.
//
// All three are worse than an error an author can read, which is why there is
// no fallback anywhere below.

import {
  PROVIDER_CATALOGUE,
  createDeterministicProvider,
  isGroundingSafe,
  type GenerationProvider,
  type ProviderCapabilities,
} from '@knowzy/claude-services';
import type {
  ErrorCode,
  GenerationExecutionMode,
  GenerationProviderId,
  KnowzyEnv,
} from '@knowzy/shared-types';

/**
 * A refusal to produce the provider that was asked for.
 *
 * Carries the ErrorCode so the route maps it to a problem document without a
 * chain of instanceof checks, following the convention the generation route
 * already uses for the domain's named errors.
 */
export class ProviderResolutionError extends Error {
  constructor(
    readonly code: ErrorCode,
    detail: string,
  ) {
    super(detail);
    this.name = 'ProviderResolutionError';
  }
}

export interface ProviderRegistryOptions {
  /**
   * Includes `'unknown'`, because the registry must be constructible even when
   * startup validation has failed to resolve the environment -- a registry
   * that could not be built would turn a configuration problem into a crash
   * with no startup report. Reserved for environment prohibitions of the kind
   * the mock adapters already enforce.
   */
  readonly environment: KnowzyEnv | 'unknown';
  /**
   * Which providers hold a resolvable platform credential.
   *
   * Passed in rather than read here, because content rule C3 confines
   * `process.env` to `@knowzy/configuration`. A provider absent from this set
   * is refused with PROVIDER_CREDENTIAL_UNAVAILABLE rather than being quietly
   * skipped.
   */
  readonly credentialedProviders?: readonly GenerationProviderId[];
  /**
   * Whether the requesting subject holds a usable entitlement for a provider,
   * for USER_MANAGED resolution. A delegated token is acquired per request and
   * never persisted, so the registry asks a question rather than holding one.
   */
  readonly userEntitlement?: (providerId: GenerationProviderId, userId: string) => Promise<boolean>;
}

export interface ResolveProviderArgs {
  readonly providerId: GenerationProviderId;
  readonly executionMode: GenerationExecutionMode;
  /** The model from the generation profile. Never hardcoded (T-30). */
  readonly modelId: string;
  readonly requestingUserId: string;
}

export interface ProviderRegistry {
  /** Every provider the platform knows about, registered or not. */
  readonly declaredProviders: readonly GenerationProviderId[];
  /** Providers constructible in this environment with what is configured. */
  readonly registeredProviders: readonly GenerationProviderId[];
  capabilitiesOf: (providerId: GenerationProviderId) => ProviderCapabilities;
  resolve: (args: ResolveProviderArgs) => Promise<GenerationProvider>;
}

type Factory = (modelId: string) => GenerationProvider;

export const createProviderRegistry = (options: ProviderRegistryOptions): ProviderRegistry => {
  const credentialed = new Set(options.credentialedProviders ?? []);

  // Registration is explicit and closed. A provider absent from this map is
  // DECLARED (it has capabilities, so a refusal can explain itself) but not
  // constructible, which is a different and more useful state than unknown.
  const factories = new Map<GenerationProviderId, Factory>();

  // Always registered, in every environment, forever. It is the
  // zero-credential path environment-and-configuration.md requires, the
  // control in every generator comparison, and the reason the gate chain is
  // known to work. Multi-provider must not make it optional.
  factories.set('DETERMINISTIC_LOCAL', () => createDeterministicProvider());

  // ANTHROPIC, MICROSOFT_COPILOT, AZURE_OPENAI and GEMINI are deliberately
  // NOT registered. Each is blocked on something outside this codebase —
  // Anthropic on T-29, Copilot on whether it can be invoked retrieval-free
  // (blocker P-2), the others on demand and their own data-processing
  // assessments. Registering a stand-in that returned plausible questions
  // would make an unapproved provider look like a working one, which is the
  // mistake `NoAdapterRegisteredError` exists to prevent for knowledge
  // sources.

  const capabilitiesOf = (providerId: GenerationProviderId): ProviderCapabilities =>
    PROVIDER_CATALOGUE[providerId];

  const resolve = async (args: ResolveProviderArgs): Promise<GenerationProvider> => {
    const capabilities = capabilitiesOf(args.providerId);

    // Checked BEFORE registration, because "this provider cannot ground a
    // question" is a more useful answer than "this provider is not available",
    // and it stays true even once the provider is built.
    if (!isGroundingSafe(capabilities)) {
      throw new ProviderResolutionError(
        'PROVIDER_NOT_GROUNDING_SAFE',
        `${args.providerId} retrieves its own context, so a question it drafts cannot be ` +
          'grounded in the selected sections alone. Evidence verification would refuse the ' +
          'span, or worse would verify a span while the question tested content the author ' +
          'never selected.',
      );
    }

    if (!capabilities.supportedExecutionModes.includes(args.executionMode)) {
      throw new ProviderResolutionError(
        'PROVIDER_MODE_NOT_SUPPORTED',
        `${args.providerId} supports ${capabilities.supportedExecutionModes.join(', ')} only. ` +
          `${args.executionMode} was requested and no substitute is used.`,
      );
    }

    if (args.executionMode === 'USER_MANAGED') {
      const entitled =
        options.userEntitlement === undefined
          ? false
          : await options.userEntitlement(args.providerId, args.requestingUserId);
      if (!entitled) {
        throw new ProviderResolutionError(
          'USER_ENTITLEMENT_UNAVAILABLE',
          `User-managed generation needs your own ${args.providerId} entitlement, and none ` +
            'was found for your account. The platform does not substitute its own credential.',
        );
      }
    }

    const factory = factories.get(args.providerId);
    if (factory === undefined) {
      throw new ProviderResolutionError(
        'PROVIDER_NOT_REGISTERED',
        `${args.providerId} is declared but not registered in this environment. ` +
          'No substitute provider is used.',
      );
    }

    if (
      args.executionMode === 'PLATFORM_MANAGED' &&
      args.providerId !== 'DETERMINISTIC_LOCAL' &&
      !credentialed.has(args.providerId)
    ) {
      throw new ProviderResolutionError(
        'PROVIDER_CREDENTIAL_UNAVAILABLE',
        `No platform credential resolved for ${args.providerId}, so no generation was ` +
          'attempted and nothing was charged.',
      );
    }

    return factory(args.modelId);
  };

  return {
    declaredProviders: Object.keys(PROVIDER_CATALOGUE) as GenerationProviderId[],
    registeredProviders: [...factories.keys()],
    capabilitiesOf,
    resolve,
  };
};
