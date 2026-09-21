// Question Bank tools — mcp-tools.md §8.
//
// These are the only tools that can write outside Knowzy, and only two of them
// actually do. §2: "Only the six Question Bank tools can write outside Knowzy,
// and only two of those (publish_question_to_sharepoint,
// retire_published_question) actually do."
//
// The registry enforces that shape: `writes: 'EXTERNAL'` is refused for any
// tool outside the question-bank family.
//
// G2 is why they live here at all: the write credential exists only in the MCP
// server process, which has internal ingress only. There is no browser path and
// no user-delegated write.

import { z } from 'zod';
import { createAuditWriter } from '@knowzy/database';
import { publishApprovedQuestions, retirePublishedQuestion } from '@knowzy/domain';
import { registerTool } from './registry.js';
import type { AuthorizationEnvelope } from './envelope.js';
import type { ToolDeps } from './deps.js';

const actorFrom = (envelope: AuthorizationEnvelope) => ({
  userId: envelope.subject.userId,
  displayName: envelope.subject.displayName,
  roles: envelope.effectiveRoles,
  permissions: envelope.permissions,
  correlationId: envelope.correlationId,
  requestId: envelope.requestId,
});

/**
 * Resolves the bank and its write permission.
 *
 * G4 gates SHAREPOINT writes on `sharepoint.write.enabled`. The mock bank is a
 * different implementation of the same port writing to a local JSON file, and
 * knowledge-source-adapters.md §6 requires the whole pipeline — publish
 * included — to be exercisable with no tenant credentials. So the gate is "may
 * THIS bank be written in THIS environment", not "is the SharePoint flag on":
 *
 *   MOCK       writable in `local` only, and the registry refuses to construct
 *              it anywhere else, so this cannot become a production fallback.
 *   SHAREPOINT writable only when the flag is on; otherwise dry-run, which is
 *              exactly what G4's `whenOff` describes.
 */
const resolveBankTarget = (deps: ToolDeps) => {
  const bank = deps.questionBank;
  if (!bank) {
    return {
      bank: null,
      target: {
        targetSiteId: '',
        targetListId: '',
        writesEnabled: false,
        dryRunReason: 'No question bank adapter is registered for this environment.',
      },
    };
  }

  const isMock = bank.bankType === 'MOCK';
  const writesEnabled = isMock ? deps.environment === 'local' : deps.sharePointWriteEnabled;

  return {
    bank,
    target: {
      targetSiteId: isMock ? 'mock-site' : deps.bankSiteId,
      targetListId: isMock ? 'knowzy-question-bank' : deps.bankListId,
      writesEnabled,
      dryRunReason: writesEnabled
        ? null
        : isMock
          ? `The mock question bank is only writable in the local environment; this is ${deps.environment}.`
          : 'sharepoint.write.enabled is off, so publishing runs in dry-run mode. Nothing was written to SharePoint.',
    },
  };
};

registerTool({
  name: 'check_question_publish_status',
  family: 'question-bank',
  permission: 'question.read',
  portals: ['AUTHORING'],
  auditAction: null,
  auditExemptionReason: 'audit-model.md §8: an individual read request is not audited.',
  timeoutMs: 15_000,
  writes: 'NONE',
  description: 'Reports whether a question already exists in the bank, and at what version.',
  input: z.object({ questionId: z.string().uuid() }).strict(),
  async handler({ input, deps, signal }) {
    const { bank, target } = resolveBankTarget(deps);
    const question = await deps.prisma.draftQuestion.findUnique({
      where: { id: input.questionId },
      select: {
        status: true,
        version: true,
        proposedQuestionId: true,
        publishedRef: {
          select: {
            questionId: true,
            publishedVersion: true,
            sharePointItemId: true,
            eTag: true,
            status: true,
          },
        },
      },
    });
    if (!question) throw new Error(`No question with id ${input.questionId}.`);

    const bankQuestionId = question.proposedQuestionId ?? question.publishedRef?.questionId ?? null;
    const item =
      bank && bankQuestionId
        ? await bank.findByQuestionId(
            {
              targetSiteId: target.targetSiteId,
              targetListId: target.targetListId,
              correlationId: 'check',
              actorUserId: 'system',
              signal,
            },
            bankQuestionId,
          )
        : null;

    return {
      questionId: input.questionId,
      localStatus: question.status,
      localVersion: question.version,
      bankType: bank?.bankType ?? null,
      writesEnabled: target.writesEnabled,
      dryRunReason: target.dryRunReason,
      bankQuestionId,
      bankItem:
        item === null
          ? null
          : {
              itemId: item.itemId,
              eTag: item.eTag,
              version: item.version,
              isActive: item.isActive,
              isPublished: item.isPublished,
              status: item.status,
            },
      // Stated plainly so a caller does not have to infer it from the shape.
      action:
        item === null ? 'CREATE' : item.version === question.version ? 'ALREADY_CURRENT' : 'UPDATE',
    };
  },
});

