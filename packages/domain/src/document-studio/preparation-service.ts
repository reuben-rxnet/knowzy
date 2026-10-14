// AI Document Studio M3 -- assessment preparation, the writes
// (docs/competencies/AI_DOCUMENT_STUDIO_ARCHITECTURE.md §11).
//
// Every act here is one transaction with its audit event, and none of them
// writes the ORIGINAL document: an upload is a new file synchronized into the
// Studio's Originals source, and a prepared version added to the repository
// is a new file in the Assessment-prepared source.
//
// Three rules a change here is most likely to break:
//
//   * A PROVIDER'S OUTPUT IS CHECKED BEFORE IT IS A VERSION. It must parse
//     against the strict schema, and it may contain no figure the original
//     does not. A failure or a refusal is recorded on its run row; no version
//     is created from it.
//
//   * THE TEST PREPARER IS NOT AI. It is only ever passed in by the API where
//     the local-only flag allows, it is recorded as TEST_PREPARATION, and every
//     read says `live: false` so no screen can call its output AI.
//
//   * A VERSION IS USABLE ONLY WHILE ITS ORIGINAL IS UNCHANGED. Every write
//     here runs the revalidation sweep first, and adding a version to the
//     repository re-checks the original's hash inside the transaction.

import { createHash, randomUUID } from 'node:crypto';
import { createAuditWriter, type PrismaClient, type TransactionClient } from '@knowzy/database';
import type { Clock } from '@knowzy/observability';
import {
  estimatePreparationTokens,
  PREPARATION_PROMPT_VERSION,
  PreparationError,
  type DocumentPreparer,
  type PreparationRequest,
} from '@knowzy/claude-services';
import {
  parsePreparedMarkdown,
  PreparationOutputSchema,
  renderPreparationMarkdown,
  repositoryMarkdown,
  safeFileStem,
  type ErrorCode,
  type GenerationProviderId,
  type PreparedVersionState,
} from '@knowzy/shared-types';
import {
  checkWindowBudgets,
  checkPerJobBudget,
  type BudgetSettings,
} from '../generation/control/budget.js';
import {
  concurrencyLimitFor,
  type ConcurrencySettings,
} from '../generation/control/concurrency.js';
import type { AdminActor } from '../generation/control/provider-administration.js';
import { checkPreparedText } from './checks.js';
import { readOriginalText } from './original-text.js';
import {
  ensureStudioSource,
  findStudioSourceIds,
  STUDIO_ORIGINALS,
  STUDIO_PREPARED,
  type StudioStorage,
  type StudioSync,
} from './studio-sources.js';

export class DocumentPreparationError extends Error {
  override readonly name = 'DocumentPreparationError';
  constructor(
    readonly code: ErrorCode,
    detail: string,
    readonly extra: Readonly<Record<string, unknown>> = {},
  ) {
    super(detail);
  }
}

export interface StudioContext {
  readonly prisma: PrismaClient;
  readonly clock: Clock;
  readonly actor: AdminActor;
  readonly correlationId: string;
  readonly requestId: string;
}

/** A stuck RUNNING row would freeze the concurrency cap forever (CLAUDE.md gotcha). */
export const PREPARATION_RUN_WINDOW_MS = 10 * 60 * 1000;
export const MAX_PREPARED_CHARS = 1_000_000;

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const asJson = (value: unknown): never => value as never;

const auditBase = (ctx: StudioContext) => ({
  actorType: 'USER' as const,
  actorUserId: ctx.actor.userId,
  actorDisplayName: ctx.actor.displayName,
  actorRoles: [...ctx.actor.roles],
  correlationId: ctx.correlationId,
  requestId: ctx.requestId,
  portal: 'AUTHORING' as const,
});

const sourceActor = (ctx: StudioContext) => ({
  userId: ctx.actor.userId,
  displayName: ctx.actor.displayName,
  roles: ctx.actor.roles,
  correlationId: ctx.correlationId,
  requestId: ctx.requestId,
});

// ------------------------------------------------------------- revalidation

/**
 * §11.6: a DRAFT or READY version whose original changed, or was deleted, is
 * REVALIDATION_REQUIRED, and its repository document stops being selectable.
 * Idempotent and cheap; run before every Studio act, every generation job and
 * after every synchronization the API performs.
 */
export const revalidatePreparedVersions = async (args: {
  readonly prisma: PrismaClient;
  readonly clock: Clock;
  readonly correlationId: string;
  readonly actor?: AdminActor | null;
}): Promise<number> => {
  const candidates = await args.prisma.preparedDocumentVersion.findMany({
    where: { state: { in: ['DRAFT', 'READY_FOR_QUESTION_GENERATION'] } },
    select: {
      id: true,
      state: true,
      versionNumber: true,
      preparedDocumentId: true,
      originalDocumentId: true,
      originalContentHash: true,
      repositoryDocumentId: true,
      original: { select: { status: true, contentHash: true, localVersionCounter: true } },
    },
  });
  const stale = candidates.filter(
    (row) =>
      row.original.status !== 'ACTIVE' || row.original.contentHash !== row.originalContentHash,
  );
  if (stale.length === 0) return 0;
  const auditWriter = createAuditWriter({ clock: args.clock });
  const now = args.clock.now();
  for (const row of stale) {
    const reason =
      row.original.status !== 'ACTIVE'
        ? 'The original document was deleted or replaced after this version was prepared.'
        : `The original document changed (now version ${row.original.localVersionCounter}) after this version was prepared.`;
    await args.prisma.$transaction(async (tx: TransactionClient) => {
      // Re-read inside the transaction: two sweeps must not both flag it.
      const updated = await tx.preparedDocumentVersion.updateMany({
        where: { id: row.id, state: row.state },
        data: {
          state: 'REVALIDATION_REQUIRED',
          revalidationReason: reason,
          revalidationFlaggedAt: now,
        },
      });
      if (updated.count === 0) return;
      if (row.repositoryDocumentId !== null) {
        await tx.knowledgeDocument.update({
          where: { id: row.repositoryDocumentId },
          data: {
            isExcludedFromGeneration: true,
            exclusionReason:
              'Assessment-prepared version needs revalidation: its original changed.',
            excludedAt: now,
          },
        });
      }
      await auditWriter.write(tx, {
        ...(args.actor === null || args.actor === undefined
          ? { actorType: 'SYSTEM' as const }
          : {
              actorType: 'USER' as const,
              actorUserId: args.actor.userId,
              actorDisplayName: args.actor.displayName,
              actorRoles: [...args.actor.roles],
            }),
        action: 'AUTHORING.DOCUMENT_PREPARATION.REVALIDATION_REQUIRED',
        outcome: 'SUCCESS',
        entityType: 'PreparedDocumentVersion',
        entityId: row.id,
        entityLabel: `Prepared version ${row.versionNumber}`,
        correlationId: args.correlationId,
        portal: 'AUTHORING',
        detail: {
          preparedDocumentId: row.preparedDocumentId,
          versionId: row.id,
          versionNumber: row.versionNumber,
          previousState: row.state,
          state: 'REVALIDATION_REQUIRED',
          originalDocumentId: row.originalDocumentId,
          originalVersionCounter: row.original.localVersionCounter,
          reason,
        },
      });
    });
  }
  return stale.length;
};

