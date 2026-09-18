// Question versioning — workflows.md §3.5 and data-model.md §6.3.
//
// | Event                          | Version effect                          |
// | Any field edit on a draft      | New snapshot, `version` increments      |
// | Approval                       | That version is what publishes          |
// | Edit of a published question   | New draft N+1; published N stays live   |
// | Existing assessment history    | Never rewritten                         |
//
// Two rules make this more than bookkeeping:
//
//   - §2.5: evidence re-verification "runs again on EVERY EDIT to question text
//     or options". An edit that broke the grounding must be caught at the edit,
//     not discovered at approval.
//   - I15: the lineage columns are immutable after insert. An edit may change
//     the question; it may never change where the question came from.

import { createAuditWriter, type PrismaClient, type TransactionClient } from '@knowzy/database';
import { verifyEvidence, type EvidenceSection } from '@knowzy/claude-services';
import type { Clock } from '@knowzy/observability';
import type { ActorContext } from './review-service.js';
import { QuestionNotFoundError } from './review-service.js';

export interface QuestionEdit {
  readonly questionText?: string;
  readonly options?: Partial<Record<'A' | 'B' | 'C' | 'D', string>>;
  readonly correctOption?: 'A' | 'B' | 'C' | 'D';
  readonly explanation?: string;
  /** May be narrowed or widened, but must still verify against the section. */
  readonly supportingEvidence?: string;
}

export class EvidenceBrokenByEditError extends Error {
  readonly code = 'EVIDENCE_UNVERIFIED';
  constructor(detail: string) {
    super(`This edit would break the question's grounding: ${detail}`);
    this.name = 'EvidenceBrokenByEditError';
  }
}

export class NotEditableError extends Error {
  readonly code = 'INVALID_STATE_TRANSITION';
  constructor(status: string) {
    super(
      `A question in ${status} cannot be edited directly. Move it to AUTHOR_REVIEW first, or edit a published question into a new draft version.`,
    );
    this.name = 'NotEditableError';
  }
}

const EDITABLE_STATUSES = new Set(['DRAFT', 'AUTHOR_REVIEW', 'CHANGES_REQUESTED']);

export interface FieldDiff {
  readonly field: string;
  readonly previous: string;
  readonly next: string;
}

export interface EditResult {
  readonly questionId: string;
  readonly version: number;
  readonly diff: readonly FieldDiff[];
  readonly evidenceReverified: boolean;
  readonly evidenceSimilarityScore: number;
}

export interface EditArgs {
  readonly prisma: PrismaClient;
  readonly clock: Clock;
  readonly questionId: string;
  readonly actor: ActorContext;
  readonly edit: QuestionEdit;
}

