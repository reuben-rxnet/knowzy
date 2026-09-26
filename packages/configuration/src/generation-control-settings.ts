// Resolving the AI Generation Control Layer's settings from configuration.
//
// This function exists so the control layer has exactly ONE source for its
// ceilings: the declared `llm.*` keys, resolved through the normal layered
// resolver. `@knowzy/domain` cannot import this package (it declares no
// dependency on it, and should not — the domain takes its settings as an
// argument), so the caller resolves and passes them in, and a test asserting
// these values against the catalogue is unnecessary: they ARE the catalogue.
//
// The alternative — a second table of defaults inside the domain — is how two
// budgets end up half-enforced, with the one nobody is looking at being the one
// in force.

import { ConfigurationResolver, type ResolutionContext, type StoredConfigRow } from './resolver.js';

/**
 * The resolved control settings, shaped exactly as `@knowzy/domain`'s
 * `ControlSettings` requires.
 *
 * Structurally typed rather than imported: this package sits below the domain
 * in the dependency graph (B-rules), so it describes the shape instead of
 * depending on the consumer that needs it.
 */
export interface ResolvedControlSettings {
  readonly perJobTokenBudget: number;
  readonly dailyTokenBudget: number;
  readonly weeklyTokenBudget: number;
  readonly monthlyTokenBudget: number;
  readonly warningRatio: number;
  readonly concurrency: number;
  readonly providerLimits: Record<string, unknown>;
  /**
   * Per-provider settings, including which credential REFERENCE each one uses.
   *
   * `Record<string, unknown>` for the same reason `providerLimits` is: this
   * package sits below the domain, so it describes the shape rather than
   * importing the consumer's type.
   */
  readonly providerSettings: Record<string, unknown>;
  readonly prices: Record<string, unknown>;
  readonly retry: {
    readonly maxAttempts: number;
    readonly baseDelayMs: number;
    readonly maxDelayMs: number;
    readonly jitterRatio: number;
  };
  readonly activeProvider: string;
  readonly approvedProviders: readonly string[];
  readonly health: {
    readonly failureThreshold: number;
    readonly windowMinutes: number;
  };
}

export const resolveControlSettings = (
  rows: readonly StoredConfigRow[],
  ctx: ResolutionContext = {},
): ResolvedControlSettings => {
  const resolver = new ConfigurationResolver(rows);
  const value = <T>(key: Parameters<typeof resolver.resolve>[0]): T =>
    resolver.resolve(key, ctx).value as T;

  return {
    perJobTokenBudget: value<number>('llm.perJobTokenBudget'),
    dailyTokenBudget: value<number>('llm.dailyTokenBudget'),
    weeklyTokenBudget: value<number>('llm.weeklyTokenBudget'),
    monthlyTokenBudget: value<number>('llm.monthlyTokenBudget'),
    warningRatio: value<number>('llm.budgetWarningRatio'),
    concurrency: value<number>('llm.concurrency'),
    providerLimits: value<Record<string, unknown>>('llm.providerLimits'),
    providerSettings: value<Record<string, unknown>>('llm.providerSettings'),
    prices: value<Record<string, unknown>>('llm.tokenPrices'),
    retry: {
      maxAttempts: value<number>('llm.maxAttempts'),
      baseDelayMs: value<number>('llm.retryBaseDelayMs'),
      maxDelayMs: value<number>('llm.retryMaxDelayMs'),
      jitterRatio: value<number>('llm.retryJitterRatio'),
    },
    activeProvider: value<string>('llm.activeProvider'),
    approvedProviders: value<readonly string[]>('llm.approvedProviders'),
    health: {
      failureThreshold: value<number>('llm.healthFailureThreshold'),
      windowMinutes: value<number>('llm.healthWindowMinutes'),
    },
  };
};

/** The `llm.*` keys this resolver reads, for a caller loading rows. */
export const CONTROL_CONFIG_KEYS = [
  'llm.perJobTokenBudget',
  'llm.dailyTokenBudget',
  'llm.weeklyTokenBudget',
  'llm.monthlyTokenBudget',
  'llm.budgetWarningRatio',
  'llm.concurrency',
  'llm.providerLimits',
  'llm.providerSettings',
  'llm.tokenPrices',
  'llm.maxAttempts',
  'llm.retryBaseDelayMs',
  'llm.retryMaxDelayMs',
  'llm.retryJitterRatio',
  'llm.activeProvider',
  'llm.approvedProviders',
  'llm.healthFailureThreshold',
  'llm.healthWindowMinutes',
] as const;
