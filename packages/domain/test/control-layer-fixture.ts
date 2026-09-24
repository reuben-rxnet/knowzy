// The AI Generation Control Layer, for tests that are not testing it.
//
// `runGenerationJob` requires a control layer, deliberately: an optional one is
// one a caller forgets, and the caller most likely to forget it is a future
// milestone wiring a provider that costs money. So every test that generates
// has to supply one, and this is the ceiling-free version they use.
//
// The numbers here are LARGE ON PURPOSE rather than infinite, and they are
// stated rather than defaulted: a test that generates four questions must not
// also be a test of the daily budget, and a shared "no limits" object that
// silently applied to the budget suites would make their assertions vacuous.
// The budget, concurrency and retry suites build their own settings instead.

import { createGeneratorRegistry } from '@knowzy/claude-services';
import type { ControlSettings } from '@knowzy/domain';

export const testControlSettings = (overrides: Partial<ControlSettings> = {}): ControlSettings => ({
  perJobTokenBudget: 10_000_000,
  dailyTokenBudget: 100_000_000,
  weeklyTokenBudget: 500_000_000,
  monthlyTokenBudget: 1_000_000_000,
  warningRatio: 0.8,
  concurrency: 16,
  providerLimits: {},
  prices: {},
  retry: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 },
  ...overrides,
});

/** A registry with the deterministic provider available and nothing else. */
export const testRegistry = () =>
  createGeneratorRegistry({
    activeProvider: 'DETERMINISTIC_LOCAL',
    approvedProviders: ['DETERMINISTIC_LOCAL'],
  });

/** Drop-in for `runGenerationJob`'s `control` argument. */
export const testControl = (overrides: Partial<ControlSettings> = {}) => ({
  registry: testRegistry(),
  settings: testControlSettings(overrides),
  // No real waiting in a test, and a fixed "random" so any backoff a test does
  // exercise is asserted rather than sampled.
  random: () => 0.5,
  sleep: async (): Promise<void> => undefined,
});