registerTool({
  name: 'publish_question_to_sharepoint',
  family: 'question-bank',
  permission: 'question.publish',
  portals: ['AUTHORING'],
  auditAction: 'AUTHORING.QUESTION.PUBLISHED',
  timeoutMs: 120_000,
  // The one place in the platform where this value is legitimate.
  writes: 'EXTERNAL',
  description: 'Publishes approved questions to the Question Bank, idempotently.',
  input: z
    .object({
      questionIds: z.array(z.string().uuid()).min(1).max(50),
      idempotencyKey: z.string().min(8).max(200).optional(),
    })
    .strict(),
  async handler({ envelope, input, deps, signal }) {
    const { bank, target } = resolveBankTarget(deps);
    if (!bank) throw new Error(target.dryRunReason ?? 'No question bank is available.');

    const result = await publishApprovedQuestions({
      deps: { prisma: deps.prisma, clock: deps.clock },
      bank,
      target,
      questionIds: input.questionIds,
      actor: actorFrom(envelope),
      signal,
      ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
    });

    // publishApprovedQuestions audits each successful write inside its own
    // transaction (G6). This event records the BATCH, which is what a
    // reviewer looking for "who ran the publish" needs.
    const auditWriter = createAuditWriter({ clock: deps.clock });
    await auditWriter.write(deps.prisma, {
      action: 'AUTHORING.QUESTION.PUBLISHED',
      outcome: result.failedCount > 0 ? 'FAILURE' : 'SUCCESS',
      actorType: 'USER',
      actorUserId: envelope.subject.userId,
      actorDisplayName: envelope.subject.displayName,
      actorRoles: [...envelope.effectiveRoles],
      entityType: 'PublishBatch',
      entityId: result.batchId,
      entityLabel: result.batchId,
      correlationId: envelope.correlationId,
      requestId: envelope.requestId,
      portal: envelope.portal,
      detail: {
        batchSize: input.questionIds.length,
        publishedCount: result.publishedCount,
        failedCount: result.failedCount,
        dryRun: result.dryRun,
      },
    });

    return result;
  },
});

registerTool({
  name: 'get_published_question',
  family: 'question-bank',
  permission: 'question.read',
  portals: ['AUTHORING'],
  // A read of the answer key IS audited: audit-model.md §8 names
  // `get_published_question` with includeAnswerKey as a sensitive read.
  auditAction: 'AUTHORING.QUESTION.REUSED',
  timeoutMs: 15_000,
  writes: 'LOCAL',
  description: 'Returns a published bank item, optionally including its answer key.',
  input: z
    .object({
      questionId: z.string().uuid(),
      includeAnswerKey: z.boolean().default(false),
    })
    .strict(),
  async handler({ envelope, input, deps, signal }) {
    const { bank, target } = resolveBankTarget(deps);
    if (!bank) throw new Error('No question bank is available.');

    const reference = await deps.prisma.publishedQuestionReference.findFirst({
      where: { question: { id: input.questionId } },
      select: { questionId: true, publishedVersion: true, sharePointItemId: true, status: true },
    });
    if (!reference) throw new Error('This question has not been published.');

    const item = await bank.findByQuestionId(
      {
        targetSiteId: target.targetSiteId,
        targetListId: target.targetListId,
        correlationId: envelope.correlationId,
        actorUserId: envelope.subject.userId,
        signal,
      },
      reference.questionId,
    );

    const auditWriter = createAuditWriter({ clock: deps.clock });
    await auditWriter.write(deps.prisma, {
      action: 'AUTHORING.QUESTION.REUSED',
      outcome: 'SUCCESS',
      actorType: 'USER',
      actorUserId: envelope.subject.userId,
      actorDisplayName: envelope.subject.displayName,
      actorRoles: [...envelope.effectiveRoles],
      entityType: 'PublishedQuestionReference',
      entityId: input.questionId,
      entityLabel: reference.questionId,
      correlationId: envelope.correlationId,
      requestId: envelope.requestId,
      portal: envelope.portal,
      // WHO saw the key matters, which is why this read is audited at all.
      detail: { includeAnswerKey: input.includeAnswerKey, bankItemId: reference.sharePointItemId },
    });

    const fields = (item?.fields ?? {}) as Record<string, unknown>;
    const withoutKey = { ...fields };
    delete withoutKey['correctAnswer'];

    return {
      questionId: reference.questionId,
      itemId: item?.itemId ?? null,
      version: reference.publishedVersion,
      status: reference.status,
      // The key is omitted unless explicitly asked for, and the ask is audited.
      fields: input.includeAnswerKey ? fields : withoutKey,
      answerKeyIncluded: input.includeAnswerKey,
    };
  },
});

