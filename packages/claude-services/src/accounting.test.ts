// Token and cost accounting.
//
// Every case here is a way a dashboard could show a confident number that
// nothing measured. The rule under test throughout: an unobservable quantity is
// null, never zero.

import { describe, expect, it } from 'vitest';
import {
  addTokens,
  aggregateCost,
  computeCost,
  estimateInputTokens,
  observableCost,
  resolvePrice,
  tokenAccount,
  unobservableCost,
  PROMPT_OVERHEAD_TOKENS,
} from './accounting.js';
import { frameGenerationPrompt } from './framing.js';

const prices = {
  ANTHROPIC: { inputPerMillion: 3, outputPerMillion: 15 },
  'OPENAI:gpt-5-codex': { inputPerMillion: 1.25, outputPerMillion: 10 },
  OPENAI: { inputPerMillion: 2, outputPerMillion: 8 },
};

describe('resolvePrice', () => {
  it('prefers a model-specific price over the provider default', () => {
    expect(resolvePrice(prices, 'OPENAI', 'gpt-5-codex')?.inputPerMillion).toBe(1.25);
    expect(resolvePrice(prices, 'OPENAI', 'something-else')?.inputPerMillion).toBe(2);
  });

  it('returns null rather than a zero price when nothing is configured', () => {
    // A zero price computes a zero cost, which is a fabricated measurement.
    expect(resolvePrice(prices, 'GEMINI', 'any')).toBeNull();
  });
});

describe('addTokens', () => {
  it('sums the counts', () => {
    const total = addTokens(tokenAccount(10, 5, true), tokenAccount(1, 2, true));
    expect(total.inputTokens).toBe(11);
    expect(total.totalTokens).toBe(18);
  });

  it('degrades "reported" when an estimate is mixed in', () => {
    // One measured call must not launder a batch of estimated ones: a
    // tokens-per-question comparison across the two is meaningless unless the
    // difference stays visible.
    expect(addTokens(tokenAccount(10, 5, true), tokenAccount(1, 2, false)).reported).toBe(false);
  });
});

describe('computeCost', () => {
  it('records exactly zero for the deterministic provider, as a FACT', () => {
    const cost = computeCost({
      providerId: 'DETERMINISTIC_LOCAL',
      modelId: 'knowzy-deterministic-local-1',
      executionMode: 'PLATFORM_MANAGED',
      reportsCost: true,
      tokens: tokenAccount(5000, 900, false),
      prices,
    });
    // It runs in process. There is no marginal cost to estimate, so 0 is a
    // measurement rather than a missing one.
    expect(cost.observable).toBe(true);
    expect(cost.amount).toBe('0.000000');
  });

  it('computes from reported tokens and the configured price', () => {
    const cost = computeCost({
      providerId: 'ANTHROPIC',
      modelId: 'claude-sonnet-5',
      executionMode: 'PLATFORM_MANAGED',
      reportsCost: true,
      tokens: tokenAccount(1_000_000, 100_000, true),
      prices,
    });
    // 1M input at 3 + 0.1M output at 15 = 3 + 1.5
    expect(cost.amount).toBe('4.500000');
  });

  it('refuses to cost a licence-based provider at any granularity', () => {
    const cost = computeCost({
      providerId: 'MICROSOFT_COPILOT',
      modelId: 'copilot',
      executionMode: 'USER_MANAGED',
      reportsCost: false,
      tokens: tokenAccount(1000, 100, false),
      prices,
    });
    expect(cost.observable).toBe(false);
    expect(cost.amount).toBeNull();
    expect(cost.unobservableReason).toContain('licence-based');
  });

  it('refuses to cost a user-managed run, whose spend the platform cannot read', () => {
    const cost = computeCost({
      providerId: 'AZURE_OPENAI',
      modelId: 'gpt-4o',
      executionMode: 'USER_MANAGED',
      reportsCost: true,
      tokens: tokenAccount(1000, 100, true),
      prices,
    });
    expect(cost.observable).toBe(false);
    expect(cost.unobservableReason).toContain("author's own account");
  });

  it('treats a MISSING price as unobservable, not as free', () => {
    const cost = computeCost({
      providerId: 'GEMINI',
      modelId: 'gemini-2',
      executionMode: 'PLATFORM_MANAGED',
      reportsCost: true,
      tokens: tokenAccount(1_000_000, 0, true),
      prices,
    });
    expect(cost.observable).toBe(false);
    expect(cost.amount).toBeNull();
  });
});

describe('aggregateCost', () => {
  it('sums when every contributing run is observable', () => {
    const total = aggregateCost([observableCost('1.500000'), observableCost('2.250000')]);
    expect(total.amount).toBe('3.750000');
  });

  it('refuses a total when ANY run is unobservable, and says how many', () => {
    // Summing only the observable part presents an undercount as a total: every
    // number in it is real and the answer is wrong.
    const total = aggregateCost([observableCost('1.000000'), unobservableCost('no price')]);
    expect(total.observable).toBe(false);
    expect(total.unobservableReason).toContain('1 of 2');
  });

  it('reports an empty set as "nothing recorded yet" rather than 0', () => {
    expect(aggregateCost([]).observable).toBe(false);
  });
});

describe('estimateInputTokens', () => {
  it('rounds up and adds the framing overhead', () => {
    expect(estimateInputTokens(0)).toBe(PROMPT_OVERHEAD_TOKENS);
    expect(estimateInputTokens(401)).toBe(101 + PROMPT_OVERHEAD_TOKENS);
  });

  it('KEEPS THE OVERHEAD CONSTANT HONEST against the real framing', () => {
    // A constant nothing checks is a constant that silently becomes wrong. If
    // the prompt grows, this fails and the number gets updated deliberately
    // rather than the estimate quietly running low — and an estimate that runs
    // low admits jobs the budget should have refused.
    const framed = frameGenerationPrompt({
      sections: [{ sectionKey: 'a'.repeat(64), label: 'S', text: '' }],
      doNotDuplicate: [],
      requestedQuestionCount: 1,
      domainName: 'D',
      topicName: 'T',
    });
    const actualOverhead = Math.ceil((framed.system.length + framed.user.length) / 4);
    expect(actualOverhead).toBeLessThanOrEqual(PROMPT_OVERHEAD_TOKENS);
    expect(actualOverhead).toBeGreaterThan(PROMPT_OVERHEAD_TOKENS * 0.5);
  });
});