export const editDraftQuestion = async (args: EditArgs): Promise<EditResult> => {
  const { prisma, clock, actor } = args;

  if (!actor.permissions.includes('question.edit')) {
    throw new Error('Editing a question requires the permission "question.edit".');
  }

  const row = await prisma.draftQuestion.findUnique({ where: { id: args.questionId } });
  if (!row) throw new QuestionNotFoundError(args.questionId);
  if (!EDITABLE_STATUSES.has(row.status)) throw new NotEditableError(row.status);

  const payload = row.answerPayload as {
    kind?: string;
    options: Record<'A' | 'B' | 'C' | 'D', string>;
    correctOption: string;
  };

  const nextOptions = { ...payload.options, ...args.edit.options };
  const nextText = args.edit.questionText ?? row.questionText;
  const nextCorrect = args.edit.correctOption ?? payload.correctOption;
  const nextExplanation = args.edit.explanation ?? row.explanation;
  const nextEvidence = args.edit.supportingEvidence ?? row.supportingEvidence;

  const diff: FieldDiff[] = [];
  const note = (field: string, previous: string, next: string): void => {
    if (previous !== next) diff.push({ field, previous, next });
  };
  note('questionText', row.questionText, nextText);
  note('correctOption', payload.correctOption, nextCorrect);
  note('explanation', row.explanation, nextExplanation);
  note('supportingEvidence', row.supportingEvidence, nextEvidence);
  for (const key of ['A', 'B', 'C', 'D'] as const) {
    note(`option${key}`, payload.options[key] ?? '', nextOptions[key] ?? '');
  }

  if (diff.length === 0) {
    // No snapshot for a no-op edit: a version history full of identical
    // versions makes the real changes hard to find.
    return {
      questionId: args.questionId,
      version: row.version,
      diff: [],
      evidenceReverified: false,
      evidenceSimilarityScore: Number(row.evidenceSimilarityScore ?? 1),
    };
  }

  // §2.5: re-verify on every edit to question text or options. Done for ANY
  // edit here, because the evidence itself may also have been narrowed, and
  // the cost of one extra check is nothing next to a published question whose
  // citation no longer supports it.
  const document = await prisma.knowledgeDocument.findFirst({
    where: { sourceId: row.sourceId, sourceDocumentId: row.sourceDocumentId },
    select: { id: true, extractedText: true, localVersionCounter: true },
  });
  const section = document
    ? await prisma.documentSection.findFirst({
        where: {
          documentId: document.id,
          sectionKey: row.sectionKey,
          documentVersionCounter: document.localVersionCounter,
        },
        select: { sectionKey: true, startOffset: true, endOffset: true },
      })
    : null;

  if (!document || !section) {
    throw new EvidenceBrokenByEditError(
      'the cited section is no longer present in the current version of the source document, so the evidence cannot be re-verified.',
    );
  }

  const evidenceSection: EvidenceSection = {
    sectionKey: section.sectionKey,
    text: (document.extractedText ?? '').slice(section.startOffset, section.endOffset),
    startOffset: section.startOffset,
  };

  const verified = verifyEvidence({
    evidence: nextEvidence,
    sectionKey: row.sectionKey,
    sections: [evidenceSection],
    mode: row.evidenceVerificationMode,
  });
  if (!verified.verified) {
    // The edit is REFUSED rather than saved-and-flagged. Saving it would leave
    // a draft whose stored offsets point at text that does not support it, and
    // ADR-005 makes verification non-optional.
    throw new EvidenceBrokenByEditError(`${verified.code} — ${verified.detail}`);
  }

  const auditWriter = createAuditWriter({ clock });
  const nextVersion = row.version + 1;

  return prisma.$transaction(async (tx: TransactionClient) => {
    await tx.draftQuestion.update({
      where: { id: args.questionId },
      data: {
        version: nextVersion,
        questionText: nextText,
        answerPayload: {
          kind: payload.kind ?? 'MULTIPLE_CHOICE_4',
          options: nextOptions,
          correctOption: nextCorrect,
        },
        explanation: nextExplanation,
        supportingEvidence: verified.evidence,
        evidenceStartOffset: verified.startOffset,
        evidenceEndOffset: verified.endOffset,
        evidenceSimilarityScore: verified.similarityScore,
        modifiedByUserId: actor.userId,
        // An edit invalidates a prior duplicate disposition: the reviewer
        // judged the OLD text distinct, and gate 10 must be re-satisfied.
        ...(diff.some((entry) => entry.field === 'questionText' || entry.field.startsWith('option'))
          ? { duplicateDisposition: null }
          : {}),
        // Lineage columns are absent from this update on purpose (I15).
      },
    });

    await tx.draftQuestionVersion.create({
      data: {
        questionId: args.questionId,
        version: nextVersion,
        changeKind: 'EDITED',
        snapshot: {
          questionText: nextText,
          options: nextOptions,
          correctOption: nextCorrect,
          explanation: nextExplanation,
          supportingEvidence: verified.evidence,
        },
        diff: { fields: diff.map((entry) => ({ ...entry })) },
        evidenceReverified: true,
        evidenceReverifyResult: {
          mode: verified.mode,
          similarityScore: verified.similarityScore,
          startOffset: verified.startOffset,
          endOffset: verified.endOffset,
        },
        changedByUserId: actor.userId,
      },
    });

    await auditWriter.write(tx, {
      action: 'AUTHORING.QUESTION.EDITED',
      outcome: 'SUCCESS',
      actorType: 'USER',
      actorUserId: actor.userId,
      actorDisplayName: actor.displayName,
      actorRoles: [...actor.roles],
      entityType: 'DraftQuestion',
      entityId: args.questionId,
      entityLabel: args.questionId,
      domainId: row.domainId,
      sourceId: row.sourceId,
      correlationId: actor.correlationId,
      requestId: actor.requestId,
      portal: 'AUTHORING',
      // Field NAMES only. The values are the field-level diff on
      // DraftQuestionVersion; audit-model.md §8 keeps question text out of a
      // seven-year store.
      detail: {
        version: nextVersion,
        changedFields: diff.map((entry) => entry.field),
        evidenceReverified: true,
      },
    });

    return {
      questionId: args.questionId,
      version: nextVersion,
      diff,
      evidenceReverified: true,
      evidenceSimilarityScore: verified.similarityScore,
    };
  });
};

export interface VersionHistoryEntry {
  readonly version: number;
  readonly changeKind: string;
  readonly changedAt: Date;
  readonly changedByUserId: string | null;
  readonly changedFields: readonly string[];
  readonly evidenceReverified: boolean;
}

export const readVersionHistory = async (
  prisma: PrismaClient,
  questionId: string,
): Promise<readonly VersionHistoryEntry[]> => {
  const rows = await prisma.draftQuestionVersion.findMany({
    where: { questionId },
    orderBy: { version: 'asc' },
  });

  return rows.map((row) => {
    const diff = row.diff as { fields?: { field: string }[] };
    return {
      version: row.version,
      changeKind: row.changeKind,
      changedAt: row.changedAt,
      changedByUserId: row.changedByUserId,
      changedFields: (diff.fields ?? []).map((entry) => entry.field),
      evidenceReverified: row.evidenceReverified,
    };
  });
};
