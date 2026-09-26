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
  createDeterministicProvider,
  PROVIDER_CATALOGUE,
  verifyEvidence,
  type GeneratorRegistry,
  type EvidenceSection,
  type GeneratedQuestion,
  type QuestionGenerator,
  type GenerationProvider,
} from '@knowzy/claude-services';
import { createAuditWriter, type DbClient, type PrismaClient } from '@knowzy/database';
import type { Clock } from '@knowzy/observability';
import type {
  EvidenceMode,
  GenerationExecutionMode,
  GenerationProviderId,
  GenerationReasonCode,
  RejectionReason,
} from '@knowzy/shared-types';
import {
  assessDuplicate,
  type ComparableQuestion,
  type DuplicateThresholds,
} from './similarity.js';
import {
  GenerationRefusedError,
  invokeWithControls,
  type ControlSettings,
  type RetryObservation,
} from './control/runtime.js';
import { scopeSectionKeys, type ResolvedGenerationScope } from './scope.js';

export interface GenerationRunContext {
  readonly jobId: string;
  readonly sourceId: string;
  readonly domainId: string;
  readonly topicId: string;
  /**
   * The org axes the JOB was created with, stamped onto every draft it creates.
   *
   * Read from the job rather than passed again by the caller: the job is the
   * record of what was asked for, and a second source for the same fact is how
   * a batch ends up half-filed.
   */
  readonly departmentId?: string | null;
  readonly jobRoleId?: string | null;
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
  /**
   * The configured model.
   *
   * Carried on the settings so a provider is constructed FROM configuration
   * (T-30: "model IDs are configuration, never hardcoded"). The profile row
   * has always held this value and the generator ignored it, which is the trap
   * the implementation plan §3.1 describes: a hardcoded constant would satisfy
   * the interface, produce plausible audit rows, and leave a configured field
   * that appears to control the model and does not.
   */
  readonly modelId: string;
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
  /**
   * The resolved provider, when one was selected.
   *
   * Takes precedence over `generator`. Both exist during the transition
   * because the deterministic generator, its tests and the zero-credential
   * path all reference the older port and there is no reason to break them in
   * the same change that adds a provider.
   */
  readonly provider?: GenerationProvider;
  readonly executionMode?: GenerationExecutionMode;
  /** Whose entitlement paid, when user-managed. */
  readonly onBehalfOfUserId?: string | null;
  /**
   * The AI Generation Control Layer. REQUIRED.
   *
   * Required rather than optional, and that is the point: an optional control
   * layer is one a caller can forget, and the caller most likely to forget it
   * is a future one adding a provider that actually costs money. A missing
   * argument is now a compile error instead of an unbudgeted run.
   */
  readonly control: {
    readonly registry: GeneratorRegistry;
    readonly settings: ControlSettings;
    /** Injected in tests so backoff is assertable and instant. */
    readonly random?: () => number;
    readonly sleep?: (ms: number) => Promise<void>;
  };
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

/**
 * Presents a legacy `QuestionGenerator` as a provider.
 *
 * Needed because tests inject a fixed generator and the zero-credential path
 * constructs one directly. It declares DETERMINISTIC_LOCAL provenance, which
 * is honest for every current caller -- the only implementations of that port
 * are the deterministic generator and test doubles of it.
 */
const wrapGenerator = (generator: QuestionGenerator): GenerationProvider => ({
  providerId: 'DETERMINISTIC_LOCAL',
  capabilities: PROVIDER_CATALOGUE.DETERMINISTIC_LOCAL,
  modelId: generator.modelId,
  providerVersion: generator.modelId,
  async generate(generateArgs) {
    const result = await generator.generate(generateArgs);
    return {
      ...result,
      providerId: 'DETERMINISTIC_LOCAL' as const,
      providerVersion: generator.modelId,
      tokenUsageReported: false,
    };
  },
});

/**
 * Record a control-layer refusal on the job, then let it propagate.
 *
 * The job becomes REFUSED rather than FAILED, and the reason, the limit and the
 * observed value are all stored: an author reading "the daily budget is
 * 2,000,000 tokens, 1,980,400 are spent, and this job needs about 31,000 more"
 * can act, where "budget exhausted" leaves them guessing.
 *
 * Written in its own transaction. The refusal is a FACT about what the platform
 * decided, and it must survive whatever the caller does with the error.
 */
const recordJobRefusal = async (args: {
  readonly prisma: PrismaClient;
  readonly auditWriter: ReturnType<typeof createAuditWriter>;
  readonly context: GenerationRunContext;
  readonly requestedQuestionCount: number;
  readonly executionMode: GenerationExecutionMode;
  readonly providerId: GenerationProviderId;
  readonly error: GenerationRefusedError;
  readonly completedAt: Date;
  readonly startedAt: Date;
}): Promise<void> => {
  const { context, error } = args;
  await args.prisma.$transaction(async (tx) => {
    await tx.generationJob.update({
      where: { id: context.jobId },
      data: {
        status: 'REFUSED',
        refusalReason: error.refusalReason,
        refusalDetail: error.detail,
        completedAt: args.completedAt,
        durationMs: args.completedAt.getTime() - args.startedAt.getTime(),
      },
    });

    await args.auditWriter.write(tx, {
      action: 'AUTHORING.GENERATION.JOB_REFUSED',
      // DENIED, not FAILURE. Nothing broke: the platform declined, and an
      // auditor counting failures must not find this here.
      outcome: 'DENIED',
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
        refusalReason: error.refusalReason,
        refusalDetail: error.detail,
        providerId: args.providerId,
        executionMode: args.executionMode,
        limitName: error.limitName,
        limitValue: error.limitValue,
        observedValue: error.observedValue,
        budgetWindow: error.budgetWindow,
        requestedQuestionCount: args.requestedQuestionCount,
      },
    });
  });
};