const reapStuckRuns = async (ctx: StudioContext): Promise<void> => {
  await ctx.prisma.documentPreparationRun.updateMany({
    where: {
      status: 'RUNNING',
      startedAt: { lt: new Date(ctx.clock.now().getTime() - PREPARATION_RUN_WINDOW_MS) },
    },
    data: {
      status: 'FAILED',
      failureClass: 'ABANDONED',
      outcomeReason: 'The preparation did not finish within ten minutes and was marked failed.',
      finishedAt: ctx.clock.now(),
    },
  });
};

// ---------------------------------------------------------------- add document

export const recordUploadRefused = async (
  ctx: StudioContext,
  refusal: {
    readonly control: string;
    readonly reason: string;
    readonly extension: string;
    readonly sizeBytes: number;
  },
): Promise<void> => {
  await createAuditWriter({ clock: ctx.clock }).write(ctx.prisma, {
    ...auditBase(ctx),
    action: 'AUTHORING.DOCUMENT_PREPARATION.UPLOAD_REFUSED',
    outcome: 'FAILURE',
    entityType: 'StudioUpload',
    entityLabel: 'Refused upload',
    detail: {
      control: refusal.control,
      reason: refusal.reason,
      extension: refusal.extension,
      sizeBytes: refusal.sizeBytes,
    },
  });
};

const titleFrom = (fileName: string): string => {
  const stem = fileName.replace(/\.[A-Za-z0-9]{1,10}$/, '').trim();
  return (stem.length > 0 ? stem : fileName).slice(0, 200);
};

/**
 * An inspected, extracted upload becomes an original document. The API has
 * already run every content control (inspectUpload, extractContent); this is
 * the duplicate control, the write, the synchronization and the record.
 */
export const acceptUpload = async (
  ctx: StudioContext,
  args: {
    readonly storage: StudioStorage;
    readonly sync: StudioSync;
    readonly originalFileName: string;
    readonly extension: string;
    readonly bytes: Uint8Array;
    readonly sha256: string;
  },
): Promise<{ readonly preparedDocumentId: string; readonly originalDocumentId: string }> => {
  const duplicate = await ctx.prisma.studioUpload.findUnique({
    where: { sha256: args.sha256 },
    select: {
      originalFileName: true,
      knowledgeDocument: { select: { preparedFrom: { select: { id: true } } } },
    },
  });
  if (duplicate !== null) {
    await recordUploadRefused(ctx, {
      control: 'DUPLICATE',
      reason: `The same file was uploaded before as "${duplicate.originalFileName}".`,
      extension: args.extension,
      sizeBytes: args.bytes.length,
    });
    throw new DocumentPreparationError(
      'DUPLICATE',
      `This file was already uploaded as "${duplicate.originalFileName}". Open it from My prepared documents.`,
      { preparedDocumentId: duplicate.knowledgeDocument?.preparedFrom?.id ?? null },
    );
  }

  const sourceId = await ensureStudioSource({
    prisma: ctx.prisma,
    clock: ctx.clock,
    actor: sourceActor(ctx),
    storage: args.storage,
    sync: args.sync,
    spec: STUDIO_ORIGINALS,
  });
  // Server-generated: the user's name is a label and never reaches the disk.
  const storedFileName = `${randomUUID()}.${args.extension}`;
  await args.storage.writeOriginal(storedFileName, args.bytes);
  await args.sync.synchronize(sourceId);

  const document = await ctx.prisma.knowledgeDocument.findFirst({
    where: { sourceId, name: storedFileName, status: 'ACTIVE' },
    select: { id: true, extractionStatus: true, extractionReason: true },
  });
  if (document === null || document.extractionStatus !== 'EXTRACTED') {
    // The extraction control: a file the platform cannot read does not stay.
    // Its row is marked DELETED, because a FULL sync does not notice a file
    // that has gone (EVAL-M1 F2).
    await args.storage.removeOriginal(storedFileName);
    if (document !== null) {
      await ctx.prisma.knowledgeDocument.update({
        where: { id: document.id },
        data: { status: 'DELETED' },
      });
    }
    const reason = document?.extractionReason ?? 'The file could not be read after it was stored.';
    await recordUploadRefused(ctx, {
      control: 'EXTRACTION',
      reason,
      extension: args.extension,
      sizeBytes: args.bytes.length,
    });
    throw new DocumentPreparationError('UPLOAD_REFUSED', reason);
  }

  const auditWriter = createAuditWriter({ clock: ctx.clock });
  return ctx.prisma.$transaction(async (tx: TransactionClient) => {
    const upload = await tx.studioUpload.create({
      data: {
        originalFileName: args.originalFileName,
        storedFileName,
        extension: args.extension,
        sizeBytes: args.bytes.length,
        sha256: args.sha256,
        uploadedByUserId: ctx.actor.userId,
        uploadedAt: ctx.clock.now(),
        knowledgeDocumentId: document.id,
      },
      select: { id: true, scanStatus: true },
    });
    const prepared = await tx.preparedDocument.create({
      data: {
        originalDocumentId: document.id,
        title: titleFrom(args.originalFileName),
        createdByUserId: ctx.actor.userId,
      },
      select: { id: true },
    });
    await auditWriter.write(tx, {
      ...auditBase(ctx),
      action: 'AUTHORING.DOCUMENT_PREPARATION.UPLOAD_ACCEPTED',
      outcome: 'SUCCESS',
      entityType: 'StudioUpload',
      entityId: upload.id,
      entityLabel: args.originalFileName.slice(0, 200),
      sourceId,
      detail: {
        preparedDocumentId: prepared.id,
        originalDocumentId: document.id,
        extension: args.extension,
        sizeBytes: args.bytes.length,
        scanStatus: upload.scanStatus,
      },
    });
    return { preparedDocumentId: prepared.id, originalDocumentId: document.id };
  });
};

