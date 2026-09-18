// Scoring — live-learning-portal.md §5.
//
// "Scoring is deterministic backend code. Claude is not involved and has no
//  input." (ADR-004.)
//
// §5.2 is normative and its details are load-bearing:
//
//   1. percentageScore = (correct / total) * 100, rounded HALF AWAY FROM ZERO
//      to two decimals, stored as NUMERIC(5,2).
//   2. All pass/fail and band comparisons use the STORED, ROUNDED value, "so
//      the number a learner sees is the number the decision used. There is no
//      hidden precision."
//   3. Comparisons are inclusive on the lower bound, exclusive on the upper.
//   6. Topic accuracy uses the same rule with its own denominator.
//
// Unanswered counts as incorrect (§5.1), which is why `totalQuestions` comes
// from the SNAPSHOT and not from the response count.

import type { GapState, ProficiencyBand, ResultState } from '@knowzy/shared-types';

/** Recorded on every result, so a score can be explained years later. */
export const SCORING_ENGINE_VERSION = '1.0.0';

export interface ProficiencyBandDefinition {
  readonly band: string;
  readonly minInclusive: number;
  readonly maxExclusive: number;
}

export const DEFAULT_PROFICIENCY_BANDS: readonly ProficiencyBandDefinition[] = [
  { band: 'CRITICAL_KNOWLEDGE_GAP', minInclusive: 0, maxExclusive: 40 },
  { band: 'NEEDS_IMPROVEMENT', minInclusive: 40, maxExclusive: 60 },
  { band: 'DEVELOPING', minInclusive: 60, maxExclusive: 75 },
  { band: 'PROFICIENT', minInclusive: 75, maxExclusive: 90 },
  { band: 'EXPERT', minInclusive: 90, maxExclusive: 100.01 },
];

export class InvalidBandSetError extends Error {
  readonly code = 'ASSESSMENT_CONFIG_INVALID';
  constructor(detail: string) {
    super(detail);
    this.name = 'InvalidBandSetError';
  }
}

/**
 * Rounds half AWAY FROM ZERO to two decimals.
 *
 * `Math.round` rounds half UP, which differs for negatives, and
 * `toFixed` is famously inconsistent at the boundary because of binary
 * floating point: (1.005).toFixed(2) is "1.00". Scores are non-negative here,
 * but the rule is normative and a silently different rounding would move a
 * learner across a band boundary — so it is implemented explicitly rather than
 * delegated.
 */
export const roundHalfAwayFromZero = (value: number, decimals: number): number => {
  const factor = 10 ** decimals;
  // The epsilon nudge corrects the binary representation of exact halves; the
  // scaled value is compared at a precision well below two decimal places.
  const scaled = value * factor;
  const rounded =
    scaled >= 0
      ? Math.floor(scaled + 0.5 + Number.EPSILON * Math.abs(scaled))
      : Math.ceil(scaled - 0.5 - Number.EPSILON * Math.abs(scaled));
  return rounded / factor;
};

/** percentageScore from a count pair, per §5.1 and §5.2. */
export const percentageOf = (correct: number, total: number): number =>
  total === 0 ? 0 : roundHalfAwayFromZero((correct / total) * 100, 2);

/**
 * Validates a band set: contiguous, non-overlapping, covering 0-100 exactly.
 *
 * §5.3: "an invalid band set BLOCKS assessment publication". So this throws
 * rather than repairing — a silently corrected band set would mean the approver
 * published something other than what they reviewed.
 */
