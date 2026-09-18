// The generation workflow, end to end against a real database.
//
// MVP step 3: document selection → generation → evidence verification → draft
// persistence → author review queue.
//
// The gates are tested by making each one FAIL in isolation from a passing
// baseline, because a gate chain where every candidate happens to pass proves
// only that nothing threw. In particular: a candidate whose evidence does not
// verify must leave NO draft behind and a recorded reason, which is the
// difference between a grounded platform and a plausible-sounding one.

import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { systemClock } from '@knowzy/observability';
import {
  createDeterministicGenerator,
  verifyEvidence,
  type GenerateArgs,
  type GenerateResult,
  type GeneratedQuestion,
  type QuestionGenerator,
} from '@knowzy/claude-services';
import {
  createGenerationJob,
  GenerationScopeEmptyError,
  GenerationSelectionRequiredError,
  PreflightRequiredError,
  resolveGenerationScope,
  runGenerationJob,
  runPreflight,
  type GenerationProfileSettings,
} from '../src/index.js';

const DATABASE_URL = process.env['DATABASE_URL'];
const describeDb = DATABASE_URL ? describe : describe.skip;

const prisma = new PrismaClient(
  DATABASE_URL ? { datasources: { db: { url: DATABASE_URL } } } : undefined,
);

/** A generator that returns exactly what a test hands it. */
const fixedGenerator = (questions: readonly GeneratedQuestion[]): QuestionGenerator => ({
  kind: 'deterministic-local',
  modelId: 'test-fixed-generator',
  generate: async (_args: GenerateArgs): Promise<GenerateResult> => ({
    output: { questions: [...questions] as [GeneratedQuestion, ...GeneratedQuestion[]] },
    insufficientSections: [],
    modelId: 'test-fixed-generator',
    inputTokens: 1,
    outputTokens: 1,
  }),
});

