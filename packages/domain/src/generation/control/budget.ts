// Token budgets — architecture.md §9.0, provider-independent.
//
// Three windows (day, week, month) and a per-job ceiling, all in tokens rather
// than money, because tokens are the one quantity every provider reports and
// cost is frequently not observable at all. A budget denominated in something
// half the providers cannot report is not a control.
//
// The window arithmetic is pure and separately tested. The usage sums read
// `generation_provider_call` rows, which is the reason retries are counted: a
// budget that only saw successful jobs would be trivially bypassed by a
// partially-failing batch.

import type { DbClient } from '@knowzy/database';
import {
  BUDGET_WINDOW_REFUSALS,
  type BudgetState,
  type BudgetWindow,
  type BudgetWindowStatus,
  type GenerationProviderId,
  type GenerationRefusalReason,
  type ProviderLimits,
} from '@knowzy/shared-types';

export interface BudgetSettings {
  readonly perJobTokenBudget: number;
  readonly dailyTokenBudget: number;
  readonly weeklyTokenBudget: number;
  readonly monthlyTokenBudget: number;
  readonly warningRatio: number;
  /** Per-provider overrides. An absent entry means the platform ceiling. */
  readonly providerLimits: Readonly<Partial<Record<GenerationProviderId, ProviderLimits>>>;
}

/** Days in each window. Fixed spans, not calendar months. */
const WINDOW_DAYS: Readonly<Record<BudgetWindow, number>> = Object.freeze({
  DAILY: 1,
  WEEKLY: 7,
  MONTHLY: 30,
});

/**
 * The start of a window.
 *
 * DAILY anchors to midnight UTC, because "today's budget" has to mean the same
 * thing to two people looking at the same dashboard. WEEKLY and MONTHLY are
 * ROLLING spans of 7 and 30 days ending now, and the UI says so: a calendar
 * month would need a timezone-aware anchor and an answer for a 28-day February,
 * and an honest rolling window beats a wrong calendar one.
 */
export const windowStart = (window: BudgetWindow, now: Date): Date => {
  if (window === 'DAILY') {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }
  return new Date(now.getTime() - WINDOW_DAYS[window] * 24 * 60 * 60_000);
};

export const windowReset = (window: BudgetWindow, now: Date): Date =>
  window === 'DAILY'
    ? new Date(windowStart('DAILY', now).getTime() + 24 * 60 * 60_000)
    : new Date(now.getTime() + WINDOW_DAYS[window] * 24 * 60 * 60_000);

/** The ceiling for a provider in a window: its override, else the platform's. */
export const limitFor = (
  window: BudgetWindow,
  settings: BudgetSettings,
  providerId: GenerationProviderId | null,
): number => {
  const override = providerId === null ? undefined : settings.providerLimits[providerId];
  const platform =
    window === 'DAILY'
      ? settings.dailyTokenBudget
      : window === 'WEEKLY'
        ? settings.weeklyTokenBudget
        : settings.monthlyTokenBudget;
  const specific =
    window === 'DAILY'
      ? override?.dailyTokenBudget
      : window === 'WEEKLY'
        ? override?.weeklyTokenBudget
        : override?.monthlyTokenBudget;
  return specific ?? platform;
};

export const perJobLimitFor = (
  settings: BudgetSettings,
  providerId: GenerationProviderId | null,
): number => {
  const override = providerId === null ? undefined : settings.providerLimits[providerId];
  return override?.perJobTokenBudget ?? settings.perJobTokenBudget;
};

/**
 * HEALTHY / WARNING / EXHAUSTED.
 *
 * A budget of 0 is EXHAUSTED rather than a division by zero, and that is the
 * right reading: a zero ceiling means "no generation permitted", which is a
 * legitimate way to switch the feature off.
 */
export const budgetState = (used: number, limit: number, warningRatio: number): BudgetState => {
  if (limit <= 0) return 'EXHAUSTED';
  if (used >= limit) return 'EXHAUSTED';
  return used / limit >= warningRatio ? 'WARNING' : 'HEALTHY';
};

export const utilizationPercent = (used: number, limit: number): number =>
  limit <= 0 ? 100 : Math.min(100, Math.round((used / limit) * 1000) / 10);

