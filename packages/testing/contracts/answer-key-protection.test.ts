// Answer-key protection contract — security.md §8 K2, and the repository rule
// C10 in repository-structure.md §5.2.
//
// K2: "LearnerQuestionDto has no answer-key field. A contract test fails the
//      build if one is added, for every question type."
//
// This suite is the build-time half. The runtime half is the response-shape
// assertion (K3), and the reflective sweep over every tool and route is the
// leakage suite — both arrive with the routes they guard (Phase 6). What is
// assertable in Phase 1 is the TYPE and the shared forbidden-key list, and
// those are what every later control reads.

import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  FORBIDDEN_LEARNER_RESPONSE_KEYS,
  LEARNER_QUESTION_COLUMNS,
  LearnerQuestionDtoSchema,
  MultipleChoice4Schema,
  AnswerPayloadSchema,
  QUESTION_TYPE,
  type LearnerQuestionDto,
} from '@knowzy/shared-types';

describe('LearnerQuestionDto (K2)', () => {
  it('has no answer-key field at the type level', () => {
    // A compile-time assertion: adding `correctOption` to the DTO makes this
    // fail typecheck, which is the point — the guarantee is structural, not a
    // runtime filter someone can forget to apply.
    expectTypeOf<LearnerQuestionDto>().not.toHaveProperty('correctOption');
    expectTypeOf<LearnerQuestionDto>().not.toHaveProperty('correctAnswer');
    expectTypeOf<LearnerQuestionDto>().not.toHaveProperty('correctOptions');
    expectTypeOf<LearnerQuestionDto>().not.toHaveProperty('correctValue');
    expectTypeOf<LearnerQuestionDto>().not.toHaveProperty('acceptedAnswers');
    expectTypeOf<LearnerQuestionDto>().not.toHaveProperty('correctOrder');
    expectTypeOf<LearnerQuestionDto>().not.toHaveProperty('answerPayload');
    expectTypeOf<LearnerQuestionDto>().not.toHaveProperty('explanation');
    expectTypeOf<LearnerQuestionDto>().not.toHaveProperty('supportingEvidence');
  });

  it('rejects an answer key at runtime because the schema is strict', () => {
    const valid = {
      questionId: 'KNZ-NET-2026-000412',
      presentationIndex: 0,
      questionType: 'MULTIPLE_CHOICE_4' as const,
      questionText: 'Which command clears the ARP cache on the Linux jump host?',
      options: {
        A: 'arp -d *',
        B: 'ip neigh flush all',
        C: 'netsh int ip reset',
        D: 'ifconfig -a',
      },
      selectedOption: null,
      isFlagged: false,
    };

    expect(LearnerQuestionDtoSchema.safeParse(valid).success).toBe(true);

    // `.strict()` means an unknown key is rejected rather than stripped. A
    // stripped key would leave the caller believing they had sent it.
    const withKey = { ...valid, correctOption: 'B' };
    const result = LearnerQuestionDtoSchema.safeParse(withKey);
    expect(result.success).toBe(false);
  });

  it('declares no forbidden key in its own shape', () => {
    const shapeKeys = Object.keys(LearnerQuestionDtoSchema.shape);
    for (const forbidden of FORBIDDEN_LEARNER_RESPONSE_KEYS) {
      expect(shapeKeys, forbidden).not.toContain(forbidden);
    }
  });
});

describe('the forbidden-key list is complete for every question type', () => {
  it('names the answer-key field of each declared payload variant', () => {
    // Every discriminated variant of AnswerPayload carries its key under a
    // distinct field name; if a new question type introduces another, this
    // assertion fails until the list is updated — which is what keeps K3 and
    // the leakage suite honest, since both read this one list.
    const keyFieldByType: Record<string, string> = {
      MULTIPLE_CHOICE_4: 'correctOption',
      MULTI_SELECT: 'correctOptions',
      TRUE_FALSE: 'correctValue',
      SHORT_ANSWER: 'acceptedAnswers',
      SCENARIO_ORDERING: 'correctOrder',
    };

    for (const type of QUESTION_TYPE) {
      const field = keyFieldByType[type];
      expect(field, `no answer-key field mapped for ${type}`).toBeDefined();
      expect(FORBIDDEN_LEARNER_RESPONSE_KEYS, `${type} -> ${field}`).toContain(field as string);
    }
  });

  it('includes the derived and adjacent fields a learner must never receive', () => {
    for (const key of ['answerPayload', 'explanation', 'supportingEvidence', 'sourceLocation']) {
      expect(FORBIDDEN_LEARNER_RESPONSE_KEYS).toContain(key);
    }
  });
});

describe('the learner column allow-list (K4)', () => {
  it('selects no answer-key column', () => {
    for (const column of LEARNER_QUESTION_COLUMNS) {
      expect(FORBIDDEN_LEARNER_RESPONSE_KEYS, column).not.toContain(column);
      expect(column.toLowerCase(), column).not.toContain('correct');
      expect(column.toLowerCase(), column).not.toContain('explanation');
      expect(column.toLowerCase(), column).not.toContain('evidence');
    }
  });
});

describe('the authoring payload still carries the key', () => {
  it('parses a full MULTIPLE_CHOICE_4 payload including correctOption', () => {
    // The mirror assertion. If the answer key were removed from the authoring
    // payload too, approval and scoring would silently break — so this proves
    // the restriction applies to the LEARNER projection specifically.
    const payload = {
      type: 'MULTIPLE_CHOICE_4' as const,
      options: { A: 'a', B: 'b', C: 'c', D: 'd' },
      correctOption: 'B' as const,
    };
    expect(MultipleChoice4Schema.safeParse(payload).success).toBe(true);
    expect(AnswerPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('rejects a payload with a blank option (I1)', () => {
    const payload = {
      type: 'MULTIPLE_CHOICE_4' as const,
      options: { A: 'a', B: '', C: 'c', D: 'd' },
      correctOption: 'B' as const,
    };
    expect(AnswerPayloadSchema.safeParse(payload).success).toBe(false);
  });

  it('rejects a correct answer outside A–D (I1)', () => {
    const payload = {
      type: 'MULTIPLE_CHOICE_4',
      options: { A: 'a', B: 'b', C: 'c', D: 'd' },
      correctOption: 'E',
    };
    expect(AnswerPayloadSchema.safeParse(payload).success).toBe(false);
  });
});
