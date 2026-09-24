// Provider health — observed behaviour, which is a different question from
// availability.
//
// A provider can be AVAILABLE and FAILING at the same time: registered,
// approved, configured, and returning errors. Conflating the two would let a
// dashboard report a green provider that has not completed a call all morning.
//
// Pure: it takes samples and thresholds and returns a state. The samples come
// from `generation_provider_call` rows, which the domain layer reads.

import type {
  CallErrorClass,
  GenerationCallOutcome,
  ProviderHealthState,
} from '@knowzy/shared-types';

export interface HealthSample {
  readonly outcome: GenerationCallOutcome;
  readonly startedAt: Date;
  readonly errorClass: CallErrorClass | null;
  readonly latencyMs: number | null;
}

export interface HealthThresholds {
  /** Failures within the window before the state is FAILING. */
  readonly failureThreshold: number;
  readonly windowMinutes: number;
}

export interface HealthAssessment {
  readonly state: ProviderHealthState;
  /** One sentence, with the numbers in it. "Degraded" alone is not a report. */
  readonly reason: string;
  readonly callsInWindow: number;
  readonly failuresInWindow: number;
  /** Null when nothing in the window recorded a latency. */
  readonly medianLatencyMs: number | null;
  readonly lastFailureAt: string | null;
}

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  const lower = sorted[middle - 1];
  const upper = sorted[middle];
  if (lower === undefined || upper === undefined) return null;
  return Math.round((lower + upper) / 2);
};

/**
 * A refusal is NOT a failure sample.
 *
 * The control layer declining to call a provider says nothing about the
 * provider's health, and counting refusals as failures would make a working
 * budget look like an outage — exactly backwards, since the budget firing is
 * the platform working correctly.
 */
const isFailure = (sample: HealthSample): boolean =>
  sample.outcome === 'FAILED' || sample.outcome === 'RATE_LIMITED';

export const assessProviderHealth = (
  samples: readonly HealthSample[],
  thresholds: HealthThresholds,
  now: Date,
): HealthAssessment => {
  const windowStart = new Date(now.getTime() - thresholds.windowMinutes * 60_000);
  const inWindow = samples.filter((sample) => sample.startedAt >= windowStart);
  const failures = inWindow.filter(isFailure);
  const latencies = inWindow
    .map((sample) => sample.latencyMs)
    .filter((value): value is number => value !== null);
  const lastFailure = failures
    .map((sample) => sample.startedAt)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  const base = {
    callsInWindow: inWindow.length,
    failuresInWindow: failures.length,
    medianLatencyMs: median(latencies),
    lastFailureAt: lastFailure?.toISOString() ?? null,
  };

  // UNKNOWN is first-class. A provider with no calls has not earned "healthy";
  // it has simply not been asked, and saying so is more useful than a green
  // badge that means nothing.
  if (inWindow.length === 0) {
    return {
      ...base,
      state: 'UNKNOWN',
      reason: `No calls in the last ${thresholds.windowMinutes} minutes, so there is nothing to judge.`,
    };
  }

  if (failures.length >= thresholds.failureThreshold) {
    return {
      ...base,
      state: 'FAILING',
      reason: `${failures.length} of ${inWindow.length} calls failed in the last ${thresholds.windowMinutes} minutes, at or above the threshold of ${thresholds.failureThreshold}.`,
    };
  }

  if (failures.length > 0) {
    return {
      ...base,
      state: 'DEGRADED',
      reason: `${failures.length} of ${inWindow.length} calls failed in the last ${thresholds.windowMinutes} minutes, below the threshold of ${thresholds.failureThreshold}.`,
    };
  }

  return {
    ...base,
    state: 'HEALTHY',
    reason: `${inWindow.length} calls in the last ${thresholds.windowMinutes} minutes, none failed.`,
  };
};
