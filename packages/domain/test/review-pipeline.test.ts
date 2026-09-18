// The review, approval, and publishing pipeline, against a real database.
//
// Draft → Review → Approval → Publication, plus every refusal on the way.
//
// The discipline here is the same as M3's: each gate and each separation-of-
// duties policy is made to FAIL in isolation from a passing baseline. A test
// suite where the happy path passes proves that the happy path works; it proves
// nothing about the thirteen things that are supposed to stop it.

import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { systemClock } from '@knowzy/observability';
import {
  createMockQuestionBankAdapter,
  BankPreconditionFailedError,
  type QuestionBankAdapter,
} from '@knowzy/knowledge-source-adapters';
import {
  addReview,
  createGenerationJob,
  dispositionDuplicate,
  editDraftQuestion,
  evaluateApprovalGates,
  evaluateApprovalSeparation,
  evaluatePublishSeparation,
  evaluateGatesForQuestion,
  operationKeyFor,
  publishApprovedQuestions,
  readVersionHistory,
  requireTransition,
  retirePublishedQuestion,
  runGenerationJob,
  transitionQuestion,
  BreakGlassNotPermittedError,
  CommentRequiredError,
  DEFAULT_SEPARATION_POLICIES,
  EvidenceBrokenByEditError,
  GatesFailedError,
  NotEditableError,
  PermissionRequiredError,
  TRANSITIONS,
  TransitionNotPermittedError,
  type ActorContext,
  type GateSourceState,
  type GateSubject,
  type PublishTarget,
  type ReviewDeps,
} from '../src/index.js';

const DATABASE_URL = process.env['DATABASE_URL'];
const describeDb = DATABASE_URL ? describe : describe.skip;

const prisma = new PrismaClient(
  DATABASE_URL ? { datasources: { db: { url: DATABASE_URL } } } : undefined,
);

const ALL_PERMISSIONS = [
  'question.read',
  'question.edit',
  'question.submit',
  'question.review',
  'question.approve',
  'question.publish',
  'question.retire',
  'question.archive',
  'platform.configure',
];

const actor = (userId: string, overrides: Partial<ActorContext> = {}): ActorContext => ({
  userId,
  displayName: `Test ${userId.slice(0, 8)}`,
  roles: ['CONTENT_AUTHOR'],
  permissions: ALL_PERMISSIONS,
  correlationId: 'review-test',
  requestId: 'review-request',
  ...overrides,
});