/**
 * Tokens spent in a window, summed over ATTEMPTS.
 *
 * `providerId` null sums every provider, which is what a tenant-wide budget
 * means; a provider id sums that provider only, for its override.
 */
export const usedTokensIn = async (
  db: DbClient,
  window: BudgetWindow,
  now: Date,
  providerId: GenerationProviderId | null = null,
): Promise<number> => {
  const aggregate = await db.generationProviderCall.aggregate({
    where: {
      startedAt: { gte: windowStart(window, now) },
      ...(providerId === null ? {} : { providerId }),
    },
    _sum: { inputTokens: true, outputTokens: true },
  });
  return (aggregate._sum.inputTokens ?? 0) + (aggregate._sum.outputTokens ?? 0);
};

export const budgetStatus = async (
  db: DbClient,
  window: BudgetWindow,
  settings: BudgetSettings,
  now: Date,
  providerId: GenerationProviderId | null = null,
): Promise<BudgetWindowStatus> => {
  const limit = limitFor(window, settings, providerId);
  const used = await usedTokensIn(db, window, now, providerId);
  return {
    window,
    budgetTokens: limit,
    usedTokens: used,
    remainingTokens: Math.max(0, limit - used),
    utilizationPercent: utilizationPercent(used, limit),
    state: budgetState(used, limit, settings.warningRatio),
    windowStartedAt: windowStart(window, now).toISOString(),
    resetsAt: windowReset(window, now).toISOString(),
  };
};

export interface BudgetRefusal {
  readonly refusalReason: GenerationRefusalReason;
  readonly limitName: string;
  readonly limitValue: number;
  readonly observedValue: number;
  readonly budgetWindow: BudgetWindow | null;
  readonly detail: string;
}

/**
 * The per-job check, run BEFORE any call, against the estimate the framing
 * arithmetic already produces.
 *
 * Checked first because it is the only budget that can be evaluated without a
 * database read, and because refusing a job that could never fit is cheaper
 * than discovering it after spending a window's worth of tokens on it.
 */
export const checkPerJobBudget = (
  estimatedTokens: number,
  settings: BudgetSettings,
  providerId: GenerationProviderId,
): BudgetRefusal | null => {
  const limit = perJobLimitFor(settings, providerId);
  if (estimatedTokens <= limit) return null;
  return {
    refusalReason: 'PER_JOB_TOKEN_BUDGET_EXCEEDED',
    limitName: 'llm.perJobTokenBudget',
    limitValue: limit,
    observedValue: estimatedTokens,
    budgetWindow: null,
    detail: `This job needs about ${estimatedTokens.toLocaleString('en-GB')} tokens and the per-job ceiling is ${limit.toLocaleString('en-GB')}. Select fewer documents or lower the question count.`,
  };
};

/**
 * The window checks, most immediate first.
 *
 * Daily before weekly before monthly, so the refusal an author reads is the one
 * that will clear soonest.
 */
export const checkWindowBudgets = async (
  db: DbClient,
  estimatedTokens: number,
  settings: BudgetSettings,
  providerId: GenerationProviderId,
  now: Date,
): Promise<BudgetRefusal | null> => {
  const windows: readonly BudgetWindow[] = ['DAILY', 'WEEKLY', 'MONTHLY'];
  for (const window of windows) {
    const limit = limitFor(window, settings, providerId);
    const used = await usedTokensIn(db, window, now, null);
    // The projected total, not just what is already spent: admitting a job that
    // would certainly breach the ceiling mid-run and stopping it half way is
    // worse than refusing it, because the tokens are gone either way.
    if (used + estimatedTokens > limit) {
      const reset = windowReset(window, now);
      return {
        refusalReason: BUDGET_WINDOW_REFUSALS[window],
        limitName:
          window === 'DAILY'
            ? 'llm.dailyTokenBudget'
            : window === 'WEEKLY'
              ? 'llm.weeklyTokenBudget'
              : 'llm.monthlyTokenBudget',
        limitValue: limit,
        observedValue: used + estimatedTokens,
        budgetWindow: window,
        detail: `The ${window.toLowerCase()} budget is ${limit.toLocaleString('en-GB')} tokens, ${used.toLocaleString('en-GB')} are spent, and this job needs about ${estimatedTokens.toLocaleString('en-GB')} more. It resets at ${reset.toISOString()}.`,
      };
    }
  }
  return null;
};
