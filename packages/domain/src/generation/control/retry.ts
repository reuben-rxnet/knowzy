// The retry policy — architecture.md §9.0 rule 4, provider-independent.
//
// Pure, and randomness is INJECTED rather than read from Math.random, so the
// backoff can be asserted exactly. A jitter implementation nobody can test is
// how a retry storm ships.
//
// Two hazards this file exists to avoid, both from the implementation plan §6.4:
//
//   * A retry must not double-charge a partial success. A response that arrived
//     and failed to parse is the bounded single repair path, not a retry, so
//     MALFORMED_OUTPUT is deliberately not retryable.
//   * Retries count against the budget. That is enforced by recording a
//     `generation_provider_call` row per ATTEMPT, which the budget sums.

import {
  RETRYABLE_ERROR_CLASSES,
  type CallErrorClass,
  type GenerationCallOutcome,
} from '@knowzy/shared-types';

export interface RetryPolicy {
  /** Total attempts including the first. 1 means "never retry". */
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  /** 1 is full jitter: the delay is uniform in [0, backoff]. */
  readonly jitterRatio: number;
}

/**
 * Classify a thrown value into one of the declared classes.
 *
 * Deliberately conservative: anything unrecognised is UNKNOWN, which is NOT
 * retryable. Guessing that an unfamiliar error is transient is how a permanent
 * failure gets paid for three times.
 */
export const classifyError = (error: unknown): CallErrorClass => {
  if (error === null || typeof error !== 'object') return 'UNKNOWN';

  const candidate = error as { status?: unknown; code?: unknown; name?: unknown };
  const status = typeof candidate.status === 'number' ? candidate.status : null;
  const code = typeof candidate.code === 'string' ? candidate.code : '';
  const name = typeof candidate.name === 'string' ? candidate.name : '';

  if (status === 429 || code === 'RATE_LIMITED') return 'RATE_LIMIT';
  if (status !== null && status >= 500) return 'SERVER_ERROR';
  // `TimeoutError` is what `AbortSignal.timeout` throws, and it is what a
  // provider client's request timeout looks like. Until OPENAI-CODEX-01 it fell
  // through to UNKNOWN and was never retried.
  if (
    code === 'ETIMEDOUT' ||
    code === 'ECONNRESET' ||
    name === 'AbortError' ||
    name === 'TimeoutError'
  ) {
    return 'TIMEOUT';
  }
  if (code === 'MALFORMED_OUTPUT' || name === 'ZodError') return 'MALFORMED_OUTPUT';
  if (status !== null && status >= 400) return 'CLIENT_ERROR';
  return 'UNKNOWN';
};

export const isRetryable = (errorClass: CallErrorClass): boolean =>
  RETRYABLE_ERROR_CLASSES.includes(errorClass);

/** A rate-limited attempt is recorded as its own outcome, not as a failure. */
export const outcomeForError = (errorClass: CallErrorClass): GenerationCallOutcome =>
  errorClass === 'RATE_LIMIT' ? 'RATE_LIMITED' : 'FAILED';

/**
 * Exponential backoff with jitter, capped.
 *
 * `attempt` is the attempt that just failed, 1-based: the delay before attempt
 * 2 is computed from attempt 1. `random` returns [0, 1).
 *
 * Full jitter (ratio 1) spreads retries uniformly across the whole window,
 * which is the point: synchronized retries across a batch are how one 429
 * becomes a thundering herd. A ratio of 0 is pure exponential backoff, which is
 * available and not the default.
 */
export const backoffDelayMs = (
  attempt: number,
  policy: RetryPolicy,
  random: () => number,
): number => {
  const exponential = policy.baseDelayMs * 2 ** Math.max(0, attempt - 1);
  const capped = Math.min(exponential, policy.maxDelayMs);
  const fixed = capped * (1 - policy.jitterRatio);
  const jittered = capped * policy.jitterRatio * random();
  return Math.round(fixed + jittered);
};

/**
 * The policy in force for ONE provider.
 *
 * Retry economics are not uniform: a provider that bills per attempt and
 * rate-limits hard wants fewer attempts than one that does neither, and a
 * single platform-wide `llm.maxAttempts` forces one answer on all of them. An
 * absent per-provider value means the platform default applies -- it never
 * means unlimited.
 */
export const retryPolicyFor = (
  policy: RetryPolicy,
  limits: { readonly maxAttempts?: number } | undefined,
): RetryPolicy =>
  limits?.maxAttempts === undefined ? policy : { ...policy, maxAttempts: limits.maxAttempts };

export interface RetryDecision {
  readonly retry: boolean;
  readonly delayMs: number;
  readonly errorClass: CallErrorClass;
  /** Why not, when `retry` is false. Recorded, so nothing is unexplained. */
  readonly reason: string;
}

export const decideRetry = (
  error: unknown,
  attempt: number,
  policy: RetryPolicy,
  random: () => number,
): RetryDecision => {
  const errorClass = classifyError(error);

  if (!isRetryable(errorClass)) {
    return {
      retry: false,
      delayMs: 0,
      errorClass,
      reason:
        errorClass === 'MALFORMED_OUTPUT'
          ? 'A response that arrived and failed to parse is repaired once, never retried: the tokens are already spent.'
          : `A ${errorClass} is not transient, so retrying would repeat a permanent failure.`,
    };
  }

  if (attempt >= policy.maxAttempts) {
    return {
      retry: false,
      delayMs: 0,
      errorClass,
      reason: `Attempt ${attempt} of ${policy.maxAttempts} failed, so the retry limit is reached.`,
    };
  }

  return {
    retry: true,
    delayMs: backoffDelayMs(attempt, policy, random),
    errorClass,
    reason: `Attempt ${attempt} of ${policy.maxAttempts} failed with a retryable ${errorClass}.`,
  };
};
