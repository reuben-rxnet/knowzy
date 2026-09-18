// Answer and option integrity — workflows.md §2.3.
//
// Failure codes are the ones the rejection taxonomy already declares:
// OPTION_DUPLICATE, ANSWER_INVALID, QUESTION_INCOMPLETE.
//
// These are cheap checks that catch the specific ways a generated
// multiple-choice question is broken in a way a reviewer would have to catch by
// eye — two options saying the same thing, or a giveaway distractor like "all of
// the above" that makes the question test nothing.

import { normalizeForComparison } from '@knowzy/shared-types';
import { OPTION_KEYS, type GeneratedQuestion } from './output-schema.js';

export type IntegrityFailureReason = 'OPTION_DUPLICATE' | 'ANSWER_INVALID' | 'QUESTION_INCOMPLETE';

export interface IntegrityFailure {
  readonly reason: IntegrityFailureReason;
  readonly detail: string;
}

/**
 * Distractors that defeat the point of the question.
 *
 * The generation profile's `distractorRules` declares these prohibited; this is
 * where the declaration is enforced. "All of the above" is testable only for
 * whether the learner noticed the phrasing.
 */
const PROHIBITED_OPTION = /^(all|none) of the above|^both [ab] and|^any of these/i;

export const checkIntegrity = (question: GeneratedQuestion): IntegrityFailure | null => {
  const values = OPTION_KEYS.map((key) => question.options[key]);

  for (const [index, value] of values.entries()) {
    if (value.trim().length === 0) {
      return {
        reason: 'QUESTION_INCOMPLETE',
        detail: `Option ${OPTION_KEYS[index]} is empty.`,
      };
    }
    if (PROHIBITED_OPTION.test(value.trim())) {
      return {
        reason: 'QUESTION_INCOMPLETE',
        detail: `Option ${OPTION_KEYS[index]} is a prohibited distractor form ("all of the above" and similar), which tests phrasing rather than knowledge.`,
      };
    }
  }

  // Compared under the shared normalization, so "IP Neigh Flush" and
  // "ip  neigh flush" are correctly caught as the same option.
  const normalized = values.map((value) => normalizeForComparison(value));
  for (let i = 0; i < normalized.length; i += 1) {
    for (let j = i + 1; j < normalized.length; j += 1) {
      if (normalized[i] === normalized[j]) {
        return {
          reason: 'OPTION_DUPLICATE',
          detail: `Options ${OPTION_KEYS[i]} and ${OPTION_KEYS[j]} are the same answer, so the question has two correct or two wrong answers.`,
        };
      }
    }
  }

  if (!OPTION_KEYS.includes(question.correctOption)) {
    return {
      reason: 'ANSWER_INVALID',
      detail: `The correct option "${question.correctOption}" is not one of A-D.`,
    };
  }

  if (question.questionText.trim().length === 0 || question.explanation.trim().length === 0) {
    return {
      reason: 'QUESTION_INCOMPLETE',
      detail: 'The question text or the explanation is empty.',
    };
  }

  // The explanation must add something. One that merely restates the correct
  // option teaches the learner nothing on review.
  if (
    normalizeForComparison(question.explanation) ===
    normalizeForComparison(question.options[question.correctOption])
  ) {
    return {
      reason: 'QUESTION_INCOMPLETE',
      detail: 'The explanation only restates the correct option, so it explains nothing.',
    };
  }

  return null;
};

/** Pairwise option distinctness in [0,1], a confidence component (§2.8). */
export const optionDistinctness = (question: GeneratedQuestion): number => {
  const values = OPTION_KEYS.map((key) => normalizeForComparison(question.options[key]));
  const scores: number[] = [];

  for (let i = 0; i < values.length; i += 1) {
    for (let j = i + 1; j < values.length; j += 1) {
      const a = values[i] ?? '';
      const b = values[j] ?? '';
      const longer = Math.max(a.length, b.length);
      if (longer === 0) {
        scores.push(0);
        continue;
      }
      // Token overlap: the practical way two distractors end up near-identical
      // is by sharing most of their words.
      const left = new Set(a.split(' '));
      const right = new Set(b.split(' '));
      let shared = 0;
      for (const token of left) if (right.has(token)) shared += 1;
      const union = left.size + right.size - shared;
      scores.push(union === 0 ? 0 : 1 - shared / union);
    }
  }

  return scores.length === 0 ? 0 : scores.reduce((sum, s) => sum + s, 0) / scores.length;
};