registerTool({
  name: 'retire_published_question',
  family: 'question-bank',
  permission: 'question.retire',
  portals: ['AUTHORING'],
  auditAction: 'AUTHORING.QUESTION.RETIRED',
  timeoutMs: 60_000,
  writes: 'EXTERNAL',
  description: 'Retires a published question. The bank item is never deleted.',
  input: z
    .object({
      questionId: z.string().uuid(),
      comment: z.string().min(10).max(2_000),
    })
    .strict(),
  async handler({ envelope, input, deps, signal }) {
    const { bank, target } = resolveBankTarget(deps);
    if (!bank) throw new Error('No question bank is available.');
    if (!target.writesEnabled) {
      throw new Error(
        target.dryRunReason ??
          'Bank writes are disabled, so retirement cannot be performed. A retirement that only changed local state would make the bank and the platform disagree.',
      );
    }

    return retirePublishedQuestion({
      deps: { prisma: deps.prisma, clock: deps.clock },
      bank,
      target,
      questionId: input.questionId,
      comment: input.comment,
      actor: actorFrom(envelope),
      signal,
    });
  },
});

registerTool({
  name: 'query_published_questions',
  family: 'question-bank',
  permission: 'question.read',
  portals: ['AUTHORING'],
  auditAction: null,
  auditExemptionReason: 'audit-model.md §8: an individual list query is not audited.',
  timeoutMs: 20_000,
  writes: 'NONE',
  description: 'Lists bank items, from the bank itself rather than the local projection.',
  input: z
    .object({
      domainCode: z.string().optional(),
      isActive: z.boolean().optional(),
      cursor: z.string().optional(),
      pageSize: z.number().int().min(1).max(100).optional(),
    })
    .strict(),
  async handler({ envelope, input, deps, signal }) {
    const { bank, target } = resolveBankTarget(deps);
    if (!bank) return { bankType: null, items: [], nextCursor: null, totalCount: 0 };

    const page = await bank.queryItems(
      {
        targetSiteId: target.targetSiteId,
        targetListId: target.targetListId,
        correlationId: envelope.correlationId,
        actorUserId: envelope.subject.userId,
        signal,
      },
      {
        ...(input.domainCode === undefined ? {} : { domainCode: input.domainCode }),
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        ...(input.pageSize === undefined ? {} : { pageSize: input.pageSize }),
      },
    );

    return {
      bankType: bank.bankType,
      items: page.items.map((item) => ({
        itemId: item.itemId,
        questionId: item.questionId,
        version: item.version,
        isActive: item.isActive,
        isPublished: item.isPublished,
        status: item.status,
        // No correctAnswer in a list response. A list is the easiest place for
        // an answer key to leak unnoticed.
        questionText: item.fields['questionText'] ?? null,
        domainCode: item.fields['domainCode'] ?? null,
        topic: item.fields['topic'] ?? null,
      })),
      nextCursor: page.nextCursor ?? null,
      totalCount: page.totalCount ?? page.items.length,
    };
  },
});
