// Publishing — workflows.md §4 and sharepoint-question-bank.md §4.
//
// The governance rules that shape this file:
//
//   G1  only APPROVED questions are written, and the 13 gates are RE-EVALUATED
//       at the moment of the write. The caller's assertion is not trusted.
//   G5  deterministic operation key + pre-write existence check.
//   G6  audited in the same transaction as the local state change.
//   G8  every update carries If-Match. A 412 triggers re-read, never a blind
//       overwrite.
//   G9  a question is PUBLISHED locally ONLY with a verified item id, in the
//       transactional order: item id returned → reference upserted → status
//       transition, all in one transaction.
//
// §4.3: each question publishes in its OWN transaction and operation record, so
// a batch of 50 with 3 failures leaves 47 PUBLISHED and 3 APPROVED with a
// retryable reason. "No question is ever left in a state that claims
// publication without a verified SharePoint item ID."

import { createHash } from 'node:crypto';
import { createAuditWriter, type PrismaClient, type TransactionClient } from '@knowzy/database';
import type { BankContext, BankItemWrite, QuestionBankAdapter } from '@knowzy/shared-types';
import {
  evaluateGatesForQuestion,
  GatesFailedError,
  type ActorContext,
  type ReviewDeps,
} from './review-service.js';
import { evaluatePublishSeparation, DEFAULT_SEPARATION_POLICIES } from './separation-of-duties.js';

export class PublishNotPermittedError extends Error {
  constructor(
    readonly code: string,
    detail: string,
  ) {
    super(detail);
    this.name = 'PublishNotPermittedError';
  }
}

/**
 * §4.2: `sha256(targetListId + questionId + publishedVersion + operationType)`.
 *
 * Deterministic is the whole point — a retry computes the same key, so the
 * unique index in PostgreSQL and the adapter's own record both recognise it.
 */
export const operationKeyFor = (args: {
  readonly targetListId: string;
  readonly questionId: string;
  readonly publishedVersion: number;
  readonly operationType: 'CREATE' | 'UPDATE' | 'RETIRE';
}): string =>
  createHash('sha256')
    .update(
      `${args.targetListId}|${args.questionId}|${args.publishedVersion}|${args.operationType}`,
      'utf8',
    )
    .digest('hex');

export interface PublishTarget {
  readonly targetSiteId: string;
  readonly targetListId: string;
  /** false → writes run in dry-run mode and say so (G4). */
  readonly writesEnabled: boolean;
  readonly dryRunReason: string | null;
}

export interface PublishItemOutcome {
  readonly questionId: string;
  readonly outcome:
    'PUBLISHED' | 'ALREADY_PUBLISHED' | 'UPDATED' | 'DRY_RUN' | 'GATE_FAILED' | 'FAILED';
  readonly bankItemId: string | null;
  readonly publishedVersion: number | null;
  readonly operationKey: string;
  readonly detail: string;
  readonly retryable: boolean;
  readonly gateFailures?: readonly { code: string; detail: string }[];
}

export interface PublishBatchResult {
  readonly batchId: string;
  readonly target: PublishTarget;
  readonly dryRun: boolean;
  readonly items: readonly PublishItemOutcome[];
  readonly publishedCount: number;
  readonly failedCount: number;
}

export interface PublishArgs {
  readonly deps: ReviewDeps;
  readonly bank: QuestionBankAdapter;
  readonly target: PublishTarget;
  readonly questionIds: readonly string[];
  readonly actor: ActorContext;
  readonly signal: AbortSignal;
  /** Replay of the same key returns the original batch result (§4.2). */
  readonly idempotencyKey?: string;
}

/** KNZ-{DOMAIN_CODE}-{YYYY}-{SEQ} — sharepoint-question-bank.md §3. */
const proposedQuestionId = (domainCode: string, year: number, sequence: number): string =>
  `KNZ-${domainCode}-${year}-${String(sequence).padStart(6, '0')}`;