/** Choosing an existing synchronized document. One prepared document per original. */
export const startFromDocument = async (
  ctx: StudioContext,
  args: { readonly documentId: string; readonly storageRoot: string | null },
): Promise<{ readonly preparedDocumentId: string; readonly created: boolean }> => {
  const document = await ctx.prisma.knowledgeDocument.findUnique({
    where: { id: args.documentId },
    select: { id: true, name: true, sourceId: true, status: true, extractionStatus: true },
  });
  if (document === null)
    throw new DocumentPreparationError('NOT_FOUND', 'No document with that id exists.');
  const studio = await findStudioSourceIds(ctx.prisma, args.storageRoot);
  if (document.sourceId === studio.prepared) {
    throw new DocumentPreparationError(
      'VALIDATION_FAILED',
      'That is already an assessment-prepared document. Choose its original instead.',
    );
  }
  if (document.status !== 'ACTIVE' || document.extractionStatus !== 'EXTRACTED') {
    throw new DocumentPreparationError(
      'DOCUMENT_NOT_READY',
      'Only a synchronized document whose text was extracted can be prepared.',
    );
  }
  const existing = await ctx.prisma.preparedDocument.findUnique({
    where: { originalDocumentId: document.id },
    select: { id: true },
  });
  if (existing !== null) return { preparedDocumentId: existing.id, created: false };
  const created = await ctx.prisma.preparedDocument.create({
    data: {
      originalDocumentId: document.id,
      title: titleFrom(document.name),
      createdByUserId: ctx.actor.userId,
    },
    select: { id: true },
  });
  return { preparedDocumentId: created.id, created: true };
};

// ------------------------------------------------------------------ prepare

export interface PreparationControls extends BudgetSettings, ConcurrencySettings {}

const failRun = async (
  ctx: StudioContext,
  runId: string,
  preparedDocumentId: string,
  status: 'FAILED' | 'REFUSED',
  failureClass: string,
  reason: string,
  extra: Readonly<Record<string, unknown>> = {},
): Promise<void> => {
  const auditWriter = createAuditWriter({ clock: ctx.clock });
  await ctx.prisma.$transaction(async (tx: TransactionClient) => {
    const run = await tx.documentPreparationRun.update({
      where: { id: runId },
      data: { status, failureClass, outcomeReason: reason, finishedAt: ctx.clock.now() },
      select: { providerId: true, modelId: true },
    });
    await auditWriter.write(tx, {
      ...auditBase(ctx),
      action:
        status === 'FAILED'
          ? 'AUTHORING.DOCUMENT_PREPARATION.PREPARATION_FAILED'
          : 'AUTHORING.DOCUMENT_PREPARATION.PREPARATION_REFUSED',
      outcome: 'FAILURE',
      entityType: 'DocumentPreparationRun',
      entityId: runId,
      detail: {
        preparedDocumentId,
        runId,
        providerId: run.providerId,
        modelId: run.modelId,
        failureClass,
        reason,
        ...extra,
      },
    });
  });
};

/**
 * Prepare for question generation. `live` is the AI preparer the API built
 * because readiness is READY; `test` is the local-only test preparer. Live
 * wins when both exist. With neither, the refusal is the brief's sentence.
 */
