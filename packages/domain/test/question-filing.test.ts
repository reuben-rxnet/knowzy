// Four axes, one path: Domain, Topic, Department, Role.
//
// Requested directly -- "each question can be mapped to Department, Role,
// Domain, Topic" -- and the reason this needs its own suite is that the filing
// crosses FIVE recorded surfaces, any one of which can drop it while the other
// four still look right:
//
//   generation_job -> draft_question -> published_question_reference -> the
//   bank item's own fields.
//
// That is exactly the defect this feature already shipped once: the API route
// did not declare the two fields, so the screen said "filing under
// Development-NG / Developer" and the database stored nulls. Every layer
// asserted its own half correctly. Nothing asserted the whole chain, so
// nothing failed.
//
// The tests here therefore follow ONE question all the way to the bank, and
// then make the two refusals fire: an unknown id, and a deactivated one.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { systemClock } from '@knowzy/observability';
import {
  createMockQuestionBankAdapter,
  type QuestionBankAdapter,
} from '@knowzy/knowledge-source-adapters';
import {
  createGenerationJob,
  createOrgEntry,
  publishApprovedQuestions,
  runGenerationJob,
  setQuestionFiling,
  transitionQuestion,
  updateOrgEntry,
  FilingNotPermittedError,
  NotEditableError,
  TaxonomyError,
  type ActorContext,
  type PublishTarget,
  type ReviewDeps,
} from '../src/index.js';
import { testControl } from './control-layer-fixture.js';

const DATABASE_URL = process.env['DATABASE_URL'];
const describeDb = DATABASE_URL ? describe : describe.skip;

const prisma = new PrismaClient(
  DATABASE_URL ? { datasources: { db: { url: DATABASE_URL } } } : undefined,
);

/** A suffix nothing else uses, so a re-run cannot collide with itself. */
const suffix = Date.now().toString(36).toUpperCase();

const PERMISSIONS = [
  'question.read',
  'question.edit',
  'question.submit',
  'question.review',
  'question.approve',
  'question.publish',
];

