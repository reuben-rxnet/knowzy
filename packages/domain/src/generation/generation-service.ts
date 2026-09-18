// The generation service — workflows.md §2.2 and §2.3.
//
// The gate chain, in the order the specification gives, per candidate:
//
//   1. schema validation            SCHEMA_INVALID
//   2. evidence verification        EVIDENCE_UNVERIFIED
//   3. answer/option integrity      OPTION_DUPLICATE / ANSWER_INVALID /
//                                   QUESTION_INCOMPLETE
//   4. duplicate scoring            DUPLICATE (block) / DUPLICATE_SUSPECTED
//   5. persistence                  DraftQuestion, transactional per question
//
// A rejected candidate is NOT persisted as a question; GenerationJobRejection
// is the record of why. That is the whole reason the table exists (§5.4), and
// it is what makes "the platform never pads a requested count" auditable rather
// than asserted.
//
// `run` takes a ResolvedGenerationScope, which cannot be constructed from an
// empty document list, and this module imports nothing that can list documents.
// "Generate from everything" is therefore not expressible here.

import {
  checkIntegrity,
  computeConfidence,
  createDeterministicGenerator,
  verifyEvidence,
  type EvidenceSection,
  type GeneratedQuestion,
  type QuestionGenerator,
} from '@knowzy/claude-services';
import { createAuditWriter, type DbClient, type PrismaClient } from '@knowzy/database';
import type { Clock } from '@knowzy/observability';
import type {
  EvidenceMode,
  GenerationReasonCode,
  RejectionReason,
} from '@knowzy/shared-types';
import { assessDuplicate, type ComparableQuestion, type DuplicateThresholds } from './similarity.js';
import { scopeSectionKeys, type ResolvedGenerationScope } from './scope.js';

export interface GenerationRunContext {
  readonly jobId: string;
  readonly sourceId: string;
  readonly domainId: string;
  readonly topicId: string;
  readonly correlationId: string;
  readonly requestId: string;
  readonly actorUserId: string;
  readonly actorDisplayName: string;
  readonly actorRoles: readonly string[];
  readonly reasonCode: GenerationReasonCode;
}

export interface GenerationProfileSettings {
  readonly profileId: string;
  readonly promptVersionId: string;
  readonly evidenceMode: EvidenceMode;
  readonly thresholds: DuplicateThresholds;
  readonly minAssessableChars: number;
  readonly maxQuestionsPerSection: number;
  readonly domainName: string;
  readonly topicName: string;
}

export interface RunGenerationArgs {
  readonly prisma: PrismaClient;
  readonly clock: Clock;
  readonly scope: ResolvedGenerationScope;
  readonly context: GenerationRunContext;
  readonly profile: GenerationProfileSettings;
  readonly requestedQuestionCount: number;
  /** Defaults to the deterministic local generator (no key required). */
  readonly generator?: QuestionGenerator;
}

export interface GenerationRejection {
  readonly reason: RejectionReason;
  readonly detail: string;
  readonly sectionKey: string | null;
  readonly matchedQuestionId?: string;
  readonly similarityScore?: number;
}

