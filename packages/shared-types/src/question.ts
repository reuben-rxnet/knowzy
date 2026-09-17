// Question payloads and projections — data-model.md §7.
//
// One Zod schema serves REST validation, the MCP tool schema, and Claude output
// parsing. Release 1 ships MULTIPLE_CHOICE_4 (ADR-014); the other members exist
// so adding a type needs no change to lifecycle, publishing, assessment,
// session, reporting, or audit code.

import { z } from 'zod';
import { QuestionTypeSchema } from './enums.js';

export const OPTION_LETTERS = ['A', 'B', 'C', 'D'] as const;
export const OptionLetterSchema = z.enum(OPTION_LETTERS);
export type OptionLetter = z.infer<typeof OptionLetterSchema>;

// ------------------------------------------------------------- release 1

export const MultipleChoice4Schema = z.object({
  type: z.literal('MULTIPLE_CHOICE_4'),
  options: z.object({
    A: z.string().min(1),
    B: z.string().min(1),
    C: z.string().min(1),
    D: z.string().min(1),
  }),
  correctOption: OptionLetterSchema,
});
export type MultipleChoice4 = z.infer<typeof MultipleChoice4Schema>;

// ------------------------------------------ designed, not built in release 1

export const MultiSelectSchema = z.object({
  type: z.literal('MULTI_SELECT'),
  options: z.record(z.string()),
  correctOptions: z.array(z.string()).min(1),
});

export const TrueFalseSchema = z.object({
  type: z.literal('TRUE_FALSE'),
  correctValue: z.boolean(),
});

export const ShortAnswerSchema = z.object({
  type: z.literal('SHORT_ANSWER'),
  acceptedAnswers: z.array(z.string()).min(1),
  matchMode: z.enum(['EXACT', 'NORMALIZED', 'REGEX']),
});

export const ScenarioOrderingSchema = z.object({
  type: z.literal('SCENARIO_ORDERING'),
  steps: z.array(z.string()).min(2),
  correctOrder: z.array(z.number().int()),
});

export const AnswerPayloadSchema = z.discriminatedUnion('type', [
  MultipleChoice4Schema,
  MultiSelectSchema,
  TrueFalseSchema,
  ShortAnswerSchema,
  ScenarioOrderingSchema,
]);
export type AnswerPayload = z.infer<typeof AnswerPayloadSchema>;

// ---------------------------------------------------------------- responses

export const MultipleChoice4ResponseSchema = z.object({
  type: z.literal('MULTIPLE_CHOICE_4'),
  selectedOption: OptionLetterSchema,
});

export const ResponsePayloadSchema = z.discriminatedUnion('type', [
  MultipleChoice4ResponseSchema,
  z.object({ type: z.literal('MULTI_SELECT'), selectedOptions: z.array(z.string()) }),
  z.object({ type: z.literal('TRUE_FALSE'), selectedValue: z.boolean() }),
  z.object({ type: z.literal('SHORT_ANSWER'), text: z.string() }),
  z.object({ type: z.literal('SCENARIO_ORDERING'), order: z.array(z.number().int()) }),
]);
export type ResponsePayload = z.infer<typeof ResponsePayloadSchema>;

// ---------------------------------------------------------------------------
// Learner projection — security.md §8 K2
//
// This type has no answer-key field, for any question type. A contract test in
// packages/testing/contracts fails the build if one is added.
// ---------------------------------------------------------------------------

export const LearnerOptionsSchema = z.object({
  A: z.string(),
  B: z.string(),
  C: z.string(),
  D: z.string(),
});

export const LearnerQuestionDtoSchema = z
  .object({
    questionId: z.string(),
    presentationIndex: z.number().int(),
    questionType: QuestionTypeSchema,
    questionText: z.string(),
    options: LearnerOptionsSchema,
    selectedOption: OptionLetterSchema.nullable(),
    isFlagged: z.boolean(),
  })
  .strict();
export type LearnerQuestionDto = z.infer<typeof LearnerQuestionDtoSchema>;

/**
 * Keys that must never appear at any depth in a `/api/v1/learning/**` response.
 * The runtime assertion (K3) and the reflective leakage suite both read this
 * list, so there is one definition of "answer key" to keep current.
 */
export const FORBIDDEN_LEARNER_RESPONSE_KEYS: readonly string[] = [
  'correctAnswer',
  'correctOption',
  'correctOptions',
  'correctValue',
  'acceptedAnswers',
  'correctOrder',
  'answerPayload',
  'explanation',
  'supportingEvidence',
  'sourceLocation',
  'evidenceStartOffset',
  'evidenceEndOffset',
];

/** The explicit column list `findLearnerQuestion()` may select — K4. */
export const LEARNER_QUESTION_COLUMNS: readonly string[] = [
  'questionId',
  'presentationIndex',
  'questionType',
  'questionText',
  'optionA',
  'optionB',
  'optionC',
  'optionD',
];

// ---------------------------------------------------------------- scoring

/**
 * A scorer is a pure function registered by question type — data-model.md §7.2.
 * `partialCredit` is expressible but unused in release 1, which is why
 * percentageScore stays defined as correct / total.
 */
export interface ScoreOutcome {
  readonly correct: boolean;
  readonly partialCredit?: number;
}

export type Scorer<P extends AnswerPayload, R extends ResponsePayload> = (
  payload: P,
  response: R | null,
) => ScoreOutcome;