export const assertValidBandSet = (bands: readonly ProficiencyBandDefinition[]): void => {
  if (bands.length === 0) throw new InvalidBandSetError('The proficiency band set is empty.');

  const sorted = [...bands].sort((a, b) => a.minInclusive - b.minInclusive);
  const first = sorted[0];
  if (!first || first.minInclusive !== 0) {
    throw new InvalidBandSetError('The lowest proficiency band must start at 0.');
  }

  for (let i = 0; i < sorted.length; i += 1) {
    const band = sorted[i];
    if (!band) continue;
    if (band.maxExclusive <= band.minInclusive) {
      throw new InvalidBandSetError(
        `Band "${band.band}" has an empty or inverted range (${band.minInclusive}-${band.maxExclusive}).`,
      );
    }
    const next = sorted[i + 1];
    if (next && next.minInclusive !== band.maxExclusive) {
      throw new InvalidBandSetError(
        `Bands "${band.band}" and "${next.band}" are not contiguous: ${band.maxExclusive} then ${next.minInclusive}. A score in the gap would have no band.`,
      );
    }
  }

  const last = sorted[sorted.length - 1];
  // The top bound is exclusive, so covering 100.00 requires it to exceed 100.
  if (!last || last.maxExclusive <= 100) {
    throw new InvalidBandSetError(
      'The highest proficiency band must cover 100 (its exclusive upper bound must be above 100).',
    );
  }
};

/**
 * The band for a stored, rounded percentage.
 *
 * Inclusive lower, exclusive upper (§5.2 rule 3). 90.00 is EXPERT by the
 * worked example; 89.99 is PROFICIENT.
 */
export const bandFor = (
  percentageScore: number,
  bands: readonly ProficiencyBandDefinition[] = DEFAULT_PROFICIENCY_BANDS,
): ProficiencyBand => {
  const match = bands.find(
    (band) => percentageScore >= band.minInclusive && percentageScore < band.maxExclusive,
  );
  if (!match) {
    // Unreachable for a validated band set. Asserted rather than defaulted: a
    // score with no band is a configuration error, not a CRITICAL gap.
    throw new InvalidBandSetError(
      `No proficiency band covers ${percentageScore}. The band set does not cover 0-100.`,
    );
  }
  return match.band as ProficiencyBand;
};

// ---------------------------------------------------------------------------

export interface SnapshotQuestion {
  readonly presentationIndex: number;
  readonly questionId: string;
  readonly publishedVersion: number;
  readonly topicId: string;
  readonly learningObjectiveId: string | null;
  /** The answer key, from the session snapshot. Never leaves the server. */
  readonly correctOption: string;
}

export interface SnapshotResponse {
  readonly presentationIndex: number;
  readonly selectedOption: string | null;
}

export interface TopicScore {
  readonly topicId: string;
  readonly questionsAsked: number;
  readonly correct: number;
  readonly incorrect: number;
  readonly unanswered: number;
  readonly topicAccuracy: number;
  readonly topicBand: ProficiencyBand;
  readonly isKnowledgeGap: boolean;
  readonly gapState: GapState;
}

export interface ObjectiveScore {
  readonly objectiveId: string;
  readonly questionsAsked: number;
  readonly correct: number;
  readonly incorrect: number;
  readonly unanswered: number;
  readonly accuracy: number;
  readonly band: ProficiencyBand;
}

export interface ScoreResult {
  readonly totalQuestions: number;
  readonly correctAnswers: number;
  readonly incorrectAnswers: number;
  readonly unansweredCount: number;
  readonly percentageScore: number;
  readonly passed: boolean;
  readonly proficiencyBand: ProficiencyBand;
  readonly appliedThresholds: readonly ProficiencyBandDefinition[];
  readonly passPercentageApplied: number;
  readonly topics: readonly TopicScore[];
  readonly objectives: readonly ObjectiveScore[];
  readonly resultState: ResultState;
  readonly scoringEngineVersion: string;
}

export interface ScoreArgs {
  readonly questions: readonly SnapshotQuestion[];
  readonly responses: readonly SnapshotResponse[];
  readonly passPercentage: number;
  readonly bands?: readonly ProficiencyBandDefinition[];
  /** §5.4, default 60.00. */
  readonly gapThreshold?: number;
  /** §5.4, default 2. Below this a topic is INSUFFICIENT_EVIDENCE. */
  readonly minTopicQuestions?: number;
  /** EXPIRED and ABANDONED are scored the same way; only the label differs. */
  readonly resultState?: ResultState;
}

