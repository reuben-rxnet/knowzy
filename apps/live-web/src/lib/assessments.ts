// The learner's eligible assessments — the one catalogue this release has.
//
// Shared by Home and the preview pages, so every page that says "your
// assessments" reads the same payload through the same call. The preview
// pages use it for their REAL sections (history, progress counts, the domains
// a learner can see); nothing illustrative is ever derived from it.

import { api, type ApiResult } from './api';

export interface AssessmentCardData {
  readonly assessmentId: string;
  readonly name: string;
  readonly description: string | null;
  readonly domain: string;
  readonly questionCount: number | null;
  readonly passPercentage: number | null;
  readonly timeLimitMinutes: number | null;
  readonly attemptsUsed: number;
  readonly attemptLimit: number | null;
  readonly startable: boolean;
  readonly blockedReason: string | null;
  /**
   * The API's own shape, not a guess at it.
   *
   * `answeredOf` arrives as a rendered string ("3 of 4"). This interface used
   * to declare `currentIndex` and `totalQuestions`, which the API never sent —
   * so the card printed "NaN / " from arithmetic on two undefined fields, and
   * TypeScript could not catch it because a hand-written interface is an
   * assertion, not a contract.
   */
  readonly inProgressSession: {
    readonly sessionId: string;
    readonly answeredOf: string;
  } | null;
}

export interface AssessmentList {
  readonly count: number;
  readonly assessments: readonly AssessmentCardData[];
}

export const listAssessments = (): Promise<ApiResult<AssessmentList>> =>
  api<AssessmentList>('/api/v1/learning/assessments');

/**
 * The domains a learner can see, with how many of their assessments each one
 * has. Taken only from assessments published to them — so it is
 * permission-trimmed by construction (learner §13.4) and never lists a domain
 * they have no access to.
 */
export const visibleDomains = (
  assessments: readonly AssessmentCardData[],
): readonly { readonly domain: string; readonly assessments: number }[] => {
  const counts = new Map<string, number>();
  for (const assessment of assessments) {
    counts.set(assessment.domain, (counts.get(assessment.domain) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([domain, count]) => ({ domain, assessments: count }))
    .sort((a, b) => a.domain.localeCompare(b.domain));
};
