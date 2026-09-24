// Provider health.
//
// The two assertions that matter most here are about what health is NOT: it is
// not availability, and a refusal is not a failure. Counting refusals as
// failures would make a working budget look like an outage, which is exactly
// backwards — the budget firing is the platform working.

import { describe, expect, it } from 'vitest';
import { assessProviderHealth, type HealthSample } from './health.js';

const thresholds = { failureThreshold: 3, windowMinutes: 15 };
const now = new Date('2026-09-24T12:00:00.000Z');
const minutesAgo = (minutes: number): Date => new Date(now.getTime() - minutes * 60_000);

const sample = (
  outcome: HealthSample['outcome'],
  minutes: number,
  latencyMs: number | null = 100,
): HealthSample => ({ outcome, startedAt: minutesAgo(minutes), errorClass: null, latencyMs });

describe('assessProviderHealth', () => {
  it('is UNKNOWN with no calls in the window, not HEALTHY', () => {
    // A provider with no calls has not earned "healthy"; it has not been asked.
    const assessment = assessProviderHealth([], thresholds, now);
    expect(assessment.state).toBe('UNKNOWN');
    expect(assessment.reason).toContain('nothing to judge');
  });

  it('ignores samples older than the window', () => {
    expect(assessProviderHealth([sample('FAILED', 60)], thresholds, now).state).toBe('UNKNOWN');
  });

  it('is HEALTHY when everything in the window succeeded', () => {
    const assessment = assessProviderHealth(
      [sample('SUCCEEDED', 1), sample('SUCCEEDED', 5)],
      thresholds,
      now,
    );
    expect(assessment.state).toBe('HEALTHY');
    expect(assessment.callsInWindow).toBe(2);
  });

  it('is DEGRADED below the threshold and FAILING at it', () => {
    const two = [sample('FAILED', 1), sample('SUCCEEDED', 2)];
    expect(assessProviderHealth(two, thresholds, now).state).toBe('DEGRADED');

    const three = [sample('FAILED', 1), sample('FAILED', 2), sample('RATE_LIMITED', 3)];
    expect(assessProviderHealth(three, thresholds, now).state).toBe('FAILING');
  });

  it('counts a rate limit as a failure for health purposes', () => {
    // It is the provider refusing to serve us, whatever the reason, so an
    // operator needs to see it.
    expect(assessProviderHealth([sample('RATE_LIMITED', 1)], thresholds, now).state).toBe(
      'DEGRADED',
    );
  });

  it('does NOT count a control-layer refusal as a failure', () => {
    // The platform declining to call says nothing about the provider.
    const assessment = assessProviderHealth(
      [sample('REFUSED', 1), sample('REFUSED', 2), sample('REFUSED', 3)],
      thresholds,
      now,
    );
    expect(assessment.state).toBe('HEALTHY');
    expect(assessment.failuresInWindow).toBe(0);
  });

  it('reports the median latency, and null when nothing recorded one', () => {
    expect(
      assessProviderHealth(
        [sample('SUCCEEDED', 1, 100), sample('SUCCEEDED', 2, 300)],
        thresholds,
        now,
      ).medianLatencyMs,
    ).toBe(200);
    expect(
      assessProviderHealth([sample('SUCCEEDED', 1, null)], thresholds, now).medianLatencyMs,
    ).toBeNull();
  });

  it('records when the last failure happened', () => {
    const assessment = assessProviderHealth(
      [sample('SUCCEEDED', 1), sample('FAILED', 4)],
      thresholds,
      now,
    );
    expect(assessment.lastFailureAt).toBe(minutesAgo(4).toISOString());
  });

  it('puts the numbers in the reason, so a badge is never the whole report', () => {
    const assessment = assessProviderHealth(
      [sample('FAILED', 1), sample('FAILED', 2), sample('FAILED', 3)],
      thresholds,
      now,
    );
    expect(assessment.reason).toContain('3 of 3');
    expect(assessment.reason).toContain('15 minutes');
  });
});