export interface GenerationRunResult {
  readonly jobId: string;
  readonly status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
  readonly acceptedQuestionIds: readonly string[];
  readonly rejections: readonly GenerationRejection[];
  readonly insufficientEvidenceSections: readonly { sectionKey: string; reason: string }[];
  readonly rejectionCounts: Readonly<Record<string, number>>;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export class ContentDriftError extends Error {
  readonly code = 'CONTENT_DRIFT';
  constructor(detail: string) {
    super(detail);
    this.name = 'ContentDriftError';
  }
}

/**
 * Loads the do-not-duplicate stem list — stage 1 suppression (§4.3).
 *
 * Question text only, capped, most recent first. The correct-answer letter is
 * deliberately NOT included: §4.3 permits it for internal comparison, but it
 * would travel into the prompt, and a prompt is the one place an answer key has
 * no business being.
 */
const loadDoNotDuplicate = async (
  client: DbClient,
  sourceDocumentIds: readonly string[],
  cap: number,
): Promise<readonly string[]> => {
  const rows = await client.draftQuestion.findMany({
    where: {
      sourceDocumentId: { in: [...sourceDocumentIds] },
      status: { notIn: ['REJECTED', 'ARCHIVED'] },
    },
    select: { questionText: true },
    orderBy: { createdAt: 'desc' },
    take: cap,
  });
  return rows.map((row) => row.questionText);
};

/**
 * The comparison corpus for stage 2 — §4.4, ACROSS ALL DOMAINS.
 *
 * No domain predicate appears here on purpose. Scoping detection to the
 * caller's domain would make check 5 (cross-domain duplicates) structurally
 * impossible to satisfy.
 */
const loadCorpus = async (client: DbClient): Promise<ComparableQuestion[]> => {
  const rows = await client.draftQuestion.findMany({
    where: { status: { notIn: ['REJECTED', 'ARCHIVED'] } },
    select: {
      id: true,
      domainId: true,
      questionText: true,
      answerPayload: true,
      sectionKey: true,
    },
    take: 2_000,
  });

  return rows.map((row) => {
    const payload = row.answerPayload as { options?: Record<string, string>; correctOption?: string };
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

const asComparable = (
  question: GeneratedQuestion,
  questionId: string,
  domainId: string,
): ComparableQuestion => ({
  questionId,
  domainId,
  questionText: question.questionText,
  options: Object.values(question.options),
  correctOptionText: question.options[question.correctOption],
  sectionKey: question.sectionKey,
});

export const runGenerationJob = async (
  args: RunGenerationArgs,
): Promise<GenerationRunResult> => {
  const { prisma, clock, scope, context, profile } = args;
  const generator = args.generator ?? createDeterministicGenerator();
  const startedAt = clock.now();

  await prisma.generationJob.update({
    where: { id: context.jobId },
    data: { status: 'RUNNING', startedAt },
  });

  // Retrieval-time freshness. workflows.md §2.3 verifies the hash at retrieval
  // so a job cannot ground questions in text that has since changed; here the
  // pinned scope was read from the index, so the check is that the index still
  // agrees with what the scope captured.
  const currentHashes = await prisma.knowledgeDocument.findMany({
    where: { id: { in: scope.documents.map((document) => document.documentId) } },
    select: { id: true, name: true, contentHash: true },
  });
  for (const document of scope.documents) {
    const current = currentHashes.find((row) => row.id === document.documentId);
    if (current && current.contentHash !== document.contentHash) {
      throw new ContentDriftError(
        `"${current.name}" changed after this job was scoped. Re-run the preflight so the questions are grounded in the current text.`,
      );
    }
  }

  const sourceDocumentIds = scope.documents.map((document) => document.sourceDocumentId);
  const doNotDuplicate = await loadDoNotDuplicate(prisma, sourceDocumentIds, 100);
  const corpus = await loadCorpus(prisma);

  const evidenceSections: EvidenceSection[] = scope.sections.map((section) => ({
    sectionKey: section.sectionKey,
    text: section.text,
    startOffset: section.startOffset,
  }));

  const { output, insufficientSections, modelId, inputTokens, outputTokens } =
    await generator.generate({
    sections: scope.sections.map((section) => ({
      sectionKey: section.sectionKey,
      label: section.label,
      text: section.text,
    })),
    doNotDuplicate,
    requestedQuestionCount: args.requestedQuestionCount,
      domainName: profile.domainName,
      topicName: profile.topicName,
    });

  const rejections: GenerationRejection[] = [];
  // §2.7: recorded PER SECTION, whether or not other sections succeeded.
  const insufficient: { sectionKey: string; reason: string }[] = insufficientSections.map(
    (section) => ({ ...section }),
  );
  const acceptedQuestionIds: string[] = [];

  if ('result' in output) {
    // §2.7: a first-class success result, not an error. The generator already
    // listed this section in `insufficientSections`, so it is only added here
    // when the two disagree — which is the case for a generator that returns
    // the union alone.
    if (!insufficient.some((row) => row.sectionKey === output.sectionKey)) {
      insufficient.push({ sectionKey: output.sectionKey, reason: output.reason });
    }
  } else {
    const perSection = new Map<string, number>();

    for (const candidate of output.questions) {
      const sectionKeysInScope = new Set(scopeSectionKeys(scope));
      if (!sectionKeysInScope.has(candidate.sectionKey)) {
        rejections.push({
          reason: 'EVIDENCE_UNVERIFIED',
          detail: 'The candidate cites a section that is not in the pinned scope.',
          sectionKey: candidate.sectionKey,
        });
        continue;
      }

      // --- gate 2: evidence verification
      const evidence = verifyEvidence({
        evidence: candidate.supportingEvidence,
        sectionKey: candidate.sectionKey,
        sections: evidenceSections,
        mode: profile.evidenceMode,
      });
      if (!evidence.verified) {
        rejections.push({
          reason: 'EVIDENCE_UNVERIFIED',
          detail: `${evidence.code}: ${evidence.detail}`,
          sectionKey: candidate.sectionKey,
        });
        continue;
      }

      // --- gate 3: integrity
      const integrity = checkIntegrity(candidate);
      if (integrity !== null) {
        rejections.push({
          reason: integrity.reason,
          detail: integrity.detail,
          sectionKey: candidate.sectionKey,
        });
        continue;
      }

      const section = scope.sections.find((s) => s.sectionKey === candidate.sectionKey);
      if (!section) continue;

      const used = perSection.get(candidate.sectionKey) ?? 0;
      if (used >= profile.maxQuestionsPerSection) {
        rejections.push({
          reason: 'DUPLICATE',
          detail: `The section already reached the profile's limit of ${profile.maxQuestionsPerSection} question(s) in this run.`,
          sectionKey: candidate.sectionKey,
        });
        continue;
      }

      // --- gate 4: duplicate scoring, against drafts + approved + published
      const comparable = asComparable(candidate, 'candidate', context.domainId);
      const verdict = assessDuplicate(comparable, corpus, profile.thresholds);
      if (verdict.action === 'BLOCK') {
        rejections.push({
          reason: 'DUPLICATE',
          detail: `Composite similarity ${verdict.maxScore.toFixed(3)} is at or above the block threshold ${profile.thresholds.blockThreshold}.`,
          sectionKey: candidate.sectionKey,
          matchedQuestionId: verdict.match.questionId,
          similarityScore: verdict.maxScore,
        });
        continue;
      }

      const confidence = computeConfidence({
        question: candidate,
        evidence,
        sectionCharCount: section.assessableCharCount,
        minAssessableChars: profile.minAssessableChars,
        maxSimilarityScore: verdict.maxScore,
      });

      const document = scope.documents.find((d) => d.documentId === section.documentId);
      if (!document) continue;

      // --- gate 5: persistence, one transaction per question, with its audit
      // event. A draft that cannot be audited does not commit (U1).
      const auditWriter = createAuditWriter({ clock });
      const questionId = await prisma.$transaction(async (tx) => {
        const created = await tx.draftQuestion.create({
          data: {
            questionType: 'MULTIPLE_CHOICE_4',
            // GENERATED → DRAFT is automatic on persistence (§3.2), so the row
            // lands in DRAFT and is immediately in the author review queue.
            status: 'DRAFT',
            domainId: context.domainId,
            topicId: context.topicId,
            questionText: candidate.questionText,
            answerPayload: {
              kind: 'MULTIPLE_CHOICE_4',
              options: candidate.options,
              correctOption: candidate.correctOption,
            },
            explanation: candidate.explanation,

            sourceId: context.sourceId,
            sourceDocumentId: document.sourceDocumentId,
            sectionKey: candidate.sectionKey,
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

            generationJobId: context.jobId,
            modelId,
            promptVersionId: profile.promptVersionId,

            confidenceScore: confidence.score,
            confidenceComponents: {
              components: { ...confidence.components },
              weights: { ...confidence.weights },
            },
            maxSimilarityScore: verdict.maxScore,
            // FLAG band: persisted with the warning, and approval is blocked
            // until a reviewer dispositions it. Null disposition IS the block.
            duplicateDisposition: null,
            duplicateDispositionNote:
              verdict.action === 'FLAG'
                ? `Similar to question ${verdict.match.questionId} (composite ${verdict.maxScore.toFixed(3)}). A reviewer must record DISTINCT or DUPLICATE before approval.`
                : null,

            createdByUserId: context.actorUserId,
          },
          select: { id: true, version: true },
        });

        // The append-only version snapshot, so the draft's history starts at
        // the moment it was generated rather than at the first edit.
        await tx.draftQuestionVersion.create({
          data: {
            questionId: created.id,
            version: created.version,
            changeKind: 'GENERATED',
            snapshot: {
              questionText: candidate.questionText,
              options: candidate.options,
              correctOption: candidate.correctOption,
              explanation: candidate.explanation,
              supportingEvidence: evidence.evidence,
            },
            diff: {},
            evidenceReverified: true,
            evidenceReverifyResult: {
              mode: evidence.mode,
              similarityScore: evidence.similarityScore,
              startOffset: evidence.startOffset,
              endOffset: evidence.endOffset,
            },
            changedByUserId: context.actorUserId,
          },
        });

        await auditWriter.write(tx, {
          action: 'AUTHORING.QUESTION.CREATED',
          outcome: 'SUCCESS',
          actorType: 'USER',
          actorUserId: context.actorUserId,
          actorDisplayName: context.actorDisplayName,
          actorRoles: [...context.actorRoles],
          entityType: 'DraftQuestion',
          entityId: created.id,
          entityLabel: created.id,
          domainId: context.domainId,
          sourceId: context.sourceId,
          correlationId: context.correlationId,
          requestId: context.requestId,
          portal: 'AUTHORING',
          detail: {
            jobId: context.jobId,
            sectionKey: candidate.sectionKey,
            evidenceMode: evidence.mode,
            confidenceScore: confidence.score,
            maxSimilarityScore: verdict.maxScore,
          },
        });

        return created.id;
      });

      acceptedQuestionIds.push(questionId);
      perSection.set(candidate.sectionKey, used + 1);
      // The new draft joins the corpus immediately, so two candidates in the
      // same run cannot both be accepted as near-duplicates of each other.
      corpus.push(asComparable(candidate, questionId, context.domainId));

      if (verdict.action === 'FLAG') {
        await prisma.draftQuestion.update({
          where: { id: questionId },
          data: { maxSimilarityScore: verdict.maxScore },
        });
      }
    }
  }

  const rejectionCounts = rejections.reduce<Record<string, number>>((counts, rejection) => {
    counts[rejection.reason] = (counts[rejection.reason] ?? 0) + 1;
    return counts;
  }, {});
  if (insufficient.length > 0) rejectionCounts['INSUFFICIENT_EVIDENCE'] = insufficient.length;

  const status: GenerationRunResult['status'] =
    acceptedQuestionIds.length === 0
      ? 'FAILED'
      : rejections.length > 0 || insufficient.length > 0
        ? 'PARTIAL'
        : 'SUCCEEDED';

  const completedAt = clock.now();
  const auditWriter = createAuditWriter({ clock });

  await prisma.$transaction(async (tx) => {
    for (const rejection of rejections) {
      await tx.generationJobRejection.create({
        data: {
          jobId: context.jobId,
          sectionKey: rejection.sectionKey,
          reason: rejection.reason,
          detail: rejection.detail,
          matchedQuestionId: rejection.matchedQuestionId ?? null,
          similarityScore: rejection.similarityScore ?? null,
          // Redacted to the stem: the full candidate would put an unverified,
          // possibly fabricated question body in a long-lived table.
          candidatePayload: { note: 'Redacted to the rejection reason and section.' },
        },
      });
    }
    for (const section of insufficient) {
      await tx.generationJobRejection.create({
        data: {
          jobId: context.jobId,
          sectionKey: section.sectionKey,
          reason: 'INSUFFICIENT_EVIDENCE',
          detail: section.reason,
          candidatePayload: {},
        },
      });
    }

    await tx.generationJob.update({
      where: { id: context.jobId },
      data: {
        status,
        modelId,
        acceptedQuestionCount: acceptedQuestionIds.length,
        rejectionCounts,
        inputTokens,
        outputTokens,
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
      },
    });

    // Coverage recompute. §6: a section with a question is COVERED; a section
    // reported insufficient is NON_ASSESSABLE with the model's own reason, which
    // is a documentation-quality signal rather than a platform failure.
    for (const section of scope.sections) {
      const covered = await tx.draftQuestion.count({
        where: {
          sectionKey: section.sectionKey,
          status: { notIn: ['REJECTED', 'ARCHIVED'] },
        },
      });
      const wasInsufficient = insufficient.some((row) => row.sectionKey === section.sectionKey);
      await tx.documentSection.updateMany({
        where: { id: section.sectionId },
        data: {
          coverageStatus: covered > 0 ? 'COVERED' : wasInsufficient ? 'NON_ASSESSABLE' : 'NOT_COVERED',
          ...(wasInsufficient
            ? {
                isAssessable: false,
                nonAssessableReason: 'Insufficient assessable content: no testable rule stated.',
              }
            : {}),
        },
      });
    }

    for (const document of scope.documents) {
      const generated = await tx.draftQuestion.count({
        where: { sourceDocumentId: document.sourceDocumentId },
      });
      await tx.documentGenerationStat.upsert({
        where: { documentId: document.documentId },
        create: {
          documentId: document.documentId,
          lastGeneratedAt: completedAt,
          totalDraftQuestionsGenerated: generated,
        },
        update: { lastGeneratedAt: completedAt, totalDraftQuestionsGenerated: generated },
      });
      await tx.generationJobDocument.upsert({
        where: { jobId_documentId: { jobId: context.jobId, documentId: document.documentId } },
        create: {
          jobId: context.jobId,
          documentId: document.documentId,
          sourceVersionAtRun: document.sourceVersion,
          contentHashAtRun: document.contentHash,
          sectionHashesAtRun: Object.fromEntries(
            scope.sections
              .filter((section) => section.documentId === document.documentId)
              .map((section) => [section.sectionKey, section.sectionContentHash]),
          ),
          outcome: 'OK',
        },
        update: {},
      });
    }

    await auditWriter.write(tx, {
      action: status === 'FAILED' ? 'AUTHORING.GENERATION.JOB_FAILED' : 'AUTHORING.GENERATION.JOB_COMPLETED',
      outcome: status === 'SUCCEEDED' ? 'SUCCESS' : 'FAILURE',
      actorType: 'USER',
      actorUserId: context.actorUserId,
      actorDisplayName: context.actorDisplayName,
      actorRoles: [...context.actorRoles],
      entityType: 'GenerationJob',
      entityId: context.jobId,
      entityLabel: context.jobId,
      domainId: context.domainId,
      sourceId: context.sourceId,
      correlationId: context.correlationId,
      requestId: context.requestId,
      portal: 'AUTHORING',
      detail: {
        jobStatus: status,
        requestedQuestionCount: args.requestedQuestionCount,
        acceptedQuestionCount: acceptedQuestionIds.length,
        rejectionCounts,
        modelId,
        // Named "...TokenCount" deliberately: the redactor matches /token/i on
        // key names, which is correct for credentials and would otherwise
        // replace these counts with "[redacted]" — making a cost figure look
        // like a leaked secret. The authoritative values are the
        // GenerationJob columns; this is the auditable copy.
        inputTokenCount: inputTokens,
        outputTokenCount: outputTokens,
      },
    });
  });

  return {
    jobId: context.jobId,
    status,
    acceptedQuestionIds,
    rejections,
    insufficientEvidenceSections: insufficient,
    rejectionCounts,
    inputTokens,
    outputTokens,
  };
};
