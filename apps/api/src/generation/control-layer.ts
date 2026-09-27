// Assembling the AI Generation Control Layer for one request.
//
// The API is where configuration and the database meet, so this is where the
// declared `llm.*` keys are resolved into the settings `@knowzy/domain`
// enforces. The domain deliberately takes them as an argument: it declares no
// dependency on `@knowzy/configuration`, and a domain that read its own
// ceilings would be a domain nobody could test against a different one.
//
// Resolved PER REQUEST rather than cached at startup. An administrator lowering
// a provider's token limit from Governance → AI Usage & Budgets expects the
// next job to obey it, not the next deployment.

import { resolveControlSettings, CONTROL_CONFIG_KEYS } from '@knowzy/configuration';
import {
  createGeneratorRegistry,
  createOpenAIGenerationProvider,
  type GeneratorRegistry,
} from '@knowzy/claude-services';
import type { PrismaClient } from '@knowzy/database';
import type {
  GenerationProviderId,
  ProviderLimits,
  ProviderSettings,
  TokenPrice,
} from '@knowzy/shared-types';

export interface ControlLayer {
  readonly registry: GeneratorRegistry;
  /** Exactly the shape `runGenerationJob`'s `control.settings` requires. */
  readonly settings: {
    readonly perJobTokenBudget: number;
    readonly dailyTokenBudget: number;
    readonly weeklyTokenBudget: number;
    readonly monthlyTokenBudget: number;
    readonly warningRatio: number;
    readonly concurrency: number;
    readonly providerLimits: Readonly<Partial<Record<GenerationProviderId, ProviderLimits>>>;
    readonly prices: Readonly<Record<string, TokenPrice>>;
    readonly retry: {
      readonly maxAttempts: number;
      readonly baseDelayMs: number;
      readonly maxDelayMs: number;
      readonly jitterRatio: number;
    };
    readonly health: { readonly failureThreshold: number; readonly windowMinutes: number };
    readonly maxAttempts: number;
  };
  /**
   * What an administrator configured per provider, and when the value was last
   * written.
   *
   * Carried on the control layer because both the administration screen and
   * the registry need it: the registry needs `enabled`, and the screen needs
   * everything except the credential reference, which never leaves the domain.
   */
  readonly providerSettings: Readonly<Partial<Record<GenerationProviderId, ProviderSettings>>>;
  readonly providerSettingsUpdatedAt: string | null;
  readonly activeProvider: GenerationProviderId;
  readonly approvedProviders: readonly GenerationProviderId[];
}

export const loadControlLayer = async (prisma: PrismaClient): Promise<ControlLayer> => {
  const rows = await prisma.applicationConfiguration.findMany({
    where: { key: { in: [...CONTROL_CONFIG_KEYS] } },
    select: { key: true, scope: true, scopeId: true, value: true, updatedAt: true },
  });

  const resolved = resolveControlSettings(rows);
  const providerSettings = resolved.providerSettings as Readonly<
    Partial<Record<GenerationProviderId, ProviderSettings>>
  >;
  // The row's own timestamp, so the screen can say when any provider's
  // configuration last changed. Whole-key granularity, which is what the
  // storage actually knows -- see `settingsUpdatedAt` in shared-types.
  const settingsRow = rows.find((row) => row.key === 'llm.providerSettings');

  // ONE factory besides the deterministic provider's: OpenAI (OPENAI-CODEX-01).
  // This registry DECIDES -- approval, enablement, credential -- and the
  // instance it builds is never the one that calls OpenAI: the route passes
  // the API registry's instance, whose key is resolved per call through the
  // audited Secret Resolution Layer, as `providerOverride`. So this one's
  // `configure` refuses, and a path that reached it would fail loudly rather
  // than call a provider with no key. Every other provider stays unregistered.
  const registry = createGeneratorRegistry({
    factories: {
      OPENAI: (modelId) =>
        createOpenAIGenerationProvider({
          modelId,
          configure: async () => {
            throw new Error(
              'The control-layer OpenAI instance decides state only; calls go through the API provider registry.',
            );
          },
        }),
    },
    activeProvider: resolved.activeProvider as GenerationProviderId,
    approvedProviders: resolved.approvedProviders as readonly GenerationProviderId[],
    // The administrator's on/off decision, which the registry treats as part
    // of the configuration step. Absent means "not decided", and for an
    // external provider that is treated as off -- a provider nobody enabled
    // must not start billing because a credential appeared in the environment.
    enabled: Object.fromEntries(
      Object.entries(providerSettings).map(([providerId, settings]) => [
        providerId,
        settings?.enabled === true,
      ]),
    ) as Readonly<Partial<Record<GenerationProviderId, boolean>>>,
    // Whether a credential REFERENCE is recorded. A boolean, never the
    // reference: the registry may not hold one, and one that could read a
    // secret would be worth attacking.
    credentialPresent: Object.fromEntries(
      Object.entries(providerSettings).map(([providerId, settings]) => [
        providerId,
        settings?.apiKeyRef !== undefined,
      ]),
    ) as Readonly<Partial<Record<GenerationProviderId, boolean>>>,
  });

  return {
    registry,
    settings: {
      perJobTokenBudget: resolved.perJobTokenBudget,
      dailyTokenBudget: resolved.dailyTokenBudget,
      weeklyTokenBudget: resolved.weeklyTokenBudget,
      monthlyTokenBudget: resolved.monthlyTokenBudget,
      warningRatio: resolved.warningRatio,
      concurrency: resolved.concurrency,
      providerLimits: resolved.providerLimits as Readonly<
        Partial<Record<GenerationProviderId, ProviderLimits>>
      >,
      prices: resolved.prices as Readonly<Record<string, TokenPrice>>,
      retry: resolved.retry,
      health: resolved.health,
      maxAttempts: resolved.retry.maxAttempts,
    },
    providerSettings,
    providerSettingsUpdatedAt: settingsRow?.updatedAt?.toISOString() ?? null,
    activeProvider: resolved.activeProvider as GenerationProviderId,
    approvedProviders: resolved.approvedProviders as readonly GenerationProviderId[],
  };
};