describeDb('review, approval, and publishing pipeline', () => {
  let authorId = '';
  let approverId = '';
  let publisherId = '';
  let documentId = '';
  let domainId = '';
  let topicId = '';
  let sourceId = '';
  let bankRoot = '';
  let bank: QuestionBankAdapter;
  let target: PublishTarget;

  const deps = (): ReviewDeps => ({ prisma, clock: systemClock });

  beforeAll(async () => {
    const source = await prisma.knowledgeSource.findFirstOrThrow({
      where: { sourceType: 'MOCK' },
      select: { id: true },
    });
    sourceId = source.id;

    const document = await prisma.knowledgeDocument.findFirstOrThrow({
      where: { sourceId, name: 'incident-escalation.md', extractionStatus: 'EXTRACTED' },
      select: { id: true },
    });
    documentId = document.id;

    const topic = await prisma.topic.findFirstOrThrow({
      where: { isActive: true },
      select: { id: true, domainId: true },
    });
    topicId = topic.id;
    domainId = topic.domainId;

    const users = await prisma.user.findMany({
      where: {
        userPrincipalName: {
          in: ['author@local.invalid', 'approver@local.invalid', 'publisher@local.invalid'],
        },
      },
      select: { id: true, userPrincipalName: true },
    });
    authorId = users.find((u) => u.userPrincipalName === 'author@local.invalid')?.id ?? '';
    approverId = users.find((u) => u.userPrincipalName === 'approver@local.invalid')?.id ?? '';
    publisherId = users.find((u) => u.userPrincipalName === 'publisher@local.invalid')?.id ?? '';
    expect(authorId && approverId && publisherId).toBeTruthy();

    // A throwaway bank per suite run, so one run's items cannot satisfy
    // another's idempotency checks and hide a real regression.
    bankRoot = mkdtempSync(join(tmpdir(), 'knowzy-bank-'));
    bank = createMockQuestionBankAdapter({ fixtureRoot: bankRoot });
    target = {
      targetSiteId: 'test-site',
      targetListId: 'test-question-bank',
      writesEnabled: true,
      dryRunReason: null,
    };
  });

  afterAll(async () => {
    rmSync(bankRoot, { recursive: true, force: true });
    await prisma.documentSection.updateMany({
      where: { documentId },
      data: { isAssessable: true, coverageStatus: 'NOT_COVERED', nonAssessableReason: null },
    });
    await prisma.$disconnect();
  });

  /** A fresh DRAFT question, generated through the real pipeline. */
  const freshDraft = async (): Promise<string> => {
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
        correlationId: 'review-test',
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
      requestedQuestionCount: 1,
      actor: {
        userId: authorId,
        displayName: 'Author',
        roles: ['CONTENT_AUTHOR'],
        permissions: ['question.generate'],
      },
      correlationId: 'review-test',
      requestId: 'review-request',
    });

    const result = await runGenerationJob({
      prisma,
      clock: systemClock,
      scope: created.resolvedScope,
      profile: created.profile,
      requestedQuestionCount: 1,
      context: {
        jobId: created.jobId,
        sourceId: created.sourceId,
        domainId,
        topicId,
        correlationId: 'review-test',
        requestId: 'review-request',
        actorUserId: authorId,
        actorDisplayName: 'Author',
        actorRoles: ['CONTENT_AUTHOR'],
        reasonCode: 'NEW_KNOWLEDGE',
      },
    });

    const questionId = result.acceptedQuestionIds[0];
    expect(questionId).toBeTruthy();
    return questionId ?? '';
  };

  /** Clears everything this suite creates, so each test starts from zero. */
  let listCounter = 0;
  beforeEach(async () => {
    // A FRESH bank list per test. The bank persists to disk, so a shared list
    // would let one test's item satisfy the next test's existence check — which
    // is exactly the failure that hid a real id-sequence defect.
    listCounter += 1;
    target = { ...target, targetListId: `test-question-bank-${listCounter}` };
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

  /** Walks a draft to APPROVED with distinct author and approver. */
  const approvedQuestion = async (): Promise<string> => {
    const questionId = await freshDraft();
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
    return questionId;
  };

  // ======================================================= the state machine

  describe('the transition table', () => {
    it('declares a permission and an audit path for every non-system transition', () => {
      for (const rule of TRANSITIONS) {
        if (rule.from === 'GENERATED') continue;
        expect(rule.permission, `${rule.from}->${rule.to}`).not.toBeNull();
        expect(rule.summary.length).toBeGreaterThan(5);
      }
    });

    it('requires a comment on every refusal and on retirement', () => {
      const mustComment = [
        ['AUTHOR_REVIEW', 'REJECTED'],
        ['SUBMITTED_FOR_APPROVAL', 'CHANGES_REQUESTED'],
        ['SUBMITTED_FOR_APPROVAL', 'REJECTED'],
        ['PUBLISHED', 'RETIRED'],
      ] as const;
      for (const [from, to] of mustComment) {
        expect(requireTransition(from, to, 'a reason').commentRequired, `${from}->${to}`).toBe(true);
      }
    });

    it('gates submit, approve, and publish, and nothing else', () => {
      expect(TRANSITIONS.filter((rule) => rule.gated).map((rule) => `${rule.from}->${rule.to}`)).toEqual([
        'AUTHOR_REVIEW->SUBMITTED_FOR_APPROVAL',
        'SUBMITTED_FOR_APPROVAL->APPROVED',
        'APPROVED->PUBLISHED',
      ]);
    });

    it('does NOT permit archiving a published question — retire first', () => {
      expect(() => requireTransition('PUBLISHED', 'ARCHIVED', null)).toThrow(
        TransitionNotPermittedError,
      );
      expect(() => requireTransition('PUBLISHED', 'ARCHIVED', null)).toThrow(/Available: RETIRED/);
    });

    it('refuses an undeclared transition and names what is available', () => {
      expect(() => requireTransition('DRAFT', 'APPROVED', null)).toThrow(
        /cannot move to APPROVED. Available: AUTHOR_REVIEW/,
      );
    });

    it('treats ARCHIVED as terminal', () => {
      expect(() => requireTransition('ARCHIVED', 'DRAFT', null)).toThrow(/terminal state/);
    });

    it('refuses a comment-required transition with no comment', () => {
      expect(() => requireTransition('SUBMITTED_FOR_APPROVAL', 'REJECTED', null)).toThrow(
        CommentRequiredError,
      );
      expect(() => requireTransition('SUBMITTED_FOR_APPROVAL', 'REJECTED', '   ')).toThrow(
        CommentRequiredError,
      );
    });
  });

  // ============================================================== the gates

  describe('the 13 gates, each failed in isolation', () => {
    const baseSubject = (): GateSubject => ({
      questionId: 'q',
      version: 1,
      questionText: 'Within how long must a severity one incident reach the duty manager?',
      options: { A: 'Fifteen minutes', B: 'One hour', C: 'One business day', D: 'End of shift' },
      correctOption: 'A',
      explanation: 'The procedure sets a fifteen-minute limit for informing the duty manager.',
      domainId: 'd',
      topicId: 't',
      sourceMetadata: { Owner: 'Network Operations' },
      supportingEvidence: 'the duty manager within fifteen minutes of the first report of an incident',
      evidenceStartOffset: 0,
      evidenceEndOffset: 74,
      sectionKey: 'sk',
      sourceContentHash: 'hash-at-generation',
      maxSimilarityScore: 0.2,
      duplicateDisposition: null,
      authorUserId: 'author',
      lastEditorUserId: 'author',
      needsRevalidation: false,
    });

    const baseSource = (): GateSourceState => ({
      documentFound: true,
      documentStatus: 'ACTIVE',
      sourceIsActive: true,
      currentContentHash: 'hash-at-generation',
      section: {
        sectionKey: 'sk',
        text: 'the duty manager within fifteen minutes of the first report of an incident, and the agent records it.',
        startOffset: 0,
      },
      evidenceMode: 'STRICT',
    });

    const basePolicy = () => ({
      minQuestionTextLength: 15,
      requiredMetadataFields: [] as readonly string[],
      duplicateFlagThreshold: 0.75,
      separationOfDuties: { permitted: true, reason: 'distinct people' },
      separationApplies: true,
      smeSignoffRequired: false,
      smeEndorsedVersion: null,
    });

    it('passes the baseline, so each failure below is caused by one change', () => {
      const result = evaluateApprovalGates(baseSubject(), baseSource(), basePolicy());
      expect(result.failures, JSON.stringify(result.failures)).toEqual([]);
      expect(result.passed).toBe(true);
      expect(result.results).toHaveLength(13);
    });

    it('gate 1 — evidence missing', () => {
      const result = evaluateApprovalGates(
        { ...baseSubject(), supportingEvidence: '' },
        baseSource(),
        basePolicy(),
      );
      expect(result.failures.map((f) => f.code)).toContain('EVIDENCE_MISSING');
    });

    it('gate 2 — question text below the configured minimum', () => {
      const result = evaluateApprovalGates(
        { ...baseSubject(), questionText: 'Too short?' },
        baseSource(),
        { ...basePolicy(), minQuestionTextLength: 40 },
      );
      const failure = result.failures.find((f) => f.code === 'QUESTION_INCOMPLETE');
      expect(failure?.detail).toContain('minimum is 40');
      expect(failure?.field).toBe('questionText');
    });

    it('gate 3 — an option is blank', () => {
      const subject = baseSubject();
      const result = evaluateApprovalGates(
        { ...subject, options: { ...subject.options, C: '   ' } },
        baseSource(),
        basePolicy(),
      );
      expect(result.failures.find((f) => f.code === 'OPTION_MISSING')?.detail).toContain('C');
    });

    it('gate 4 — two options identical after normalization', () => {
      const subject = baseSubject();
      const result = evaluateApprovalGates(
        { ...subject, options: { ...subject.options, D: 'fifteen  MINUTES' } },
        baseSource(),
        basePolicy(),
      );
      // A/D differ only by case and spacing, which is what normalization is for.
      expect(result.failures.find((f) => f.code === 'OPTION_DUPLICATE')?.detail).toContain('A/D');
    });

    it('gate 5 — the correct answer is not one of A-D', () => {
      const result = evaluateApprovalGates(
        { ...baseSubject(), correctOption: 'E' },
        baseSource(),
        basePolicy(),
      );
      expect(result.failures.map((f) => f.code)).toContain('ANSWER_INVALID');
    });

    it('gate 6 — the explanation is missing', () => {
      const result = evaluateApprovalGates(
        { ...baseSubject(), explanation: '  ' },
        baseSource(),
        basePolicy(),
      );
      expect(result.failures.map((f) => f.code)).toContain('EXPLANATION_MISSING');
    });

    it('gates 7 and 8 — domain and topic', () => {
      const result = evaluateApprovalGates(
        { ...baseSubject(), domainId: null, topicId: null },
        baseSource(),
        basePolicy(),
      );
      expect(result.failures.map((f) => f.code)).toEqual(
        expect.arrayContaining(['DOMAIN_MISSING', 'TOPIC_MISSING']),
      );
    });

    it('gate 9 — a configured required metadata field is missing', () => {
      const result = evaluateApprovalGates(baseSubject(), baseSource(), {
        ...basePolicy(),
        requiredMetadataFields: ['Owner', 'ReviewCycle'],
      });
      const failure = result.failures.find((f) => f.code === 'METADATA_MISSING');
      // Owner is present; ReviewCycle is not.
      expect(failure?.detail).toContain('ReviewCycle');
      expect(failure?.detail).not.toContain('Owner');
    });

    it('gate 10 — flagged as similar and not dispositioned', () => {
      const result = evaluateApprovalGates(
        { ...baseSubject(), maxSimilarityScore: 0.81 },
        baseSource(),
        basePolicy(),
      );
      expect(result.failures.find((f) => f.code === 'DUPLICATE_THRESHOLD_EXCEEDED')?.detail).toContain(
        '0.810',
      );
    });

    it('gate 10 — dispositioned DISTINCT unblocks it', () => {
      const result = evaluateApprovalGates(
        { ...baseSubject(), maxSimilarityScore: 0.81, duplicateDisposition: 'DISTINCT' },
        baseSource(),
        basePolicy(),
      );
      expect(result.failures.map((f) => f.code)).not.toContain('DUPLICATE_THRESHOLD_EXCEEDED');
    });

    it('gate 10 — dispositioned DUPLICATE is NOT a pass', () => {
      // Recording the judgement does not make the question publishable; it
      // records that it should not be.
      const result = evaluateApprovalGates(
        { ...baseSubject(), maxSimilarityScore: 0.81, duplicateDisposition: 'DUPLICATE' },
        baseSource(),
        basePolicy(),
      );
      expect(result.failures.find((f) => f.code === 'DUPLICATE_THRESHOLD_EXCEEDED')?.detail).toContain(
        'Reject it instead',
      );
    });

    it('gate 11 — the source document is gone', () => {
      const result = evaluateApprovalGates(
        baseSubject(),
        { ...baseSource(), documentFound: false, section: null },
        basePolicy(),
      );
      expect(result.failures.map((f) => f.code)).toContain('SOURCE_INACCESSIBLE');
    });

    it('gate 11 — the knowledge source is inactive', () => {
      const result = evaluateApprovalGates(
        baseSubject(),
        { ...baseSource(), sourceIsActive: false },
        basePolicy(),
      );
      expect(result.failures.map((f) => f.code)).toContain('SOURCE_INACCESSIBLE');
    });

    it('gate 12 — the span no longer re-locates in the current text', () => {
      const result = evaluateApprovalGates(
        baseSubject(),
        {
          ...baseSource(),
          section: {
            sectionKey: 'sk',
            text: 'The procedure was rewritten and no longer states any notification timeframe at all.',
            startOffset: 0,
          },
        },
        basePolicy(),
      );
      expect(result.failures.find((f) => f.code === 'SOURCE_VALIDATION_FAILED')?.detail).toContain(
        'no longer re-locates',
      );
    });

    it('gate 12 — a changed hash with revalidation pending fails', () => {
      const result = evaluateApprovalGates(
        { ...baseSubject(), needsRevalidation: true },
        { ...baseSource(), currentContentHash: 'a-different-hash' },
        basePolicy(),
      );
      expect(result.failures.find((f) => f.code === 'SOURCE_VALIDATION_FAILED')?.detail).toContain(
        'flagged for revalidation',
      );
    });

    it('gate 13 — separation of duties', () => {
      const result = evaluateApprovalGates(baseSubject(), baseSource(), {
        ...basePolicy(),
        separationOfDuties: { permitted: false, reason: 'the approver is the original author' },
      });
      expect(result.failures.find((f) => f.code === 'SEPARATION_OF_DUTIES')?.detail).toContain(
        'original author',
      );
    });

    it('the SME gate applies only when the domain requires sign-off', () => {
      const without = evaluateApprovalGates(baseSubject(), baseSource(), basePolicy());
      expect(without.results.map((r) => r.code)).not.toContain('SME_SIGNOFF_REQUIRED');

      const requiredNoEndorsement = evaluateApprovalGates(baseSubject(), baseSource(), {
        ...basePolicy(),
        smeSignoffRequired: true,
      });
      expect(requiredNoEndorsement.failures.map((r) => r.code)).toContain('SME_SIGNOFF_REQUIRED');

      // Version-bound: an endorsement for v1 does not carry to v2.
      const stale = evaluateApprovalGates({ ...baseSubject(), version: 2 }, baseSource(), {
        ...basePolicy(),
        smeSignoffRequired: true,
        smeEndorsedVersion: 1,
      });
      expect(stale.failures.find((r) => r.code === 'SME_SIGNOFF_REQUIRED')?.detail).toContain(
        'Editing invalidated it',
      );
    });

    it('reports EVERY failure at once, not the first', () => {
      const subject = baseSubject();
      const result = evaluateApprovalGates(
        {
          ...subject,
          questionText: '',
          explanation: '',
          domainId: null,
          options: { ...subject.options, B: '' },
        },
        baseSource(),
        basePolicy(),
      );
      expect(result.failures.map((f) => f.code).sort()).toEqual([
        'DOMAIN_MISSING',
        'EXPLANATION_MISSING',
        'OPTION_MISSING',
        'QUESTION_INCOMPLETE',
      ]);
    });
  });

  // =============================================== separation of duties

  describe('separation of duties (§3.4)', () => {
    it('refuses the author approving their own question, by default', () => {
      const decision = evaluateApprovalSeparation({
        approverUserId: 'u1',
        approverRoles: ['QUIZ_APPROVER'],
        approverPermissions: ['question.approve'],
        authorUserId: 'u1',
        lastEditorUserId: 'u2',
        policies: DEFAULT_SEPARATION_POLICIES,
      });
      expect(decision.permitted).toBe(false);
      expect(decision.reason).toContain('original author');
    });

    it('refuses the last editor approving, by default', () => {
      const decision = evaluateApprovalSeparation({
        approverUserId: 'u2',
        approverRoles: ['QUIZ_APPROVER'],
        approverPermissions: ['question.approve'],
        authorUserId: 'u1',
        lastEditorUserId: 'u2',
        policies: DEFAULT_SEPARATION_POLICIES,
      });
      expect(decision.permitted).toBe(false);
      expect(decision.reason).toContain('last editor');
    });

    it('permits a distinct approver', () => {
      expect(
        evaluateApprovalSeparation({
          approverUserId: 'u3',
          approverRoles: ['QUIZ_APPROVER'],
          approverPermissions: ['question.approve'],
          authorUserId: 'u1',
          lastEditorUserId: 'u2',
          policies: DEFAULT_SEPARATION_POLICIES,
        }).permitted,
      ).toBe(true);
    });

    it('permits self-approval when a tenant turns it on', () => {
      expect(
        evaluateApprovalSeparation({
          approverUserId: 'u1',
          approverRoles: ['QUIZ_APPROVER'],
          approverPermissions: ['question.approve'],
          authorUserId: 'u1',
          lastEditorUserId: 'u1',
          policies: {
            ...DEFAULT_SEPARATION_POLICIES,
            authorMayApproveOwn: true,
            editorMayApproveOwn: true,
          },
        }).permitted,
      ).toBe(true);
    });

    it('refuses break-glass when it is disabled', () => {
      expect(() =>
        evaluateApprovalSeparation({
          approverUserId: 'u1',
          approverRoles: ['PLATFORM_ADMINISTRATOR'],
          approverPermissions: ['question.approve', 'platform.configure'],
          authorUserId: 'u1',
          lastEditorUserId: 'u1',
          policies: DEFAULT_SEPARATION_POLICIES,
          breakGlass: { justification: 'A long enough justification for the override request.' },
        }),
      ).toThrow(BreakGlassNotPermittedError);
    });

    it('refuses break-glass from a non-administrator', () => {
      expect(() =>
        evaluateApprovalSeparation({
          approverUserId: 'u1',
          approverRoles: ['QUIZ_APPROVER'],
          approverPermissions: ['question.approve'],
          authorUserId: 'u1',
          lastEditorUserId: 'u1',
          policies: { ...DEFAULT_SEPARATION_POLICIES, breakGlassEnabled: true },
          breakGlass: { justification: 'A long enough justification for the override request.' },
        }),
      ).toThrow(/Platform Administrator/);
    });

    it('refuses break-glass with a thin justification', () => {
      expect(() =>
        evaluateApprovalSeparation({
          approverUserId: 'u1',
          approverRoles: ['PLATFORM_ADMINISTRATOR'],
          approverPermissions: ['question.approve', 'platform.configure'],
          authorUserId: 'u1',
          lastEditorUserId: 'u1',
          policies: { ...DEFAULT_SEPARATION_POLICIES, breakGlassEnabled: true },
          breakGlass: { justification: 'because' },
        }),
      ).toThrow(/at least 30 characters/);
    });

    it('permits break-glass properly exercised, and says it was an override', () => {
      const decision = evaluateApprovalSeparation({
        approverUserId: 'u1',
        approverRoles: ['PLATFORM_ADMINISTRATOR'],
        approverPermissions: ['question.approve', 'platform.configure'],
        authorUserId: 'u1',
        lastEditorUserId: 'u1',
        policies: { ...DEFAULT_SEPARATION_POLICIES, breakGlassEnabled: true },
        breakGlass: {
          justification: 'The only approver is on leave and this question blocks a compliance deadline.',
        },
      });
      expect(decision.permitted).toBe(true);
      expect(decision.viaBreakGlass).toBe(true);
      expect(decision.reason).toContain('Overridden by break-glass');
    });

    it('never records an override for an approval that did not need one', () => {
      const decision = evaluateApprovalSeparation({
        approverUserId: 'u3',
        approverRoles: ['PLATFORM_ADMINISTRATOR'],
        approverPermissions: ['question.approve', 'platform.configure'],
        authorUserId: 'u1',
        lastEditorUserId: 'u2',
        policies: { ...DEFAULT_SEPARATION_POLICIES, breakGlassEnabled: true },
        breakGlass: { justification: 'A justification long enough to satisfy the minimum length.' },
      });
      expect(decision.permitted).toBe(true);
      // The exception report must only contain real exceptions.
      expect(decision.viaBreakGlass).toBe(false);
    });

    it('permits the approver to publish by default, and refuses when configured otherwise', () => {
      expect(
        evaluatePublishSeparation({
          publisherUserId: 'u1',
          approverUserId: 'u1',
          policies: DEFAULT_SEPARATION_POLICIES,
        }).permitted,
      ).toBe(true);

      expect(
        evaluatePublishSeparation({
          publisherUserId: 'u1',
          approverUserId: 'u1',
          policies: { ...DEFAULT_SEPARATION_POLICIES, approverMayPublishOwn: false },
        }).permitted,
      ).toBe(false);

      expect(
        evaluatePublishSeparation({
          publisherUserId: 'u2',
          approverUserId: 'u1',
          policies: { ...DEFAULT_SEPARATION_POLICIES, approverMayPublishOwn: false },
        }).permitted,
      ).toBe(true);
    });
  });

  // ================================================ the live pipeline

  describe('Draft to Review to Approval to Publication', () => {
    it('walks the whole path and lands a verified bank item', async () => {
      const questionId = await freshDraft();

      const claimed = await transitionQuestion({
        deps: deps(),
        questionId,
        to: 'AUTHOR_REVIEW',
        actor: actor(authorId),
      });
      expect(claimed.from).toBe('DRAFT');

      // An advisory SME review, recorded without changing status.
      const review = await addReview({
        deps: deps(),
        questionId,
        actor: actor(approverId, { roles: ['SUBJECT_MATTER_EXPERT'] }),
        kind: 'SME',
        outcome: 'ENDORSED',
        comment: 'The timeframe matches the procedure as written.',
      });
      expect(review.outcome).toBe('ENDORSED');
      expect(
        (await prisma.draftQuestion.findUniqueOrThrow({ where: { id: questionId } })).status,
      ).toBe('AUTHOR_REVIEW');

      const submitted = await transitionQuestion({
        deps: deps(),
        questionId,
        to: 'SUBMITTED_FOR_APPROVAL',
        actor: actor(authorId),
      });
      expect(submitted.gates?.passed).toBe(true);

      const approved = await transitionQuestion({
        deps: deps(),
        questionId,
        to: 'APPROVED',
        actor: actor(approverId, { roles: ['QUIZ_APPROVER'] }),
        comment: 'Evidence checked against the source.',
      });
      expect(approved.to).toBe('APPROVED');
      expect(approved.viaBreakGlass).toBe(false);

      // The approval carries the gate results AS EVALUATED.
      const approval = await prisma.questionApproval.findFirstOrThrow({ where: { questionId } });
      const gateResults = approval.gateResults as { passed: boolean; results: unknown[] };
      expect(gateResults.passed).toBe(true);
      expect(gateResults.results.length).toBeGreaterThanOrEqual(13);

      const published = await publishApprovedQuestions({
        deps: deps(),
        bank,
        target,
        questionIds: [questionId],
        actor: actor(publisherId, { roles: ['PUBLISHER'] }),
        signal: new AbortController().signal,
      });
      expect(published.dryRun).toBe(false);
      expect(published.publishedCount).toBe(1);
      expect(published.items[0]?.outcome).toBe('PUBLISHED');
      expect(published.items[0]?.bankItemId).toBeTruthy();

      // G9: PUBLISHED locally only WITH a verified item id.
      const reference = await prisma.publishedQuestionReference.findFirstOrThrow({
        where: { question: { id: questionId } },
      });
      expect(reference.sharePointItemId).toBe(published.items[0]?.bankItemId);
      expect(reference.questionId).toMatch(/^KNZ-SUPPORT_OPS-\d{4}-\d{6}$/);
      expect(
        (await prisma.draftQuestion.findUniqueOrThrow({ where: { id: questionId } })).status,
      ).toBe('PUBLISHED');

      // And the item really is in the bank, with the answer key.
      const item = await bank.findByQuestionId(
        {
          targetSiteId: target.targetSiteId,
          targetListId: target.targetListId,
          correlationId: 'c',
          actorUserId: publisherId,
          signal: new AbortController().signal,
        },
        reference.questionId,
      );
      expect(item?.isActive).toBe(true);
      expect(item?.fields['correctAnswer']).toBeTruthy();
    });

    it('audits every step of the path', async () => {
      const questionId = await approvedQuestion();
      await publishApprovedQuestions({
        deps: deps(),
        bank,
        target,
        questionIds: [questionId],
        actor: actor(publisherId, { roles: ['PUBLISHER'] }),
        signal: new AbortController().signal,
      });

      const events = await prisma.auditEvent.findMany({
        where: { entityId: questionId, entityType: 'DraftQuestion' },
        orderBy: { occurredAt: 'asc' },
        select: { action: true },
      });
      expect(events.map((e) => e.action)).toEqual([
        'AUTHORING.QUESTION.CREATED',
        'AUTHORING.QUESTION.EDITED',
        'AUTHORING.QUESTION.SUBMITTED',
        'AUTHORING.QUESTION.APPROVED',
        'AUTHORING.QUESTION.PUBLISHED',
      ]);
      // The before/after status travels in `detail`, not in
      // previousValue/newValue: audit-model.md H2 populates those only for the
      // declared VALUE_DIFF_ACTIONS, and a question transition is not one.
      const detailed = await prisma.auditEvent.findFirstOrThrow({
        where: { entityId: questionId, action: 'AUTHORING.QUESTION.SUBMITTED' },
        select: { detail: true },
      });
      expect(detailed.detail).toMatchObject({
        previousStatus: 'AUTHOR_REVIEW',
        newStatus: 'SUBMITTED_FOR_APPROVAL',
      });
    });
  });

  // ============================================= refusals along the path

  describe('the path refuses what it should', () => {
    it('refuses an approval by the author', async () => {
      const questionId = await freshDraft();
      await transitionQuestion({ deps: deps(), questionId, to: 'AUTHOR_REVIEW', actor: actor(authorId) });
      await transitionQuestion({
        deps: deps(),
        questionId,
        to: 'SUBMITTED_FOR_APPROVAL',
        actor: actor(authorId),
      });

      await expect(
        transitionQuestion({
          deps: deps(),
          questionId,
          to: 'APPROVED',
          actor: actor(authorId, { roles: ['QUIZ_APPROVER'] }),
        }),
      ).rejects.toThrow(GatesFailedError);

      // Still SUBMITTED: a refused transition commits nothing.
      expect(
        (await prisma.draftQuestion.findUniqueOrThrow({ where: { id: questionId } })).status,
      ).toBe('SUBMITTED_FOR_APPROVAL');
      expect(await prisma.questionApproval.count({ where: { questionId } })).toBe(0);
    });

    it('refuses a transition the actor lacks the permission for', async () => {
      const questionId = await freshDraft();
      await expect(
        transitionQuestion({
          deps: deps(),
          questionId,
          to: 'AUTHOR_REVIEW',
          actor: actor(authorId, { permissions: ['question.read'] }),
        }),
      ).rejects.toThrow(PermissionRequiredError);
    });

    it('refuses publishing a question that is not APPROVED', async () => {
      const questionId = await freshDraft();
      const result = await publishApprovedQuestions({
        deps: deps(),
        bank,
        target,
        questionIds: [questionId],
        actor: actor(publisherId, { roles: ['PUBLISHER'] }),
        signal: new AbortController().signal,
      });
      expect(result.items[0]?.outcome).toBe('FAILED');
      expect(result.items[0]?.detail).toContain('Only an APPROVED question');
      expect(await prisma.publishedQuestionReference.count()).toBe(0);
    });

    it('refuses publishing without the permission', async () => {
      const questionId = await approvedQuestion();
      await expect(
        publishApprovedQuestions({
          deps: deps(),
          bank,
          target,
          questionIds: [questionId],
          actor: actor(publisherId, { permissions: ['question.read'] }),
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow(/question.publish/);
    });

    it('re-evaluates the gates at publish and refuses a question the source no longer supports', async () => {
      const questionId = await approvedQuestion();

      // The source document changes AFTER approval. G1 exists for exactly this.
      const question = await prisma.draftQuestion.findUniqueOrThrow({
        where: { id: questionId },
        select: { sourceDocumentId: true, sourceId: true, sectionKey: true },
      });
      const document = await prisma.knowledgeDocument.findFirstOrThrow({
        where: { sourceId: question.sourceId, sourceDocumentId: question.sourceDocumentId },
        select: { id: true, extractedText: true },
      });
      const original = document.extractedText ?? '';
      await prisma.knowledgeDocument.update({
        where: { id: document.id },
        data: { extractedText: 'The procedure was rewritten and states no timeframes whatsoever.' },
      });

      try {
        const result = await publishApprovedQuestions({
          deps: deps(),
          bank,
          target,
          questionIds: [questionId],
          actor: actor(publisherId, { roles: ['PUBLISHER'] }),
          signal: new AbortController().signal,
        });
        expect(result.items[0]?.outcome).toBe('GATE_FAILED');
        expect(result.items[0]?.gateFailures?.map((f) => f.code)).toContain(
          'SOURCE_VALIDATION_FAILED',
        );
        // Nothing was written, and the question stays APPROVED so it can be
        // revalidated rather than silently lost.
        expect(await prisma.publishedQuestionReference.count()).toBe(0);
        expect(
          (await prisma.draftQuestion.findUniqueOrThrow({ where: { id: questionId } })).status,
        ).toBe('APPROVED');
      } finally {
        await prisma.knowledgeDocument.update({
          where: { id: document.id },
          data: { extractedText: original },
        });
      }
    });

    it('refuses a publish the configuration says needs a distinct publisher', async () => {
      const questionId = await approvedQuestion();
      const result = await publishApprovedQuestions({
        deps: { prisma, clock: systemClock, policies: { approverMayPublishOwn: false } },
        bank,
        target,
        questionIds: [questionId],
        // The approver trying to publish their own approval.
        actor: actor(approverId, { roles: ['PUBLISHER'] }),
        signal: new AbortController().signal,
      });
      expect(result.items[0]?.outcome).toBe('FAILED');
      expect(result.items[0]?.detail).toContain('distinct from the approver');
    });
  });

  // ================================================= duplicate blocking

  describe('duplicate blocking (gate 10)', () => {
    it('blocks approval until a flagged question is dispositioned, then allows it', async () => {
      const questionId = await freshDraft();
      // Simulate the FLAG band: persisted with a warning, no disposition.
      await prisma.draftQuestion.update({
        where: { id: questionId },
        data: { maxSimilarityScore: 0.83, duplicateDisposition: null },
      });

      await transitionQuestion({ deps: deps(), questionId, to: 'AUTHOR_REVIEW', actor: actor(authorId) });

      // §3.2 gates SUBMIT on all 13 too, so an undispositioned flag stops the
      // question before an approver ever sees it.
      await expect(
        transitionQuestion({
          deps: deps(),
          questionId,
          to: 'SUBMITTED_FOR_APPROVAL',
          actor: actor(authorId),
        }),
      ).rejects.toThrow(/DUPLICATE_THRESHOLD_EXCEEDED/);

      await dispositionDuplicate({
        deps: deps(),
        questionId,
        actor: actor(approverId),
        disposition: 'DISTINCT',
        note: 'Tests the notification timeframe, not the pager rotation. Different fact.',
      });

      await transitionQuestion({
        deps: deps(),
        questionId,
        to: 'SUBMITTED_FOR_APPROVAL',
        actor: actor(authorId),
      });
      const approved = await transitionQuestion({
        deps: deps(),
        questionId,
        to: 'APPROVED',
        actor: actor(approverId, { roles: ['QUIZ_APPROVER'] }),
      });
      expect(approved.to).toBe('APPROVED');
    });

    it('keeps a DUPLICATE disposition blocking', async () => {
      const questionId = await freshDraft();
      await prisma.draftQuestion.update({
        where: { id: questionId },
        data: { maxSimilarityScore: 0.95 },
      });
      await transitionQuestion({ deps: deps(), questionId, to: 'AUTHOR_REVIEW', actor: actor(authorId) });
      await dispositionDuplicate({
        deps: deps(),
        questionId,
        actor: actor(approverId),
        disposition: 'DUPLICATE',
        note: 'This is the same question as the one already approved for this section.',
      });

      // A DUPLICATE disposition blocks at every gated transition, submit
      // included: recording the judgement records that it should not proceed.
      await expect(
        transitionQuestion({
          deps: deps(),
          questionId,
          to: 'SUBMITTED_FOR_APPROVAL',
          actor: actor(authorId),
        }),
      ).rejects.toThrow(/Reject it instead/);
    });

    it('requires a note on a disposition', async () => {
      const questionId = await freshDraft();
      await expect(
        dispositionDuplicate({
          deps: deps(),
          questionId,
          actor: actor(approverId),
          disposition: 'DISTINCT',
          note: 'fine',
        }),
      ).rejects.toThrow(/at least 10 characters/);
    });
  });

  // ==================================================== review comments

  describe('review comments', () => {
    it('records a comment, its author, and the version it was given for', async () => {
      const questionId = await freshDraft();
      await addReview({
        deps: deps(),
        questionId,
        actor: actor(approverId, { roles: ['QUIZ_REVIEWER'] }),
        kind: 'REVIEWER',
        outcome: 'COMMENTED',
        comment: 'The distractors are plausible but option C is close to the key.',
      });

      const stored = await prisma.questionReview.findFirstOrThrow({ where: { questionId } });
      expect(stored.reviewerUserId).toBe(approverId);
      expect(stored.questionVersion).toBe(1);
      expect(stored.comment).toContain('option C');
    });

    it('refuses a review from someone without question.review', async () => {
      const questionId = await freshDraft();
      await expect(
        addReview({
          deps: deps(),
          questionId,
          actor: actor(authorId, { permissions: ['question.read'] }),
          kind: 'REVIEWER',
          outcome: 'COMMENTED',
          comment: 'A comment.',
        }),
      ).rejects.toThrow(PermissionRequiredError);
    });

    it('records the mandatory comment when changes are requested', async () => {
      const questionId = await freshDraft();
      await transitionQuestion({ deps: deps(), questionId, to: 'AUTHOR_REVIEW', actor: actor(authorId) });
      await transitionQuestion({
        deps: deps(),
        questionId,
        to: 'SUBMITTED_FOR_APPROVAL',
        actor: actor(authorId),
      });

      await expect(
        transitionQuestion({
          deps: deps(),
          questionId,
          to: 'CHANGES_REQUESTED',
          actor: actor(approverId),
        }),
      ).rejects.toThrow(CommentRequiredError);

      await transitionQuestion({
        deps: deps(),
        questionId,
        to: 'CHANGES_REQUESTED',
        actor: actor(approverId),
        comment: 'Please quote the whole sentence, not the clause.',
      });

      const stored = await prisma.questionReview.findFirstOrThrow({
        where: { questionId, outcome: 'CHANGES_REQUESTED' },
      });
      expect(stored.isBlocking).toBe(true);
      expect(stored.comment).toContain('whole sentence');
    });
  });

  // ======================================================== versioning

  describe('versioning (§3.5)', () => {
    it('increments the version, records a field diff, and re-verifies the evidence', async () => {
      const questionId = await freshDraft();
      await transitionQuestion({ deps: deps(), questionId, to: 'AUTHOR_REVIEW', actor: actor(authorId) });

      const before = await prisma.draftQuestion.findUniqueOrThrow({ where: { id: questionId } });
      const result = await editDraftQuestion({
        prisma,
        clock: systemClock,
        questionId,
        actor: actor(authorId),
        edit: { explanation: 'Rewritten to name the escalation path explicitly.' },
      });

      expect(result.version).toBe(before.version + 1);
      expect(result.diff.map((entry) => entry.field)).toEqual(['explanation']);
      expect(result.evidenceReverified).toBe(true);

      const history = await readVersionHistory(prisma, questionId);
      expect(history.map((entry) => entry.changeKind)).toEqual(['GENERATED', 'EDITED']);
      expect(history[1]?.changedFields).toEqual(['explanation']);
    });

    it('refuses an edit that breaks the grounding', async () => {
      const questionId = await freshDraft();
      await transitionQuestion({ deps: deps(), questionId, to: 'AUTHOR_REVIEW', actor: actor(authorId) });

      await expect(
        editDraftQuestion({
          prisma,
          clock: systemClock,
          questionId,
          actor: actor(authorId),
          edit: {
            supportingEvidence:
              'The duty manager must be informed within four minutes, by pager, at all times.',
          },
        }),
      ).rejects.toThrow(EvidenceBrokenByEditError);

      // The version did not move, because the edit did not happen.
      expect(
        (await prisma.draftQuestion.findUniqueOrThrow({ where: { id: questionId } })).version,
      ).toBe(1);
      expect(await prisma.draftQuestionVersion.count({ where: { questionId } })).toBe(1);
    });

    it('invalidates a duplicate disposition when the question text changes', async () => {
      const questionId = await freshDraft();
      await transitionQuestion({ deps: deps(), questionId, to: 'AUTHOR_REVIEW', actor: actor(authorId) });
      await prisma.draftQuestion.update({
        where: { id: questionId },
        data: { maxSimilarityScore: 0.8, duplicateDisposition: 'DISTINCT' },
      });

      await editDraftQuestion({
        prisma,
        clock: systemClock,
        questionId,
        actor: actor(authorId),
        edit: { questionText: 'Within what period must the duty manager be told of a severity one?' },
      });

      // The reviewer judged the OLD text distinct; gate 10 must be re-satisfied.
      expect(
        (await prisma.draftQuestion.findUniqueOrThrow({ where: { id: questionId } }))
          .duplicateDisposition,
      ).toBeNull();
    });

    it('refuses editing a question that is not in an editable state', async () => {
      const questionId = await approvedQuestion();
      await expect(
        editDraftQuestion({
          prisma,
          clock: systemClock,
          questionId,
          actor: actor(authorId),
          edit: { explanation: 'A change.' },
        }),
      ).rejects.toThrow(NotEditableError);
    });

    it('writes no snapshot for a no-op edit', async () => {
      const questionId = await freshDraft();
      await transitionQuestion({ deps: deps(), questionId, to: 'AUTHOR_REVIEW', actor: actor(authorId) });
      const row = await prisma.draftQuestion.findUniqueOrThrow({ where: { id: questionId } });

      const result = await editDraftQuestion({
        prisma,
        clock: systemClock,
        questionId,
        actor: actor(authorId),
        edit: { explanation: row.explanation },
      });
      expect(result.diff).toEqual([]);
      expect(await prisma.draftQuestionVersion.count({ where: { questionId } })).toBe(1);
    });
  });

  // ======================================================= idempotency

  describe('publishing idempotency and conditional updates', () => {
    it('computes a deterministic operation key', () => {
      const args = {
        targetListId: 'list',
        questionId: 'q',
        publishedVersion: 1,
        operationType: 'CREATE' as const,
      };
      expect(operationKeyFor(args)).toBe(operationKeyFor(args));
      expect(operationKeyFor(args)).toBe(
        createHash('sha256').update('list|q|1|CREATE', 'utf8').digest('hex'),
      );
      expect(operationKeyFor({ ...args, operationType: 'UPDATE' })).not.toBe(operationKeyFor(args));
    });

    it('a replayed publish creates ONE bank item', async () => {
      const questionId = await approvedQuestion();
      const publisher = actor(publisherId, { roles: ['PUBLISHER'] });

      const first = await publishApprovedQuestions({
        deps: deps(),
        bank,
        target,
        questionIds: [questionId],
        actor: publisher,
        signal: new AbortController().signal,
      });
      expect(first.items[0]?.outcome).toBe('PUBLISHED');

      // The same question again. It is PUBLISHED now, so the status gate stops
      // it — which is itself the idempotency guarantee at the domain level.
      const second = await publishApprovedQuestions({
        deps: deps(),
        bank,
        target,
        questionIds: [questionId],
        actor: publisher,
        signal: new AbortController().signal,
      });
      expect(second.items[0]?.outcome).toBe('FAILED');

      const page = await bank.queryItems(
        {
          targetSiteId: target.targetSiteId,
          targetListId: target.targetListId,
          correlationId: 'c',
          actorUserId: publisherId,
          signal: new AbortController().signal,
        },
        {},
      );
      expect(page.items).toHaveLength(1);
    });

    it('the bank itself refuses a second create for the same operation key', async () => {
      const ctx = {
        targetSiteId: target.targetSiteId,
        targetListId: 'idempotency-probe',
        correlationId: 'c',
        actorUserId: publisherId,
        signal: new AbortController().signal,
      };
      const item = {
        questionId: 'KNZ-TEST-2026-000001',
        internalQuestionId: 'i',
        questionType: 'MULTIPLE_CHOICE_4',
        questionText: 'q',
        optionA: 'a',
        optionB: 'b',
        optionC: 'c',
        optionD: 'd',
        correctAnswer: 'A',
        explanation: 'e',
        domain: 'D',
        domainCode: 'D',
        topic: 'T',
        sourceDocumentName: 'n',
        sourceUrl: 'u',
        sourceDocumentId: 's',
        sourceSectionKey: 'k',
        supportingEvidence: 'e',
        sourceContentHash: 'h',
        sourceVersion: '1',
        confidenceIndicator: 0.5,
        generationJobId: null,
        claudeModel: null,
        promptVersion: null,
        status: 'Approved',
        isActive: true,
        isPublished: true,
        version: 1,
        approvedBy: null,
        approvalDate: null,
        publishedBy: null,
        publishedDate: null,
        correlationId: 'c',
      };

      const first = await bank.createItem(ctx, item, 'operation-key-1');
      expect(first.outcome).toBe('CREATED');
      const replay = await bank.createItem(ctx, item, 'operation-key-1');
      expect(replay.outcome).toBe('ALREADY_CURRENT');
      expect(replay.itemId).toBe(first.itemId);

      // A DIFFERENT key for the same QuestionID also refuses to duplicate —
      // the pre-write existence check, which is the backstop if a key changes.
      const other = await bank.createItem(ctx, item, 'operation-key-2');
      expect(other.outcome).toBe('ALREADY_CURRENT');
      expect(other.itemId).toBe(first.itemId);
    });

    it('the bank returns a real 412 on a stale ifMatch', async () => {
      const ctx = {
        targetSiteId: target.targetSiteId,
        targetListId: 'etag-probe',
        correlationId: 'c',
        actorUserId: publisherId,
        signal: new AbortController().signal,
      };
      const created = await bank.createItem(
        ctx,
        {
          questionId: 'KNZ-TEST-2026-000002',
          internalQuestionId: 'i',
          questionType: 'MULTIPLE_CHOICE_4',
          questionText: 'q',
          optionA: 'a',
          optionB: 'b',
          optionC: 'c',
          optionD: 'd',
          correctAnswer: 'A',
          explanation: 'e',
          domain: 'D',
          domainCode: 'D',
          topic: 'T',
          sourceDocumentName: 'n',
          sourceUrl: 'u',
          sourceDocumentId: 's',
          sourceSectionKey: 'k',
          supportingEvidence: 'e',
          sourceContentHash: 'h',
          sourceVersion: '1',
          confidenceIndicator: 0.5,
          generationJobId: null,
          claudeModel: null,
          promptVersion: null,
          status: 'Approved',
          isActive: true,
          isPublished: true,
          version: 1,
          approvedBy: null,
          approvalDate: null,
          publishedBy: null,
          publishedDate: null,
          correlationId: 'c',
        },
        'etag-op-1',
      );

      await bank.updateItem(ctx, created.itemId, { version: 2 }, created.eTag, 'etag-op-2');

      // The first eTag is now stale. G8: re-read, never overwrite.
      await expect(
        bank.updateItem(ctx, created.itemId, { version: 3 }, created.eTag, 'etag-op-3'),
      ).rejects.toThrow(BankPreconditionFailedError);
    });

    it('runs in dry-run mode when writes are disabled, and says so', async () => {
      const questionId = await approvedQuestion();
      const result = await publishApprovedQuestions({
        deps: deps(),
        bank,
        target: { ...target, writesEnabled: false, dryRunReason: 'Writes are off in this environment.' },
        questionIds: [questionId],
        actor: actor(publisherId, { roles: ['PUBLISHER'] }),
        signal: new AbortController().signal,
      });

      expect(result.dryRun).toBe(true);
      expect(result.items[0]?.outcome).toBe('DRY_RUN');
      expect(result.items[0]?.detail).toContain('Writes are off');
      // Nothing was written anywhere, including no operation row that would
      // suggest an attempt was made.
      expect(await prisma.publishedQuestionReference.count()).toBe(0);
      expect(await prisma.publishOperation.count()).toBe(0);
      expect(
        (await prisma.draftQuestion.findUniqueOrThrow({ where: { id: questionId } })).status,
      ).toBe('APPROVED');
    });

    it('publishes a partial batch: the good ones land, the bad one reports', async () => {
      const good = await approvedQuestion();
      const bad = await freshDraft();

      const result = await publishApprovedQuestions({
        deps: deps(),
        bank,
        target,
        questionIds: [good, bad],
        actor: actor(publisherId, { roles: ['PUBLISHER'] }),
        signal: new AbortController().signal,
      });

      expect(result.publishedCount).toBe(1);
      expect(result.failedCount).toBe(1);
      expect(result.items.find((item) => item.questionId === good)?.outcome).toBe('PUBLISHED');
      expect(result.items.find((item) => item.questionId === bad)?.outcome).toBe('FAILED');
    });
  });

  // ========================================================= retirement

  describe('retirement (§4.4)', () => {
    it('marks the bank item inactive WITHOUT deleting it, and requires a comment', async () => {
      const questionId = await approvedQuestion();
      const published = await publishApprovedQuestions({
        deps: deps(),
        bank,
        target,
        questionIds: [questionId],
        actor: actor(publisherId, { roles: ['PUBLISHER'] }),
        signal: new AbortController().signal,
      });
      const itemId = published.items[0]?.bankItemId ?? '';

      await expect(
        retirePublishedQuestion({
          deps: deps(),
          bank,
          target,
          questionId,
          comment: 'stale',
          actor: actor(publisherId, { roles: ['PUBLISHER'] }),
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow(/at least 10 characters/);

      const retired = await retirePublishedQuestion({
        deps: deps(),
        bank,
        target,
        questionId,
        comment: 'The procedure changed and this question tests the old timeframe.',
        actor: actor(publisherId, { roles: ['PUBLISHER'] }),
        signal: new AbortController().signal,
      });
      expect(retired.bankItemId).toBe(itemId);

      // G7: the item is STILL THERE, flagged.
      const item = await bank.findByQuestionId(
        {
          targetSiteId: target.targetSiteId,
          targetListId: target.targetListId,
          correlationId: 'c',
          actorUserId: publisherId,
          signal: new AbortController().signal,
        },
        (await prisma.publishedQuestionReference.findFirstOrThrow({
          where: { question: { id: questionId } },
        })).questionId,
      );
      expect(item).not.toBeNull();
      expect(item?.isActive).toBe(false);
      expect(item?.status).toBe('Retired');
      expect(item?.fields['retireComment']).toContain('old timeframe');

      const reference = await prisma.publishedQuestionReference.findFirstOrThrow({
        where: { question: { id: questionId } },
      });
      expect(reference.status).toBe('RETIRED');
      expect(reference.isActive).toBe(false);
      expect(
        (await prisma.draftQuestion.findUniqueOrThrow({ where: { id: questionId } })).status,
      ).toBe('RETIRED');
    });

    it('has no delete method at all (G7)', () => {
      // The type system enforces this; the assertion documents it at runtime
      // so a future adapter cannot add one unnoticed.
      expect('deleteItem' in bank).toBe(false);
      expect(Object.keys(bank).filter((key) => /delete|remove|purge/i.test(key))).toEqual([]);
    });

    it('refuses retiring something that was never published', async () => {
      const questionId = await approvedQuestion();
      await expect(
        retirePublishedQuestion({
          deps: deps(),
          bank,
          target,
          questionId,
          comment: 'This has never been published to the bank at all.',
          actor: actor(publisherId, { roles: ['PUBLISHER'] }),
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow(/Only a PUBLISHED question/);
    });
  });

  // ============================================ the gate evaluation surface

  describe('the advisory gate endpoint agrees with the enforcement', () => {
    it('reports the same failures the transition refuses on', async () => {
      const questionId = await freshDraft();
      await prisma.draftQuestion.update({
        where: { id: questionId },
        data: { maxSimilarityScore: 0.9 },
      });

      const advisory = await evaluateGatesForQuestion(deps(), questionId, {
        userId: approverId,
        roles: ['QUIZ_APPROVER'],
        permissions: ALL_PERMISSIONS,
      }, { separationApplies: true });
      expect(advisory.evaluation.failures.map((f) => f.code)).toContain(
        'DUPLICATE_THRESHOLD_EXCEEDED',
      );

      await transitionQuestion({ deps: deps(), questionId, to: 'AUTHOR_REVIEW', actor: actor(authorId) });
      try {
        await transitionQuestion({
          deps: deps(),
          questionId,
          to: 'SUBMITTED_FOR_APPROVAL',
          actor: actor(authorId),
        });
        expect.unreachable('the submit should have been refused');
      } catch (error) {
        expect(error).toBeInstanceOf(GatesFailedError);
        expect((error as GatesFailedError).evaluation.failures.map((f) => f.code)).toContain(
          'DUPLICATE_THRESHOLD_EXCEEDED',
        );
      }
    });
  });
});