export const prepareDocument = async (
  ctx: StudioContext,
  args: {
    readonly preparedDocumentId: string;
    readonly live: DocumentPreparer | null;
    readonly test: DocumentPreparer | null;
    readonly controls: PreparationControls;
  },
): Promise<{
  readonly versionId: string;
  readonly versionNumber: number;
  readonly warningCount: number;
}> => {
  await reapStuckRuns(ctx);
  await revalidatePreparedVersions({ ...ctx, actor: ctx.actor });

  const prepared = await ctx.prisma.preparedDocument.findUnique({
    where: { id: args.preparedDocumentId },
    select: {
      id: true,
      title: true,
      original: {
        select: {
          id: true,
          name: true,
          status: true,
          extractionStatus: true,
          extractedText: true,
          contentHash: true,
          localVersionCounter: true,
        },
      },
    },
  });
  if (prepared === null)
    throw new DocumentPreparationError('NOT_FOUND', 'No prepared document with that id exists.');
  const original = prepared.original;
  if (
    original.status !== 'ACTIVE' ||
    original.extractionStatus !== 'EXTRACTED' ||
    original.extractedText === null ||
    original.contentHash === null
  ) {
    throw new DocumentPreparationError(
      'DOCUMENT_NOT_READY',
      'The original document is not available or its text could not be read, so it cannot be prepared.',
    );
  }

  const preparer = args.live ?? args.test;
  if (preparer === null) {
    await createAuditWriter({ clock: ctx.clock }).write(ctx.prisma, {
      ...auditBase(ctx),
      action: 'AUTHORING.DOCUMENT_PREPARATION.PREPARATION_REFUSED',
      outcome: 'FAILURE',
      entityType: 'PreparedDocument',
      entityId: prepared.id,
      entityLabel: prepared.title,
      detail: {
        preparedDocumentId: prepared.id,
        failureClass: 'NOT_ENABLED',
        reason: 'CP-5 not recorded or no provider ready',
      },
    });
    throw new DocumentPreparationError(
      'PREPARATION_NOT_ENABLED',
      'AI document preparation is not yet enabled for this environment. Contact your administrator.',
    );
  }

  const sections = await ctx.prisma.documentSection.findMany({
    where: { documentId: original.id, documentVersionCounter: original.localVersionCounter },
    orderBy: { ordinal: 'asc' },
    select: { heading: true, startOffset: true, endOffset: true, isAssessable: true },
  });
  const text = original.extractedText;
  const request: PreparationRequest = {
    documentName: original.name,
    sections: (sections.length > 0
      ? sections
      : [{ heading: null, startOffset: 0, endOffset: text.length, isAssessable: true }]
    ).map((section) => ({
      heading: section.heading,
      text: text.slice(section.startOffset, section.endOffset),
      isAssessable: section.isAssessable,
    })),
  };
  const estimate = preparer.live ? estimatePreparationTokens(request) : 0;

  // Controls, for a live provider only: the test preparer spends nothing.
  if (preparer.live) {
    const providerId = preparer.providerId as GenerationProviderId;
    const refusal =
      checkPerJobBudget(estimate, args.controls, providerId) ??
      (await checkWindowBudgets(ctx.prisma, estimate, args.controls, providerId, ctx.clock.now()));
    const running = await ctx.prisma.documentPreparationRun.count({
      where: { status: 'RUNNING', providerId },
    });
    const limit = concurrencyLimitFor(args.controls, providerId);
    const detail =
      refusal?.detail ??
      (running >= limit
        ? `${running} preparation${running === 1 ? ' is' : 's are'} already running and the limit is ${limit}. Try again when one finishes.`
        : null);
    if (detail !== null) {
      const run = await ctx.prisma.documentPreparationRun.create({
        data: {
          preparedDocumentId: prepared.id,
          providerId,
          modelId: preparer.modelId,
          promptVersion: PREPARATION_PROMPT_VERSION,
          status: 'RUNNING',
          originalVersionCounter: original.localVersionCounter,
          originalContentHash: original.contentHash,
          estimatedInputTokens: estimate,
          requestedByUserId: ctx.actor.userId,
          startedAt: ctx.clock.now(),
        },
        select: { id: true },
      });
      await failRun(
        ctx,
        run.id,
        prepared.id,
        'REFUSED',
        refusal === null ? 'CONCURRENCY' : refusal.refusalReason,
        detail,
      );
      throw new DocumentPreparationError(
        refusal === null ? 'GENERATION_CONCURRENCY_LIMIT' : 'BUDGET_EXCEEDED',
        detail,
      );
    }
  }

  const run = await ctx.prisma.documentPreparationRun.create({
    data: {
      preparedDocumentId: prepared.id,
      providerId: preparer.providerId,
      modelId: preparer.modelId,
      promptVersion: PREPARATION_PROMPT_VERSION,
      status: 'RUNNING',
      originalVersionCounter: original.localVersionCounter,
      originalContentHash: original.contentHash,
      estimatedInputTokens: estimate,
      requestedByUserId: ctx.actor.userId,
      startedAt: ctx.clock.now(),
    },
    select: { id: true },
  });

  let result: Awaited<ReturnType<DocumentPreparer['prepare']>>;
  try {
    result = await preparer.prepare(request);
  } catch (error) {
    const code = error instanceof PreparationError ? error.code : 'PROVIDER_ERROR';
    const message =
      error instanceof PreparationError
        ? error.message
        : 'The provider could not prepare the document.';
    await failRun(ctx, run.id, prepared.id, 'FAILED', code, message);
    throw new DocumentPreparationError(
      code === 'MALFORMED_OUTPUT' ? 'SCHEMA_INVALID' : 'LLM_UNAVAILABLE',
      `Preparation failed: ${message}`,
    );
  }
  const usage = { inputTokens: result.inputTokens, outputTokens: result.outputTokens };
  await ctx.prisma.documentPreparationRun.update({ where: { id: run.id }, data: usage });

  const parsed = PreparationOutputSchema.safeParse(result.output);
  if (!parsed.success) {
    const reason = 'The provider returned a prepared document in an unexpected format.';
    await failRun(ctx, run.id, prepared.id, 'FAILED', 'MALFORMED_OUTPUT', reason);
    throw new DocumentPreparationError('SCHEMA_INVALID', `Preparation failed: ${reason}`);
  }
  const markdown = renderPreparationMarkdown(parsed.data);
  const nodes = parsePreparedMarkdown(markdown);
  const originalText = await readOriginalText(ctx.prisma, {
    documentId: original.id,
    versionCounter: original.localVersionCounter,
    extractedText: text,
  });
  const check = checkPreparedText(originalText.comparisonText, nodes);
  if (check.inventedFigures.length > 0) {
    const reason = `The prepared document contained figures that are not in the original: ${check.inventedFigures.slice(0, 10).join(', ')}.`;
    await failRun(ctx, run.id, prepared.id, 'REFUSED', 'INVENTED_QUANTITY', reason, {
      inventedFigures: check.inventedFigures.slice(0, 20),
    });
    throw new DocumentPreparationError('PREPARATION_OUTPUT_REFUSED', reason);
  }

  const auditWriter = createAuditWriter({ clock: ctx.clock });
  const now = ctx.clock.now();
  return ctx.prisma.$transaction(async (tx: TransactionClient) => {
    // The lock: one writer per prepared document at a time.
    await tx.preparedDocument.update({ where: { id: prepared.id }, data: { updatedAt: now } });
    // One draft at a time. Preparing again replaces the open draft, recorded.
    const openDrafts = await tx.preparedDocumentVersion.findMany({
      where: { preparedDocumentId: prepared.id, state: 'DRAFT' },
      select: { id: true, versionNumber: true },
    });
    for (const draft of openDrafts) {
      await tx.preparedDocumentVersion.update({
        where: { id: draft.id },
        data: { state: 'REJECTED', rejectedByUserId: ctx.actor.userId, rejectedAt: now },
      });
      await auditWriter.write(tx, {
        ...auditBase(ctx),
        action: 'AUTHORING.DOCUMENT_PREPARATION.VERSION_REJECTED',
        outcome: 'SUCCESS',
        entityType: 'PreparedDocumentVersion',
        entityId: draft.id,
        detail: {
          preparedDocumentId: prepared.id,
          versionId: draft.id,
          versionNumber: draft.versionNumber,
          previousState: 'DRAFT',
          state: 'REJECTED',
          reason: 'Replaced by a new preparation.',
        },
      });
    }
    const last = await tx.preparedDocumentVersion.aggregate({
      where: { preparedDocumentId: prepared.id },
      _max: { versionNumber: true },
    });
    const versionNumber = (last._max.versionNumber ?? 0) + 1;
    const version = await tx.preparedDocumentVersion.create({
      data: {
        preparedDocumentId: prepared.id,
        versionNumber,
        state: 'DRAFT',
        origin: 'PREPARATION',
        preparationRunId: run.id,
        content: markdown,
        contentSha256: sha256(markdown),
        checks: asJson(check.warnings),
        originalDocumentId: original.id,
        originalVersionCounter: original.localVersionCounter,
        originalContentHash: original.contentHash as string,
        providerId: preparer.providerId,
        modelId: result.servedModel ?? preparer.modelId,
        promptVersion: PREPARATION_PROMPT_VERSION,
        preparedAt: now,
        preparedByUserId: ctx.actor.userId,
      },
      select: { id: true },
    });
    await tx.documentPreparationRun.update({
      where: { id: run.id },
      data: {
        status: 'SUCCEEDED',
        finishedAt: now,
        modelId: result.servedModel ?? preparer.modelId,
        output: asJson(parsed.data),
        outputMarkdown: markdown,
        checks: asJson(check.warnings),
        // A measurement for the test preparer (it costs nothing); unobservable,
        // so null, for a live provider with no recorded price.
        measuredCost: preparer.live ? null : 0,
      },
    });
    await auditWriter.write(tx, {
      ...auditBase(ctx),
      action: 'AUTHORING.DOCUMENT_PREPARATION.PREPARATION_COMPLETED',
      outcome: 'SUCCESS',
      entityType: 'PreparedDocumentVersion',
      entityId: version.id,
      entityLabel: `${prepared.title} — version ${versionNumber}`,
      detail: {
        preparedDocumentId: prepared.id,
        versionId: version.id,
        versionNumber,
        runId: run.id,
        providerId: preparer.providerId,
        modelId: result.servedModel ?? preparer.modelId,
        promptVersion: PREPARATION_PROMPT_VERSION,
        live: preparer.live,
        originalDocumentId: original.id,
        originalVersionCounter: original.localVersionCounter,
        contentSha256: sha256(markdown),
        warningCount: check.warnings.length,
        findingCount: parsed.data.findings.length,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      },
    });
    return { versionId: version.id, versionNumber, warningCount: check.warnings.length };
  });
};