/**
 * The next identifier in the published series for a domain and year.
 *
 * Derived from the MAXIMUM sequence already issued, not from a count. A count
 * is not monotonic: archive or delete a draft and the count falls, so the next
 * publish reissues an identifier that a bank item already holds. The bank's
 * pre-write existence check then finds that item and reports ALREADY_PUBLISHED,
 * and a brand-new question silently appears to be a different one.
 *
 * PublishedQuestionReference rows are the right source because nothing ever
 * deletes them — retirement flags them (G7) and a superseded version keeps its
 * row.
 */
const nextBankQuestionId = async (
  client: PrismaClient,
  domainCode: string,
  domainId: string,
  year: number,
): Promise<string> => {
  const prefix = `KNZ-${domainCode}-${year}-`;
  const issued = await client.publishedQuestionReference.findMany({
    where: { domainId, questionId: { startsWith: prefix } },
    select: { questionId: true },
  });

  const highest = issued.reduce((max, row) => {
    const sequence = Number.parseInt(row.questionId.slice(prefix.length), 10);
    return Number.isFinite(sequence) && sequence > max ? sequence : max;
  }, 0);

  return proposedQuestionId(domainCode, year, highest + 1);
};

export const publishApprovedQuestions = async (args: PublishArgs): Promise<PublishBatchResult> => {
  const { deps, bank, target, actor } = args;

  if (!actor.permissions.includes('question.publish')) {
    throw new PublishNotPermittedError(
      'FORBIDDEN',
      'Publishing requires the permission "question.publish".',
    );
  }
  if (!bank.capabilities.supportsConditionalUpdate) {
    // §4: "Blind overwrite is never an acceptable fallback."
    throw new PublishNotPermittedError(
      'QUESTIONBANK_NOT_WRITABLE',
      `The ${bank.bankType} question bank does not support conditional updates, so publishing is refused rather than overwriting blindly.`,
    );
  }
  if (args.questionIds.length === 0) {
    throw new PublishNotPermittedError(
      'VALIDATION_FAILED',
      'Publishing requires an explicit, non-empty list of question ids.',
    );
  }

  const batchId = createHash('sha256')
    .update(
      args.idempotencyKey ?? `${actor.correlationId}|${[...args.questionIds].sort().join(',')}`,
      'utf8',
    )
    .digest('hex')
    .slice(0, 32);

  const items: PublishItemOutcome[] = [];

  for (const questionId of args.questionIds) {
    items.push(
      await publishOne({
        deps,
        bank,
        target,
        questionId,
        actor,
        batchId,
        signal: args.signal,
      }),
    );
  }

  return {
    batchId,
    target,
    dryRun: !target.writesEnabled,
    items,
    publishedCount: items.filter(
      (item) => item.outcome === 'PUBLISHED' || item.outcome === 'UPDATED',
    ).length,
    failedCount: items.filter((item) => item.outcome === 'FAILED' || item.outcome === 'GATE_FAILED')
      .length,
  };
};

interface PublishOneArgs {
  readonly deps: ReviewDeps;
  readonly bank: QuestionBankAdapter;
  readonly target: PublishTarget;
  readonly questionId: string;
  readonly actor: ActorContext;
  readonly batchId: string;
  readonly signal: AbortSignal;
}

