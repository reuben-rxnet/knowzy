// AI Document Studio M3 against a real database
// (docs/competencies/AI_DOCUMENT_STUDIO_ARCHITECTURE.md §11).
//
// The whole journey through the domain service, with the two things the API
// supplies replaced by honest fakes:
//
//   * StudioStorage writes into memory instead of the Studio directory;
//   * StudioSync does what the MCP synchronization does -- extracts each file
//     with the platform's own extractor and writes the document and its
//     sections -- so the documents it creates are the documents a real sync
//     would create.
//
// The browser suite drives the real MCP path end to end.
//
// What it pins down: the CP-5 refusal; the test preparer's draft; refusal of
// an invented figure and failure of malformed output, each recorded on its
// run with no version created; save, restore and discard; the confirmation
// requirement; supersession and the exclusion that follows it; revalidation
// when the original changes; and a question generated FROM the prepared
// document, citing it as its immediate source, with lineage to the original.
//
// Everything is synthetic, in throwaway sources under a throwaway root. Rows
// are left in place where a trigger or an FK makes them permanent (audit,
// generated questions); every other row this suite creates it removes.

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { systemClock } from '@knowzy/observability';
import { extractContent } from '@knowzy/content-extraction';
import { createTestPreparer, type DocumentPreparer } from '@knowzy/claude-services';
import {
  acceptUpload,
  addToRepository,
  createGenerationJob,
  DocumentPreparationError,
  preparedDocumentDetail,
  preparedLineageFor,
  prepareDocument,
  rejectDraft,
  restoreAiVersion,
  revalidatePreparedVersions,
  reviewAgainstUpdatedOriginal,
  runGenerationJob,
  savePreparedContent,
  startFromDocument,
  STUDIO_ORIGINALS,
  STUDIO_PREPARED,
  sourceRoot,
  type StudioStorage,
  type StudioSync,
} from '../src/index.js';
import { testControl, testControlSettings } from './control-layer-fixture.js';

const DATABASE_URL = process.env['DATABASE_URL'];
const describeDb = DATABASE_URL ? describe : describe.skip;
const prisma = new PrismaClient(
  DATABASE_URL ? { datasources: { db: { url: DATABASE_URL } } } : undefined,
);

const RUN = randomUUID().slice(0, 8);
const ROOT = `/tmp/knowzy-studio-it-${RUN}`;

/** A synthetic procedure whose sections are long enough to be assessable. */
const SOP = (codename: string, days: number): string =>
  [
    `# Lantern ${codename} Procedure`,
    '',
    `## ${codename} Authority Limits`,
    '',
    `A desk clerk may grant a lantern refund worth up to 40 ${codename} units without further review.`,
    `A refund above that requires the shift lead's approval, recorded in the returns ledger before anything`,
    `is granted, and the shift lead may not approve a request they raised. Above 900 units the desk`,
    `director must also approve in writing, and the clerk attaches that approval to the ledger entry.`,
    '',
    `## ${codename} Response Windows`,
    '',
    `A returns request marked urgent must receive a first response within 25 minutes. A standard request`,
    `must receive one within 6 hours, and an unanswered ledger entry is escalated to the shift lead the`,
    `moment that window passes. A low-priority request must receive a first response within ${days} working`,
    `days; the clock pauses only while the ledger entry waits for information the customer has to supply.`,
    '',
  ].join('\n');

/** In-memory storage, keyed by source folder then file name. */
const memoryStorage = (): StudioStorage & { files: Map<string, Map<string, Uint8Array>> } => {
  const files = new Map<string, Map<string, Uint8Array>>([
    [STUDIO_ORIGINALS.folder, new Map()],
    [STUDIO_PREPARED.folder, new Map()],
  ]);
  return {
    root: ROOT,
    files,
    async writeOriginal(name, bytes) {
      files.get(STUDIO_ORIGINALS.folder)?.set(name, bytes);
    },
    async removeOriginal(name) {
      files.get(STUDIO_ORIGINALS.folder)?.delete(name);
    },
    async writePrepared(name, text) {
      files.get(STUDIO_PREPARED.folder)?.set(name, new Uint8Array(Buffer.from(text, 'utf8')));
    },
  };
};