// -------------------------------------------------------------------- edits

const loadVersion = async (ctx: StudioContext, versionId: string) => {
  const version = await ctx.prisma.preparedDocumentVersion.findUnique({
    where: { id: versionId },
    select: {
      id: true,
      state: true,
      versionNumber: true,
      preparedDocumentId: true,
      content: true,
      preparationRunId: true,
      originalDocumentId: true,
      originalVersionCounter: true,
      originalContentHash: true,
      providerId: true,
      modelId: true,
      promptVersion: true,
      preparedAt: true,
      preparedByUserId: true,
      repositoryDocumentId: true,
      original: {
        select: { extractedText: true, contentHash: true, localVersionCounter: true, status: true },
      },
    },
  });
  if (version === null)
    throw new DocumentPreparationError('NOT_FOUND', 'No prepared version with that id exists.');
  return version;
};

const refuseState = (state: PreparedVersionState, act: string): never => {
  throw new DocumentPreparationError(
    'STATE_TRANSITION_INVALID',
    `A ${state === 'READY_FOR_QUESTION_GENERATION' ? 'ready' : state.toLowerCase().replace(/_/g, ' ')} version cannot be ${act}.`,
  );
};

/**
 * Save changes. A DRAFT is updated in place; a READY, SUPERSEDED or flagged
 * version is never changed -- editing it opens a new DRAFT from it (§11.6).
 */