const publishOne = async (args: PublishOneArgs): Promise<PublishItemOutcome> => {
  const { deps, bank, target, actor } = args;
  const prisma = deps.prisma;

  const question = await prisma.draftQuestion.findUnique({
    where: { id: args.questionId },
    include: {
      domain: { select: { code: true, name: true } },
      topic: { select: { name: true } },
      approvals: { orderBy: { decidedAt: 'desc' }, take: 1 },
      publishedRef: true,
    },
  });

  if (!question) {
    return {
      questionId: args.questionId,
      outcome: 'FAILED',
      bankItemId: null,
      publishedVersion: null,
      operationKey: '',
      detail: 'No such question.',
      retryable: false,
    };
  }

  // G1, part one: status.
  if (question.status !== 'APPROVED') {
    return {
      questionId: args.questionId,
      outcome: 'FAILED',
      bankItemId: null,
      publishedVersion: null,
      operationKey: '',
      detail: `Only an APPROVED question may be published; this one is ${question.status}.`,
      retryable: false,
    };
  }

  const approval = question.approvals[0];
  const separation = evaluatePublishSeparation({
    publisherUserId: actor.userId,
    approverUserId: approval?.approverUserId ?? null,
    policies: { ...DEFAULT_SEPARATION_POLICIES, ...deps.policies },
  });
  if (!separation.permitted) {
    return {
      questionId: args.questionId,
      outcome: 'FAILED',
      bankItemId: null,
      publishedVersion: null,
      operationKey: '',
      detail: separation.reason,
      retryable: false,
    };
  }

  // G1, part two: the gates, RE-EVALUATED now. An approval from before the
  // source document changed must not carry a question into the bank.
  let gateFailures: readonly { code: string; detail: string }[] = [];
  try {
    const context = await evaluateGatesForQuestion(
      deps,
      args.questionId,
      { userId: actor.userId, roles: actor.roles, permissions: actor.permissions },
      // Gate 13 concerns the APPROVER and is already recorded on the approval;
      // the publisher's own separation is `approverMayPublishOwn`, checked above.
      { separationApplies: false },
    );
    if (!context.evaluation.passed) {
      gateFailures = context.evaluation.failures.map((failure) => ({
        code: failure.code,
        detail: failure.detail,
      }));
    }
  } catch (error) {
    if (!(error instanceof GatesFailedError)) throw error;
    gateFailures = error.evaluation.failures.map((failure) => ({
      code: failure.code,
      detail: failure.detail,
    }));
  }

  if (gateFailures.length > 0) {
    return {
      questionId: args.questionId,
      outcome: 'GATE_FAILED',
      bankItemId: null,
      publishedVersion: null,
      operationKey: '',
      detail: 'The approval gates no longer pass, so this question was not written to the bank.',
      retryable: false,
      gateFailures,
    };
  }

  const publishedVersion = question.version;
  const existingRef = question.publishedRef;
  const operationType = existingRef ? 'UPDATE' : 'CREATE';
  const operationKey = operationKeyFor({
    targetListId: target.targetListId,
    questionId: args.questionId,
    publishedVersion,
    operationType,
  });

  // G4: dry-run when writes are disabled, and it SAYS SO. It stops before the
  // operation row so a dry run leaves no trace suggesting a real attempt.
  if (!target.writesEnabled) {
    return {
      questionId: args.questionId,
      outcome: 'DRY_RUN',
      bankItemId: null,
      publishedVersion,
      operationKey,
      detail:
        target.dryRunReason ??
        'Bank writes are disabled in this environment, so nothing was written. The gates passed and this question is ready to publish.',
      retryable: true,
    };
  }

  const bankContext: BankContext = {
    targetSiteId: target.targetSiteId,
    targetListId: target.targetListId,
    correlationId: actor.correlationId,
    actorUserId: actor.userId,
    signal: args.signal,
  };

  const payload = question.answerPayload as {
    options: Record<'A' | 'B' | 'C' | 'D', string>;
    correctOption: string;
  };

  // The proposed id becomes the bank's QuestionID. Assigned at publish rather
  // than at generation, because a draft that is never approved should not
  // consume an identifier in the published series.
  const year = deps.clock.now().getUTCFullYear();
  const questionIdForBank =
    question.proposedQuestionId ??
    (await nextBankQuestionId(prisma, question.domain.code, question.domainId, year));

  const write: BankItemWrite = {
    questionId: questionIdForBank,
    internalQuestionId: question.internalQuestionId,
    questionType: question.questionType,
    questionText: question.questionText,
    optionA: payload.options.A,
    optionB: payload.options.B,
    optionC: payload.options.C,
    optionD: payload.options.D,
    correctAnswer: payload.correctOption,
    explanation: question.explanation,
    domain: question.domain.name,
    domainCode: question.domain.code,
    topic: question.topic.name,
    sourceDocumentName: question.sourceDocumentName,
    sourceUrl: question.sourceUrl,
    sourceDocumentId: question.sourceDocumentId,
    sourceSectionKey: question.sectionKey,
    supportingEvidence: question.supportingEvidence,
    sourceContentHash: question.sourceContentHash,
    sourceVersion: question.sourceVersionAtGeneration,
    confidenceIndicator: Number(question.confidenceScore),
    generationJobId: question.generationJobId,
    generatorModel: question.modelId,
    promptVersion: question.promptVersionId,
    status: 'Approved',
    isActive: true,
    isPublished: true,
    version: publishedVersion,
    approvedBy: approval?.approverUserId ?? null,
    approvalDate: approval?.decidedAt.toISOString() ?? null,
    publishedBy: actor.userId,
    publishedDate: deps.clock.now().toISOString(),
    correlationId: actor.correlationId,
  };

  const operation = await prisma.publishOperation.upsert({
    where: { operationKey },
    create: {
      operationKey,
      questionId: args.questionId,
      batchId: args.batchId,
      operationType,
      state: 'IN_FLIGHT',
      attemptCount: 1,
      claimedAt: deps.clock.now(),
      claimedBy: actor.userId,
      correlationId: actor.correlationId,
    },
    update: { attemptCount: { increment: 1 }, claimedAt: deps.clock.now() },
    select: { id: true, state: true },
  });

  // A retry of a key that already succeeded is a no-op, not a second write.
  if (operation.state === 'SUCCEEDED' || operation.state === 'ALREADY_PUBLISHED') {
    return {
      questionId: args.questionId,
      outcome: 'ALREADY_PUBLISHED',
      bankItemId: existingRef?.sharePointItemId ?? null,
      publishedVersion,
      operationKey,
      detail: 'This exact publish operation already completed.',
      retryable: false,
    };
  }

  try {
    // §4.1 and G5: the pre-write existence check, BEFORE every create.
    const found = await bank.findByQuestionId(bankContext, questionIdForBank);

    let itemId: string;
    let eTag: string;
    let outcome: PublishItemOutcome['outcome'];
    let fieldsWritten: readonly string[] = [];

    if (found === null) {
      const result = await bank.createItem(bankContext, write, operationKey);
      itemId = result.itemId;
      eTag = result.eTag;
      fieldsWritten = result.fieldsWritten;
      outcome = 'PUBLISHED';
    } else if (found.version === publishedVersion) {
      // Idempotent no-op: the item already carries this version.
      itemId = found.itemId;
      eTag = found.eTag;
      outcome = 'ALREADY_PUBLISHED';
    } else {
      // G8: conditional, with the eTag just read.
      const result = await bank.updateItem(
        bankContext,
        found.itemId,
        write,
        found.eTag,
        operationKey,
      );
      itemId = result.itemId;
      eTag = result.eTag;
      fieldsWritten = result.fieldsWritten;
      outcome = 'UPDATED';
    }

    const auditWriter = createAuditWriter({ clock: deps.clock });
    const publishedAt = deps.clock.now();

    // G9: the transactional order. The item id exists BEFORE anything local
    // claims publication.
    await prisma.$transaction(async (tx: TransactionClient) => {
      await tx.publishedQuestionReference.upsert({
        where: { internalQuestionId: question.internalQuestionId },
        create: {
          questionId: questionIdForBank,
          internalQuestionId: question.internalQuestionId,
          targetSiteId: target.targetSiteId,
          targetListId: target.targetListId,
          sharePointItemId: itemId,
          eTag,
          publishedVersion,
          status: 'PUBLISHED',
          isActive: true,
          isPublished: true,
          domainId: question.domainId,
          topicId: question.topicId,
          questionTextHash: createHash('sha256')
            .update(question.questionText, 'utf8')
            .digest('hex'),
          answerPayloadHash: createHash('sha256')
            .update(JSON.stringify(question.answerPayload), 'utf8')
            .digest('hex'),
          sourceDocumentId: question.sourceDocumentId,
          sectionKey: question.sectionKey,
          sourceContentHash: question.sourceContentHash,
          publishedAt,
          publishedByUserId: actor.userId,
        },
        update: {
          sharePointItemId: itemId,
          eTag,
          publishedVersion,
          status: 'PUBLISHED',
          isActive: true,
          isPublished: true,
          publishedAt,
          publishedByUserId: actor.userId,
          questionTextHash: createHash('sha256')
            .update(question.questionText, 'utf8')
            .digest('hex'),
          answerPayloadHash: createHash('sha256')
            .update(JSON.stringify(question.answerPayload), 'utf8')
            .digest('hex'),
        },
      });

      await tx.draftQuestion.update({
        where: { id: args.questionId },
        data: {
          status: 'PUBLISHED',
          publishedVersion,
          proposedQuestionId: questionIdForBank,
          modifiedByUserId: actor.userId,
        },
      });

      await tx.publishOperation.update({
        where: { operationKey },
        data: {
          state: outcome === 'ALREADY_PUBLISHED' ? 'ALREADY_PUBLISHED' : 'SUCCEEDED',
          sharePointItemId: itemId,
          resultETag: eTag,
        },
      });

      // G6: the item id, eTag, version, and field SET (names, not values).
      await auditWriter.write(tx, {
        action: 'AUTHORING.QUESTION.PUBLISHED',
        outcome: 'SUCCESS',
        actorType: 'USER',
        actorUserId: actor.userId,
        actorDisplayName: actor.displayName,
        actorRoles: [...actor.roles],
        entityType: 'DraftQuestion',
        entityId: args.questionId,
        entityLabel: questionIdForBank,
        domainId: question.domainId,
        sourceId: question.sourceId,
        previousValue: { status: 'APPROVED' },
        newValue: { status: 'PUBLISHED' },
        correlationId: actor.correlationId,
        requestId: actor.requestId,
        portal: 'AUTHORING',
        detail: {
          previousStatus: 'APPROVED',
          newStatus: 'PUBLISHED',
          bankItemId: itemId,
          bankETag: eTag,
          publishedVersion,
          operationType,
          fieldCount: fieldsWritten.length,
          bankType: bank.bankType,
        },
      });
    });

    return {
      questionId: args.questionId,
      outcome,
      bankItemId: itemId,
      publishedVersion,
      operationKey,
      detail:
        outcome === 'ALREADY_PUBLISHED'
          ? 'The bank already carried this version; nothing was rewritten.'
          : `Written to the question bank as ${questionIdForBank}.`,
      retryable: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The publish failed.';
    const code =
      error !== null && typeof error === 'object' && 'code' in error
        ? String((error as { code: unknown }).code)
        : 'UPSTREAM_UNEXPECTED';

    await prisma.publishOperation.update({
      where: { operationKey },
      data: {
        // FAILED, not abandoned: §4.3 requires the question to stay APPROVED
        // with a retryable operation and a reason.
        state: 'FAILED',
        lastError: { code, message },
      },
    });

    return {
      questionId: args.questionId,
      outcome: 'FAILED',
      bankItemId: null,
      publishedVersion,
      operationKey,
      detail: message,
      // A precondition failure is retryable: re-read and re-evaluate is exactly
      // what G8 asks for.
      retryable: code === 'REMOTE_PRECONDITION_FAILED' || code === 'UPSTREAM_UNEXPECTED',
    };
  }
};

// ---------------------------------------------------------------------------

interface RetirableQuestion {
  readonly internalQuestionId: string;
  readonly bankQuestionId: string;
  readonly bankItemId: string;
  readonly eTag: string;
  readonly publishedVersion: number;
  readonly domainId: string;
}

/** Loads what retirement needs, refusing anything that is not published. */
const loadQuestionForRetire = async (
  client: PrismaClient,
  questionId: string,
): Promise<RetirableQuestion> => {
  const row = await client.draftQuestion.findUnique({
    where: { id: questionId },
    select: { internalQuestionId: true, domainId: true, status: true, publishedRef: true },
  });
  if (!row) {
    throw new PublishNotPermittedError('NOT_FOUND', `No question with id ${questionId}.`);
  }
  if (row.status !== 'PUBLISHED' || !row.publishedRef) {
    throw new PublishNotPermittedError(
      'INVALID_STATE_TRANSITION',
      `Only a PUBLISHED question can be retired; this one is ${row.status}.`,
    );
  }
  return {
    internalQuestionId: row.internalQuestionId,
    bankQuestionId: row.publishedRef.questionId,
    bankItemId: row.publishedRef.sharePointItemId,
    eTag: row.publishedRef.eTag,
    publishedVersion: row.publishedRef.publishedVersion,
    domainId: row.domainId,
  };
};

export interface RetireArgs {
  readonly deps: ReviewDeps;
  readonly bank: QuestionBankAdapter;
  readonly target: PublishTarget;
  readonly questionId: string;
  readonly comment: string;
  readonly actor: ActorContext;
  readonly signal: AbortSignal;
}

/**
 * Retirement — §4.4. The item is NEVER deleted (G7).
 *
 * Sets IsActive false and Status Retired on the bank item via a conditional
 * update, marks the local reference RETIRED, requires a comment, and audits.
 */
export const retirePublishedQuestion = async (
  args: RetireArgs,
): Promise<{ questionId: string; bankItemId: string; detail: string }> => {
  const { deps, bank, target, actor } = args;

  if (!actor.permissions.includes('question.retire')) {
    throw new PublishNotPermittedError(
      'FORBIDDEN',
      'Retiring a published question requires the permission "question.retire".',
    );
  }
  if (args.comment.trim().length < 10) {
    throw new PublishNotPermittedError(
      'COMMENT_REQUIRED',
      'Retirement requires a written comment of at least 10 characters. Someone will ask why this question left the bank.',
    );
  }

  const question = await loadQuestionForRetire(deps.prisma, args.questionId);

  const operationKey = operationKeyFor({
    targetListId: target.targetListId,
    questionId: args.questionId,
    publishedVersion: question.publishedVersion,
    operationType: 'RETIRE',
  });

  const bankContext: BankContext = {
    targetSiteId: target.targetSiteId,
    targetListId: target.targetListId,
    correlationId: actor.correlationId,
    actorUserId: actor.userId,
    signal: args.signal,
  };

  const result = await bank.retireItem(
    bankContext,
    question.bankItemId,
    question.eTag,
    args.comment.trim(),
    operationKey,
  );

  const auditWriter = createAuditWriter({ clock: deps.clock });
  const retiredAt = deps.clock.now();

  await deps.prisma.$transaction(async (tx: TransactionClient) => {
    await tx.publishedQuestionReference.update({
      where: { internalQuestionId: question.internalQuestionId },
      data: {
        status: 'RETIRED',
        isActive: false,
        eTag: result.eTag,
        retiredAt,
        retiredByUserId: actor.userId,
        retireComment: args.comment.trim(),
      },
    });

    await tx.draftQuestion.update({
      where: { id: args.questionId },
      data: { status: 'RETIRED', retiredAt, modifiedByUserId: actor.userId },
    });

    await tx.questionReview.create({
      data: {
        questionId: args.questionId,
        questionVersion: question.publishedVersion,
        reviewerUserId: actor.userId,
        kind: 'REVIEWER',
        outcome: 'COMMENTED',
        comment: args.comment.trim(),
        isBlocking: false,
      },
    });

    await auditWriter.write(tx, {
      action: 'AUTHORING.QUESTION.RETIRED',
      outcome: 'SUCCESS',
      actorType: 'USER',
      actorUserId: actor.userId,
      actorDisplayName: actor.displayName,
      actorRoles: [...actor.roles],
      entityType: 'DraftQuestion',
      entityId: args.questionId,
      entityLabel: question.bankQuestionId,
      domainId: question.domainId,
      correlationId: actor.correlationId,
      requestId: actor.requestId,
      portal: 'AUTHORING',
      previousValue: { status: 'PUBLISHED' },
      newValue: { status: 'RETIRED' },
      detail: {
        previousStatus: 'PUBLISHED',
        newStatus: 'RETIRED',
        bankItemId: result.itemId,
        bankETag: result.eTag,
        publishedVersion: question.publishedVersion,
        operationType: 'RETIRE',
      },
    });
  });

  return {
    questionId: args.questionId,
    bankItemId: result.itemId,
    detail: 'The bank item was marked inactive and Retired. It was not deleted.',
  };
};