/** What the MCP synchronization does for a FILE_REPOSITORY source, in miniature. */
const syncFake = (storage: ReturnType<typeof memoryStorage>): StudioSync => ({
  testConnection: async (sourceId) => {
    await prisma.knowledgeSource.update({
      where: { id: sourceId },
      data: { connectionStatus: 'HEALTHY', connectionStatusAt: systemClock.now() },
    });
  },
  synchronize: async (sourceId) => {
    const source = await prisma.knowledgeSource.findUniqueOrThrow({
      where: { id: sourceId },
      select: { connection: true, paths: { select: { id: true } } },
    });
    const root = (source.connection as { localRoot: string }).localRoot;
    const folder =
      root === sourceRoot(ROOT, STUDIO_ORIGINALS)
        ? STUDIO_ORIGINALS.folder
        : STUDIO_PREPARED.folder;
    const pathId = source.paths[0]?.id ?? '';
    for (const [name, bytes] of storage.files.get(folder) ?? []) {
      const extension = name.split('.').pop() ?? '';
      const extracted = await extractContent(
        {
          fileName: name,
          content:
            extension === 'md' || extension === 'txt' ? Buffer.from(bytes).toString('utf8') : bytes,
        },
        { documentScope: name },
      );
      const existing = await prisma.knowledgeDocument.findUnique({
        where: { sourceId_sourceDocumentId: { sourceId, sourceDocumentId: name } },
        select: { id: true, contentHash: true, localVersionCounter: true },
      });
      if (existing !== null && existing.contentHash === extracted.contentHash) continue;
      const versionCounter = (existing?.localVersionCounter ?? 0) + 1;
      const data = {
        sourceId,
        pathId,
        sourceDocumentId: name,
        name,
        containerName: 'Test',
        containerId: 'Test',
        folderPath: '',
        sourceUrl: '',
        fileType: extension,
        fileSizeBytes: BigInt(bytes.length),
        sourceCreatedAt: systemClock.now(),
        sourceVersion: String(versionCounter),
        localVersionCounter: versionCounter,
        contentHash: extracted.contentHash,
        extractedText: extracted.normalizedText,
        extractedCharCount: extracted.charCount,
        extractionStatus: extracted.status as 'EXTRACTED',
        extractionReason: extracted.reason,
        sourceMetadata: {},
        status: 'ACTIVE' as const,
        lastSynchronizedAt: systemClock.now(),
      };
      const document = await prisma.knowledgeDocument.upsert({
        where: { sourceId_sourceDocumentId: { sourceId, sourceDocumentId: name } },
        create: data,
        update: data,
        select: { id: true },
      });
      for (const section of extracted.sections) {
        await prisma.documentSection.create({
          data: {
            documentId: document.id,
            sectionKey: section.sectionKey,
            sectionKeyV1: section.sectionKeyV1,
            ordinal: section.ordinal,
            heading: section.heading ?? null,
            headingPath: section.headingPath ?? null,
            startOffset: section.startOffset,
            endOffset: section.endOffset,
            sectionContentHash: section.sectionContentHash,
            assessableCharCount: section.text.length,
            isAssessable: section.isAssessable,
            nonAssessableReason: section.nonAssessableReason ?? null,
            targetQuestionCount: 0,
            coverageStatus: section.isAssessable ? 'NOT_COVERED' : 'NON_ASSESSABLE',
            documentVersionCounter: versionCounter,
          },
        });
      }
    }
  },
});

/** A "live" preparer the test controls: what a misbehaving model would return. */
const scriptedPreparer = (output: unknown): DocumentPreparer => ({
  providerId: 'OPENAI',
  modelId: 'scripted-test-model',
  live: true,
  prepare: async () => ({
    output,
    inputTokens: 10,
    outputTokens: 10,
    servedModel: 'scripted-test-model',
  }),
});

