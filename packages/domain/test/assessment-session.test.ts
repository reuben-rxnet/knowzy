// Assessment, session, and scoring — MVP steps 6 and 7.
//
// Scoring is tested as arithmetic first, because §5.2's rounding rule is
// normative and the worked examples in it are the specification: 7/9 → 77.78,
// 27/30 → 90.00 → EXPERT on an inclusive lower bound, 3/7 → 42.86, 5/9 → 55.56.
// A scoring engine that disagrees with those four numbers is wrong regardless
// of what the rest of the pipeline does.
//
// Then the session lifecycle against a real database: the snapshot really is
// immutable, an answer really is persisted before the response returns, a
// refresh really does resume, and the answer key really does not leave.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { systemClock } from '@knowzy/observability';
import { FORBIDDEN_LEARNER_RESPONSE_KEYS } from '@knowzy/shared-types';
import {
  createMockQuestionBankAdapter,
  type QuestionBankAdapter,
} from '@knowzy/knowledge-source-adapters';
import {
  AssessmentConfigError,
  assertNoAnswerKey,
  assertValidBandSet,
  bandFor,
  completeSession,
  createAssessment,
  createGenerationJob,
  createSeededRandom,
  currentQuestion,
  deriveSessionId,
  evaluatePool,
  expireSession,
  intersectWithSnapshot,
  onePerCluster,
  percentageOf,
  publishApprovedQuestions,
  publishAssessmentVersion,
  readResult,
  recordSessionRecovery,
  resumeSession,
  roundHalfAwayFromZero,
  runGenerationJob,
  scoreSession,
  seededShuffle,
  selectQuestions,
  startSession,
  submitAnswer,
  transitionAssessmentVersion,
  transitionQuestion,
  validateAssessmentVersion,
  InvalidBandSetError,
  NotEligibleError,
  PoolInsufficientError,
  SequenceConflictError,
  SessionNotActiveError,
  type ActorContext,
  type LearnerContext,
  type PublishTarget,
  type SnapshotQuestion,
} from '../src/index.js';
import { testControl } from './control-layer-fixture.js';

const DATABASE_URL = process.env['DATABASE_URL'];
const describeDb = DATABASE_URL ? describe : describe.skip;

const prisma = new PrismaClient(
  DATABASE_URL ? { datasources: { db: { url: DATABASE_URL } } } : undefined,
);

// =========================================================== pure arithmetic