export const savePreparedContent = async (
  ctx: StudioContext,
  args: { readonly versionId: string; readonly content: string },
): Promise<{
  readonly versionId: string;
  readonly created: boolean;
  readonly warningCount: number;
}> => {
  await revalidatePreparedVersions({ ...ctx, actor: ctx.actor });
  const content = args.content.replace(/\r\n?/g, '\n');
  if (content.trim().length === 0) {
    throw new DocumentPreparationError('VALIDATION_FAILED', 'A prepared document cannot be empty.');
  }
  if (content.length > MAX_PREPARED_CHARS) {
    throw new DocumentPreparationError(
      'VALIDATION_FAILED',
      'The prepared document is too long to save.',
    );
  }
  const version = await loadVersion(ctx, args.versionId);
  if (version.state === 'REJECTED') refuseState(version.state, 'edited');
  const nodes = parsePreparedMarkdown(content);
  const check = checkPreparedText(
    (
      await readOriginalText(ctx.prisma, {
        documentId: version.originalDocumentId,
        versionCounter: version.original.localVersionCounter,
        extractedText: version.original.extractedText ?? '',
      })
    ).comparisonText,
    nodes,
  );
  const auditWriter = createAuditWriter({ clock: ctx.clock });
  const now = ctx.clock.now();

  return ctx.prisma.$transaction(async (tx: TransactionClient) => {
    await tx.preparedDocument.update({
      where: { id: version.preparedDocumentId },
      data: { updatedAt: now },
    });
    let versionId = version.id;
    let created = false;
    let versionNumber = version.versionNumber;
    if (version.state === 'DRAFT') {
      await tx.preparedDocumentVersion.update({
        where: { id: version.id },
        data: {
          content,
          contentSha256: sha256(content),
          checks: asJson(check.warnings),
          editedByUserId: ctx.actor.userId,
          editedAt: now,
        },
      });
    } else {
      const draft = await tx.preparedDocumentVersion.findFirst({
        where: { preparedDocumentId: version.preparedDocumentId, state: 'DRAFT' },
        select: { versionNumber: true },
      });
      if (draft !== null) {
        throw new DocumentPreparationError(
          'STATE_TRANSITION_INVALID',
          `Version ${draft.versionNumber} is already an open draft. Edit that version instead.`,
        );
      }
      if (version.state === 'REVALIDATION_REQUIRED') {
        throw new DocumentPreparationError(
          'STATE_TRANSITION_INVALID',
          'This version needs revalidation. Use "Review against the updated original" or "Prepare again".',
        );
      }
      const last = await tx.preparedDocumentVersion.aggregate({
        where: { preparedDocumentId: version.preparedDocumentId },
        _max: { versionNumber: true },
      });
      versionNumber = (last._max.versionNumber ?? 0) + 1;
      const next = await tx.preparedDocumentVersion.create({
        data: {
          preparedDocumentId: version.preparedDocumentId,
          versionNumber,
          state: 'DRAFT',
          origin: 'EDIT',
          basedOnVersionId: version.id,
          preparationRunId: version.preparationRunId,
          content,
          contentSha256: sha256(content),
          checks: asJson(check.warnings),
          originalDocumentId: version.originalDocumentId,
          originalVersionCounter: version.originalVersionCounter,
          originalContentHash: version.originalContentHash,
          providerId: version.providerId,
          modelId: version.modelId,
          promptVersion: version.promptVersion,
          preparedAt: version.preparedAt,
          preparedByUserId: version.preparedByUserId,
          editedByUserId: ctx.actor.userId,
          editedAt: now,
        },
        select: { id: true },
      });
      versionId = next.id;
      created = true;
    }
    await auditWriter.write(tx, {
      ...auditBase(ctx),
      action: 'AUTHORING.DOCUMENT_PREPARATION.VERSION_SAVED',
      outcome: 'SUCCESS',
      entityType: 'PreparedDocumentVersion',
      entityId: versionId,
      detail: {
        preparedDocumentId: version.preparedDocumentId,
        versionId,
        versionNumber,
        state: 'DRAFT',
        ...(created ? { previousState: version.state } : {}),
        contentSha256: sha256(content),
        warningCount: check.warnings.length,
      },
    });
    return { versionId, created, warningCount: check.warnings.length };
  });
};

/** Restore AI version: the draft's text becomes its preparation's output again. */
export const restoreAiVersion = async (
  ctx: StudioContext,
  versionId: string,
): Promise<{ readonly versionId: string }> => {
  const version = await loadVersion(ctx, versionId);
  if (version.state !== 'DRAFT') refuseState(version.state, 'restored');
  if (version.preparationRunId === null) {
    throw new DocumentPreparationError(
      'STATE_TRANSITION_INVALID',
      'This version has no preparation to restore.',
    );
  }
  const run = await ctx.prisma.documentPreparationRun.findUnique({
    where: { id: version.preparationRunId },
    select: { outputMarkdown: true, checks: true },
  });
  if (run?.outputMarkdown === null || run?.outputMarkdown === undefined) {
    throw new DocumentPreparationError(
      'STATE_TRANSITION_INVALID',
      'The preparation output is not available.',
    );
  }
  const content = run.outputMarkdown;
  const auditWriter = createAuditWriter({ clock: ctx.clock });
  await ctx.prisma.$transaction(async (tx: TransactionClient) => {
    await tx.preparedDocumentVersion.update({
      where: { id: version.id },
      data: {
        content,
        contentSha256: sha256(content),
        checks: asJson(run.checks ?? []),
        editedByUserId: ctx.actor.userId,
        editedAt: ctx.clock.now(),
      },
    });
    await auditWriter.write(tx, {
      ...auditBase(ctx),
      action: 'AUTHORING.DOCUMENT_PREPARATION.AI_VERSION_RESTORED',
      outcome: 'SUCCESS',
      entityType: 'PreparedDocumentVersion',
      entityId: version.id,
      detail: {
        preparedDocumentId: version.preparedDocumentId,
        versionId: version.id,
        versionNumber: version.versionNumber,
        runId: version.preparationRunId,
        contentSha256: sha256(content),
      },
    });
  });
  return { versionId: version.id };
};

