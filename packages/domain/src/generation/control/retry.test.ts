// The retry policy, asserted rather than sampled.
//
// Randomness is injected, so every delay below is an exact expectation. A
// jitter implementation nobody can test is how a retry storm ships.

import { describe, expect, it } from 'vitest';
import {
  backoffDelayMs,
  classifyError,
  decideRetry,
  isRetryable,
  outcomeForError,
} from './retry.js';
import type { RetryPolicy } from './retry.js';

const policy: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 30_000,
  jitterRatio: 1,
};

describe('classifyError', () => {
  it('reads a 429 and an explicit rate-limit code as RATE_LIMIT', () => {
    expect(classifyError({ status: 429 })).toBe('RATE_LIMIT');
    expect(classifyError({ code: 'RATE_LIMITED' })).toBe('RATE_LIMIT');
  });

  it('separates a server error from a client error', () => {
    expect(classifyError({ status: 503 })).toBe('SERVER_ERROR');
    expect(classifyError({ status: 400 })).toBe('CLIENT_ERROR');
  });

  it('recognises a timeout by code and by AbortError', () => {
    expect(classifyError({ code: 'ETIMEDOUT' })).toBe('TIMEOUT');
    expect(classifyError({ name: 'AbortError' })).toBe('TIMEOUT');
  });

  it('recognises a parse failure as MALFORMED_OUTPUT', () => {
    expect(classifyError({ name: 'ZodError' })).toBe('MALFORMED_OUTPUT');
  });

  it('classifies anything unrecognised as UNKNOWN, which is NOT retryable', () => {
    // The conservative direction on purpose: guessing that an unfamiliar error
    // is transient is how a permanent failure gets paid for three times.
    expect(classifyError(new Error('who knows'))).toBe('UNKNOWN');
    expect(classifyError('a string')).toBe('UNKNOWN');
    expect(classifyError(null)).toBe('UNKNOWN');
    expect(isRetryable('UNKNOWN')).toBe(false);
  });
});

describe('isRetryable', () => {
  it('retries only rate limits, server errors and timeouts', () => {
    expect(isRetryable('RATE_LIMIT')).toBe(true);
    expect(isRetryable('SERVER_ERROR')).toBe(true);
    expect(isRetryable('TIMEOUT')).toBe(true);
    expect(isRetryable('CLIENT_ERROR')).toBe(false);
  });

  it('REFUSES to retry a response that arrived and failed to parse', () => {
    // The tokens are already spent. This is the bounded single repair path, not
    // a retry, and retrying it could double-charge a partial success.
    expect(isRetryable('MALFORMED_OUTPUT')).toBe(false);
  });
});

describe('outcomeForError', () => {
  it('records a rate limit as its own outcome, not as a failure', () => {
    // Provider health counts failures; a 429 is the provider working and
    // telling us to slow down, which is a different signal.
    expect(outcomeForError('RATE_LIMIT')).toBe('RATE_LIMITED');
    expect(outcomeForError('SERVER_ERROR')).toBe('FAILED');
  });
});

describe('backoffDelayMs', () => {
  it('doubles per attempt', () => {
    const noJitter: RetryPolicy = { ...policy, jitterRatio: 0 };
    expect(backoffDelayMs(1, noJitter, () => 0)).toBe(500);
    expect(backoffDelayMs(2, noJitter, () => 0)).toBe(1000);
    expect(backoffDelayMs(3, noJitter, () => 0)).toBe(2000);
  });

  it('caps at maxDelayMs however many attempts have failed', () => {
    const noJitter: RetryPolicy = { ...policy, jitterRatio: 0, maxDelayMs: 1500 };
    expect(backoffDelayMs(10, noJitter, () => 0)).toBe(1500);
  });

  it('full jitter spreads the delay across the whole window', () => {
    // [0, backoff] — the point being that two jobs failing at the same instant
    // do not retry at the same instant.
    expect(backoffDelayMs(2, policy, () => 0)).toBe(0);
    expect(backoffDelayMs(2, policy, () => 0.5)).toBe(500);
    expect(backoffDelayMs(2, policy, () => 0.999)).toBe(999);
  });

  it('a jitter ratio between 0 and 1 keeps a fixed floor', () => {
    const half: RetryPolicy = { ...policy, jitterRatio: 0.5 };
    // 1000 backoff: 500 fixed + up to 500 random.
    expect(backoffDelayMs(2, half, () => 0)).toBe(500);
    expect(backoffDelayMs(2, half, () => 1)).toBe(1000);
  });
});

describe('decideRetry', () => {
  it('retries a rate limit while attempts remain, with a delay', () => {
    const decision = decideRetry({ status: 429 }, 1, policy, () => 0.5);
    expect(decision.retry).toBe(true);
    expect(decision.delayMs).toBe(250);
    expect(decision.errorClass).toBe('RATE_LIMIT');
  });

  it('stops at the attempt cap and says which attempt it was', () => {
    const decision = decideRetry({ status: 429 }, 3, policy, () => 0.5);
    expect(decision.retry).toBe(false);
    expect(decision.reason).toContain('3 of 3');
  });

  it('never retries a non-transient class, whatever the attempt', () => {
    const decision = decideRetry({ status: 400 }, 1, policy, () => 0.5);
    expect(decision.retry).toBe(false);
    expect(decision.reason).toContain('not transient');
  });

  it('explains the parse-failure refusal in terms of the spend', () => {
    const decision = decideRetry({ name: 'ZodError' }, 1, policy, () => 0.5);
    expect(decision.retry).toBe(false);
    expect(decision.reason).toContain('already spent');
  });

  it('honours maxAttempts of 1 as "never retry"', () => {
    const once: RetryPolicy = { ...policy, maxAttempts: 1 };
    expect(decideRetry({ status: 503 }, 1, once, () => 0.5).retry).toBe(false);
  });
});
