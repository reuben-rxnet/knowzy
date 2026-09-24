// Budget arithmetic — the half that needs no database.
//
// The window and state functions are where a budget is silently wrong, so each
// case below is a way a ceiling could fail open.

import { describe, expect, it } from 'vitest';
import {
  budgetState,
  checkPerJobBudget,
  limitFor,
  perJobLimitFor,
  utilizationPercent,
  windowReset,
  windowStart,
} from './budget.js';
import type { BudgetSettings } from './budget.js';

const settings: BudgetSettings = {
  perJobTokenBudget: 250_000,
  dailyTokenBudget: 2_000_000,
  weeklyTokenBudget: 10_000_000,
  monthlyTokenBudget: 40_000_000,
  warningRatio: 0.8,
  providerLimits: {
    OPENAI: { perJobTokenBudget: 60_000, dailyTokenBudget: 500_000, concurrency: 1 },
  },
};

const now = new Date('2026-09-24T13:45:00.000Z');

describe('windowStart', () => {
  it('anchors the day to midnight UTC, so two people see the same "today"', () => {
    expect(windowStart('DAILY', now).toISOString()).toBe('2026-09-24T00:00:00.000Z');
  });

  it('rolls the week and the month back from now, and says so by being exact', () => {
    // Rolling spans, not calendar periods: a calendar month needs a
    // timezone-aware anchor and an answer for February, and an honest rolling
    // window beats a wrong calendar one.
    expect(windowStart('WEEKLY', now).toISOString()).toBe('2026-09-17T13:45:00.000Z');
    expect(windowStart('MONTHLY', now).toISOString()).toBe('2026-08-25T13:45:00.000Z');
  });
});

describe('windowReset', () => {
  it('resets the day at the next midnight', () => {
    expect(windowReset('DAILY', now).toISOString()).toBe('2026-09-25T00:00:00.000Z');
  });
});

describe('limitFor', () => {
  it('uses the platform ceiling when a provider has no override', () => {
    expect(limitFor('DAILY', settings, 'DETERMINISTIC_LOCAL')).toBe(2_000_000);
    expect(limitFor('WEEKLY', settings, 'DETERMINISTIC_LOCAL')).toBe(10_000_000);
  });

  it("uses a provider's own override where one is set", () => {
    expect(limitFor('DAILY', settings, 'OPENAI')).toBe(500_000);
  });

  it('falls back to the platform ceiling for a window the override omits', () => {
    // An override of the daily ceiling is not a statement about the weekly one.
    // Treating a partial override as "unlimited elsewhere" is how a provider
    // ends up with no weekly cap at all.
    expect(limitFor('WEEKLY', settings, 'OPENAI')).toBe(10_000_000);
  });

  it('applies the platform ceiling when no provider is named', () => {
    expect(limitFor('DAILY', settings, null)).toBe(2_000_000);
  });
});

describe('perJobLimitFor', () => {
  it('prefers the override and falls back to the platform value', () => {
    expect(perJobLimitFor(settings, 'OPENAI')).toBe(60_000);
    expect(perJobLimitFor(settings, 'ANTHROPIC')).toBe(250_000);
  });
});

describe('budgetState', () => {
  it('is HEALTHY below the warning ratio', () => {
    expect(budgetState(100, 1000, 0.8)).toBe('HEALTHY');
  });

  it('is WARNING at the ratio, not just past it', () => {
    expect(budgetState(800, 1000, 0.8)).toBe('WARNING');
  });

  it('is EXHAUSTED at the limit, not only above it', () => {
    expect(budgetState(1000, 1000, 0.8)).toBe('EXHAUSTED');
    expect(budgetState(1001, 1000, 0.8)).toBe('EXHAUSTED');
  });

  it('treats a ceiling of zero as EXHAUSTED rather than dividing by zero', () => {
    // A zero ceiling is a legitimate way to switch generation off, and it must
    // read as "no budget", never as 0% used and healthy.
    expect(budgetState(0, 0, 0.8)).toBe('EXHAUSTED');
    expect(utilizationPercent(0, 0)).toBe(100);
  });
});

describe('utilizationPercent', () => {
  it('reports one decimal place and never exceeds 100', () => {
    expect(utilizationPercent(333, 1000)).toBe(33.3);
    expect(utilizationPercent(5000, 1000)).toBe(100);
  });
});

describe('checkPerJobBudget', () => {
  it('permits a job inside the ceiling', () => {
    expect(checkPerJobBudget(10_000, settings, 'DETERMINISTIC_LOCAL')).toBeNull();
  });

  it('refuses a job over the ceiling, naming the key, the limit and the estimate', () => {
    const refusal = checkPerJobBudget(75_000, settings, 'OPENAI');
    expect(refusal?.refusalReason).toBe('PER_JOB_TOKEN_BUDGET_EXCEEDED');
    expect(refusal?.limitName).toBe('llm.perJobTokenBudget');
    expect(refusal?.limitValue).toBe(60_000);
    expect(refusal?.observedValue).toBe(75_000);
    // The numbers have to reach the author: "budget exceeded" with no figures
    // is not something anyone can act on.
    expect(refusal?.detail).toContain('60,000');
    expect(refusal?.detail).toContain('75,000');
  });

  it('permits a job exactly at the ceiling', () => {
    expect(checkPerJobBudget(60_000, settings, 'OPENAI')).toBeNull();
  });
});
