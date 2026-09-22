// Import validation — the gate between "detected" and "worth a reviewer's time".
//
// This does NOT replace any approval gate. Every draft an import creates goes
// through the identical 13 gates, evidence verification, duplicate detection,
// review and approval as a generated question. Validation here is earlier and
// cheaper: a question missing its answer cannot be graded, so persisting it as
// a draft would put a guaranteed rejection in a reviewer's queue.
//
// The thresholds are the SAME ones the generation schema enforces, deliberately
// rather than incidentally. If import accepted a 10-character stem that
// generation refuses, the review queue would hold two classes of question with
// two standards, and the weaker one would be indistinguishable after approval.

import {
  EVIDENCE_MAX_CHARS,
  EVIDENCE_MIN_CHARS,
  OPTION_KEYS,
  optionsAreDistinct,
  type DetectedQuestion,
  type DetectionIssue,
  type ImportIssueCode,
} from './detect.js';

/** Matches GeneratedQuestionSchema, so both paths hold one standard. */
export const QUESTION_TEXT_MIN = 15;
export const QUESTION_TEXT_MAX = 1_000;
export const OPTION_MAX = 500;
export const EXPLANATION_MIN = 20;
export const EXPLANATION_MAX = 2_000;

export interface ValidatedQuestion extends DetectedQuestion {
  readonly correctOption: Exclude<DetectedQuestion['correctOption'], null>;
  readonly explanation: string;
}

export interface ValidationOutcome {
  /** Ready to become drafts. Every field the question model requires is present. */
  readonly valid: readonly ValidatedQuestion[];
  /**
   * Detected but not importable, each with the reason and where to look.
   * Shown to the importer rather than silently dropped: a question bank with
   * three unusable rows is a fact about the file the owner should fix.
   */
  readonly invalid: readonly (DetectionIssue & { readonly ordinal: number })[];
}

const issue = (
  question: DetectedQuestion,
  code: ImportIssueCode,
  detail: string,
): DetectionIssue & { ordinal: number } => ({
  ordinal: question.ordinal,
  locator: question.locator,
  code,
  detail,
});

/**
 * Checks one detected question.
 *
 * Returns the FIRST failure rather than all of them, because the importer's
 * next action is the same either way — go and look at that row — and a list of
 * six complaints about one malformed row is harder to act on than one.
 */
const firstFailure = (
  question: DetectedQuestion,
): (DetectionIssue & { ordinal: number }) | null => {
  const stem = question.questionText.trim();
  if (stem.length === 0) {
    return issue(question, 'MISSING_FIELD', 'No question text was found.');
  }
  if (stem.length < QUESTION_TEXT_MIN) {
    return issue(
      question,
      'MISSING_FIELD',
      `The question text is ${stem.length} characters; the minimum is ${QUESTION_TEXT_MIN}. ` +
        'Generation holds the same minimum, so importing a shorter one would put two standards ' +
        'in one review queue.',
    );
  }
  if (stem.length > QUESTION_TEXT_MAX) {
    return issue(
      question,
      'MISSING_FIELD',
      `The question text is ${stem.length} characters; the maximum is ${QUESTION_TEXT_MAX}.`,
    );
  }

  for (const key of OPTION_KEYS) {
    const option = question.options[key].trim();
    if (option.length === 0) {
      return issue(question, 'OPTION_INCOMPLETE', `Option ${key} is empty.`);
    }
    if (option.length > OPTION_MAX) {
      return issue(
        question,
        'OPTION_INCOMPLETE',
        `Option ${key} is ${option.length} characters; the maximum is ${OPTION_MAX}.`,
      );
    }
  }
  if (!optionsAreDistinct(question.options)) {
    return issue(
      question,
      'OPTION_INCOMPLETE',
      'Two options are the same answer, so the question has two correct or two wrong answers.',
    );
  }

  if (question.correctOption === null) {
    return issue(
      question,
      'ANSWER_MISSING',
      'No correct answer was stated. A question that cannot be graded cannot be imported.',
    );
  }
  if (!(OPTION_KEYS as readonly string[]).includes(question.correctOption)) {
    return issue(
      question,
      'ANSWER_INVALID',
      `The stated answer "${question.correctOption}" is not one of A to D.`,
    );
  }

  const explanation = question.explanation?.trim() ?? '';
  if (explanation.length < EXPLANATION_MIN) {
    return issue(
      question,
      'MISSING_FIELD',
      explanation.length === 0
        ? 'No explanation was found. A learner sees the explanation on review, so it is ' +
            'required rather than optional.'
        : `The explanation is ${explanation.length} characters; the minimum is ${EXPLANATION_MIN}.`,
    );
  }

  // The evidence span is what makes an imported question groundable at all.
  // A row too short to quote cannot satisfy gate 1, so it is refused here
  // rather than failing at approval after a reviewer has read it.
  const evidence = question.evidence.trim();
  if (evidence.length < EVIDENCE_MIN_CHARS) {
    return issue(
      question,
      'EVIDENCE_TOO_SHORT',
      `The block this question was read from is ${evidence.length} characters; the minimum ` +
        `evidence span is ${EVIDENCE_MIN_CHARS}. Evidence verification would refuse it, so it ` +
        'is not persisted.',
    );
  }

  return null;
};

export const validateDetected = (detected: readonly DetectedQuestion[]): ValidationOutcome => {
  const valid: ValidatedQuestion[] = [];
  const invalid: (DetectionIssue & { ordinal: number })[] = [];

  for (const question of detected) {
    const failure = firstFailure(question);
    if (failure !== null) {
      invalid.push(failure);
      continue;
    }
    valid.push({
      ...question,
      correctOption: question.correctOption as ValidatedQuestion['correctOption'],
      explanation: (question.explanation ?? '').trim(),
      // Trimmed to the maximum rather than refused: a long block is still a
      // true quotation of the document, and truncating it keeps the citation
      // honest while satisfying the span ceiling.
      evidence:
        question.evidence.trim().length > EVIDENCE_MAX_CHARS
          ? question.evidence.trim().slice(0, EVIDENCE_MAX_CHARS)
          : question.evidence.trim(),
    });
  }

  return { valid, invalid };
};
