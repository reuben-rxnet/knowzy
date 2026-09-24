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
import { createGeneratorRegistry, type GeneratorRegistry } from '@knowzy/claude-services';
import type { PrismaClient } from '@knowzy/database';
import type { GenerationProviderId, ProviderLimits, TokenPrice } from '@knowzy/shared-types';

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
}

export const loadControlLayer = async (prisma: PrismaClient): Promise<ControlLayer> => {
  const rows = await prisma.applicationConfiguration.findMany({
    where: { key: { in: [...CONTROL_CONFIG_KEYS] } },
    select: { key: true, scope: true, scopeId: true, value: true },
  });

  const resolved = resolveControlSettings(rows);

  // Factories are NOT passed: no external provider client exists in this
  // build, so every provider except the deterministic one resolves to
  // UNAVAILABLE with that stated as the reason. Registering a stand-in here is
  // the one thing the registry exists to prevent.
  const registry = createGeneratorRegistry({
    activeProvider: resolved.activeProvider as GenerationProviderId,
    approvedProviders: resolved.approvedProviders as readonly GenerationProviderId[],
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
  };
};
