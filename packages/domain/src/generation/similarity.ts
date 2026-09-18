// Stage 2 post-generation similarity scoring — generation-governance.md §4.4.
//
// Composite score with the documented weights:
//
//   stem trigram similarity          0.45
//   stem token Jaccard               0.20
//   option-set overlap               0.20
//   same source section              0.10
//   same correct-answer semantics    0.05
//
//   >= blockThreshold (0.92)  the draft is NOT PERSISTED; recorded as rejected
//                             with reason DUPLICATE and a pointer to the match
//   >= flagThreshold  (0.75)  persisted with DUPLICATE_SUSPECTED; approval is
//                             blocked until a reviewer dispositions it
//   <  flagThreshold          no action
//
// §4.4 is explicit that the comparison corpus spans ALL DOMAINS: a domain
// filter applies to RANKING, never to DETECTION. And release 1 ships lexical
// detection only, which will miss paraphrases — stated plainly there and
// restated here, because the reviewer is the backstop.

import { normalizeForComparison } from '@knowzy/shared-types';
import { trigramSimilarity } from '@knowzy/claude-services';

export const SIMILARITY_WEIGHTS = {
  stemTrigram: 0.45,
  stemTokenJaccard: 0.2,
  optionOverlap: 0.2,
  sameSection: 0.1,
  sameCorrectAnswer: 0.05,
} as const;

export interface ComparableQuestion {
  readonly questionId: string;
  readonly domainId: string;
  readonly questionText: string;
  readonly options: readonly string[];
  readonly correctOptionText: string;
  readonly sectionKey: string;
}

export interface SimilarityMatch {
  readonly questionId: string;
  readonly score: number;
  readonly components: {
    readonly stemTrigram: number;
    readonly stemTokenJaccard: number;
    readonly optionOverlap: number;
    readonly sameSection: number;
    readonly sameCorrectAnswer: number;
  };
}

/** Stopwords stripped before the token comparison, per §4.4's normalization. */
const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'is',
  'of',
  'on',
  'or',
  'that',
  'the',
  'to',
  'was',
  'which',
  'with',
  'what',
  'according',
  'following',
  'statement',
  'correct',
]);

const tokens = (text: string): Set<string> =>
  new Set(
    normalizeForComparison(text)
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 2 && !STOPWORDS.has(token)),
  );

const jaccard = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 && b.size === 0) return 1;
  let shared = 0;
  for (const value of a) if (b.has(value)) shared += 1;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
};

export const scoreSimilarity = (
  candidate: ComparableQuestion,
  existing: ComparableQuestion,
): SimilarityMatch => {
  const components = {
    stemTrigram: trigramSimilarity(
      normalizeForComparison(candidate.questionText),
      normalizeForComparison(existing.questionText),
    ),
    stemTokenJaccard: jaccard(tokens(candidate.questionText), tokens(existing.questionText)),
    optionOverlap: jaccard(
      new Set(candidate.options.map((option) => normalizeForComparison(option))),
      new Set(existing.options.map((option) => normalizeForComparison(option))),
    ),
    sameSection: candidate.sectionKey === existing.sectionKey ? 1 : 0,
    sameCorrectAnswer:
      normalizeForComparison(candidate.correctOptionText) ===
      normalizeForComparison(existing.correctOptionText)
        ? 1
        : 0,
  };

  const score =
    components.stemTrigram * SIMILARITY_WEIGHTS.stemTrigram +
    components.stemTokenJaccard * SIMILARITY_WEIGHTS.stemTokenJaccard +
    components.optionOverlap * SIMILARITY_WEIGHTS.optionOverlap +
    components.sameSection * SIMILARITY_WEIGHTS.sameSection +
    components.sameCorrectAnswer * SIMILARITY_WEIGHTS.sameCorrectAnswer;

  return {
    questionId: existing.questionId,
    score: Math.round(score * 1000) / 1000,
    components,
  };
};

export type DuplicateVerdict =
  | { readonly action: 'ACCEPT'; readonly maxScore: number; readonly match: null }
  | { readonly action: 'FLAG'; readonly maxScore: number; readonly match: SimilarityMatch }
  | { readonly action: 'BLOCK'; readonly maxScore: number; readonly match: SimilarityMatch };

export interface DuplicateThresholds {
  readonly flagThreshold: number;
  readonly blockThreshold: number;
}

export const assessDuplicate = (
  candidate: ComparableQuestion,
  corpus: readonly ComparableQuestion[],
  thresholds: DuplicateThresholds,
): DuplicateVerdict => {
  let best: SimilarityMatch | null = null;

  for (const existing of corpus) {
    if (existing.questionId === candidate.questionId) continue;
    const match = scoreSimilarity(candidate, existing);
    if (best === null || match.score > best.score) best = match;
  }

  const maxScore = best?.score ?? 0;
  if (best !== null && maxScore >= thresholds.blockThreshold) {
    return { action: 'BLOCK', maxScore, match: best };
  }
  if (best !== null && maxScore >= thresholds.flagThreshold) {
    return { action: 'FLAG', maxScore, match: best };
  }
  return { action: 'ACCEPT', maxScore, match: null };
};