describe('scoring arithmetic (live-learning-portal.md §5.2)', () => {
  it('rounds half AWAY FROM ZERO to two decimals', () => {
    expect(roundHalfAwayFromZero(1.005, 2)).toBe(1.01);
    expect(roundHalfAwayFromZero(2.675, 2)).toBe(2.68);
    expect(roundHalfAwayFromZero(0.125, 2)).toBe(0.13);
    expect(roundHalfAwayFromZero(-1.005, 2)).toBe(-1.01);
  });

  it('matches every worked example in §5.2 rule 5', () => {
    expect(percentageOf(7, 9)).toBe(77.78);
    expect(bandFor(77.78)).toBe('PROFICIENT');

    expect(percentageOf(27, 30)).toBe(90);
    // The lower bound is INCLUSIVE, so exactly 90.00 is EXPERT.
    expect(bandFor(90)).toBe('EXPERT');

    expect(percentageOf(3, 7)).toBe(42.86);
    expect(bandFor(42.86)).toBe('NEEDS_IMPROVEMENT');

    expect(percentageOf(5, 9)).toBe(55.56);
    expect(bandFor(55.56)).toBe('NEEDS_IMPROVEMENT');
  });

  it('treats band bounds as inclusive lower and exclusive upper', () => {
    expect(bandFor(89.99)).toBe('PROFICIENT');
    expect(bandFor(90)).toBe('EXPERT');
    expect(bandFor(100)).toBe('EXPERT');
    expect(bandFor(74.99)).toBe('DEVELOPING');
    expect(bandFor(75)).toBe('PROFICIENT');
    expect(bandFor(0)).toBe('CRITICAL_KNOWLEDGE_GAP');
    expect(bandFor(39.99)).toBe('CRITICAL_KNOWLEDGE_GAP');
    expect(bandFor(40)).toBe('NEEDS_IMPROVEMENT');
  });

  it('refuses a band set with a gap, because a score in it would have no band', () => {
    expect(() =>
      assertValidBandSet([
        { band: 'LOW', minInclusive: 0, maxExclusive: 40 },
        { band: 'HIGH', minInclusive: 50, maxExclusive: 100.01 },
      ]),
    ).toThrow(/not contiguous/);
  });

  it('refuses a band set that does not start at 0 or does not cover 100', () => {
    expect(() =>
      assertValidBandSet([{ band: 'ONLY', minInclusive: 10, maxExclusive: 100.01 }]),
    ).toThrow(/must start at 0/);
    expect(() =>
      assertValidBandSet([{ band: 'ONLY', minInclusive: 0, maxExclusive: 100 }]),
    ).toThrow(/must cover 100/);
  });

  it('refuses an empty or inverted band', () => {
    expect(() => assertValidBandSet([{ band: 'BAD', minInclusive: 50, maxExclusive: 50 }])).toThrow(
      InvalidBandSetError,
    );
  });

  const question = (
    index: number,
    topicId: string,
    correct: string,
    objectiveId: string | null = null,
  ): SnapshotQuestion => ({
    presentationIndex: index,
    questionId: `q${index}`,
    publishedVersion: 1,
    topicId,
    learningObjectiveId: objectiveId,
    correctOption: correct,
  });

  it('counts an UNANSWERED question as incorrect', () => {
    const score = scoreSession({
      questions: [question(0, 't1', 'A'), question(1, 't1', 'B'), question(2, 't1', 'C')],
      // Only one of three answered, and it is right.
      responses: [{ presentationIndex: 0, selectedOption: 'A' }],
      passPercentage: 70,
    });
    expect(score.totalQuestions).toBe(3);
    expect(score.correctAnswers).toBe(1);
    expect(score.incorrectAnswers).toBe(2);
    expect(score.unansweredCount).toBe(2);
    expect(score.percentageScore).toBe(33.33);
    expect(score.passed).toBe(false);
  });

  it('compares pass/fail against the STORED, ROUNDED value', () => {
    // 7/9 is 77.777…, which rounds to 77.78. A pass mark of 77.78 must pass;
    // comparing the unrounded value would fail it.
    const score = scoreSession({
      questions: Array.from({ length: 9 }, (_, i) => question(i, 't1', 'A')),
      responses: Array.from({ length: 7 }, (_, i) => ({
        presentationIndex: i,
        selectedOption: 'A',
      })),
      passPercentage: 77.78,
    });
    expect(score.percentageScore).toBe(77.78);
    expect(score.passed).toBe(true);
  });

  it('records topic performance with its own denominator', () => {
    const score = scoreSession({
      questions: [
        question(0, 'escalation', 'A'),
        question(1, 'escalation', 'A'),
        question(2, 'escalation', 'A'),
        question(3, 'billing', 'B'),
        question(4, 'billing', 'B'),
      ],
      responses: [
        { presentationIndex: 0, selectedOption: 'A' },
        { presentationIndex: 1, selectedOption: 'A' },
        { presentationIndex: 2, selectedOption: 'D' },
        { presentationIndex: 3, selectedOption: 'B' },
        { presentationIndex: 4, selectedOption: 'B' },
      ],
      passPercentage: 70,
    });

    const escalation = score.topics.find((topic) => topic.topicId === 'escalation');
    const billing = score.topics.find((topic) => topic.topicId === 'billing');
    expect(escalation?.questionsAsked).toBe(3);
    expect(escalation?.topicAccuracy).toBe(66.67);
    expect(escalation?.topicBand).toBe('DEVELOPING');
    expect(billing?.topicAccuracy).toBe(100);
    expect(billing?.topicBand).toBe('EXPERT');
    expect(score.percentageScore).toBe(80);
  });

  it('identifies a knowledge gap below the threshold', () => {
    const score = scoreSession({
      questions: [
        question(0, 'weak', 'A'),
        question(1, 'weak', 'A'),
        question(2, 'weak', 'A'),
        question(3, 'strong', 'A'),
        question(4, 'strong', 'A'),
      ],
      responses: [
        { presentationIndex: 0, selectedOption: 'B' },
        { presentationIndex: 1, selectedOption: 'B' },
        { presentationIndex: 2, selectedOption: 'A' },
        { presentationIndex: 3, selectedOption: 'A' },
        { presentationIndex: 4, selectedOption: 'A' },
      ],
      passPercentage: 70,
    });

    const weak = score.topics.find((topic) => topic.topicId === 'weak');
    expect(weak?.topicAccuracy).toBe(33.33);
    expect(weak?.isKnowledgeGap).toBe(true);
    expect(weak?.gapState).toBe('GAP');
    expect(score.topics.find((topic) => topic.topicId === 'strong')?.gapState).toBe('NO_GAP');
  });

  it('records INSUFFICIENT_EVIDENCE rather than a false gap on one question', () => {
    // §5.4: "The minimum-question rule prevents a single unlucky question from
    // being reported as a proficiency gap."
    const score = scoreSession({
      questions: [question(0, 'thin', 'A'), question(1, 'other', 'A'), question(2, 'other', 'A')],
      responses: [
        { presentationIndex: 0, selectedOption: 'B' },
        { presentationIndex: 1, selectedOption: 'A' },
        { presentationIndex: 2, selectedOption: 'A' },
      ],
      passPercentage: 70,
    });

    const thin = score.topics.find((topic) => topic.topicId === 'thin');
    expect(thin?.topicAccuracy).toBe(0);
    expect(thin?.gapState).toBe('INSUFFICIENT_EVIDENCE');
    // 0% accuracy, and still NOT reported as a gap.
    expect(thin?.isKnowledgeGap).toBe(false);
  });

  it('honours a configured gap threshold and minimum', () => {
    const score = scoreSession({
      questions: [question(0, 't', 'A'), question(1, 't', 'A')],
      responses: [
        { presentationIndex: 0, selectedOption: 'A' },
        { presentationIndex: 1, selectedOption: 'B' },
      ],
      passPercentage: 70,
      gapThreshold: 80,
      minTopicQuestions: 2,
    });
    // 50% is above the default 60 threshold's... no: below it. Raised to 80 it
    // is still a gap; the point is the configured value is the one used.
    expect(score.topics[0]?.topicAccuracy).toBe(50);
    expect(score.topics[0]?.isKnowledgeGap).toBe(true);

    const lenient = scoreSession({
      questions: [question(0, 't', 'A'), question(1, 't', 'A')],
      responses: [
        { presentationIndex: 0, selectedOption: 'A' },
        { presentationIndex: 1, selectedOption: 'B' },
      ],
      passPercentage: 70,
      gapThreshold: 40,
    });
    expect(lenient.topics[0]?.isKnowledgeGap).toBe(false);
  });

  it('scores objectives alongside topics', () => {
    const score = scoreSession({
      questions: [question(0, 't', 'A', 'obj-1'), question(1, 't', 'A', 'obj-1')],
      responses: [
        { presentationIndex: 0, selectedOption: 'A' },
        { presentationIndex: 1, selectedOption: 'A' },
      ],
      passPercentage: 70,
    });
    expect(score.objectives).toHaveLength(1);
    expect(score.objectives[0]?.accuracy).toBe(100);
  });

  it('is deterministic: the same inputs give the same output', () => {
    const args = {
      questions: [question(0, 't', 'A'), question(1, 't', 'B')],
      responses: [{ presentationIndex: 0, selectedOption: 'A' }],
      passPercentage: 50,
    };
    expect(JSON.stringify(scoreSession(args))).toBe(JSON.stringify(scoreSession(args)));
  });

  it('stamps the scoring engine version on every result', () => {
    const score = scoreSession({
      questions: [question(0, 't', 'A')],
      responses: [],
      passPercentage: 50,
    });
    expect(score.scoringEngineVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('selection is reproducible (workflows.md §6.1)', () => {
  it('produces the same sequence for the same seed, on any platform', () => {
    const a = createSeededRandom('session-abc');
    const b = createSeededRandom('session-abc');
    const first = [a(), a(), a()];
    const second = [b(), b(), b()];
    expect(second).toEqual(first);
    // A different seed gives a different sequence.
    const c = createSeededRandom('session-abd');
    expect([c(), c(), c()]).not.toEqual(first);
  });

  it('shuffles reproducibly and keeps every element', () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const once = seededShuffle(items, 'seed-1');
    expect(seededShuffle(items, 'seed-1')).toEqual(once);
    expect([...once].sort((x, y) => x - y)).toEqual(items);
    expect(once).not.toEqual(items);
  });

  it('intersects on BOTH id and version, so a republished question is excluded', () => {
    const snapshot = [
      { questionId: 'q1', publishedVersion: 1 },
      { questionId: 'q2', publishedVersion: 2 },
    ];
    const live = [
      {
        questionId: 'q1',
        publishedVersion: 1,
        topicId: 't',
        similarityClusterId: null,
        approvedAt: null,
      },
      // Republished at v3 — NOT the v2 the approver pinned.
      {
        questionId: 'q2',
        publishedVersion: 3,
        topicId: 't',
        similarityClusterId: null,
        approvedAt: null,
      },
      // Never in the snapshot at all.
      {
        questionId: 'q9',
        publishedVersion: 1,
        topicId: 't',
        similarityClusterId: null,
        approvedAt: null,
      },
    ];
    expect(intersectWithSnapshot(snapshot, live).map((q) => q.questionId)).toEqual(['q1']);
  });

  it('keeps one question per similarity cluster, by approval recency', () => {
    const pool = [
      {
        questionId: 'old',
        publishedVersion: 1,
        topicId: 't',
        similarityClusterId: 'c1',
        approvedAt: new Date('2026-01-01'),
      },
      {
        questionId: 'new',
        publishedVersion: 1,
        topicId: 't',
        similarityClusterId: 'c1',
        approvedAt: new Date('2026-06-01'),
      },
      {
        questionId: 'solo',
        publishedVersion: 1,
        topicId: 't',
        similarityClusterId: null,
        approvedAt: null,
      },
    ];
    const kept = onePerCluster(pool)
      .map((q) => q.questionId)
      .sort();
    expect(kept).toEqual(['new', 'solo']);
  });

  it('refuses a short pool rather than padding it', () => {
    const pool = [
      {
        questionId: 'q1',
        publishedVersion: 1,
        topicId: 't',
        similarityClusterId: null,
        approvedAt: null,
      },
    ];
    expect(() =>
      selectQuestions(pool, { strategy: 'RANDOM_POOL', questionCount: 5 }, 'seed'),
    ).toThrow(PoolInsufficientError);
    expect(() =>
      selectQuestions(pool, { strategy: 'RANDOM_POOL', questionCount: 5 }, 'seed'),
    ).toThrow(/5 question\(s\) are required and 1 are available/);
  });

  it('keeps a FIXED_SET in its pinned order, unshuffled', () => {
    const pool = ['c', 'a', 'b'].map((id) => ({
      questionId: id,
      publishedVersion: 1,
      topicId: 't',
      similarityClusterId: null,
      approvedAt: null,
    }));
    const order = [
      { questionId: 'c', publishedVersion: 1 },
      { questionId: 'a', publishedVersion: 1 },
      { questionId: 'b', publishedVersion: 1 },
    ];
    const result = selectQuestions(
      pool,
      { strategy: 'FIXED_SET', questionCount: 3, fixedOrder: order },
      'seed',
    );
    expect(result.selected.map((q) => q.questionId)).toEqual(['c', 'a', 'b']);
  });

  it('refuses a FIXED_SET that lost a member', () => {
    const pool = [
      {
        questionId: 'a',
        publishedVersion: 1,
        topicId: 't',
        similarityClusterId: null,
        approvedAt: null,
      },
    ];
    expect(() =>
      selectQuestions(
        pool,
        {
          strategy: 'FIXED_SET',
          questionCount: 2,
          fixedOrder: [
            { questionId: 'a', publishedVersion: 1 },
            { questionId: 'gone', publishedVersion: 1 },
          ],
        },
        'seed',
      ),
    ).toThrow(/fixed question set is incomplete/);
  });

  it('allocates TOPIC_BALANCED evenly and deterministically', () => {
    const pool = ['t1', 't1', 't1', 't2', 't2', 't2'].map((topicId, i) => ({
      questionId: `q${i}`,
      publishedVersion: 1,
      topicId,
      similarityClusterId: null,
      approvedAt: null,
    }));
    const first = selectQuestions(pool, { strategy: 'TOPIC_BALANCED', questionCount: 4 }, 'seed');
    const again = selectQuestions(pool, { strategy: 'TOPIC_BALANCED', questionCount: 4 }, 'seed');
    expect(first.selected.map((q) => q.questionId)).toEqual(
      again.selected.map((q) => q.questionId),
    );
    expect(first.selected).toHaveLength(4);
    // Two per topic.
    expect(first.selected.filter((q) => q.topicId === 't1')).toHaveLength(2);
    expect(first.selected.filter((q) => q.topicId === 't2')).toHaveLength(2);
  });
});

describe('the answer-key assertion', () => {
  it('rejects every forbidden key, at any depth', () => {
    for (const key of FORBIDDEN_LEARNER_RESPONSE_KEYS) {
      expect(() => assertNoAnswerKey({ nested: { deeper: { [key]: 'x' } } }, 'test')).toThrow(
        /RESPONSE_SHAPE_VIOLATION/,
      );
    }
  });

  it('rejects a forbidden key inside an array', () => {
    expect(() => assertNoAnswerKey({ items: [{ correctOption: 'A' }] }, 'test')).toThrow(
      /correctOption/,
    );
  });

  it('accepts a clean learner payload', () => {
    expect(() =>
      assertNoAnswerKey(
        { questionId: 'q', options: { A: 'a', B: 'b', C: 'c', D: 'd' }, selectedOption: 'A' },
        'test',
      ),
    ).not.toThrow();
  });
});

// ============================================================ the lifecycle

describeDb('quiz session lifecycle', () => {
  let learnerId = '';
  let authorId = '';
  let approverId = '';
  let publisherId = '';
  let assessmentManagerId = '';
  let domainId = '';
  let topicId = '';
  let sourceId = '';
  let documentId = '';
  let bankRoot = '';
  let bank: QuestionBankAdapter;
  let target: PublishTarget;
  let assessmentId = '';
  let assessmentVersionId = '';

  const ALL = [
    'question.read',
    'question.edit',
    'question.submit',
    'question.review',
    'question.approve',
    'question.publish',
    'assessment.read',
    'assessment.manage',
    'assessment.approve',
    'assessment.publish',
  ];

  const actor = (userId: string, overrides: Partial<ActorContext> = {}): ActorContext => ({
    userId,
    displayName: 'Test actor',
    roles: ['CONTENT_AUTHOR'],
    permissions: ALL,
    correlationId: 'm6-test',
    requestId: 'm6-request',
    ...overrides,
  });

  const learner = (overrides: Partial<LearnerContext> = {}): LearnerContext => ({
    userId: learnerId,
    displayName: 'Local Learner',
    roles: ['LEARNER'],
    permissions: [
      'learning.access',
      'learning.assessment.list',
      'learning.session.create',
      'learning.session.own',
      'learning.result.own',
    ],
    correlationId: 'm6-learner',
    requestId: 'm6-learner-request',
    ...overrides,
  });

  const deps = () => ({ prisma, clock: systemClock });

  /**
   * A complete retirement record.
   *
   * `published_question_reference_retirement_check` requires retiredAt,
   * retiredByUserId, and a retireComment of at least 10 characters whenever
   * status is RETIRED — the database will not accept a half-retirement, which
   * is exactly right and caught this test taking a shortcut.
   */
  const retirementFields = () => ({
    status: 'RETIRED' as const,
    isActive: false,
    retiredAt: new Date(),
    retiredByUserId: publisherId,
    retireComment: 'Retired by the assessment session test suite.',
  });

  beforeAll(async () => {
    const source = await prisma.knowledgeSource.findFirstOrThrow({
      where: { sourceType: 'MOCK' },
      select: { id: true },
    });
    sourceId = source.id;

    const topic = await prisma.topic.findFirstOrThrow({
      where: { isActive: true },
      select: { id: true, domainId: true },
    });
    topicId = topic.id;
    domainId = topic.domainId;

    const document = await prisma.knowledgeDocument.findFirstOrThrow({
      where: { sourceId, name: 'refunds-and-chargebacks.md', extractionStatus: 'EXTRACTED' },
      select: { id: true },
    });
    documentId = document.id;

    const users = await prisma.user.findMany({
      where: {
        userPrincipalName: {
          in: [
            'learner@local.invalid',
            'author@local.invalid',
            'approver@local.invalid',
            'publisher@local.invalid',
            'assessment-manager@local.invalid',
          ],
        },
      },
      select: { id: true, userPrincipalName: true },
    });
    const idOf = (upn: string): string =>
      users.find((user) => user.userPrincipalName === upn)?.id ?? '';
    learnerId = idOf('learner@local.invalid');
    authorId = idOf('author@local.invalid');
    approverId = idOf('approver@local.invalid');
    publisherId = idOf('publisher@local.invalid');
    assessmentManagerId = idOf('assessment-manager@local.invalid');
    expect(learnerId && authorId && approverId && publisherId && assessmentManagerId).toBeTruthy();

    bankRoot = mkdtempSync(join(tmpdir(), 'knowzy-m6-bank-'));
    bank = createMockQuestionBankAdapter({ fixtureRoot: bankRoot });
    target = {
      targetSiteId: 'm6-site',
      targetListId: 'm6-bank',
      writesEnabled: true,
      dryRunReason: null,
    };
  });

  afterAll(async () => {
    rmSync(bankRoot, { recursive: true, force: true });
    // Leave the database as it was found. The last test's rows would otherwise
    // become another suite's surprise setup.
    await prisma.objectiveResult.deleteMany({});
    await prisma.topicResult.deleteMany({});
    await prisma.assessmentResult.deleteMany({});
    await prisma.quizResponse.deleteMany({});
    await prisma.quizSessionQuestion.deleteMany({});
    await prisma.quizSession.deleteMany({});
    await prisma.assessmentEligibilitySnapshot.deleteMany({});
    await prisma.assessmentVersion.deleteMany({});
    await prisma.assessment.deleteMany({});
    await prisma.publishOperation.deleteMany({});
    await prisma.publishedQuestionReference.deleteMany({});
    await prisma.questionApproval.deleteMany({});
    await prisma.questionReview.deleteMany({});
    await prisma.draftQuestionVersion.deleteMany({});
    await prisma.draftQuestion.deleteMany({});
    await prisma.generationJobRejection.deleteMany({});
    await prisma.generationJobDocument.deleteMany({});
    await prisma.generationJob.deleteMany({});
    await prisma.generationPreflight.deleteMany({});
    await prisma.documentGenerationStat.deleteMany({});
    await prisma.documentSection.updateMany({
      where: { documentId },
      data: { isAssessable: true, coverageStatus: 'NOT_COVERED', nonAssessableReason: null },
    });
    await prisma.$disconnect();
  });

  /** Generates, approves, and publishes questions so a pool exists. */
  const publishQuestions = async (count: number): Promise<string[]> => {
    await prisma.documentSection.updateMany({
      where: { documentId },
      data: { isAssessable: true, coverageStatus: 'NOT_COVERED', nonAssessableReason: null },
    });

    const preflight = await prisma.generationPreflight.create({
      data: {
        sourceId,
        documentIds: [documentId],
        checkResults: {},
        recommendation: 'GENERATE_NEW',
        chosenAction: 'GENERATE_NEW',
        chosenAt: new Date(),
        chosenByUserId: authorId,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        correlationId: 'm6-test',
        createdByUserId: authorId,
      },
      select: { id: true },
    });

    const created = await createGenerationJob({
      prisma,
      clock: systemClock,
      preflightId: preflight.id,
      scope: 'ENTIRE_DOCUMENT',
      domainId,
      topicId,
      reasonCode: 'NEW_KNOWLEDGE',
      requestedQuestionCount: count,
      actor: {
        userId: authorId,
        displayName: 'Author',
        roles: ['CONTENT_AUTHOR'],
        permissions: ['question.generate'],
      },
      correlationId: 'm6-test',
      requestId: 'm6-request',
    });

    const run = await runGenerationJob({
      prisma,
      clock: systemClock,
      scope: created.resolvedScope,
      profile: created.profile,
      requestedQuestionCount: count,
      control: testControl(),
      context: {
        jobId: created.jobId,
        sourceId: created.sourceId,
        domainId,
        topicId,
        correlationId: 'm6-test',
        requestId: 'm6-request',
        actorUserId: authorId,
        actorDisplayName: 'Author',
        actorRoles: ['CONTENT_AUTHOR'],
        reasonCode: 'NEW_KNOWLEDGE',
      },
    });

    for (const questionId of run.acceptedQuestionIds) {
      await transitionQuestion({
        deps: deps(),
        questionId,
        to: 'AUTHOR_REVIEW',
        actor: actor(authorId),
      });
      await transitionQuestion({
        deps: deps(),
        questionId,
        to: 'SUBMITTED_FOR_APPROVAL',
        actor: actor(authorId),
      });
      await transitionQuestion({
        deps: deps(),
        questionId,
        to: 'APPROVED',
        actor: actor(approverId, { roles: ['QUIZ_APPROVER'] }),
      });
    }

    const published = await publishApprovedQuestions({
      deps: deps(),
      bank,
      target,
      questionIds: run.acceptedQuestionIds,
      actor: actor(publisherId, { roles: ['PUBLISHER'] }),
      signal: new AbortController().signal,
    });
    expect(published.publishedCount).toBe(run.acceptedQuestionIds.length);
    return [...run.acceptedQuestionIds];
  };

  /** Creates and publishes an assessment over the published pool. */
  const publishAssessment = async (questionCount: number): Promise<void> => {
    const created = await createAssessment({
      prisma,
      clock: systemClock,
      actor: actor(assessmentManagerId, { roles: ['ASSESSMENT_MANAGER'] }),
      name: `M6 Refunds Assessment ${Date.now()}`,
      slug: `m6-refunds-${Date.now()}`,
      domainId,
      topicIds: [topicId],
      questionCount,
      selectionStrategy: 'RANDOM_POOL',
      passPercentage: 70,
    });
    assessmentId = created.assessmentId;
    assessmentVersionId = created.assessmentVersionId;

    await transitionAssessmentVersion({
      prisma,
      clock: systemClock,
      actor: actor(assessmentManagerId, { roles: ['ASSESSMENT_MANAGER'] }),
      assessmentVersionId,
      to: 'UNDER_REVIEW',
    });
    await transitionAssessmentVersion({
      prisma,
      clock: systemClock,
      actor: actor(assessmentManagerId, { roles: ['ASSESSMENT_MANAGER'] }),
      assessmentVersionId,
      to: 'APPROVED',
    });
    await publishAssessmentVersion({
      prisma,
      clock: systemClock,
      actor: actor(assessmentManagerId, { roles: ['ASSESSMENT_MANAGER'] }),
      assessmentVersionId,
    });
  };

  let listCounter = 0;
  beforeEach(async () => {
    listCounter += 1;
    target = { ...target, targetListId: `m6-bank-${listCounter}` };

    await prisma.objectiveResult.deleteMany({});
    await prisma.topicResult.deleteMany({});
    await prisma.assessmentResult.deleteMany({});
    await prisma.quizResponse.deleteMany({});
    await prisma.quizSessionQuestion.deleteMany({});
    await prisma.quizSession.deleteMany({});
    await prisma.assessmentEligibilitySnapshot.deleteMany({});
    await prisma.assessmentVersion.deleteMany({});
    await prisma.assessment.deleteMany({});
    await prisma.publishOperation.deleteMany({});
    await prisma.publishedQuestionReference.deleteMany({});
    await prisma.questionApproval.deleteMany({});
    await prisma.questionReview.deleteMany({});
    await prisma.draftQuestionVersion.deleteMany({});
    await prisma.draftQuestion.deleteMany({});
    await prisma.generationJobRejection.deleteMany({});
    await prisma.generationJobDocument.deleteMany({});
    await prisma.generationJob.deleteMany({});
    await prisma.generationPreflight.deleteMany({});
    await prisma.documentGenerationStat.deleteMany({});
  });

  // -------------------------------------------------------- published only

  describe('published questions only', () => {
    it('builds a pool from published references, and nothing else', async () => {
      const published = await publishQuestions(3);
      const pool = await evaluatePool(prisma, { domainId, topicIds: [topicId] });
      expect(pool.members).toHaveLength(published.length);

      // A question whose LOCAL row is no longer PUBLISHED leaves the pool, even
      // though its published reference still exists. A reference and a draft
      // that disagree is a reconciliation problem, not something the pool
      // papers over.
      const first = published[0]!;
      const reference = await prisma.publishedQuestionReference.findFirstOrThrow({
        where: { question: { id: first } },
        select: { questionId: true },
      });
      await prisma.draftQuestion.update({ where: { id: first }, data: { status: 'APPROVED' } });

      const after = await evaluatePool(prisma, { domainId, topicIds: [topicId] });
      expect(after.members).toHaveLength(published.length - 1);
      expect(after.members.map((member) => member.questionId)).not.toContain(reference.questionId);
    });

    it('refuses to publish an assessment whose pool is too small', async () => {
      await publishQuestions(2);
      const created = await createAssessment({
        prisma,
        clock: systemClock,
        actor: actor(assessmentManagerId),
        name: 'Too Big',
        slug: `too-big-${Date.now()}`,
        domainId,
        topicIds: [topicId],
        questionCount: 50,
        selectionStrategy: 'RANDOM_POOL',
        passPercentage: 70,
      });

      const validation = await validateAssessmentVersion(prisma, created.assessmentVersionId);
      expect(validation.valid).toBe(false);
      expect(validation.problems.map((p) => p.code)).toContain('ASSESSMENT_POOL_INSUFFICIENT');

      await expect(
        publishAssessmentVersion({
          prisma,
          clock: systemClock,
          actor: actor(assessmentManagerId),
          assessmentVersionId: created.assessmentVersionId,
        }),
      ).rejects.toThrow(PoolInsufficientError);
    });

    it('pins a FIXED_SET to exactly the chosen published questions, in their order', async () => {
      const published = await publishQuestions(3);
      expect(published.length).toBeGreaterThanOrEqual(2);
      const chosen = [published[1] as string, published[0] as string];
      const created = await createAssessment({
        prisma,
        clock: systemClock,
        actor: actor(assessmentManagerId),
        name: 'Fixed Quiz',
        slug: `fixed-quiz-${Date.now()}`,
        domainId,
        topicIds: [topicId],
        // Ignored for a list: the count is the list's length.
        questionCount: 99,
        selectionStrategy: 'FIXED_SET',
        passPercentage: 70,
        fixedQuestionIds: chosen,
      });
      const version = await prisma.assessmentVersion.findUniqueOrThrow({
        where: { id: created.assessmentVersionId },
        select: { questionCount: true, selectionConfig: true },
      });
      expect(version.questionCount).toBe(2);
      const fixedOrder = (version.selectionConfig as { fixedOrder: { questionId: string }[] })
        .fixedOrder;
      // Draft ids in, KNZ QuestionIDs stored, in the chosen order.
      const knz = await Promise.all(
        chosen.map(
          async (id) =>
            (
              await prisma.publishedQuestionReference.findFirstOrThrow({
                where: { question: { id } },
                select: { questionId: true },
              })
            ).questionId,
        ),
      );
      expect(fixedOrder.map((member) => member.questionId)).toEqual(knz);
      expect((await validateAssessmentVersion(prisma, created.assessmentVersionId)).valid).toBe(
        true,
      );

      // A member that stops being published invalidates the fixed set.
      await prisma.publishedQuestionReference.updateMany({
        where: { question: { id: chosen[0] as string } },
        data: retirementFields(),
      });
      const after = await validateAssessmentVersion(prisma, created.assessmentVersionId);
      expect(after.valid).toBe(false);
      expect(after.problems.map((problem) => problem.detail).join(' ')).toMatch(
        /no longer published/,
      );
    });

    it('refuses a FIXED_SET naming a question that is not published, or no list at all', async () => {
      const base = {
        prisma,
        clock: systemClock,
        actor: actor(assessmentManagerId),
        name: 'Fixed Refused',
        domainId,
        topicIds: [topicId],
        questionCount: 1,
        selectionStrategy: 'FIXED_SET' as const,
        passPercentage: 70,
      };
      await expect(
        createAssessment({
          ...base,
          slug: `fixed-refused-${Date.now()}`,
          fixedQuestionIds: [randomUUID()],
        }),
      ).rejects.toThrow(AssessmentConfigError);
      await expect(createAssessment({ ...base, slug: `fixed-none-${Date.now()}` })).rejects.toThrow(
        AssessmentConfigError,
      );
    });
  });

  // --------------------------------------------------------- the snapshot

  describe('the session snapshot is authoritative (§4.2)', () => {
    it('pins question id, version, and the answer key at creation', async () => {
      await publishQuestions(3);
      await publishAssessment(2);

      const started = await startSession({
        deps: deps(),
        learner: learner(),
        assessmentId,
      });
      expect(started.totalQuestions).toBe(2);

      const snapshot = await prisma.quizSessionQuestion.findMany({
        where: { sessionId: started.sessionId },
        orderBy: { presentationIndex: 'asc' },
      });
      expect(snapshot).toHaveLength(2);
      for (const row of snapshot) {
        expect(row.publishedVersion).toBeGreaterThan(0);
        // The answer key IS in the snapshot, server-side.
        expect((row.answerPayload as { correctOption?: string }).correctOption).toMatch(/^[ABCD]$/);
        expect(row.topicId).toBe(topicId);
      }
    });

    it('a question retired MID-SESSION does not change the in-flight attempt', async () => {
      const published = await publishQuestions(3);
      await publishAssessment(2);
      const started = await startSession({ deps: deps(), learner: learner(), assessmentId });

      const before = await prisma.quizSessionQuestion.findMany({
        where: { sessionId: started.sessionId },
        orderBy: { presentationIndex: 'asc' },
        select: { questionId: true, publishedVersion: true, questionText: true },
      });

      // Retire every published question and edit the underlying text.
      await prisma.publishedQuestionReference.updateMany({
        where: {},
        data: retirementFields(),
      });
      await prisma.draftQuestion.updateMany({
        where: { id: { in: published } },
        data: { questionText: 'This text was changed after the session started.' },
      });

      const after = await prisma.quizSessionQuestion.findMany({
        where: { sessionId: started.sessionId },
        orderBy: { presentationIndex: 'asc' },
        select: { questionId: true, publishedVersion: true, questionText: true },
      });
      expect(after).toEqual(before);

      // And the learner can still finish the attempt.
      const current = await currentQuestion({
        deps: deps(),
        learner: learner(),
        sessionId: started.sessionId,
      });
      expect(current.question.questionText).not.toContain('changed after');
    });

    it('never serves a question retired BEFORE the session started', async () => {
      // The generator yields what the document supports, so the assessment is
      // sized from the ACTUAL pool rather than an assumed one — retiring more
      // than the surplus would fail on pool sufficiency instead of testing the
      // exclusion this is about.
      const published = await publishQuestions(4);
      expect(published.length).toBeGreaterThanOrEqual(2);
      await publishAssessment(published.length - 1);

      // Retire one AFTER the assessment snapshot was pinned.
      const references = await prisma.publishedQuestionReference.findMany({
        select: { id: true },
        take: 1,
      });
      await prisma.publishedQuestionReference.updateMany({
        where: { id: { in: references.map((r) => r.id) } },
        data: retirementFields(),
      });

      const started = await startSession({ deps: deps(), learner: learner(), assessmentId });
      const served = await prisma.quizSessionQuestion.findMany({
        where: { sessionId: started.sessionId },
        select: { questionId: true },
      });
      const retiredIds = (
        await prisma.publishedQuestionReference.findMany({
          where: { status: 'RETIRED' },
          select: { questionId: true },
        })
      ).map((r) => r.questionId);
      for (const row of served) {
        expect(retiredIds).not.toContain(row.questionId);
      }
    });

    it('fails session creation when re-filtering drops the pool below the count', async () => {
      await publishQuestions(3);
      await publishAssessment(3);

      // Every question retired: the intersection is empty.
      await prisma.publishedQuestionReference.updateMany({
        where: {},
        data: retirementFields(),
      });

      await expect(
        startSession({ deps: deps(), learner: learner(), assessmentId }),
      ).rejects.toThrow(PoolInsufficientError);
      // The learner is not served a short assessment.
      expect(await prisma.quizSession.count()).toBe(0);
    });
  });

  // ------------------------------------------------- one question at a time

  describe('one question at a time, with every answer persisted', () => {
    it('serves one question and no answer key', async () => {
      await publishQuestions(3);
      await publishAssessment(2);
      const started = await startSession({ deps: deps(), learner: learner(), assessmentId });

      const current = await currentQuestion({
        deps: deps(),
        learner: learner(),
        sessionId: started.sessionId,
      });
      expect(current.currentIndex).toBe(0);
      expect(current.totalQuestions).toBe(2);
      expect(Object.keys(current.question).sort()).toEqual([
        'isFlagged',
        'options',
        'presentationIndex',
        'questionId',
        'questionText',
        'questionType',
        'selectedOption',
      ]);
      // No key, at any depth.
      expect(() => assertNoAnswerKey(current, 'test')).not.toThrow();
    });

    it('persists every answer and advances', async () => {
      await publishQuestions(3);
      await publishAssessment(2);
      const started = await startSession({ deps: deps(), learner: learner(), assessmentId });

      const first = await submitAnswer({
        deps: deps(),
        learner: learner(),
        sessionId: started.sessionId,
        presentationIndex: 0,
        selectedOption: 'A',
        idempotencyKey: 'answer-key-0',
      });
      expect(first.completed).toBe(false);
      expect(first.nextQuestion?.presentationIndex).toBe(1);
      // No correctness signal, no running score (§4.3).
      expect(Object.keys(first)).not.toContain('correct');
      expect(Object.keys(first)).not.toContain('score');

      // Written BEFORE the response returned.
      const stored = await prisma.quizResponse.findFirstOrThrow({
        where: { sessionId: started.sessionId, presentationIndex: 0, isLatest: true },
      });
      expect((stored.responsePayload as { selectedOption: string }).selectedOption).toBe('A');
      expect(stored.revision).toBe(1);

      const second = await submitAnswer({
        deps: deps(),
        learner: learner(),
        sessionId: started.sessionId,
        presentationIndex: 1,
        selectedOption: 'B',
        idempotencyKey: 'answer-key-1',
      });
      expect(second.completed).toBe(true);
      expect(second.nextQuestion).toBeNull();
      expect(second.answeredCount).toBe(2);
    });

    it('keeps the prior value when an answer is changed', async () => {
      await publishQuestions(3);
      await publishAssessment(2);
      const started = await startSession({ deps: deps(), learner: learner(), assessmentId });

      await submitAnswer({
        deps: deps(),
        learner: learner(),
        sessionId: started.sessionId,
        presentationIndex: 0,
        selectedOption: 'A',
        idempotencyKey: 'change-1',
      });
      await submitAnswer({
        deps: deps(),
        learner: learner(),
        sessionId: started.sessionId,
        presentationIndex: 0,
        selectedOption: 'C',
        idempotencyKey: 'change-2',
      });

      const revisions = await prisma.quizResponse.findMany({
        where: { sessionId: started.sessionId, presentationIndex: 0 },
        orderBy: { revision: 'asc' },
      });
      expect(revisions).toHaveLength(2);
      expect(revisions[0]?.isLatest).toBe(false);
      expect((revisions[0]?.responsePayload as { selectedOption: string }).selectedOption).toBe(
        'A',
      );
      expect(revisions[1]?.isLatest).toBe(true);
      expect((revisions[1]?.responsePayload as { selectedOption: string }).selectedOption).toBe(
        'C',
      );
    });

    it('returns the original result for a replayed idempotency key', async () => {
      await publishQuestions(3);
      await publishAssessment(2);
      const started = await startSession({ deps: deps(), learner: learner(), assessmentId });

      const once = await submitAnswer({
        deps: deps(),
        learner: learner(),
        sessionId: started.sessionId,
        presentationIndex: 0,
        selectedOption: 'A',
        idempotencyKey: 'double-click',
      });
      const twice = await submitAnswer({
        deps: deps(),
        learner: learner(),
        sessionId: started.sessionId,
        presentationIndex: 0,
        selectedOption: 'D',
        idempotencyKey: 'double-click',
      });

      expect(twice.replayed).toBe(true);
      expect(twice.revision).toBe(once.revision);
      // One write, not two — and the second option was NOT applied.
      expect(await prisma.quizResponse.count({ where: { sessionId: started.sessionId } })).toBe(1);
    });

    it('rejects an out-of-order write', async () => {
      await publishQuestions(3);
      await publishAssessment(2);
      const started = await startSession({ deps: deps(), learner: learner(), assessmentId });

      await expect(
        submitAnswer({
          deps: deps(),
          learner: learner(),
          sessionId: started.sessionId,
          presentationIndex: 0,
          selectedOption: 'A',
          idempotencyKey: 'seq-bad',
          // The session is at sequence 0, so 1 is expected, not 7.
          writeSequence: 7,
        }),
      ).rejects.toThrow(SequenceConflictError);
    });

    it('rejects an index outside the session', async () => {
      await publishQuestions(3);
      await publishAssessment(2);
      const started = await startSession({ deps: deps(), learner: learner(), assessmentId });

      await expect(
        submitAnswer({
          deps: deps(),
          learner: learner(),
          sessionId: started.sessionId,
          presentationIndex: 99,
          selectedOption: 'A',
          idempotencyKey: 'out-of-range',
        }),
      ).rejects.toThrow(/outside this session/);
    });
  });

  // ---------------------------------------------------------- recovery

  describe('session recovery (§4.4)', () => {
    it('resumes at the exact position with every saved answer', async () => {
      await publishQuestions(4);
      await publishAssessment(3);
      const started = await startSession({ deps: deps(), learner: learner(), assessmentId });

      await submitAnswer({
        deps: deps(),
        learner: learner(),
        sessionId: started.sessionId,
        presentationIndex: 0,
        selectedOption: 'A',
        idempotencyKey: 'resume-1',
      });

      // A "browser crash": nothing client-side survives, and the server is asked
      // again from scratch.
      const resumed = await resumeSession({
        deps: deps(),
        learner: learner(),
        sessionId: started.sessionId,
      });
      expect(resumed.currentIndex).toBe(1);
      expect(resumed.totalQuestions).toBe(3);
      expect(resumed.firstQuestion.presentationIndex).toBe(1);

      const answers = await prisma.quizResponse.findMany({
        where: { sessionId: started.sessionId, isLatest: true },
      });
      expect(answers).toHaveLength(1);
    });

    it('resumes a session where every question is answered but Finish was never pressed', async () => {
      // The state a learner reaches by answering the last question and closing
      // the tab: §4.5 advances the cursor past each answer, so it sits at
      // totalQuestions, and the session stays IN_PROGRESS until completion.
      //
      // Reading that cursor literally threw NOT_FOUND — "no snapshot question
      // at index 3" — so the one attempt a learner is most likely to return to
      // was the one that could not be reopened. Found in the browser, on a
      // session with four of four answered.
      await publishQuestions(4);
      await publishAssessment(3);
      const started = await startSession({ deps: deps(), learner: learner(), assessmentId });

      for (const index of [0, 1, 2]) {
        await submitAnswer({
          deps: deps(),
          learner: learner(),
          sessionId: started.sessionId,
          presentationIndex: index,
          selectedOption: 'A',
          idempotencyKey: `all-answered-${index}`,
        });
      }

      const session = await prisma.quizSession.findUniqueOrThrow({
        where: { id: started.sessionId },
      });
      expect(session.currentIndex).toBe(3);
      expect(session.totalQuestions).toBe(3);
      expect(session.status).toBe('IN_PROGRESS');

      // Both entry points have to work: the quiz page reads the current
      // question, and the Resume button goes through session start.
      const current = await currentQuestion({
        deps: deps(),
        learner: learner(),
        sessionId: started.sessionId,
      });
      expect(current.answeredCount).toBe(3);
      expect(current.totalQuestions).toBe(3);
      // The LAST question, with the answer already saved against it, so the
      // learner can change it before finishing.
      expect(current.currentIndex).toBe(2);
      expect(current.question.presentationIndex).toBe(2);
      expect(current.question.selectedOption).toBe('A');
      // And never "Question 4 of 3".
      expect(current.currentIndex).toBeLessThan(current.totalQuestions);

      const resumed = await startSession({ deps: deps(), learner: learner(), assessmentId });
      expect(resumed.resumed).toBe(true);
      expect(resumed.sessionId).toBe(started.sessionId);
      expect(resumed.currentIndex).toBe(2);
      expect(resumed.firstQuestion.presentationIndex).toBe(2);

      // Resuming must not have completed, scored, or otherwise touched it.
      expect(await prisma.assessmentResult.count()).toBe(0);
      const after = await prisma.quizSession.findUniqueOrThrow({
        where: { id: started.sessionId },
      });
      expect(after.status).toBe('IN_PROGRESS');
      expect(after.currentIndex).toBe(3);
    });

    it('still completes normally from the fully answered state', async () => {
      // The clamp must not turn "all answered" into a state the learner cannot
      // leave: Finish has to score exactly as it would have before.
      await publishQuestions(3);
      await publishAssessment(2);
      const started = await startSession({ deps: deps(), learner: learner(), assessmentId });

      for (const index of [0, 1]) {
        await submitAnswer({
          deps: deps(),
          learner: learner(),
          sessionId: started.sessionId,
          presentationIndex: index,
          selectedOption: 'A',
          idempotencyKey: `finish-after-all-${index}`,
        });
      }

      const completion = await completeSession({
        deps: deps(),
        learner: learner(),
        sessionId: started.sessionId,
      });
      expect(completion.unansweredCount).toBe(0);
      expect(completion.totalQuestions).toBe(2);
      expect(completion.resultState).toBe('SCORED');
    });

    it('starting again returns the SAME in-progress session, not a second one', async () => {
      await publishQuestions(4);
      await publishAssessment(3);
      const first = await startSession({ deps: deps(), learner: learner(), assessmentId });
      const again = await startSession({ deps: deps(), learner: learner(), assessmentId });

      expect(again.sessionId).toBe(first.sessionId);
      expect(again.resumed).toBe(true);
      expect(await prisma.quizSession.count()).toBe(1);
    });

    it('derives a session id deterministically, so a retried start is the same session', () => {
      const args = {
        learnerUserId: 'u1',
        assessmentVersionId: 'v1',
        attemptNumber: 1,
        idempotencyKey: 'k1',
      };
      expect(deriveSessionId(args)).toBe(deriveSessionId(args));
      expect(deriveSessionId(args)).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(deriveSessionId({ ...args, attemptNumber: 2 })).not.toBe(deriveSessionId(args));
    });

    it('audits a recovery with its reason', async () => {
      await publishQuestions(3);
      await publishAssessment(2);
      const started = await startSession({ deps: deps(), learner: learner(), assessmentId });

      const recovered = await recordSessionRecovery({
        deps: deps(),
        learner: learner(),
        sessionId: started.sessionId,
        reason: 'The snapshot row was unreadable after an infrastructure failure.',
      });
      expect(recovered.recoveryCount).toBe(1);

      const event = await prisma.auditEvent.findFirstOrThrow({
        where: { action: 'LEARNING.SESSION.RECOVERED', entityId: started.sessionId },
      });
      expect(event.detail).toMatchObject({ recoveryCount: 1 });
    });

    it('refuses to read another learner’s session', async () => {
      await publishQuestions(3);
      await publishAssessment(2);
      const started = await startSession({ deps: deps(), learner: learner(), assessmentId });

      await expect(
        currentQuestion({
          deps: deps(),
          learner: learner({ userId: authorId }),
          sessionId: started.sessionId,
        }),
      ).rejects.toThrow(/belongs to you/);
    });
  });

  // ------------------------------------------------- completion and scoring

  describe('completion, scoring, and results', () => {
    /** Answers every question in a session, choosing the key or not. */
    const answerAll = async (sessionId: string, correctly: boolean): Promise<void> => {
      const snapshot = await prisma.quizSessionQuestion.findMany({
        where: { sessionId },
        orderBy: { presentationIndex: 'asc' },
      });
      for (const row of snapshot) {
        const key = (row.answerPayload as { correctOption: 'A' | 'B' | 'C' | 'D' }).correctOption;
        const wrong = (['A', 'B', 'C', 'D'] as const).find((option) => option !== key) ?? 'A';
        await submitAnswer({
          deps: deps(),
          learner: learner(),
          sessionId,
          presentationIndex: row.presentationIndex,
          selectedOption: correctly ? key : wrong,
          idempotencyKey: `auto-${row.presentationIndex}-${correctly ? 'right' : 'wrong'}`,
        });
      }
    };

    it('scores a perfect attempt and records topic performance', async () => {
      await publishQuestions(3);
      await publishAssessment(2);
      const started = await startSession({ deps: deps(), learner: learner(), assessmentId });
      await answerAll(started.sessionId, true);

      const result = await completeSession({
        deps: deps(),
        learner: learner(),
        sessionId: started.sessionId,
      });
      expect(result.percentageScore).toBe(100);
      expect(result.passed).toBe(true);
      expect(result.proficiencyBand).toBe('EXPERT');
      expect(result.correctAnswers).toBe(2);
      expect(result.unansweredCount).toBe(0);
      expect(result.topics).toHaveLength(1);
      expect(result.topics[0]?.topicAccuracy).toBe(100);
      expect(result.knowledgeGaps).toEqual([]);

      const session = await prisma.quizSession.findUniqueOrThrow({
        where: { id: started.sessionId },
      });
      expect(session.status).toBe('COMPLETED');
      expect(session.completedAt).not.toBeNull();
    });

    it('scores a failed attempt and reports the knowledge gap', async () => {
      await publishQuestions(3);
      await publishAssessment(2);
      const started = await startSession({ deps: deps(), learner: learner(), assessmentId });
      await answerAll(started.sessionId, false);

      const result = await completeSession({
        deps: deps(),
        learner: learner(),
        sessionId: started.sessionId,
      });
      expect(result.percentageScore).toBe(0);
      expect(result.passed).toBe(false);
      expect(result.proficiencyBand).toBe('CRITICAL_KNOWLEDGE_GAP');
      expect(result.knowledgeGaps).toEqual([topicId]);
      expect(result.topics[0]?.gapState).toBe('GAP');
    });

    it('counts unanswered questions as incorrect on an incomplete attempt', async () => {
      await publishQuestions(4);
      await publishAssessment(3);
      const started = await startSession({ deps: deps(), learner: learner(), assessmentId });

      const snapshot = await prisma.quizSessionQuestion.findMany({
        where: { sessionId: started.sessionId },
        orderBy: { presentationIndex: 'asc' },
      });
      const key = (snapshot[0]!.answerPayload as { correctOption: 'A' | 'B' | 'C' | 'D' })
        .correctOption;
      await submitAnswer({
        deps: deps(),
        learner: learner(),
        sessionId: started.sessionId,
        presentationIndex: 0,
        selectedOption: key,
        idempotencyKey: 'partial-1',
      });

      const result = await completeSession({
        deps: deps(),
        learner: learner(),
        sessionId: started.sessionId,
      });
      expect(result.totalQuestions).toBe(3);
      expect(result.correctAnswers).toBe(1);
      expect(result.unansweredCount).toBe(2);
      expect(result.percentageScore).toBe(33.33);
    });

    it('is idempotent: a second complete returns the same result id', async () => {
      await publishQuestions(3);
      await publishAssessment(2);
      const started = await startSession({ deps: deps(), learner: learner(), assessmentId });
      await answerAll(started.sessionId, true);

      const first = await completeSession({
        deps: deps(),
        learner: learner(),
        sessionId: started.sessionId,
      });
      const second = await completeSession({
        deps: deps(),
        learner: learner(),
        sessionId: started.sessionId,
      });
      expect(second.resultId).toBe(first.resultId);
      expect(second.replayed).toBe(true);
      expect(await prisma.assessmentResult.count()).toBe(1);
    });

    it('refuses an answer after completion', async () => {
      await publishQuestions(3);
      await publishAssessment(2);
      const started = await startSession({ deps: deps(), learner: learner(), assessmentId });
      await answerAll(started.sessionId, true);
      await completeSession({ deps: deps(), learner: learner(), sessionId: started.sessionId });

      await expect(
        submitAnswer({
          deps: deps(),
          learner: learner(),
          sessionId: started.sessionId,
          presentationIndex: 0,
          selectedOption: 'A',
          idempotencyKey: 'after-complete',
        }),
      ).rejects.toThrow(SessionNotActiveError);
    });

    it('copies the threshold set onto the result, so it stays interpretable', async () => {
      await publishQuestions(3);
      await publishAssessment(2);
      const started = await startSession({ deps: deps(), learner: learner(), assessmentId });
      await answerAll(started.sessionId, true);
      const result = await completeSession({
        deps: deps(),
        learner: learner(),
        sessionId: started.sessionId,
      });

      const stored = await prisma.assessmentResult.findUniqueOrThrow({
        where: { id: result.resultId },
      });
      const thresholds = stored.appliedThresholds as { band: string }[];
      expect(thresholds.map((band) => band.band)).toContain('EXPERT');
      expect(Number(stored.passPercentageApplied)).toBe(70);
      expect(stored.scoringEngineVersion).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('serves the result with topic performance and no answer key', async () => {
      await publishQuestions(3);
      await publishAssessment(2);
      const started = await startSession({ deps: deps(), learner: learner(), assessmentId });
      await answerAll(started.sessionId, true);
      const completed = await completeSession({
        deps: deps(),
        learner: learner(),
        sessionId: started.sessionId,
      });

      const view = await readResult({
        deps: deps(),
        learner: learner(),
        resultId: completed.resultId,
      });
      expect(view.percentageScore).toBe(100);
      expect(view.topics[0]?.topicName.length).toBeGreaterThan(0);
      expect(() => assertNoAnswerKey(view, 'test')).not.toThrow();
    });

    it('refuses to serve another learner’s result', async () => {
      await publishQuestions(3);
      await publishAssessment(2);
      const started = await startSession({ deps: deps(), learner: learner(), assessmentId });
      await answerAll(started.sessionId, true);
      const completed = await completeSession({
        deps: deps(),
        learner: learner(),
        sessionId: started.sessionId,
      });

      await expect(
        readResult({
          deps: deps(),
          learner: learner({ userId: authorId }),
          resultId: completed.resultId,
        }),
      ).rejects.toThrow();
    });

    it('audits the scored result', async () => {
      await publishQuestions(3);
      await publishAssessment(2);
      const started = await startSession({ deps: deps(), learner: learner(), assessmentId });
      await answerAll(started.sessionId, true);
      const completed = await completeSession({
        deps: deps(),
        learner: learner(),
        sessionId: started.sessionId,
      });

      const event = await prisma.auditEvent.findFirstOrThrow({
        where: { action: 'LEARNING.RESULT.SCORED', entityId: completed.resultId },
      });
      expect(event.detail).toMatchObject({ percentageScore: 100, passed: true });
      // The CHOICES are not in audit; they live on QuizResponse.
      const answerEvents = await prisma.auditEvent.findMany({
        where: { action: 'LEARNING.SESSION.ANSWER_SAVED', entityId: started.sessionId },
      });
      expect(answerEvents.length).toBe(2);
      for (const answer of answerEvents) {
        expect(JSON.stringify(answer.detail)).not.toMatch(/selectedOption/);
      }
    });

    it('expires a session and scores what was submitted', async () => {
      await publishQuestions(4);
      await publishAssessment(3);
      const started = await startSession({ deps: deps(), learner: learner(), assessmentId });

      const snapshot = await prisma.quizSessionQuestion.findMany({
        where: { sessionId: started.sessionId },
        orderBy: { presentationIndex: 'asc' },
      });
      const key = (snapshot[0]!.answerPayload as { correctOption: 'A' | 'B' | 'C' | 'D' })
        .correctOption;
      await submitAnswer({
        deps: deps(),
        learner: learner(),
        sessionId: started.sessionId,
        presentationIndex: 0,
        selectedOption: key,
        idempotencyKey: 'expiry-1',
      });

      const expired = await expireSession({
        deps: deps(),
        learner: learner(),
        sessionId: started.sessionId,
      });
      expect(expired.status).toBe('EXPIRED');
      expect(expired.resultId).not.toBeNull();

      const result = await prisma.assessmentResult.findFirstOrThrow({
        where: { sessionId: started.sessionId },
      });
      // Labelled EXPIRED, scored with unanswered counted incorrect.
      expect(result.resultState).toBe('EXPIRED');
      expect(result.correctAnswers).toBe(1);
      expect(result.unansweredCount).toBe(2);
    });

    it('refuses an answer once the deadline has passed', async () => {
      await publishQuestions(3);
      await publishAssessment(2);
      const started = await startSession({ deps: deps(), learner: learner(), assessmentId });

      // The SERVER holds the deadline; a client cannot extend it.
      await prisma.quizSession.update({
        where: { id: started.sessionId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await expect(
        submitAnswer({
          deps: deps(),
          learner: learner(),
          sessionId: started.sessionId,
          presentationIndex: 0,
          selectedOption: 'A',
          idempotencyKey: 'too-late',
        }),
      ).rejects.toThrow(SessionNotActiveError);
    });
  });

  // -------------------------------------------------------- eligibility

  describe('eligibility (§3.2)', () => {
    it('refuses a learner without the permission', async () => {
      await publishQuestions(3);
      await publishAssessment(2);
      await expect(
        startSession({
          deps: deps(),
          learner: learner({ permissions: ['learning.access'] }),
          assessmentId,
        }),
      ).rejects.toThrow(NotEligibleError);
    });

    it('refuses an assessment outside its availability window', async () => {
      await publishQuestions(3);
      await publishAssessment(2);
      await prisma.assessmentVersion.update({
        where: { id: assessmentVersionId },
        data: { availabilityEnd: new Date(Date.now() - 60_000) },
      });
      await expect(
        startSession({ deps: deps(), learner: learner(), assessmentId }),
      ).rejects.toThrow(/has closed/);
    });

    it('refuses once the attempt limit is reached', async () => {
      await publishQuestions(3);
      await publishAssessment(2);
      await prisma.assessmentVersion.update({
        where: { id: assessmentVersionId },
        data: { attemptLimit: 1 },
      });

      const first = await startSession({ deps: deps(), learner: learner(), assessmentId });
      const snapshot = await prisma.quizSessionQuestion.findMany({
        where: { sessionId: first.sessionId },
      });
      for (const row of snapshot) {
        await submitAnswer({
          deps: deps(),
          learner: learner(),
          sessionId: first.sessionId,
          presentationIndex: row.presentationIndex,
          selectedOption: 'A',
          idempotencyKey: `limit-${row.presentationIndex}`,
        });
      }
      await completeSession({ deps: deps(), learner: learner(), sessionId: first.sessionId });

      await expect(
        startSession({ deps: deps(), learner: learner(), assessmentId }),
      ).rejects.toThrow(/used all 1 attempt/);
    });
  });
});
