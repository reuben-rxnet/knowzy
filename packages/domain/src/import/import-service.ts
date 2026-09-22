// Question import — one acquisition path onto the existing rails.
//
// This creates DRAFT questions from an uploaded question bank, and it is
// deliberately boring: it runs the SAME evidence verification, the SAME
// integrity gate, the SAME duplicate detection and the SAME confidence
// computation as generation, then writes a draft into the SAME review queue.
//
// The one thing it does differently is record HOW the question arrived
// (`acquisition: 'IMPORTED'`) and WHERE in the file it was found
// (`importLocator`). A reviewer needs both: an imported question was written
// outside this platform, for a purpose the platform cannot see, and it
// deserves a different kind of reading even though it clears the same bar.
//
// What this does NOT do, and must never do, is let an imported question skip
// review or approval. Publishing still requires an approver who is not the
// importer, and gate 13 is an identity comparison that knows nothing about
// acquisition.

import {
  checkIntegrity,
  computeConfidence,
  verifyEvidence,
  type EvidenceSection,
  type GeneratedQuestion,
} from '@knowzy/claude-services';
import { createAuditWriter, type PrismaClient } from '@knowzy/database';
import type { Clock } from '@knowzy/observability';
import type { EvidenceMode } from '@knowzy/shared-types';
import type { ValidatedQuestion } from '@knowzy/question-import';
import {
  assessDuplicate,
  type ComparableQuestion,
  type DuplicateThresholds,
} from '../generation/similarity.js';

export interface ImportTargetDocument {
  readonly documentId: string;
  readonly sourceId: string;
  readonly sourceDocumentId: string;
  readonly name: string;
  readonly sourceUrl: string;
  readonly containerName: string | null;
  readonly folderPath: string | null;
  readonly sourceVersion: string;
  readonly sourceETag: string | null;
  readonly contentHash: string;
}

export interface ImportTargetSection {
  readonly sectionKey: string;
  readonly sectionContentHash: string;
  readonly startOffset: number;
  readonly assessableCharCount: number;
  readonly text: string;
}

export interface ImportRejection {
  readonly locator: string;
  readonly reason:
    | 'EVIDENCE_UNVERIFIED'
    | 'OPTION_DUPLICATE'
    | 'ANSWER_INVALID'
    | 'QUESTION_INCOMPLETE'
    | 'DUPLICATE'
    | 'TAXONOMY_MAPPING_REQUIRED';
  readonly detail: string;
}

export interface RunImportArgs {
  readonly prisma: PrismaClient;
  readonly clock: Clock;
  readonly document: ImportTargetDocument;
  readonly sections: readonly ImportTargetSection[];
  readonly questions: readonly ValidatedQuestion[];
  /** The batch default, used for a question whose file names no taxonomy. */
  readonly domainId: string;
  readonly topicId: string;
  /**
   * Per-question taxonomy, from the file's own Domain and Topic columns.
   *
   * Returning null REFUSES the question rather than filing it under the batch
   * default: a name the file wrote and the platform does not hold is a
   * question for the importer, and quietly filing it somewhere plausible is
   * the failure this whole path exists to prevent. Omit the resolver entirely
   * and every question takes the batch default, which is what a file with no
   * taxonomy columns needs.
   */
  readonly resolveTaxonomy?: (detected: {
    readonly domainName: string | null;
    readonly topicName: string | null;
  }) => { readonly domainId: string; readonly topicId: string } | null;
  readonly evidenceMode: EvidenceMode;
  readonly thresholds: DuplicateThresholds;
  readonly minAssessableChars: number;
  readonly actor: {
    readonly userId: string;
    readonly displayName: string;
    readonly roles: readonly string[];
  };
  readonly correlationId: string;
  readonly requestId: string;
}

export interface ImportRunResult {
  readonly createdQuestionIds: readonly string[];
  readonly rejections: readonly ImportRejection[];
}

const asComparable = (question: ValidatedQuestion, domainId: string): ComparableQuestion => ({
  questionId: 'candidate',
  domainId,
  questionText: question.questionText,
  options: Object.values(question.options),
  correctOptionText: question.options[question.correctOption],
  sectionKey: question.sectionKey,
});

/**
 * The corpus every import is compared against.
 *
 * Drafts, approved and published together — the same corpus generation uses.
 * Importing a question the bank already holds is the single most likely
 * failure of a question-bank import, because a bank is often imported twice.
 */