export const runGenerationJob = async (args: RunGenerationArgs): Promise<GenerationRunResult> => {
  const { prisma, clock, scope, context, profile } = args;
  // A provider wins if one was resolved; otherwise the legacy generator port,
  // otherwise the deterministic default. No path here chooses a DIFFERENT
  // provider from the one requested -- the registry refuses instead, because a
  // substitution would make the provenance recorded below false.
  const provider: GenerationProvider =
    args.provider ??
    (args.generator === undefined ? createDeterministicProvider() : wrapGenerator(args.generator));
  const startedAt = clock.now();
  // One writer for the whole run. Declared here rather than beside the final
  // transaction because a retry has to be audited as it happens -- a retry
  // recorded only on completion is missing from every job that never completes.
  const auditWriter = createAuditWriter({ clock });

  await prisma.generationJob.update({
    where: { id: context.jobId },
    data: { status: 'RUNNING', startedAt },
  });

  // The organizational axes come from the JOB rather than from the caller. The
  // job is the record of what was asked for; taking them from an argument as
  // well would give two sources for one fact, and the first disagreement would
  // be a batch half-filed under a department nobody chose.
  const filing = await prisma.generationJob.findUniqueOrThrow({
    where: { id: context.jobId },
    select: { departmentId: true, jobRoleId: true },
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

  // EVERY generation call goes through the control layer, including this
  // deterministic one. A ceiling that only applies to the providers that cost
  // money is a ceiling nobody has ever seen fire.
  const retryObservations: RetryObservation[] = [];
  let controlled: Awaited<ReturnType<typeof invokeWithControls>>;
  try {
    controlled = await invokeWithControls({
      db: prisma,
      clock,
      registry: args.control.registry,
      settings: args.control.settings,
      providerId: provider.providerId,
      providerOverride: provider,
      random: args.control.random,
      sleep: args.control.sleep,
      context: {
        jobId: context.jobId,
        correlationId: context.correlationId,
        requestedByUserId: context.actorUserId,
        onBehalfOfUserId: args.onBehalfOfUserId ?? null,
        executionMode: args.executionMode ?? 'PLATFORM_MANAGED',
        modelId: profile.modelId,
        // The estimate is over the text actually going into the prompt, which is
        // the section text: the only quantity available before a call.
        promptCharacterCount: scope.sections.reduce(
          (total, section) => total + section.text.length,
          0,
        ),
      },
      generateArgs: {
        sections: scope.sections.map((section) => ({
          sectionKey: section.sectionKey,
          label: section.label,
          text: section.text,
        })),
        doNotDuplicate,
        requestedQuestionCount: args.requestedQuestionCount,
        domainName: profile.domainName,
        topicName: profile.topicName,
      },
      onRetry: async (observation) => {
        retryObservations.push(observation);
        await auditWriter.write(prisma, {
          action: 'AUTHORING.GENERATION.PROVIDER_CALL_RETRIED',
          outcome: 'FAILURE',
          actorType: 'SYSTEM',
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
            providerId: provider.providerId,
            attempt: observation.attempt,
            maxAttempts: args.control.settings.retry.maxAttempts,
            errorClass: observation.errorClass,
            delayMs: observation.delayMs,
          },
        });
      },
    });
  } catch (error) {
    // A control DECISION is recorded and rethrown; a provider breaking is
    // rethrown untouched. Flattening the two would make "did the controls
    // hold?" unanswerable from the audit log.
    if (error instanceof GenerationRefusedError) {
      await recordJobRefusal({
        prisma,
        auditWriter,
        context,
        requestedQuestionCount: args.requestedQuestionCount,
        executionMode: args.executionMode ?? 'PLATFORM_MANAGED',
        providerId: provider.providerId,
        error,
        completedAt: clock.now(),
        startedAt,
      });
    }
    throw error;
  }

  const {
    output,
    insufficientSections,
    modelId,
    inputTokens,
    outputTokens,
    providerId,
    providerVersion,
    tokenUsageReported,
  } = controlled.result;

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
            departmentId: filing.departmentId,
            jobRoleId: filing.jobRoleId,
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
            providerId,
            providerVersion,
            executionMode: args.executionMode ?? 'PLATFORM_MANAGED',
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
        providerId,
        providerVersion,
        executionMode: args.executionMode ?? 'PLATFORM_MANAGED',
        onBehalfOfUserId: args.onBehalfOfUserId ?? null,
        tokenUsageReported,
        acceptedQuestionCount: acceptedQuestionIds.length,
        rejectionCounts,
        inputTokens,
        outputTokens,
        // Null when no cost could be known -- a licence-based provider or a
        // user-managed run. Never 0, which would claim a measurement.
        estimatedCost: controlled.cost.amount,
        costObservable: controlled.cost.observable,
        attemptCount: controlled.attemptCount,
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
      },
    });

    // Coverage recompute. §6: a section with a question is COVERED; a section
    // reported insufficient is NON_ASSESSABLE with the generator's own reason,
    // which is a documentation-quality signal rather than a platform failure.
    //
    // It does NOT touch `isAssessable`, and that distinction is load-bearing.
    // §6.2 reserves that flag for the document's own structure — tables of
    // contents, revision histories, legal notices, and sections below
    // `minAssessableChars` — and makes it author-curated, flippable only "with
    // an audited reason". A generator's inability to build four plausible
    // options is a fact about THAT GENERATOR, not about whether the content can
    // be assessed.
    //
    // Writing `isAssessable: false` here used to conflate the two, and the
    // consequences were measured on the first real corpus: 94 sections, every
    // one comfortably over the length threshold, were permanently marked
    // unassessable by a single run. A second generation over the same documents
    // then failed with GENERATION_SCOPE_EMPTY — not because the corpus was
    // exhausted, but because the flags had been cleared — and the coverage
    // denominator every percentage is computed against had silently shrunk.
    // Worst of all it destroys the baseline for comparing a different
    // generator: a model asked to work the corpus afterwards would be handed
    // one that says there is almost nothing left to assess.
    for (const section of scope.sections) {
      // Either key. A question published before migration 0004 cites the
      // unscoped key and is immutable, so matching only the scoped key would
      // report its section as uncovered — replacing one wrong coverage figure
      // with another.
      const keys = [section.sectionKey, ...(section.sectionKeyV1 ? [section.sectionKeyV1] : [])];
      const covered = await tx.draftQuestion.count({
        where: {
          sectionKey: { in: keys },
          status: { notIn: ['REJECTED', 'ARCHIVED'] },
        },
      });
      const wasInsufficient = insufficient.some((row) => row.sectionKey === section.sectionKey);
      const reason = insufficient.find((row) => row.sectionKey === section.sectionKey)?.reason;

      // PILOT-T2: the run's outcome and the section's coverage are written to
      // SEPARATE fields, because they are separate facts.
      //
      // The earlier fix stopped this block writing `isAssessable`, but left it
      // writing `coverageStatus = 'NON_ASSESSABLE'` on a refusal — and
      // preflight counted a section as uncovered only when its status was
      // NOT_COVERED or PARTIALLY_COVERED. So a refused section stayed in the
      // denominator and vanished from the numerator's complement: every
      // refusal was counted as coverage. On the pilot corpus that read 94.8%
      // where the truth was 2.6%, and the 106 "hidden" sections were exactly
      // the 106 recorded refusals.
      //
      // `coverageStatus` now answers one question — does a question cite this
      // section — and the generator's verdict lives in
      // `lastGenerationOutcome` with its own reason column.
      await tx.documentSection.updateMany({
        where: { id: section.sectionId },
        data: {
          coverageStatus: covered > 0 ? 'COVERED' : 'NOT_COVERED',
          generationAttemptCount: { increment: 1 },
          lastAttemptedAt: startedAt,
          lastGenerationOutcome:
            covered > 0 ? 'GENERATED' : wasInsufficient ? 'REFUSED' : 'UNRESOLVED',
          // The generator's own words, so an author reads why. Never written
          // to `nonAssessableReason`, which is author curation.
          lastRefusalReason: wasInsufficient ? (reason ?? 'No reason recorded.') : null,
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
      action:
        status === 'FAILED'
          ? 'AUTHORING.GENERATION.JOB_FAILED'
          : 'AUTHORING.GENERATION.JOB_COMPLETED',
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
        providerId,
        providerVersion,
        executionMode: args.executionMode ?? 'PLATFORM_MANAGED',
        tokenUsageReported,
        estimatedCost: controlled.cost.amount,
        costObservable: controlled.cost.observable,
        attemptCount: controlled.attemptCount,
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
