// @knowzy/question-import
//
// Detects and validates multiple-choice questions in an already-extracted
// document, so an existing question bank can be brought into Knowzy without a
// second governance model.
//
// The design rests on one decision, explained at the top of `detect.ts`: the
// UPLOADED FILE BECOMES A KNOWLEDGE DOCUMENT, and a detected question's
// evidence span is the verbatim block it was read from. Every approval gate
// then passes for the same reason it passes for a generated question, and
// nothing downstream needs a special case.
//
// This package takes plain data and holds no dependency on the extraction
// package, so the domain can consume it without violating boundary rule B3.

export {
  detectQuestions,
  optionsAreDistinct,
  EVIDENCE_MAX_CHARS,
  EVIDENCE_MIN_CHARS,
  OPTION_KEYS,
  type DetectInput,
  type DetectedQuestion,
  type DetectionIssue,
  type DetectionResult,
  type ImportIssueCode,
  type ImportSection,
  type ImportStrategy,
  type OptionKey,
} from './detect.js';

export {
  validateDetected,
  EXPLANATION_MAX,
  EXPLANATION_MIN,
  OPTION_MAX,
  QUESTION_TEXT_MAX,
  QUESTION_TEXT_MIN,
  type ValidatedQuestion,
  type ValidationOutcome,
} from './validate.js';

export const PACKAGE_NAME = '@knowzy/question-import' as const;