interface Tally {
  asked: number;
  correct: number;
  unanswered: number;
}

const tally = (): Tally => ({ asked: 0, correct: 0, unanswered: 0 });

export const scoreSession = (args: ScoreArgs): ScoreResult => {
  const bands = args.bands ?? DEFAULT_PROFICIENCY_BANDS;
  assertValidBandSet(bands);

  const gapThreshold = args.gapThreshold ?? 60;
  const minTopicQuestions = args.minTopicQuestions ?? 2;

  const chosen = new Map<number, string | null>();
  for (const response of args.responses) {
    chosen.set(response.presentationIndex, response.selectedOption);
  }

  // The denominator is the SNAPSHOT, not the responses: unanswered counts as
  // incorrect (§5.1), so a learner who answers three of ten scores 30% at best.
  const totalQuestions = args.questions.length;
  let correctAnswers = 0;
  let unansweredCount = 0;

  const byTopic = new Map<string, Tally>();
  const byObjective = new Map<string, Tally>();

  for (const question of args.questions) {
    const selected = chosen.get(question.presentationIndex) ?? null;
    const isCorrect = selected !== null && selected === question.correctOption;
    if (isCorrect) correctAnswers += 1;
    if (selected === null) unansweredCount += 1;

    const topic = byTopic.get(question.topicId) ?? tally();
    topic.asked += 1;
    if (isCorrect) topic.correct += 1;
    if (selected === null) topic.unanswered += 1;
    byTopic.set(question.topicId, topic);

    if (question.learningObjectiveId !== null) {
      const objective = byObjective.get(question.learningObjectiveId) ?? tally();
      objective.asked += 1;
      if (isCorrect) objective.correct += 1;
      if (selected === null) objective.unanswered += 1;
      byObjective.set(question.learningObjectiveId, objective);
    }
  }

  const percentageScore = percentageOf(correctAnswers, totalQuestions);

  const topics: TopicScore[] = [...byTopic.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([topicId, counts]) => {
      const topicAccuracy = percentageOf(counts.correct, counts.asked);
      // §5.4: the minimum-question rule "prevents a single unlucky question
      // from being reported as a proficiency gap".
      const insufficient = counts.asked < minTopicQuestions;
      const isGap = !insufficient && topicAccuracy < gapThreshold;
      return {
        topicId,
        questionsAsked: counts.asked,
        correct: counts.correct,
        incorrect: counts.asked - counts.correct,
        unanswered: counts.unanswered,
        topicAccuracy,
        topicBand: bandFor(topicAccuracy, bands),
        isKnowledgeGap: isGap,
        gapState: insufficient ? 'INSUFFICIENT_EVIDENCE' : isGap ? 'GAP' : 'NO_GAP',
      };
    });

  const objectives: ObjectiveScore[] = [...byObjective.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([objectiveId, counts]) => {
      const accuracy = percentageOf(counts.correct, counts.asked);
      return {
        objectiveId,
        questionsAsked: counts.asked,
        correct: counts.correct,
        incorrect: counts.asked - counts.correct,
        unanswered: counts.unanswered,
        accuracy,
        band: bandFor(accuracy, bands),
      };
    });

  return {
    totalQuestions,
    correctAnswers,
    incorrectAnswers: totalQuestions - correctAnswers,
    unansweredCount,
    percentageScore,
    // Compared against the STORED, ROUNDED value (§5.2 rule 2).
    passed: percentageScore >= args.passPercentage,
    proficiencyBand: bandFor(percentageScore, bands),
    appliedThresholds: bands,
    passPercentageApplied: args.passPercentage,
    topics,
    objectives,
    resultState: args.resultState ?? 'SCORED',
    scoringEngineVersion: SCORING_ENGINE_VERSION,
  };
};