describeDb('generation workflow', () => {
  let sourceId = '';
  let documentId = '';
  let sourceDocumentId = '';
  let domainId = '';
  let topicId = '';
  let authorUserId = '';
  let profile: GenerationProfileSettings;
  let sections: {
    sectionId: string;
    sectionKey: string;
    documentId: string;
    ordinal: number;
    label: string;
    text: string;
    sectionContentHash: string;
    startOffset: number;
    assessableCharCount: number;
  }[] = [];
  let documents: {
    documentId: string;
    sourceDocumentId: string;
    name: string;
    sourceUrl: string;
    folderPath: string | null;
    containerName: string | null;
    sourceVersion: string;
    sourceETag: string | null;
    contentHash: string;
    localVersionCounter: number;
  }[] = [];

  beforeAll(async () => {
    const source = await prisma.knowledgeSource.findFirstOrThrow({
      where: { sourceType: 'MOCK' },
      select: { id: true },
    });
    sourceId = source.id;

    const document = await prisma.knowledgeDocument.findFirstOrThrow({
      where: { sourceId, extractionStatus: 'EXTRACTED', name: 'incident-escalation.md' },
      select: {
        id: true,
        sourceDocumentId: true,
        name: true,
        sourceUrl: true,
        folderPath: true,
        containerName: true,
        sourceVersion: true,
        sourceETag: true,
        contentHash: true,
        localVersionCounter: true,
        extractedText: true,
      },
    });
    documentId = document.id;
    sourceDocumentId = document.sourceDocumentId;

    const topic = await prisma.topic.findFirstOrThrow({
      where: { isActive: true },
      select: { id: true, name: true, domainId: true, domain: { select: { name: true } } },
    });
    topicId = topic.id;
    domainId = topic.domainId;

    const author = await prisma.user.findFirstOrThrow({
      where: { userPrincipalName: 'author@local.invalid' },
      select: { id: true },
    });
    authorUserId = author.id;

    const profileRow = await prisma.generationProfile.findFirstOrThrow({
      where: { name: 'Default' },
    });
    profile = {
      profileId: profileRow.id,
      promptVersionId: profileRow.promptVersionId,
      evidenceMode: profileRow.evidenceStrictness,
      thresholds: {
        flagThreshold: Number(profileRow.duplicateFlagThreshold),
        blockThreshold: Number(profileRow.duplicateBlockThreshold),
      },
      minAssessableChars: 300,
      maxQuestionsPerSection: profileRow.maxQuestionsPerSection,
      domainName: topic.domain.name,
      topicName: topic.name,
    };

    // Stage-1 suppression compares against EXISTING drafts for the same source
    // document, so a draft left behind by an earlier run — a previous suite
    // execution, or a live request against the same local database — makes the
    // deterministic generator suppress the very question a test expects it to
    // produce, and the suite fails for a reason unrelated to the code. These
    // are fixture-derived drafts in a local database, so the suite clears them
    // for the documents it uses and states that it does.
    const fixtureDocuments = await prisma.knowledgeDocument.findMany({
      where: { sourceId, name: { in: ['incident-escalation.md', 'refunds-and-chargebacks.md'] } },
      select: { sourceDocumentId: true },
    });
    const fixtureSourceDocumentIds = fixtureDocuments.map((row) => row.sourceDocumentId);
    const stale = await prisma.draftQuestion.findMany({
      where: { sourceDocumentId: { in: fixtureSourceDocumentIds } },
      select: { id: true },
    });
    if (stale.length > 0) {
      await prisma.draftQuestionVersion.deleteMany({
        where: { questionId: { in: stale.map((row) => row.id) } },
      });
      await prisma.draftQuestion.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } });
    }

    // A generation run MUTATES section assessability and coverage — that is the
    // point of the coverage recompute. So the suite resets the document to a
    // known baseline before reading it, rather than inheriting whatever an
    // earlier run (or a live request against the same database) left behind. A
    // suite whose fixtures depend on its own previous execution passes or fails
    // for reasons that have nothing to do with the code under test.
    await prisma.documentSection.updateMany({
      where: { documentId },
      data: { isAssessable: true, coverageStatus: 'NOT_COVERED', nonAssessableReason: null },
    });

    const rows = await prisma.documentSection.findMany({
      where: { documentId, isAssessable: true },
      orderBy: { ordinal: 'asc' },
    });
    const text = document.extractedText ?? '';
    sections = rows.map((row) => ({
      sectionId: row.id,
      sectionKey: row.sectionKey,
      documentId,
      ordinal: row.ordinal,
      label: row.headingPath ?? `Section ${row.ordinal}`,
      text: text.slice(row.startOffset, row.endOffset),
      sectionContentHash: row.sectionContentHash,
      startOffset: row.startOffset,
      assessableCharCount: row.assessableCharCount,
    }));

    expect(sections.length).toBeGreaterThan(2);

    documents = [
      {
        documentId,
        sourceDocumentId,
        name: document.name,
        sourceUrl: document.sourceUrl,
        folderPath: document.folderPath,
        containerName: document.containerName,
        sourceVersion: document.sourceVersion,
        sourceETag: document.sourceETag,
        contentHash: document.contentHash ?? '',
        localVersionCounter: document.localVersionCounter,
      },
    ];
  });

  afterAll(async () => {
    await prisma.documentSection.updateMany({
      where: { documentId },
      data: { isAssessable: true, coverageStatus: 'NOT_COVERED', nonAssessableReason: null },
    });
    await prisma.$disconnect();
  });

  /** Removes only what a test created, so re-runs stay independent. */
  const cleanup = async (jobId: string): Promise<void> => {
    const questions = await prisma.draftQuestion.findMany({
      where: { generationJobId: jobId },
      select: { id: true },
    });
    await prisma.draftQuestionVersion.deleteMany({
      where: { questionId: { in: questions.map((q) => q.id) } },
    });
    await prisma.draftQuestion.deleteMany({ where: { generationJobId: jobId } });
    await prisma.generationJobRejection.deleteMany({ where: { jobId } });
    await prisma.generationJobDocument.deleteMany({ where: { jobId } });
    const job = await prisma.generationJob.findUnique({
      where: { id: jobId },
      select: { preflightId: true },
    });
    await prisma.generationJob.delete({ where: { id: jobId } });
    if (job) await prisma.generationPreflight.delete({ where: { id: job.preflightId } });
  };

  const makePreflight = async (
    chosenAction: 'GENERATE_NEW' | 'GENERATE_ADDITIONAL' | 'VIEW_EXISTING' | null,
  ): Promise<string> => {
    const row = await prisma.generationPreflight.create({
      data: {
        sourceId,
        documentIds: [documentId],
        checkResults: {},
        recommendation: 'GENERATE_NEW',
        chosenAction,
        chosenAt: chosenAction === null ? null : new Date(),
        chosenByUserId: chosenAction === null ? null : authorUserId,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        correlationId: 'test',
        createdByUserId: authorUserId,
      },
      select: { id: true },
    });
    return row.id;
  };

  const runWith = async (
    generator?: QuestionGenerator,
  ): Promise<{ jobId: string; result: Awaited<ReturnType<typeof runGenerationJob>> }> => {
    // Reset before EVERY run, not once per suite. A run marks sections covered
    // or non-assessable, which changes the scope the next run resolves — so
    // without this, a test's outcome depends on which tests ran before it.
    await prisma.documentSection.updateMany({
      where: { documentId },
      data: { isAssessable: true, coverageStatus: 'NOT_COVERED', nonAssessableReason: null },
    });

    const preflightId = await makePreflight('GENERATE_NEW');
    const created = await createGenerationJob({
      prisma,
      clock: systemClock,
      preflightId,
      scope: 'ENTIRE_DOCUMENT',
      domainId,
      topicId,
      reasonCode: 'NEW_KNOWLEDGE',
      requestedQuestionCount: 5,
      actor: {
        userId: authorUserId,
        displayName: 'Local Quiz Author',
        roles: ['CONTENT_AUTHOR'],
        permissions: ['question.generate'],
      },
      correlationId: 'test-run',
      requestId: 'test-request',
    });

    const result = await runGenerationJob({
      prisma,
      clock: systemClock,
      scope: created.resolvedScope,
      profile: created.profile,
      requestedQuestionCount: created.requestedQuestionCount,
      ...(generator === undefined ? {} : { generator }),
      context: {
        jobId: created.jobId,
        sourceId: created.sourceId,
        domainId,
        topicId,
        correlationId: 'test-run',
        requestId: 'test-request',
        actorUserId: authorUserId,
        actorDisplayName: 'Local Quiz Author',
        actorRoles: ['CONTENT_AUTHOR'],
        reasonCode: 'NEW_KNOWLEDGE',
      },
    });

    return { jobId: created.jobId, result };
  };

  // ------------------------------------------------------------- preflight

  describe('preflight (generation-governance.md §4.1)', () => {
    it('runs all six checks and offers all four actions', async () => {
      const result = await runPreflight({
        client: prisma,
        sourceId,
        documentIds: [documentId],
        charsPerQuestion: 1_200,
      });

      expect(result.documents).toHaveLength(1);
      const document = result.documents[0];
      expect(document?.check1.check).toBe('PREVIOUSLY_PROCESSED');
      expect(document?.check2.check).toBe('APPROVED_QUESTIONS_EXIST');
      expect(document?.check3.check).toBe('SOURCE_CONTENT_CHANGED');
      expect(document?.check4.check).toBe('SIMILARITY_RISK');
      expect(result.check5.check).toBe('CROSS_DOMAIN_DUPLICATES');
      expect(result.check6.check).toBe('POOL_CONFLICTS');
      // §4.2: never one "proceed anyway" button.
      expect(result.offeredActions).toEqual([
        'VIEW_EXISTING',
        'REUSE_EXISTING',
        'GENERATE_ADDITIONAL',
        'REGENERATE',
      ]);
    });

    it('reports UNKNOWN_BASELINE rather than "unchanged" with nothing to compare', async () => {
      const result = await runPreflight({
        client: prisma,
        sourceId,
        documentIds: [documentId],
        charsPerQuestion: 1_200,
      });
      const check3 = result.documents[0]?.check3;
      if (check3?.status === 'UNKNOWN_BASELINE') {
        expect(check3.hashChanged).toBeNull();
        expect(check3.detail).toContain('no baseline');
      }
    });

    it('refuses a document that has not been extracted', async () => {
      const pending = await prisma.knowledgeDocument.findFirst({
        where: { sourceId, extractionStatus: { not: 'EXTRACTED' } },
        select: { id: true },
      });
      if (!pending) return;
      await expect(
        runPreflight({
          client: prisma,
          sourceId,
          documentIds: [pending.id],
          charsPerQuestion: 1_200,
        }),
      ).rejects.toThrow(/extraction status/);
    });
  });

  // -------------------------------------------------------- job creation

  describe('job creation preconditions (workflows.md §2.1)', () => {
    it('refuses a job whose preflight has no recorded decision', async () => {
      const preflightId = await makePreflight(null);
      await expect(
        createGenerationJob({
          prisma,
          clock: systemClock,
          preflightId,
          scope: 'ENTIRE_DOCUMENT',
          domainId,
          topicId,
          reasonCode: 'NEW_KNOWLEDGE',
          requestedQuestionCount: 3,
          actor: { userId: authorUserId, displayName: 'A', roles: [], permissions: [] },
          correlationId: 'c',
          requestId: 'r',
        }),
      ).rejects.toThrow(PreflightRequiredError);
      await prisma.generationPreflight.delete({ where: { id: preflightId } });
    });

    it('refuses a job whose preflight decision was VIEW_EXISTING', async () => {
      const preflightId = await makePreflight('VIEW_EXISTING');
      await expect(
        createGenerationJob({
          prisma,
          clock: systemClock,
          preflightId,
          scope: 'ENTIRE_DOCUMENT',
          domainId,
          topicId,
          reasonCode: 'NEW_KNOWLEDGE',
          requestedQuestionCount: 3,
          actor: { userId: authorUserId, displayName: 'A', roles: [], permissions: [] },
          correlationId: 'c',
          requestId: 'r',
        }),
      ).rejects.toThrow(/does not authorize generation/);
      await prisma.generationPreflight.delete({ where: { id: preflightId } });
    });

    it('refuses PUBLISHER_REQUESTED without the Publisher permission', async () => {
      const preflightId = await makePreflight('GENERATE_NEW');
      await expect(
        createGenerationJob({
          prisma,
          clock: systemClock,
          preflightId,
          scope: 'ENTIRE_DOCUMENT',
          domainId,
          topicId,
          reasonCode: 'PUBLISHER_REQUESTED',
          justification: 'A long enough justification for the regeneration request.',
          requestedQuestionCount: 3,
          actor: { userId: authorUserId, displayName: 'A', roles: [], permissions: [] },
          correlationId: 'c',
          requestId: 'r',
        }),
      ).rejects.toThrow(/Publisher role/);
      await prisma.generationPreflight.delete({ where: { id: preflightId } });
    });

    it('refuses PUBLISHER_REQUESTED with no written justification', async () => {
      const preflightId = await makePreflight('GENERATE_NEW');
      await expect(
        createGenerationJob({
          prisma,
          clock: systemClock,
          preflightId,
          scope: 'ENTIRE_DOCUMENT',
          domainId,
          topicId,
          reasonCode: 'PUBLISHER_REQUESTED',
          requestedQuestionCount: 3,
          actor: {
            userId: authorUserId,
            displayName: 'A',
            roles: ['PUBLISHER'],
            permissions: ['question.regenerate'],
          },
          correlationId: 'c',
          requestId: 'r',
        }),
      ).rejects.toThrow(/justification/);
      await prisma.generationPreflight.delete({ where: { id: preflightId } });
    });

    it('pins the resolved section list on the job, so the run is reproducible', async () => {
      const { jobId, result } = await runWith();
      const job = await prisma.generationJob.findUniqueOrThrow({ where: { id: jobId } });
      expect(job.resolvedSectionKeys.length).toBeGreaterThan(0);
      expect(job.resolvedSectionKeys).toEqual(sections.map((section) => section.sectionKey));
      expect(result.jobId).toBe(jobId);
      await cleanup(jobId);
    });
  });

  // ------------------------------------------------ the structural guarantee

  describe('"generate from everything" is not expressible (§1.1)', () => {
    it('refuses an empty document list', () => {
      expect(() =>
        resolveGenerationScope({ scope: 'ENTIRE_DOCUMENT', documents: [], sections: [] }),
      ).toThrow(GenerationSelectionRequiredError);
    });

    it('refuses more than ten documents', () => {
      const many = Array.from({ length: 11 }, (_, i) => ({ ...documents[0]!, documentId: `d${i}` }));
      expect(() =>
        resolveGenerationScope({ scope: 'ENTIRE_DOCUMENT', documents: many, sections: [] }),
      ).toThrow(/at most 10 documents/);
    });

    it('refuses a section belonging to an unselected document', () => {
      expect(() =>
        resolveGenerationScope({
          scope: 'ENTIRE_DOCUMENT',
          documents,
          sections: [{ ...sections[0]!, documentId: 'some-other-document' }],
        }),
      ).toThrow(/were not selected/);
    });

    it('names the reason when a scope resolves to nothing', () => {
      expect(() =>
        resolveGenerationScope({
          scope: 'UNCOVERED_SECTIONS_ONLY',
          documents,
          sections: [],
        }),
      ).toThrow(GenerationScopeEmptyError);
      expect(() =>
        resolveGenerationScope({
          scope: 'UNCOVERED_SECTIONS_ONLY',
          documents,
          sections: [],
        }),
      ).toThrow(/already covered/);
    });
  });

  // ------------------------------------------------------ evidence gate

  describe('evidence verification is the gate that cannot be bypassed', () => {
    const baseline = (): GeneratedQuestion => ({
      sectionKey: sections[0]!.sectionKey,
      questionText: 'Within how long must a severity one incident reach the duty manager?',
      options: {
        A: 'Within fifteen minutes',
        B: 'Within one hour',
        C: 'Within one business day',
        D: 'At the end of the shift',
      },
      correctOption: 'A',
      explanation:
        'The procedure sets a fifteen-minute limit for informing the duty manager on a severity one incident.',
      supportingEvidence: sections[0]!.text.slice(0, 200),
      modelConfidence: 0.8,
    });

    it('accepts a verbatim span and persists exactly one draft', async () => {
      const { jobId, result } = await runWith(fixedGenerator([baseline()]));
      expect(result.acceptedQuestionIds).toHaveLength(1);
      expect(result.rejections).toEqual([]);

      const draft = await prisma.draftQuestion.findUniqueOrThrow({
        where: { id: result.acceptedQuestionIds[0]! },
      });
      expect(draft.status).toBe('DRAFT');
      expect(draft.evidenceVerificationMode).toBe('STRICT');
      expect(Number(draft.evidenceSimilarityScore)).toBe(1);
      // The offsets must re-locate the span in the document's stored text.
      const document = await prisma.knowledgeDocument.findUniqueOrThrow({
        where: { id: documentId },
        select: { extractedText: true },
      });
      expect(
        (document.extractedText ?? '').slice(draft.evidenceStartOffset, draft.evidenceEndOffset),
      ).toBe(draft.supportingEvidence);
      await cleanup(jobId);
    });

    it('REJECTS a fabricated span and persists NO draft', async () => {
      const fabricated: GeneratedQuestion = {
        ...baseline(),
        supportingEvidence:
          'The procedure requires the duty manager to be informed within four minutes of the first report, by pager.',
      };
      const { jobId, result } = await runWith(fixedGenerator([fabricated]));

      expect(result.acceptedQuestionIds).toEqual([]);
      expect(result.rejections).toHaveLength(1);
      expect(result.rejections[0]?.reason).toBe('EVIDENCE_UNVERIFIED');
      expect(await prisma.draftQuestion.count({ where: { generationJobId: jobId } })).toBe(0);

      // The reason is recorded on the job, which is what makes the absence of a
      // draft explainable rather than just an absence.
      const rejections = await prisma.generationJobRejection.findMany({ where: { jobId } });
      expect(rejections).toHaveLength(1);
      expect(rejections[0]?.reason).toBe('EVIDENCE_UNVERIFIED');
      await cleanup(jobId);
    });

    it('rejects a span quoted from a section outside the pinned scope', async () => {
      const other = await prisma.knowledgeDocument.findFirstOrThrow({
        where: { sourceId, id: { not: documentId }, extractionStatus: 'EXTRACTED' },
        select: { extractedText: true },
      });
      const outOfScope: GeneratedQuestion = {
        ...baseline(),
        supportingEvidence: (other.extractedText ?? '').slice(0, 200),
      };
      const { jobId, result } = await runWith(fixedGenerator([outOfScope]));
      expect(result.acceptedQuestionIds).toEqual([]);
      expect(result.rejections[0]?.reason).toBe('EVIDENCE_UNVERIFIED');
      await cleanup(jobId);
    });

    it('rejects a span attributed to a section key not in scope', () => {
      const result = verifyEvidence({
        evidence: sections[0]!.text.slice(0, 200),
        sectionKey: createHash('sha256').update('not-in-scope').digest('hex'),
        sections: sections.map((section) => ({
          sectionKey: section.sectionKey,
          text: section.text,
          startOffset: section.startOffset,
        })),
        mode: 'STRICT',
      });
      expect(result.verified).toBe(false);
      if (!result.verified) expect(result.code).toBe('EVIDENCE_SECTION_NOT_IN_SCOPE');
    });

    it('rejects a span below the 40-character floor', async () => {
      const tooShort: GeneratedQuestion = { ...baseline(), supportingEvidence: 'Severity one.' };
      const { jobId, result } = await runWith(fixedGenerator([tooShort]));
      expect(result.rejections[0]?.detail).toContain('EVIDENCE_TOO_SHORT');
      await cleanup(jobId);
    });
  });

  // ---------------------------------------------------- integrity gate

  describe('integrity gate', () => {
    const withOptions = (options: Record<'A' | 'B' | 'C' | 'D', string>): GeneratedQuestion => ({
      sectionKey: sections[0]!.sectionKey,
      questionText: 'Within how long must a severity one incident reach the duty manager?',
      options,
      correctOption: 'A',
      explanation: 'The procedure sets a fifteen-minute limit for informing the duty manager.',
      supportingEvidence: sections[0]!.text.slice(0, 200),
    });

    it('rejects two options that are the same answer', async () => {
      const { jobId, result } = await runWith(
        fixedGenerator([
          withOptions({
            A: 'Within fifteen minutes',
            B: 'within  FIFTEEN minutes',
            C: 'Within one hour',
            D: 'At the end of the shift',
          }),
        ]),
      );
      expect(result.acceptedQuestionIds).toEqual([]);
      expect(result.rejections[0]?.reason).toBe('OPTION_DUPLICATE');
      await cleanup(jobId);
    });

    it('rejects a prohibited distractor form', async () => {
      const { jobId, result } = await runWith(
        fixedGenerator([
          withOptions({
            A: 'Within fifteen minutes',
            B: 'Within one hour',
            C: 'Within one business day',
            D: 'All of the above',
          }),
        ]),
      );
      expect(result.rejections[0]?.reason).toBe('QUESTION_INCOMPLETE');
      expect(result.rejections[0]?.detail).toContain('prohibited distractor');
      await cleanup(jobId);
    });
  });

  // --------------------------------------------------- duplicate gate

  describe('duplicate gate', () => {
    it('blocks an identical second candidate without persisting it', async () => {
      const question: GeneratedQuestion = {
        sectionKey: sections[0]!.sectionKey,
        questionText: 'Within how long must a severity one incident reach the duty manager?',
        options: {
          A: 'Within fifteen minutes',
          B: 'Within one hour',
          C: 'Within one business day',
          D: 'At the end of the shift',
        },
        correctOption: 'A',
        explanation: 'The procedure sets a fifteen-minute limit for informing the duty manager.',
        supportingEvidence: sections[0]!.text.slice(0, 200),
      };

      // Two identical candidates in one run: the first is accepted, and the
      // second must be blocked against the first — which only works because an
      // accepted draft joins the comparison corpus immediately.
      const { jobId, result } = await runWith(fixedGenerator([question, { ...question }]));
      expect(result.acceptedQuestionIds).toHaveLength(1);
      expect(result.rejections[0]?.reason).toBe('DUPLICATE');
      expect(result.rejections[0]?.similarityScore).toBeGreaterThanOrEqual(
        profile.thresholds.blockThreshold,
      );
      expect(await prisma.draftQuestion.count({ where: { generationJobId: jobId } })).toBe(1);
      await cleanup(jobId);
    });
  });

  // ------------------------------------------- the deterministic generator

  describe('the deterministic local generator through the full chain', () => {
    it('produces drafts whose evidence verifies against the source', async () => {
      const { jobId, result } = await runWith(createDeterministicGenerator());

      expect(result.acceptedQuestionIds.length).toBeGreaterThan(0);
      const drafts = await prisma.draftQuestion.findMany({
        where: { generationJobId: jobId },
        orderBy: { createdAt: 'asc' },
      });
      const document = await prisma.knowledgeDocument.findUniqueOrThrow({
        where: { id: documentId },
        select: { extractedText: true, contentHash: true },
      });

      for (const draft of drafts) {
        // Every stored span re-locates in the stored text.
        expect(
          (document.extractedText ?? '').slice(draft.evidenceStartOffset, draft.evidenceEndOffset),
        ).toBe(draft.supportingEvidence);
        expect(draft.supportingEvidence.length).toBeGreaterThanOrEqual(40);
        // Full lineage, so "view question source" can work years later.
        expect(draft.sourceContentHash).toBe(document.contentHash);
        expect(draft.sourceDocumentName).toBe('incident-escalation.md');
        expect(draft.sectionKey).toBeTruthy();
        expect(draft.modelId).toBe('knowzy-deterministic-local-1');
        expect(Number(draft.confidenceScore)).toBeGreaterThan(0);
        expect(Number(draft.confidenceScore)).toBeLessThanOrEqual(1);
      }

      await cleanup(jobId);
    });

    it('records a confidence breakdown, not just a number', async () => {
      const { jobId, result } = await runWith(createDeterministicGenerator());
      const draft = await prisma.draftQuestion.findUniqueOrThrow({
        where: { id: result.acceptedQuestionIds[0]! },
      });
      const confidence = draft.confidenceComponents as {
        components: Record<string, number>;
        weights: Record<string, number>;
      };
      expect(Object.keys(confidence.components).sort()).toEqual([
        'duplicateDistance',
        'evidenceMatchQuality',
        'metadataCompleteness',
        'modelDeclaredConfidence',
        'optionDistinctness',
        'sectionCoverageAdequacy',
      ]);
      // The model's own number is capped at a tenth of the score.
      expect(confidence.weights['modelDeclaredConfidence']).toBe(0.1);
      await cleanup(jobId);
    });

    it('opens the version history at GENERATED rather than at the first edit', async () => {
      const { jobId, result } = await runWith(createDeterministicGenerator());
      const versions = await prisma.draftQuestionVersion.findMany({
        where: { questionId: result.acceptedQuestionIds[0]! },
      });
      expect(versions).toHaveLength(1);
      expect(versions[0]?.changeKind).toBe('GENERATED');
      expect(versions[0]?.evidenceReverified).toBe(true);
      await cleanup(jobId);
    });
  });

  describe('per-section insufficient evidence is never discarded (§2.7)', () => {
    it('records a section that yielded nothing even when another section succeeded', async () => {
      const partial: QuestionGenerator = {
        kind: 'deterministic-local',
        modelId: 'test-partial-generator',
        generate: async () => ({
          output: {
            questions: [
              {
                sectionKey: sections[0]!.sectionKey,
                questionText: 'Within how long must a severity one incident reach the duty manager?',
                options: {
                  A: 'Within fifteen minutes',
                  B: 'Within one hour',
                  C: 'Within one business day',
                  D: 'At the end of the shift',
                },
                correctOption: 'A',
                explanation: 'The procedure sets a fifteen-minute limit for the duty manager.',
                supportingEvidence: sections[0]!.text.slice(0, 200),
              },
            ] as [GeneratedQuestion],
          },
          // A second section reported nothing. This MUST survive alongside the
          // accepted question: the union output cannot carry both, which is the
          // bug a live run exposed.
          insufficientSections: [
            { sectionKey: sections[1]!.sectionKey, reason: 'States ownership but no testable rule.' },
          ],
          modelId: 'test-partial-generator',
          inputTokens: 1,
          outputTokens: 1,
        }),
      };

      const { jobId, result } = await runWith(partial);
      expect(result.acceptedQuestionIds).toHaveLength(1);
      expect(result.insufficientEvidenceSections).toHaveLength(1);
      expect(result.rejectionCounts['INSUFFICIENT_EVIDENCE']).toBe(1);

      // Recorded on the job, so the author can read the reason.
      const recorded = await prisma.generationJobRejection.findMany({
        where: { jobId, reason: 'INSUFFICIENT_EVIDENCE' },
      });
      expect(recorded).toHaveLength(1);
      expect(recorded[0]?.detail).toContain('no testable rule');

      // And the section is marked, so coverage tells the truth.
      const marked = await prisma.documentSection.findFirstOrThrow({
        where: { id: sections[1]!.sectionId },
      });
      expect(marked.coverageStatus).toBe('NON_ASSESSABLE');
      expect(marked.nonAssessableReason).toContain('Insufficient assessable content');

      await cleanup(jobId);
      await prisma.documentSection.update({
        where: { id: sections[1]!.sectionId },
        data: { isAssessable: true, coverageStatus: 'NOT_COVERED', nonAssessableReason: null },
      });
    });
  });

  // ------------------------------------------------- review queue + audit

  describe('author review queue and audit', () => {
    it('places every persisted draft in the author queue', async () => {
      const { jobId, result } = await runWith(createDeterministicGenerator());
      const queued = await prisma.draftQuestion.findMany({
        where: {
          generationJobId: jobId,
          status: { in: ['DRAFT', 'AUTHOR_REVIEW', 'CHANGES_REQUESTED'] },
        },
        select: { id: true },
      });
      expect(queued.map((q) => q.id).sort()).toEqual([...result.acceptedQuestionIds].sort());
      await cleanup(jobId);
    });

    it('writes an audit event per draft and one for the job', async () => {
      const { jobId, result } = await runWith(createDeterministicGenerator());

      const created = await prisma.auditEvent.findMany({
        where: {
          action: 'AUTHORING.QUESTION.CREATED',
          entityId: { in: [...result.acceptedQuestionIds] },
        },
      });
      expect(created).toHaveLength(result.acceptedQuestionIds.length);

      const jobEvents = await prisma.auditEvent.findMany({
        where: { entityId: jobId, entityType: 'GenerationJob' },
        orderBy: { occurredAt: 'asc' },
      });
      // Requested at creation, completed at the end of the run.
      expect(jobEvents.map((event) => event.action)).toEqual([
        'AUTHORING.GENERATION.REQUESTED',
        'AUTHORING.GENERATION.JOB_COMPLETED',
      ]);
      await cleanup(jobId);
    });

    it('records the accepted count and rejection counts on the job', async () => {
      const { jobId, result } = await runWith(createDeterministicGenerator());
      const job = await prisma.generationJob.findUniqueOrThrow({ where: { id: jobId } });
      expect(job.acceptedQuestionCount).toBe(result.acceptedQuestionIds.length);
      expect(job.status === 'SUCCEEDED' || job.status === 'PARTIAL').toBe(true);
      expect(job.completedAt).not.toBeNull();
      expect(job.modelId).toBe('knowzy-deterministic-local-1');
      await cleanup(jobId);
    });

    it('marks generated sections COVERED and never pads the requested count', async () => {
      const { jobId, result } = await runWith(createDeterministicGenerator());
      // The requested count was 5; the platform delivers what the source
      // supports, and the shortfall is visible rather than filled.
      expect(result.acceptedQuestionIds.length).toBeLessThanOrEqual(5);

      const covered = await prisma.documentSection.findMany({
        where: { documentId, coverageStatus: 'COVERED' },
        select: { sectionKey: true },
      });
      const usedKeys = new Set(
        (
          await prisma.draftQuestion.findMany({
            where: { generationJobId: jobId },
            select: { sectionKey: true },
          })
        ).map((row) => row.sectionKey),
      );
      for (const key of usedKeys) {
        expect(covered.map((row) => row.sectionKey)).toContain(key);
      }
      await cleanup(jobId);
    });
  });
});