describeDb('AI Document Studio M3: assessment preparation', () => {
  const storage = memoryStorage();
  const sync = syncFake(storage);
  let actor = { userId: '', displayName: '', roles: ['KNOWZY_ADMINISTRATOR'] as readonly string[] };
  const ctx = () => ({
    prisma,
    clock: systemClock,
    actor,
    correlationId: randomUUID(),
    requestId: randomUUID(),
  });
  const controls = testControlSettings();

  beforeAll(async () => {
    await prisma.$connect();
    const admin = await prisma.user.findFirstOrThrow({
      where: { userPrincipalName: 'knowzy-administrator@local.invalid' },
      select: { id: true, displayName: true },
    });
    actor = { userId: admin.id, displayName: admin.displayName, roles: ['KNOWZY_ADMINISTRATOR'] };
  });

  afterAll(async () => {
    // Everything this run created, found by its throwaway root, removed in FK
    // order -- generated questions first, which also lifts the version
    // trigger, then the Studio rows, then the documents and sources. Audit
    // rows are append-only and stay.
    const sources = await prisma.knowledgeSource.findMany({
      where: { connection: { path: ['localRoot'], string_starts_with: ROOT } },
      select: { id: true },
    });
    const sourceIds = sources.map((row) => row.id);
    const jobs = await prisma.generationJob.findMany({
      where: { sourceId: { in: sourceIds } },
      select: { id: true, preflightId: true },
    });
    const jobIds = jobs.map((job) => job.id);
    const questions = await prisma.draftQuestion.findMany({
      where: { generationJobId: { in: jobIds } },
      select: { id: true },
    });
    await prisma.draftQuestionVersion.deleteMany({
      where: { questionId: { in: questions.map((q) => q.id) } },
    });
    await prisma.draftQuestion.deleteMany({ where: { generationJobId: { in: jobIds } } });
    await prisma.generationProviderCall.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.generationJobRejection.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.generationJobDocument.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.generationJob.deleteMany({ where: { id: { in: jobIds } } });
    await prisma.generationPreflight.deleteMany({
      where: { id: { in: jobs.map((job) => job.preflightId) } },
    });
    const documents = await prisma.knowledgeDocument.findMany({
      where: { sourceId: { in: sourceIds } },
      select: { id: true },
    });
    const documentIds = documents.map((row) => row.id);
    const prepared = await prisma.preparedDocument.findMany({
      where: { originalDocumentId: { in: documentIds } },
      select: { id: true },
    });
    const preparedIds = prepared.map((row) => row.id);
    await prisma.preparedDocumentVersion.deleteMany({
      where: { preparedDocumentId: { in: preparedIds } },
    });
    await prisma.documentPreparationRun.deleteMany({
      where: { preparedDocumentId: { in: preparedIds } },
    });
    await prisma.preparedDocument.deleteMany({ where: { id: { in: preparedIds } } });
    await prisma.studioUpload.deleteMany({ where: { knowledgeDocumentId: { in: documentIds } } });
    await prisma.documentGenerationStat.deleteMany({ where: { documentId: { in: documentIds } } });
    await prisma.documentSection.deleteMany({ where: { documentId: { in: documentIds } } });
    await prisma.knowledgeDocument.deleteMany({ where: { id: { in: documentIds } } });
    await prisma.knowledgeSourcePath.deleteMany({ where: { sourceId: { in: sourceIds } } });
    await prisma.knowledgeSource.deleteMany({ where: { id: { in: sourceIds } } });
    await prisma.$disconnect();
  });

  let preparedDocumentId = '';
  let originalDocumentId = '';

  it('adds an uploaded original, kept unchanged, and refuses the same file twice', async () => {
    const bytes = new Uint8Array(Buffer.from(SOP(`Kestrel${RUN}`, 4), 'utf8'));
    const sha256 = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');
    const accepted = await acceptUpload(ctx(), {
      storage,
      sync,
      originalFileName: `Lantern Returns ${RUN}.md`,
      extension: 'md',
      bytes,
      sha256,
    });
    preparedDocumentId = accepted.preparedDocumentId;
    originalDocumentId = accepted.originalDocumentId;
    const upload = await prisma.studioUpload.findUniqueOrThrow({ where: { sha256 } });
    expect(upload.originalFileName).toBe(`Lantern Returns ${RUN}.md`);
    expect(upload.storedFileName).toMatch(/^[0-9a-f-]{36}\.md$/);
    expect(upload.scanStatus).toBe('NOT_SCANNED');
    // The stored bytes are the uploaded bytes.
    expect(storage.files.get('originals')?.get(upload.storedFileName)).toEqual(bytes);

    await expect(
      acceptUpload(ctx(), {
        storage,
        sync,
        originalFileName: 'again.md',
        extension: 'md',
        bytes,
        sha256,
      }),
    ).rejects.toMatchObject({ code: 'DUPLICATE' });
    const refused = await prisma.auditEvent.findFirst({
      where: { action: 'AUTHORING.DOCUMENT_PREPARATION.UPLOAD_REFUSED', actorUserId: actor.userId },
      orderBy: { occurredAt: 'desc' },
      select: { detail: true },
    });
    expect((refused?.detail as { control?: string }).control).toBe('DUPLICATE');
  });

  it('removes an upload the extractor cannot read, and marks its row deleted', async () => {
    const bytes = new Uint8Array(Buffer.from('%PDF-1.4 not really a pdf', 'latin1'));
    const sha256 = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');
    await expect(
      acceptUpload(ctx(), {
        storage,
        sync,
        originalFileName: 'broken.pdf',
        extension: 'pdf',
        bytes,
        sha256,
      }),
    ).rejects.toMatchObject({ code: 'UPLOAD_REFUSED' });
    expect(
      [...(storage.files.get('originals')?.keys() ?? [])].some((name) => name.endsWith('.pdf')),
    ).toBe(false);
    expect(await prisma.studioUpload.findUnique({ where: { sha256 } })).toBeNull();
  });

  it('chooses an existing document once: one prepared document per original', async () => {
    const again = await startFromDocument(ctx(), {
      documentId: originalDocumentId,
      storageRoot: ROOT,
    });
    expect(again).toEqual({ preparedDocumentId, created: false });
  });

  it('refuses with the brief’s sentence when nothing may prepare (CP-5 unrecorded)', async () => {
    await expect(
      prepareDocument(ctx(), { preparedDocumentId, live: null, test: null, controls }),
    ).rejects.toThrow(
      'AI document preparation is not yet enabled for this environment. Contact your administrator.',
    );
  });

  it('refuses an invented figure and fails malformed output, with no version created', async () => {
    const invented = {
      sections: [
        {
          heading: 'Limits',
          kind: 'THRESHOLD',
          blocks: [{ type: 'paragraph', text: 'Refunds up to 4000 units.' }],
        },
      ],
      findings: [],
    };
    await expect(
      prepareDocument(ctx(), {
        preparedDocumentId,
        live: scriptedPreparer(invented),
        test: null,
        controls,
      }),
    ).rejects.toMatchObject({ code: 'PREPARATION_OUTPUT_REFUSED' });
    await expect(
      prepareDocument(ctx(), {
        preparedDocumentId,
        live: scriptedPreparer({ sections: 'not an array' }),
        test: null,
        controls,
      }),
    ).rejects.toMatchObject({ code: 'SCHEMA_INVALID' });
    const runs = await prisma.documentPreparationRun.findMany({
      where: { preparedDocumentId },
      orderBy: { startedAt: 'asc' },
      select: { status: true, failureClass: true, inputTokens: true },
    });
    expect(runs.map((run) => [run.status, run.failureClass])).toEqual([
      ['REFUSED', 'INVENTED_QUANTITY'],
      ['FAILED', 'MALFORMED_OUTPUT'],
    ]);
    // The tokens are spent and counted, even when the output is refused.
    expect(runs[0]?.inputTokens).toBe(10);
    expect(await prisma.preparedDocumentVersion.count({ where: { preparedDocumentId } })).toBe(0);
  });

  it('refuses a live run over the per-job token ceiling, recorded as REFUSED', async () => {
    await expect(
      prepareDocument(ctx(), {
        preparedDocumentId,
        live: scriptedPreparer({}),
        test: null,
        controls: testControlSettings({ perJobTokenBudget: 1 }),
      }),
    ).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
  });

  let v1 = '';
  it('prepares with the test preparer: a DRAFT, labelled not-live, verbatim', async () => {
    const result = await prepareDocument(ctx(), {
      preparedDocumentId,
      live: null,
      test: createTestPreparer(),
      controls,
    });
    v1 = result.versionId;
    const detail = await preparedDocumentDetail(prisma, { preparedDocumentId, storageRoot: ROOT });
    expect(detail.current?.state).toBe('DRAFT');
    expect(detail.current?.live).toBe(false);
    expect(detail.current?.providerId).toBe('TEST_PREPARATION');
    expect(detail.current?.versionNumber).toBe(1);
    expect(detail.current?.content).toContain('must receive a first response within 25 minutes');
    expect(detail.current?.marked.some((node) => node.type === 'heading')).toBe(true);
    // The original's own headings are not "added": the comparison includes
    // them, though the extracted text carries headings separately.
    expect(detail.current?.marked.filter((node) => node.type === 'heading' && node.added)).toEqual(
      [],
    );
    expect(
      detail.original.sections.some((section) => section.heading?.includes('Authority Limits')),
    ).toBe(true);
    expect(detail.current?.warnings).toEqual([]);
  });

  it('saves a draft in place, restores the prepared version, and needs confirmation to add', async () => {
    const original = (await prisma.preparedDocumentVersion.findUniqueOrThrow({ where: { id: v1 } }))
      .content;
    const saved = await savePreparedContent(ctx(), {
      versionId: v1,
      content: `${original}\nAn extra note.\n`,
    });
    expect(saved).toMatchObject({ versionId: v1, created: false });
    await restoreAiVersion(ctx(), v1);
    expect(
      (await prisma.preparedDocumentVersion.findUniqueOrThrow({ where: { id: v1 } })).content,
    ).toBe(original);
    await expect(
      addToRepository(ctx(), { versionId: v1, confirmed: false, storage, sync }),
    ).rejects.toBeInstanceOf(DocumentPreparationError);
  });

  let repositoryDocumentId = '';
  let repositorySourceId = '';
  it('adds the exact version to the repository, once', async () => {
    const added = await addToRepository(ctx(), { versionId: v1, confirmed: true, storage, sync });
    repositoryDocumentId = added.repositoryDocumentId;
    repositorySourceId = added.repositorySourceId;
    const version = await prisma.preparedDocumentVersion.findUniqueOrThrow({ where: { id: v1 } });
    expect(version.state).toBe('READY_FOR_QUESTION_GENERATION');
    expect(version.addedByUserId).toBe(actor.userId);
    const document = await prisma.knowledgeDocument.findUniqueOrThrow({
      where: { id: repositoryDocumentId },
    });
    expect(document.isExcludedFromGeneration).toBe(false);
    expect(document.name).toMatch(/ - Assessment-prepared v1 \([0-9a-f]{8}\)\.md$/);
    // Markers never reach the repository text.
    expect(document.extractedText ?? '').not.toMatch(/\[!|too short to support/);
    const source = await prisma.knowledgeSource.findUniqueOrThrow({
      where: { id: repositorySourceId },
    });
    expect(source.usableForGeneration).toBe(true);
    await expect(
      addToRepository(ctx(), { versionId: v1, confirmed: true, storage, sync }),
    ).rejects.toMatchObject({ code: 'DUPLICATE' });
  });

  it('generates questions FROM the prepared document, citing it with lineage to the original', async () => {
    const domain = await prisma.domain.findFirstOrThrow({
      where: { code: 'SUPPORT_OPS' },
      select: { id: true },
    });
    const topic = await prisma.topic.findFirstOrThrow({
      where: { domainId: domain.id },
      select: { id: true },
    });
    const preflight = await prisma.generationPreflight.create({
      data: {
        sourceId: repositorySourceId,
        documentIds: [repositoryDocumentId],
        checkResults: {},
        recommendation: 'GENERATE_NEW',
        chosenAction: 'GENERATE_NEW',
        chosenAt: systemClock.now(),
        chosenByUserId: actor.userId,
        expiresAt: new Date(systemClock.now().getTime() + 10 * 60 * 1000),
        correlationId: 'studio-it',
        createdByUserId: actor.userId,
      },
      select: { id: true },
    });
    const created = await createGenerationJob({
      prisma,
      clock: systemClock,
      preflightId: preflight.id,
      scope: 'ENTIRE_DOCUMENT',
      domainId: domain.id,
      topicId: topic.id,
      reasonCode: 'NEW_KNOWLEDGE',
      requestedQuestionCount: 3,
      actor: { ...actor, permissions: ['question.generate'] },
      correlationId: 'studio-it',
      requestId: 'studio-it',
    });
    await runGenerationJob({
      prisma,
      clock: systemClock,
      scope: created.resolvedScope,
      profile: created.profile,
      requestedQuestionCount: created.requestedQuestionCount,
      control: testControl(),
      context: {
        jobId: created.jobId,
        sourceId: created.sourceId,
        domainId: domain.id,
        topicId: topic.id,
        correlationId: 'studio-it',
        requestId: 'studio-it',
        actorUserId: actor.userId,
        actorDisplayName: actor.displayName,
        actorRoles: [...actor.roles],
        reasonCode: 'NEW_KNOWLEDGE',
      },
    });
    const questions = await prisma.draftQuestion.findMany({
      where: { generationJobId: created.jobId },
      select: {
        sourceId: true,
        sourceDocumentId: true,
        sectionKey: true,
        supportingEvidence: true,
      },
    });
    expect(questions.length).toBeGreaterThan(0);
    const repository = await prisma.knowledgeDocument.findUniqueOrThrow({
      where: { id: repositoryDocumentId },
      select: { extractedText: true, sourceDocumentId: true },
    });
    for (const question of questions) {
      // The immediate source is the prepared document, and its evidence is in it.
      expect(question.sourceId).toBe(repositorySourceId);
      expect(repository.extractedText).toContain(question.supportingEvidence);
    }
    const lineage = await preparedLineageFor(prisma, {
      sourceId: repositorySourceId,
      sourceDocumentId: repository.sourceDocumentId,
    });
    expect(lineage).toMatchObject({
      preparedDocumentId,
      versionNumber: 1,
      originalDocumentId,
      originalVersionCounter: 1,
      live: false,
    });
    // A version with downstream questions can never be destructively deleted.
    await expect(prisma.preparedDocumentVersion.delete({ where: { id: v1 } })).rejects.toThrow();
  });

  let v2 = '';
  it('editing a ready version opens a new draft; adding it supersedes the old one', async () => {
    const content = (await prisma.preparedDocumentVersion.findUniqueOrThrow({ where: { id: v1 } }))
      .content;
    const saved = await savePreparedContent(ctx(), {
      versionId: v1,
      content: content.replace('Authority Limits', 'Authority limits for refunds'),
    });
    expect(saved.created).toBe(true);
    v2 = saved.versionId;
    expect(
      (await prisma.preparedDocumentVersion.findUniqueOrThrow({ where: { id: v1 } })).state,
    ).toBe('READY_FOR_QUESTION_GENERATION');
    const added = await addToRepository(ctx(), { versionId: v2, confirmed: true, storage, sync });
    expect(added.supersededVersionIds).toEqual([v1]);
    const old = await prisma.preparedDocumentVersion.findUniqueOrThrow({
      where: { id: v1 },
      select: { state: true, repository: { select: { isExcludedFromGeneration: true } } },
    });
    expect(old.state).toBe('SUPERSEDED');
    expect(old.repository?.isExcludedFromGeneration).toBe(true);
  });

  it('flags the ready version when the original changes, and revalidation clears it', async () => {
    const upload = await prisma.studioUpload.findFirstOrThrow({
      where: { knowledgeDocumentId: originalDocumentId },
    });
    // The original changes at its source (a new version arrives).
    storage.files
      .get('originals')
      ?.set(upload.storedFileName, new Uint8Array(Buffer.from(SOP(`Kestrel${RUN}`, 7), 'utf8')));
    const originalsSource = await prisma.knowledgeDocument.findUniqueOrThrow({
      where: { id: originalDocumentId },
      select: { sourceId: true },
    });
    await sync.synchronize(originalsSource.sourceId);
    expect(
      await revalidatePreparedVersions({ prisma, clock: systemClock, correlationId: 'it' }),
    ).toBeGreaterThan(0);
    const flagged = await prisma.preparedDocumentVersion.findUniqueOrThrow({
      where: { id: v2 },
      select: {
        state: true,
        revalidationReason: true,
        repository: { select: { isExcludedFromGeneration: true } },
      },
    });
    expect(flagged.state).toBe('REVALIDATION_REQUIRED');
    expect(flagged.revalidationReason).toMatch(/changed/);
    expect(flagged.repository?.isExcludedFromGeneration).toBe(true);

    const review = await reviewAgainstUpdatedOriginal(ctx(), v2);
    const v3 = await prisma.preparedDocumentVersion.findUniqueOrThrow({
      where: { id: review.versionId },
    });
    expect(v3.state).toBe('DRAFT');
    expect(v3.origin).toBe('REVALIDATION_REVIEW');
    expect(v3.originalVersionCounter).toBe(2);
    await addToRepository(ctx(), { versionId: v3.id, confirmed: true, storage, sync });
    expect(
      (await prisma.preparedDocumentVersion.findUniqueOrThrow({ where: { id: v2 } })).state,
    ).toBe('SUPERSEDED');
  });

  it('discards a draft as REJECTED, never deleting it', async () => {
    const prepared = await prepareDocument(ctx(), {
      preparedDocumentId,
      live: null,
      test: createTestPreparer(),
      controls,
    });
    await rejectDraft(ctx(), prepared.versionId);
    const row = await prisma.preparedDocumentVersion.findUniqueOrThrow({
      where: { id: prepared.versionId },
    });
    expect(row.state).toBe('REJECTED');
    expect(row.rejectedByUserId).toBe(actor.userId);
  });
});