const loadCorpus = async (prisma: PrismaClient): Promise<ComparableQuestion[]> => {
  const rows = await prisma.draftQuestion.findMany({
    where: { status: { notIn: ['REJECTED', 'ARCHIVED'] } },
    select: { id: true, domainId: true, questionText: true, answerPayload: true, sectionKey: true },
  });
  return rows.map((row) => {
    const payload = row.answerPayload as {
      options?: Record<string, string>;
      correctOption?: string;
    };
    const options = Object.values(payload.options ?? {});
    return {
      questionId: row.id,
      domainId: row.domainId,
      questionText: row.questionText,
      options,
      correctOptionText: payload.options?.[payload.correctOption ?? 'A'] ?? '',
      sectionKey: row.sectionKey,
    };
  });
};

export const runQuestionImport = async (args: RunImportArgs): Promise<ImportRunResult> => {
  const { prisma, clock, document } = args;

  const evidenceSections: EvidenceSection[] = args.sections.map((section) => ({
    sectionKey: section.sectionKey,
    text: section.text,
    startOffset: section.startOffset,
  }));

  const corpus = await loadCorpus(prisma);
  const createdQuestionIds: string[] = [];
  const rejections: ImportRejection[] = [];
  const auditWriter = createAuditWriter({ clock });

  for (const question of args.questions) {
    const section = args.sections.find((s) => s.sectionKey === question.sectionKey);
    if (section === undefined) {
      rejections.push({
        locator: question.locator,
        reason: 'EVIDENCE_UNVERIFIED',
        detail: 'The question cites a section that is not part of the imported document.',
      });
      continue;
    }

    // --- gate 1: evidence verification, unmodified.
    //
    // This is the load-bearing step and the reason import is groundable at
    // all: the span is the block the question was READ FROM, so it verifies
    // against the document for the same reason a generated question's span
    // does. A span that does not verify means detection mis-read the file,
    // which is exactly when a draft should not be created.
    const evidence = verifyEvidence({
      evidence: question.evidence,
      sectionKey: question.sectionKey,
      sections: evidenceSections,
      mode: args.evidenceMode,
    });
    if (!evidence.verified) {
      rejections.push({
        locator: question.locator,
        reason: 'EVIDENCE_UNVERIFIED',
        detail: `${evidence.code}: ${evidence.detail}`,
      });
      continue;
    }

    // --- gate 2: integrity, the same checks a model's output passes.
    const candidate: GeneratedQuestion = {
      sectionKey: question.sectionKey,
      questionText: question.questionText,
      options: question.options,
      correctOption: question.correctOption,
      explanation: question.explanation,
      supportingEvidence: question.evidence,
    };
    const integrity = checkIntegrity(candidate);
    if (integrity !== null) {
      rejections.push({
        locator: question.locator,
        reason: integrity.reason,
        detail: integrity.detail,
      });
      continue;
    }

    // --- taxonomy: where this question is filed, from the FILE, not the form.
    //
    // Before the duplicate check on purpose: duplicate scoring is scoped by
    // domain, so a question whose domain is unresolved cannot be scored
    // meaningfully either.
    const placement =
      args.resolveTaxonomy === undefined
        ? { domainId: args.domainId, topicId: args.topicId }
        : args.resolveTaxonomy({
            domainName: question.domainName,
            topicName: question.topicName,
          });
    if (placement === null) {
      rejections.push({
        locator: question.locator,
        reason: 'TAXONOMY_MAPPING_REQUIRED',
        detail:
          `The file files this question under "${question.domainName ?? ''}" / ` +
          `"${question.topicName ?? ''}", which does not exist here. Map it to an existing ` +
          'domain and topic, or create them in Administration first. An import never creates ' +
          'taxonomy: a spreadsheet typo would become a permanent domain code.',
      });
      continue;
    }

    // --- gate 3: duplicates, against drafts, approved and published.
    const verdict = assessDuplicate(
      asComparable(question, placement.domainId),
      corpus,
      args.thresholds,
    );
    if (verdict.action === 'BLOCK') {
      rejections.push({
        locator: question.locator,
        reason: 'DUPLICATE',
        detail:
          `Composite similarity ${verdict.maxScore.toFixed(3)} against question ` +
          `${verdict.match.questionId} is at or above the block threshold ` +
          `${args.thresholds.blockThreshold}. The bank may already hold this question.`,
      });
      continue;
    }

    const confidence = computeConfidence({
      question: candidate,
      evidence,
      sectionCharCount: section.assessableCharCount,
      minAssessableChars: args.minAssessableChars,
      maxSimilarityScore: verdict.maxScore,
    });

    const questionId = await prisma.$transaction(async (tx) => {
      const created = await tx.draftQuestion.create({
        data: {
          questionType: 'MULTIPLE_CHOICE_4',
          // DRAFT, exactly as a generated question lands in DRAFT. An import
          // that created APPROVED questions would be a governance bypass
          // dressed as a convenience.
          status: 'DRAFT',
          acquisition: 'IMPORTED',
          importLocator: question.locator,
          domainId: placement.domainId,
          topicId: placement.topicId,
          questionText: question.questionText,
          answerPayload: {
            kind: 'MULTIPLE_CHOICE_4',
            options: question.options,
            correctOption: question.correctOption,
          },
          explanation: question.explanation,

          sourceId: document.sourceId,
          sourceDocumentId: document.sourceDocumentId,
          sectionKey: question.sectionKey,
          sourceUrl: document.sourceUrl,
          sourceDocumentName: document.name,
          sourceLibraryName: document.containerName,
          sourceFolderPath: document.folderPath,
          sourceVersionAtGeneration: document.sourceVersion,
          sourceETagAtGeneration: document.sourceETag,
          sourceContentHash: document.contentHash,
          sectionContentHash: section.sectionContentHash,

          supportingEvidence: evidence.evidence,
          evidenceStartOffset: evidence.startOffset,
          evidenceEndOffset: evidence.endOffset,
          evidenceVerificationMode: evidence.mode,
          evidenceSimilarityScore: evidence.similarityScore,

          // No job, no model, no prompt and no provider: nothing generated
          // this. Leaving them null is the honest record, and it is why
          // `acquisition` exists rather than a sentinel model id like
          // "imported" that would pollute every yield comparison.
          generationJobId: null,
          modelId: null,
          promptVersionId: null,

          confidenceScore: confidence.score,
          confidenceComponents: {
            components: { ...confidence.components },
            weights: { ...confidence.weights },
          },
          maxSimilarityScore: verdict.maxScore,
          duplicateDisposition: null,
          duplicateDispositionNote:
            verdict.action === 'FLAG'
              ? `Similar to question ${verdict.match.questionId} (composite ${verdict.maxScore.toFixed(3)}). A reviewer must record DISTINCT or DUPLICATE before approval.`
              : null,

          createdByUserId: args.actor.userId,
        },
        select: { id: true, version: true },
      });

      await tx.draftQuestionVersion.create({
        data: {
          questionId: created.id,
          version: created.version,
          changeKind: 'IMPORTED',
          diff: {},
          snapshot: {
            questionText: question.questionText,
            options: question.options,
            correctOption: question.correctOption,
            explanation: question.explanation,
            supportingEvidence: evidence.evidence,
            importLocator: question.locator,
            strategy: question.strategy,
          },
          changedByUserId: args.actor.userId,
        },
      });

      await auditWriter.write(tx, {
        action: 'AUTHORING.QUESTION.IMPORTED',
        outcome: 'SUCCESS',
        actorType: 'USER',
        actorUserId: args.actor.userId,
        actorDisplayName: args.actor.displayName,
        actorRoles: [...args.actor.roles],
        entityType: 'DraftQuestion',
        entityId: created.id,
        entityLabel: created.id,
        domainId: placement.domainId,
        sourceId: document.sourceId,
        correlationId: args.correlationId,
        requestId: args.requestId,
        portal: 'AUTHORING',
        detail: {
          // Counts, ids and locators only. No question text and no option
          // text: the audit allow-list would drop them anyway, and an audit
          // row is not a copy of the content.
          importLocator: question.locator,
          importStrategy: question.strategy,
          sourceDocumentName: document.name,
          confidenceScore: confidence.score,
        },
      });

      return created.id;
    });

    createdQuestionIds.push(questionId);
    // Added to the corpus so the NEXT question in the same import is compared
    // against it. Without this, a file containing the same question twice
    // would import it twice.
    corpus.push({ ...asComparable(question, placement.domainId), questionId });
  }

  return { createdQuestionIds, rejections };
};