describeDb('question filing on four axes', () => {
  let authorId = '';
  let approverId = '';
  let publisherId = '';
  let adminId = '';
  let sourceId = '';
  let documentId = '';
  let domainId = '';
  let topicId = '';
  let departmentId = '';
  let jobRoleId = '';
  let departmentCode = '';
  let jobRoleCode = '';
  let bankRoot = '';
  let bank: QuestionBankAdapter;
  let target: PublishTarget;
  let listCounter = 0;

  const deps = (): ReviewDeps => ({ prisma, clock: systemClock });

  const actor = (userId: string, overrides: Partial<ActorContext> = {}): ActorContext => ({
    userId,
    displayName: `Filing ${userId.slice(0, 8)}`,
    roles: ['CONTENT_AUTHOR'],
    permissions: PERMISSIONS,
    correlationId: 'filing-test',
    requestId: 'filing-request',
    ...overrides,
  });

  const administrator = () => ({
    userId: adminId,
    displayName: 'KNOWZY Administrator',
    roles: ['KNOWZY_ADMINISTRATOR'],
    correlationId: 'filing-test',
    requestId: 'filing-request',
  });

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
          in: [
            'author@local.invalid',
            'approver@local.invalid',
            'publisher@local.invalid',
            'knowzy-administrator@local.invalid',
          ],
        },
      },
      select: { id: true, userPrincipalName: true },
    });
    const idOf = (upn: string): string =>
      users.find((row) => row.userPrincipalName === upn)?.id ?? '';
    authorId = idOf('author@local.invalid');
    approverId = idOf('approver@local.invalid');
    publisherId = idOf('publisher@local.invalid');
    adminId = idOf('knowzy-administrator@local.invalid');
    expect(authorId && approverId && publisherId && adminId).toBeTruthy();

    const department = await createOrgEntry(
      { prisma, clock: systemClock },
      administrator(),
      'DEPARTMENT',
      { code: `FILING_DEPT_${suffix}`, name: `Filing Department ${suffix}` },
    );
    departmentId = department.id;
    departmentCode = department.code;
    const role = await createOrgEntry({ prisma, clock: systemClock }, administrator(), 'ROLE', {
      code: `FILING_ROLE_${suffix}`,
      name: `Filing Role ${suffix}`,
    });
    jobRoleId = role.id;
    jobRoleCode = role.code;

    bankRoot = mkdtempSync(join(tmpdir(), 'knowzy-filing-bank-'));
    bank = createMockQuestionBankAdapter({ fixtureRoot: bankRoot });
    target = {
      targetSiteId: 'test-site',
      targetListId: 'filing-question-bank',
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

  beforeEach(async () => {
    listCounter += 1;
    target = { ...target, targetListId: `filing-question-bank-${listCounter}` };
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
  });

  /**
   * A job created with whatever filing the caller asks for, then run.
   *
   * The filing is passed ONLY to `createGenerationJob`. The run is not told
   * again, because the point of the test is that the run reads it from the job
   * -- a second parameter here would let the chain pass while the job row was
   * empty.
   */
  const generate = async (filing: {
    departmentId?: string | null;
    jobRoleId?: string | null;
  }): Promise<{ jobId: string; questionId: string }> => {
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
        correlationId: 'filing-test',
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
      ...filing,
      reasonCode: 'NEW_KNOWLEDGE',
      requestedQuestionCount: 1,
      actor: {
        userId: authorId,
        displayName: 'Author',
        roles: ['CONTENT_AUTHOR'],
        permissions: ['question.generate'],
      },
      correlationId: 'filing-test',
      requestId: 'filing-request',
    });

    const result = await runGenerationJob({
      prisma,
      clock: systemClock,
      scope: created.resolvedScope,
      profile: created.profile,
      requestedQuestionCount: 1,
      control: testControl(),
      context: {
        jobId: created.jobId,
        sourceId: created.sourceId,
        domainId,
        topicId,
        correlationId: 'filing-test',
        requestId: 'filing-request',
        actorUserId: authorId,
        actorDisplayName: 'Author',
        actorRoles: ['CONTENT_AUTHOR'],
        reasonCode: 'NEW_KNOWLEDGE',
      },
    });

    const questionId = result.acceptedQuestionIds[0];
    expect(questionId).toBeTruthy();
    return { jobId: created.jobId, questionId: questionId ?? '' };
  };

  const approveAndPublish = async (questionId: string): Promise<void> => {
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
      comment: 'Evidence checked against the source.',
    });
    const published = await publishApprovedQuestions({
      deps: deps(),
      bank,
      target,
      questionIds: [questionId],
      actor: actor(publisherId, { roles: ['PUBLISHER'] }),
      signal: new AbortController().signal,
    });
    expect(published.publishedCount).toBe(1);
  };

  const bankItem = async (publishedQuestionId: string) =>
    bank.findByQuestionId(
      {
        targetSiteId: target.targetSiteId,
        targetListId: target.targetListId,
        correlationId: 'filing-test',
        actorUserId: publisherId,
        signal: new AbortController().signal,
      },
      publishedQuestionId,
    );

  it('carries the department and role from the job to the bank item', async () => {
    const { jobId, questionId } = await generate({ departmentId, jobRoleId });

    // 1. The JOB records what was asked for.
    const job = await prisma.generationJob.findUniqueOrThrow({
      where: { id: jobId },
      select: { departmentId: true, jobRoleId: true },
    });
    expect(job.departmentId).toBe(departmentId);
    expect(job.jobRoleId).toBe(jobRoleId);

    // 2. The DRAFT is stamped, without the runner being told a second time.
    const draft = await prisma.draftQuestion.findUniqueOrThrow({
      where: { id: questionId },
      select: { departmentId: true, jobRoleId: true },
    });
    expect(draft.departmentId).toBe(departmentId);
    expect(draft.jobRoleId).toBe(jobRoleId);

    await approveAndPublish(questionId);

    // 3. The PUBLISHED reference copies both ids, so a report can group by
    //    department without joining back to a draft that may be superseded.
    const reference = await prisma.publishedQuestionReference.findFirstOrThrow({
      where: { question: { id: questionId } },
      select: { questionId: true, departmentId: true, jobRoleId: true },
    });
    expect(reference.departmentId).toBe(departmentId);
    expect(reference.jobRoleId).toBe(jobRoleId);

    // 4. And the BANK ITEM carries the resolved labels PLUS the stable codes,
    //    which is what survives a display-name change in the tenant list.
    const item = await bankItem(reference.questionId);
    expect(item).not.toBeNull();
    expect(item?.fields['department']).toBe(`Filing Department ${suffix}`);
    expect(item?.fields['departmentCode']).toBe(departmentCode);
    expect(item?.fields['jobRole']).toBe(`Filing Role ${suffix}`);
    expect(item?.fields['jobRoleCode']).toBe(jobRoleCode);
  });

  it('publishes an unfiled question with null, never a placeholder label', async () => {
    // Every question that predates the two axes must still publish. What must
    // NOT happen is a stand-in string: a bank full of "Unassigned" cannot be
    // told apart from a bank somebody filed that way.
    const { questionId } = await generate({});

    const draft = await prisma.draftQuestion.findUniqueOrThrow({
      where: { id: questionId },
      select: { departmentId: true, jobRoleId: true },
    });
    expect(draft.departmentId).toBeNull();
    expect(draft.jobRoleId).toBeNull();

    await approveAndPublish(questionId);

    const reference = await prisma.publishedQuestionReference.findFirstOrThrow({
      where: { question: { id: questionId } },
      select: { questionId: true, departmentId: true, jobRoleId: true },
    });
    expect(reference.departmentId).toBeNull();
    expect(reference.jobRoleId).toBeNull();

    const item = await bankItem(reference.questionId);
    for (const key of ['department', 'departmentCode', 'jobRole', 'jobRoleCode']) {
      expect(item?.fields[key] ?? null).toBeNull();
    }
  });

  it('refuses a department id that does not exist', async () => {
    await expect(
      generate({ departmentId: '00000000-0000-4000-8000-000000000000' }),
    ).rejects.toThrow(TaxonomyError);
  });

  it('refuses filing under a DEACTIVATED role, rather than filing it as null', async () => {
    // The failure this prevents: deactivation that only hides a row from the
    // dropdown still accepts an id somebody's open tab is holding, and the
    // question is filed under a role nobody can see.
    const retired = await createOrgEntry({ prisma, clock: systemClock }, administrator(), 'ROLE', {
      code: `FILING_GONE_${suffix}`,
      name: `Filing Retired Role ${suffix}`,
    });
    await updateOrgEntry({ prisma, clock: systemClock }, administrator(), 'ROLE', {
      id: retired.id,
      name: retired.name,
      isActive: false,
    });

    await expect(generate({ jobRoleId: retired.id })).rejects.toThrow(/deactivated/i);
  });
  // ======================================================= re-filing a draft
  //
  // The Filing tab's write path. Domain and topic are deliberately absent from
  // it, so the tests that matter are the ones that prove the WINDOW and the
  // RECORD: a filing that can be corrected while the question is with its
  // author, cannot be corrected afterwards, and leaves a reconstructable trail
  // either way.

  describe('re-filing', () => {
    it('corrects both axes, bumps the version, and records previous and new', async () => {
      const { questionId } = await generate({});

      const result = await setQuestionFiling({
        prisma,
        clock: systemClock,
        questionId,
        actor: actor(authorId),
        filing: { departmentId, jobRoleId },
      });
      expect(result.changedFields).toEqual(['departmentId', 'jobRoleId']);
      expect(result.version).toBe(2);

      const draft = await prisma.draftQuestion.findUniqueOrThrow({
        where: { id: questionId },
        select: { departmentId: true, jobRoleId: true, version: true },
      });
      expect(draft.departmentId).toBe(departmentId);
      expect(draft.jobRoleId).toBe(jobRoleId);
      expect(draft.version).toBe(2);

      const version = await prisma.draftQuestionVersion.findFirstOrThrow({
        where: { questionId, version: 2 },
      });
      expect(version.changeKind).toBe('EDITED');
      // FALSE, and that is the point: re-filing touches no text, so claiming a
      // re-verification in an append-only table would be a permanent lie.
      expect(version.evidenceReverified).toBe(false);

      const event = await prisma.auditEvent.findFirstOrThrow({
        where: { entityId: questionId, action: 'AUTHORING.QUESTION.FILING_CHANGED' },
        orderBy: { occurredAt: 'desc' },
      });
      // H2: both sides, and by CODE -- a uuid cannot be resolved against a
      // catalogue somebody re-curates next year.
      expect((event.previousValue as { departmentCode: string | null }).departmentCode).toBeNull();
      expect((event.newValue as { departmentCode: string | null }).departmentCode).toBe(
        departmentCode,
      );
      expect((event.detail as { _droppedKeys?: unknown })._droppedKeys).toBeUndefined();
    });

    it('clears an axis when it is given null, and leaves an absent one alone', async () => {
      const { questionId } = await generate({ departmentId, jobRoleId });

      const cleared = await setQuestionFiling({
        prisma,
        clock: systemClock,
        questionId,
        actor: actor(authorId),
        // departmentId absent -- unchanged. jobRoleId null -- cleared.
        filing: { jobRoleId: null },
      });
      expect(cleared.changedFields).toEqual(['jobRoleId']);
      expect(cleared.departmentId).toBe(departmentId);
      expect(cleared.jobRoleId).toBeNull();
    });

    it('writes NO version and NO audit row when nothing changed', async () => {
      const { questionId } = await generate({ departmentId, jobRoleId });
      const before = await prisma.auditEvent.count({
        where: { entityId: questionId, action: 'AUTHORING.QUESTION.FILING_CHANGED' },
      });

      const result = await setQuestionFiling({
        prisma,
        clock: systemClock,
        questionId,
        actor: actor(authorId),
        filing: { departmentId, jobRoleId },
      });
      expect(result.changedFields).toEqual([]);
      expect(result.version).toBe(1);
      expect(await prisma.draftQuestionVersion.count({ where: { questionId, version: 2 } })).toBe(
        0,
      );
      expect(
        await prisma.auditEvent.count({
          where: { entityId: questionId, action: 'AUTHORING.QUESTION.FILING_CHANGED' },
        }),
      ).toBe(before);
    });

    it('refuses once the question has been submitted', async () => {
      // A question is approved AS FILED. If the filing could move afterwards,
      // the approval record would be a statement about something else.
      const { questionId } = await generate({});
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

      await expect(
        setQuestionFiling({
          prisma,
          clock: systemClock,
          questionId,
          actor: actor(authorId),
          filing: { departmentId },
        }),
      ).rejects.toThrow(NotEditableError);
    });

    it('refuses an identity without question.edit', async () => {
      const { questionId } = await generate({});
      await expect(
        setQuestionFiling({
          prisma,
          clock: systemClock,
          questionId,
          actor: actor(authorId, { permissions: ['question.read'] }),
          filing: { departmentId },
        }),
      ).rejects.toThrow(FilingNotPermittedError);
    });

    it('refuses a DEACTIVATED department here too, not only at generation', async () => {
      const { questionId } = await generate({});
      const retired = await createOrgEntry(
        { prisma, clock: systemClock },
        administrator(),
        'DEPARTMENT',
        { code: `FILING_OLD_${suffix}`, name: `Filing Retired Department ${suffix}` },
      );
      await updateOrgEntry({ prisma, clock: systemClock }, administrator(), 'DEPARTMENT', {
        id: retired.id,
        name: retired.name,
        isActive: false,
      });

      await expect(
        setQuestionFiling({
          prisma,
          clock: systemClock,
          questionId,
          actor: actor(authorId),
          filing: { departmentId: retired.id },
        }),
      ).rejects.toThrow(/deactivated/i);
    });

    it('publishes the CORRECTED filing, not the one the job chose', async () => {
      // The whole reason the tab exists: one wrong choice on the generation
      // screen files a batch, and the correction has to reach the bank.
      const { questionId } = await generate({ departmentId, jobRoleId });
      const other = await createOrgEntry(
        { prisma, clock: systemClock },
        administrator(),
        'DEPARTMENT',
        { code: `FILING_FIX_${suffix}`, name: `Filing Corrected Department ${suffix}` },
      );
      await setQuestionFiling({
        prisma,
        clock: systemClock,
        questionId,
        actor: actor(authorId),
        filing: { departmentId: other.id },
      });

      await approveAndPublish(questionId);
      const reference = await prisma.publishedQuestionReference.findFirstOrThrow({
        where: { question: { id: questionId } },
        select: { questionId: true, departmentId: true },
      });
      expect(reference.departmentId).toBe(other.id);

      const item = await bankItem(reference.questionId);
      expect(item?.fields['departmentCode']).toBe(other.code);
      expect(item?.fields['jobRoleCode']).toBe(jobRoleCode);
    });
  });
});