/** Discard draft: REJECTED, kept, never deleted. */
export const rejectDraft = async (ctx: StudioContext, versionId: string): Promise<void> => {
  const version = await loadVersion(ctx, versionId);
  if (version.state !== 'DRAFT') refuseState(version.state, 'discarded');
  const auditWriter = createAuditWriter({ clock: ctx.clock });
  await ctx.prisma.$transaction(async (tx: TransactionClient) => {
    await tx.preparedDocumentVersion.update({
      where: { id: version.id },
      data: { state: 'REJECTED', rejectedByUserId: ctx.actor.userId, rejectedAt: ctx.clock.now() },
    });
    await auditWriter.write(tx, {
      ...auditBase(ctx),
      action: 'AUTHORING.DOCUMENT_PREPARATION.VERSION_REJECTED',
      outcome: 'SUCCESS',
      entityType: 'PreparedDocumentVersion',
      entityId: version.id,
      detail: {
        preparedDocumentId: version.preparedDocumentId,
        versionId: version.id,
        versionNumber: version.versionNumber,
        previousState: 'DRAFT',
        state: 'REJECTED',
      },
    });
  });
};

/**
 * Review against the updated original: a flagged version's text as a new
 * DRAFT pinned to the original's CURRENT version, for a person to check and
 * add. Completing that addition is what completes revalidation.
 */
export const reviewAgainstUpdatedOriginal = async (
  ctx: StudioContext,
  versionId: string,
): Promise<{ readonly versionId: string }> => {
  const version = await loadVersion(ctx, versionId);
  if (version.state !== 'REVALIDATION_REQUIRED') refuseState(version.state, 'revalidated');
  const original = version.original;
  if (
    original.status !== 'ACTIVE' ||
    original.contentHash === null ||
    original.extractedText === null
  ) {
    throw new DocumentPreparationError(
      'DOCUMENT_NOT_READY',
      'The original document is no longer available, so this version cannot be revalidated against it.',
    );
  }
  const check = checkPreparedText(
    (
      await readOriginalText(ctx.prisma, {
        documentId: version.originalDocumentId,
        versionCounter: original.localVersionCounter,
        extractedText: original.extractedText,
      })
    ).comparisonText,
    parsePreparedMarkdown(version.content),
  );
  const auditWriter = createAuditWriter({ clock: ctx.clock });
  const now = ctx.clock.now();
  return ctx.prisma.$transaction(async (tx: TransactionClient) => {
    await tx.preparedDocument.update({
      where: { id: version.preparedDocumentId },
      data: { updatedAt: now },
    });
    const draft = await tx.preparedDocumentVersion.findFirst({
      where: { preparedDocumentId: version.preparedDocumentId, state: 'DRAFT' },
      select: { versionNumber: true },
    });
    if (draft !== null) {
      throw new DocumentPreparationError(
        'STATE_TRANSITION_INVALID',
        `Version ${draft.versionNumber} is already an open draft. Finish or discard it first.`,
      );
    }
    const last = await tx.preparedDocumentVersion.aggregate({
      where: { preparedDocumentId: version.preparedDocumentId },
      _max: { versionNumber: true },
    });
    const versionNumber = (last._max.versionNumber ?? 0) + 1;
    const next = await tx.preparedDocumentVersion.create({
      data: {
        preparedDocumentId: version.preparedDocumentId,
        versionNumber,
        state: 'DRAFT',
        origin: 'REVALIDATION_REVIEW',
        basedOnVersionId: version.id,
        preparationRunId: version.preparationRunId,
        content: version.content,
        contentSha256: sha256(version.content),
        checks: asJson(check.warnings),
        originalDocumentId: version.originalDocumentId,
        originalVersionCounter: original.localVersionCounter,
        originalContentHash: original.contentHash as string,
        providerId: version.providerId,
        modelId: version.modelId,
        promptVersion: version.promptVersion,
        preparedAt: version.preparedAt,
        preparedByUserId: version.preparedByUserId,
        editedByUserId: ctx.actor.userId,
        editedAt: now,
      },
      select: { id: true },
    });
    await auditWriter.write(tx, {
      ...auditBase(ctx),
      action: 'AUTHORING.DOCUMENT_PREPARATION.VERSION_SAVED',
      outcome: 'SUCCESS',
      entityType: 'PreparedDocumentVersion',
      entityId: next.id,
      detail: {
        preparedDocumentId: version.preparedDocumentId,
        versionId: next.id,
        versionNumber,
        state: 'DRAFT',
        previousState: 'REVALIDATION_REQUIRED',
        originalVersionCounter: original.localVersionCounter,
        reason: 'Review against the updated original.',
        warningCount: check.warnings.length,
      },
    });
    return { versionId: next.id };
  });
};

// ------------------------------------------------------ add to the repository

/** `<Title> - Assessment-prepared v<n> (<8 hex>).md`: readable on Generate, unique by id. */
export const repositoryFileNameFor = (
  title: string,
  preparedDocumentId: string,
  versionNumber: number,
): string =>
  `${safeFileStem(title)} - Assessment-prepared v${versionNumber} (${preparedDocumentId.slice(0, 8)}).md`;

/**
 * Add to Question Generation Repository (§11.8). The confirmation IS the
 * approval, so it is required here and not only on the screen.
 */
export const addToRepository = async (
  ctx: StudioContext,
  args: {
    readonly versionId: string;
    readonly confirmed: boolean;
    readonly storage: StudioStorage;
    readonly sync: StudioSync;
  },
): Promise<{
  readonly versionId: string;
  readonly repositorySourceId: string;
  readonly repositoryDocumentId: string;
  readonly supersededVersionIds: readonly string[];
}> => {
  if (!args.confirmed) {
    throw new DocumentPreparationError(
      'VALIDATION_FAILED',
      'Adding a prepared document to the Question Generation Repository needs your confirmation.',
    );
  }
  await revalidatePreparedVersions({ ...ctx, actor: ctx.actor });
  const version = await loadVersion(ctx, args.versionId);
  if (version.state === 'READY_FOR_QUESTION_GENERATION') {
    throw new DocumentPreparationError(
      'DUPLICATE',
      `Version ${version.versionNumber} is already in the Question Generation Repository.`,
    );
  }
  if (version.state !== 'DRAFT') refuseState(version.state, 'added to the repository');
  const prepared = await ctx.prisma.preparedDocument.findUniqueOrThrow({
    where: { id: version.preparedDocumentId },
    select: { id: true, title: true },
  });
  const nodes = parsePreparedMarkdown(version.content);
  const text = repositoryMarkdown(nodes);
  if (text.trim().length === 0) {
    throw new DocumentPreparationError(
      'VALIDATION_FAILED',
      'The prepared document has no content to add.',
    );
  }

  const sourceId = await ensureStudioSource({
    prisma: ctx.prisma,
    clock: ctx.clock,
    actor: sourceActor(ctx),
    storage: args.storage,
    sync: args.sync,
    spec: STUDIO_PREPARED,
  });
  const fileName = repositoryFileNameFor(prepared.title, prepared.id, version.versionNumber);
  await args.storage.writePrepared(fileName, text);
  await args.sync.synchronize(sourceId);
  const document = await ctx.prisma.knowledgeDocument.findFirst({
    where: { sourceId, name: fileName, status: 'ACTIVE' },
    select: { id: true, extractionStatus: true },
  });
  if (document === null || document.extractionStatus !== 'EXTRACTED') {
    throw new DocumentPreparationError(
      'DOCUMENT_NOT_READY',
      'The prepared document was written but could not be read back into the repository.',
    );
  }

  const auditWriter = createAuditWriter({ clock: ctx.clock });
  const now = ctx.clock.now();
  return ctx.prisma.$transaction(async (tx: TransactionClient) => {
    await tx.preparedDocument.update({ where: { id: prepared.id }, data: { updatedAt: now } });
    const current = await tx.preparedDocumentVersion.findUniqueOrThrow({
      where: { id: version.id },
      select: {
        state: true,
        originalContentHash: true,
        original: { select: { contentHash: true, status: true } },
      },
    });
    if (current.state !== 'DRAFT') refuseState(current.state, 'added to the repository');
    if (
      current.original.status !== 'ACTIVE' ||
      current.original.contentHash !== current.originalContentHash
    ) {
      throw new DocumentPreparationError(
        'STATE_TRANSITION_INVALID',
        'The original document changed after this version was prepared. Revalidate it first.',
      );
    }
    const previous = await tx.preparedDocumentVersion.findMany({
      where: {
        preparedDocumentId: prepared.id,
        state: { in: ['READY_FOR_QUESTION_GENERATION', 'REVALIDATION_REQUIRED'] },
      },
      select: { id: true, versionNumber: true, state: true, repositoryDocumentId: true },
    });
    for (const row of previous) {
      await tx.preparedDocumentVersion.update({
        where: { id: row.id },
        data: { state: 'SUPERSEDED', supersededAt: now },
      });
      if (row.repositoryDocumentId !== null) {
        await tx.knowledgeDocument.update({
          where: { id: row.repositoryDocumentId },
          data: {
            isExcludedFromGeneration: true,
            exclusionReason: `Superseded by assessment-prepared version ${version.versionNumber}.`,
            excludedAt: now,
          },
        });
      }
      await auditWriter.write(tx, {
        ...auditBase(ctx),
        action: 'AUTHORING.DOCUMENT_PREPARATION.VERSION_SUPERSEDED',
        outcome: 'SUCCESS',
        entityType: 'PreparedDocumentVersion',
        entityId: row.id,
        detail: {
          preparedDocumentId: prepared.id,
          versionId: row.id,
          versionNumber: row.versionNumber,
          previousState: row.state,
          state: 'SUPERSEDED',
          reason: `Superseded by version ${version.versionNumber}.`,
        },
      });
    }
    await tx.knowledgeDocument.update({
      where: { id: document.id },
      data: { isExcludedFromGeneration: false, exclusionReason: null, excludedAt: null },
    });
    await tx.preparedDocumentVersion.update({
      where: { id: version.id },
      data: {
        state: 'READY_FOR_QUESTION_GENERATION',
        addedByUserId: ctx.actor.userId,
        addedAt: now,
        repositoryDocumentId: document.id,
        repositoryFileName: fileName,
      },
    });
    const supersededVersionIds = previous.map((row) => row.id);
    await auditWriter.write(tx, {
      ...auditBase(ctx),
      action: 'AUTHORING.DOCUMENT_PREPARATION.ADDED_TO_REPOSITORY',
      outcome: 'SUCCESS',
      entityType: 'PreparedDocumentVersion',
      entityId: version.id,
      entityLabel: `${prepared.title} — version ${version.versionNumber}`,
      sourceId,
      detail: {
        preparedDocumentId: prepared.id,
        versionId: version.id,
        versionNumber: version.versionNumber,
        previousState: 'DRAFT',
        state: 'READY_FOR_QUESTION_GENERATION',
        originalDocumentId: version.originalDocumentId,
        originalVersionCounter: version.originalVersionCounter,
        repositoryDocumentId: document.id,
        contentSha256: sha256(version.content),
        supersededVersionIds,
      },
    });
    return {
      versionId: version.id,
      repositorySourceId: sourceId,
      repositoryDocumentId: document.id,
      supersededVersionIds,
    };
  });
};

/** A download is recorded: who took a copy of which version, in which format. */
export const recordDownload = async (
  ctx: StudioContext,
  args: {
    readonly versionId: string;
    readonly preparedDocumentId: string;
    readonly versionNumber: number;
    readonly format: 'docx' | 'pdf';
  },
): Promise<void> => {
  await createAuditWriter({ clock: ctx.clock }).write(ctx.prisma, {
    ...auditBase(ctx),
    action: 'AUTHORING.DOCUMENT_PREPARATION.DOWNLOADED',
    outcome: 'SUCCESS',
    entityType: 'PreparedDocumentVersion',
    entityId: args.versionId,
    detail: {
      preparedDocumentId: args.preparedDocumentId,
      versionId: args.versionId,
      versionNumber: args.versionNumber,
      format: args.format,
    },
  });
};
