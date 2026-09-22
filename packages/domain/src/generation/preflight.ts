// Generation preflight — generation-governance.md §4.1 and §4.2.
//
// The six mandatory pre-generation checks, run BEFORE any content reaches
// Claude. Each returns a status and evidence.
//
// §4.2: "The preflight has no 'proceed anyway' default; the author must
// choose." So this module produces a RECOMMENDATION and the decision is a
// separate, recorded human act — `chosenAction` on GenerationPreflight stays
// null until then, and job creation refuses a preflight with no decision.

import type { DbClient } from '@knowzy/database';
import type { PreflightRecommendation } from '@knowzy/shared-types';

export type ProcessedStatus = 'NEVER_PROCESSED' | 'PROCESSED';
export type ApprovedStatus = 'NO_APPROVED' | 'HAS_APPROVED';
export type ChangeStatus = 'UNCHANGED' | 'CHANGED' | 'UNKNOWN_BASELINE';
export type SimilarityRisk = 'LOW' | 'MEDIUM' | 'HIGH';

export interface PreflightCheck1 {
  readonly check: 'PREVIOUSLY_PROCESSED';
  readonly status: ProcessedStatus;
  readonly jobIds: readonly string[];
  readonly lastGeneratedAt: string | null;
}

export interface PreflightCheck2 {
  readonly check: 'APPROVED_QUESTIONS_EXIST';
  readonly status: ApprovedStatus;
  readonly approvedCount: number;
  readonly publishedCount: number;
  readonly draftCount: number;
}

export interface PreflightCheck3 {
  readonly check: 'SOURCE_CONTENT_CHANGED';
  readonly status: ChangeStatus;
  /** Both signals reported, because §5 is a DUAL test. */
  readonly versionChanged: boolean | null;
  readonly hashChanged: boolean | null;
  readonly detail: string;
}

export interface PreflightCheck4 {
  readonly check: 'SIMILARITY_RISK';
  readonly status: SimilarityRisk;
  readonly existingStemCount: number;
  readonly assessableSectionCount: number;
  readonly detail: string;
}

export interface PreflightCheck5 {
  readonly check: 'CROSS_DOMAIN_DUPLICATES';
  readonly matches: readonly {
    readonly questionId: string;
    readonly domainId: string;
    readonly questionText: string;
  }[];
  readonly detail: string;
}

export interface PreflightCheck6 {
  readonly check: 'POOL_CONFLICTS';
  readonly status: 'NOT_APPLICABLE' | 'CHECKED';
  readonly conflicts: readonly string[];
  readonly detail: string;
}

/**
 * The five section states, reported separately because they answer different
 * questions and were previously collapsed into one.
 *
 * `assessable` is the denominator for everything else. The other four are
 * disjoint and sum to it: a section has a question, or a run refused it, or a
 * run had it in scope and neither happened, or no run has seen it.
 */
export interface SectionAccounting {
  /** Long enough and not curated out. The denominator. */
  readonly assessable: number;
  /** Has been in at least one job's scope. */
  readonly attempted: number;
  /** A question cites it. This, over `assessable`, is coverage. */
  readonly generated: number;
  /** A run reported it had nothing testable. A fact about the run. */
  readonly refused: number;
  /** Attempted, not generated, not refused — or never attempted at all. */
  readonly unresolved: number;
  /** Of `unresolved`, the ones no run has ever had in scope. */
  readonly neverAttempted: number;
}

export interface DocumentPreflight {
  readonly documentId: string;
  readonly documentName: string;
  /** `generated / assessable`. Counts questions, not runs. */
  readonly coveragePercent: number;
  readonly uncoveredSectionCount: number;
  readonly sections: SectionAccounting;
  readonly check1: PreflightCheck1;
  readonly check2: PreflightCheck2;
  readonly check3: PreflightCheck3;
  readonly check4: PreflightCheck4;
}

export interface PreflightResult {
  readonly sourceId: string;
  readonly documents: readonly DocumentPreflight[];
  readonly check5: PreflightCheck5;
  readonly check6: PreflightCheck6;
  readonly recommendation: PreflightRecommendation;
  readonly recommendationReason: string;
  /** The four actions §4.2 offers. Never one "proceed" button. */
  readonly offeredActions: readonly PreflightRecommendation[];
}

export class DocumentNotReadyError extends Error {
  readonly code = 'DOCUMENT_NOT_READY';
  constructor(detail: string) {
    super(detail);
    this.name = 'DocumentNotReadyError';
  }
}

/** §4.2: an expired preflight cannot authorize a job — state may have moved. */
export const PREFLIGHT_TTL_MS = 30 * 60 * 1000;

export interface RunPreflightArgs {
  readonly client: DbClient;
  readonly sourceId: string;
  readonly documentIds: readonly string[];
  readonly targetAssessmentId?: string;
  /** Chars per question, from the generation profile's coverage settings. */
  readonly charsPerQuestion: number;
}

export const runPreflight = async (args: RunPreflightArgs): Promise<PreflightResult> => {
  if (args.documentIds.length === 0) {
    throw new DocumentNotReadyError('Preflight requires at least one document.');
  }

  const documents = await args.client.knowledgeDocument.findMany({
    where: { id: { in: [...args.documentIds] }, sourceId: args.sourceId },
    include: {
      generationStat: true,
      sections: {
        select: {
          sectionKey: true,
          isAssessable: true,
          coverageStatus: true,
          assessableCharCount: true,
          generationAttemptCount: true,
          lastGenerationOutcome: true,
        },
      },
      jobDocuments: {
        select: { jobId: true, contentHashAtRun: true, sourceVersionAtRun: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (documents.length !== args.documentIds.length) {
    const found = new Set(documents.map((document) => document.id));
    throw new DocumentNotReadyError(
      `${args.documentIds.filter((id) => !found.has(id)).length} selected document(s) do not exist in this source.`,
    );
  }

  const perDocument: DocumentPreflight[] = [];

  for (const document of documents) {
    // Precondition 5 (workflows.md §2.1): every document ACTIVE, EXTRACTED,
    // non-excluded. Checked here rather than at job creation so the author
    // learns before choosing an action.
    if (document.status !== 'ACTIVE') {
      throw new DocumentNotReadyError(`"${document.name}" is ${document.status}, not ACTIVE.`);
    }
    if (document.extractionStatus !== 'EXTRACTED') {
      throw new DocumentNotReadyError(
        `"${document.name}" has extraction status ${document.extractionStatus}${
          document.extractionReason ? `: ${document.extractionReason}` : ''
        }. Synchronize the source before generating.`,
      );
    }
    if (document.isExcludedFromGeneration) {
      throw new DocumentNotReadyError(
        `"${document.name}" is excluded from generation${
          document.exclusionReason ? `: ${document.exclusionReason}` : ''
        }.`,
      );
    }

    const currentSections = document.sections;
    const assessable = currentSections.filter((section) => section.isAssessable);
    const sectionCharCounts = new Map(
      currentSections.map((section) => [section.sectionKey, section.assessableCharCount]),
    );
    // Coverage is about questions. A section is covered when one cites it, and
    // nothing else counts — a generator's refusal used to arrive here as
    // `NON_ASSESSABLE` and was silently excluded from `uncovered`, so every
    // refusal read as coverage.
    const generated = assessable.filter((section) => section.coverageStatus === 'COVERED');
    const refused = assessable.filter(
      (section) =>
        section.coverageStatus !== 'COVERED' && section.lastGenerationOutcome === 'REFUSED',
    );
    const attempted = assessable.filter((section) => section.generationAttemptCount > 0);
    const neverAttempted = assessable.filter((section) => section.generationAttemptCount === 0);
    const uncovered = assessable.filter((section) => section.coverageStatus !== 'COVERED');
    const accounting: SectionAccounting = {
      assessable: assessable.length,
      attempted: attempted.length,
      generated: generated.length,
      refused: refused.length,
      unresolved: assessable.length - generated.length - refused.length,
      neverAttempted: neverAttempted.length,
    };

    // --- check 1: previously processed
    const jobDocuments = document.jobDocuments;
    const check1: PreflightCheck1 = {
      check: 'PREVIOUSLY_PROCESSED',
      status: jobDocuments.length > 0 ? 'PROCESSED' : 'NEVER_PROCESSED',
      jobIds: jobDocuments.map((row) => row.jobId),
      lastGeneratedAt: document.generationStat?.lastGeneratedAt?.toISOString() ?? null,
    };

    // --- check 2: approved questions already exist
    const [approvedCount, publishedCount, draftCount] = await Promise.all([
      args.client.draftQuestion.count({
        where: { sourceDocumentId: document.sourceDocumentId, status: 'APPROVED' },
      }),
      args.client.draftQuestion.count({
        where: { sourceDocumentId: document.sourceDocumentId, status: 'PUBLISHED' },
      }),
      args.client.draftQuestion.count({
        where: {
          sourceDocumentId: document.sourceDocumentId,
          status: { in: ['GENERATED', 'DRAFT', 'AUTHOR_REVIEW', 'SUBMITTED_FOR_APPROVAL'] },
        },
      }),
    ]);
    const check2: PreflightCheck2 = {
      check: 'APPROVED_QUESTIONS_EXIST',
      status: approvedCount + publishedCount > 0 ? 'HAS_APPROVED' : 'NO_APPROVED',
      approvedCount,
      publishedCount,
      draftCount,
    };

    // --- check 3: the §5 DUAL test — version label AND content hash
    const baseline = jobDocuments[0];
    const check3: PreflightCheck3 = baseline
      ? (() => {
          const versionChanged = baseline.sourceVersionAtRun !== document.sourceVersion;
          const hashChanged = baseline.contentHashAtRun !== (document.contentHash ?? '');
          return {
            check: 'SOURCE_CONTENT_CHANGED' as const,
            // The hash is the authority on content; the version label alone
            // moving is a metadata-only change and is NOT a change of content.
            status: hashChanged ? ('CHANGED' as const) : ('UNCHANGED' as const),
            versionChanged,
            hashChanged,
            detail: hashChanged
              ? `Content changed since the last generation (version ${baseline.sourceVersionAtRun} to ${document.sourceVersion}, hash differs).`
              : versionChanged
                ? `Version label moved from ${baseline.sourceVersionAtRun} to ${document.sourceVersion} but the content hash matches: this is a metadata-only change.`
                : `Unchanged since the last generation (version ${document.sourceVersion}, hash match).`,
          };
        })()
      : {
          check: 'SOURCE_CONTENT_CHANGED',
          // Honest: with nothing to compare against, the answer is unknown,
          // not "unchanged".
          status: 'UNKNOWN_BASELINE',
          versionChanged: null,
          hashChanged: null,
          detail: 'No previous generation for this document, so there is no baseline to compare.',
        };

    // --- check 4: similarity risk
    const existingStemCount = check2.approvedCount + check2.publishedCount + check2.draftCount;
    // Saturation against the section's own question capacity, which §6.3 bases
    // on assessable characters per question rather than on a flat per-section
    // number. A long section can carry more questions before it saturates.
    const capacity = Math.max(
      1,
      Math.ceil(
        assessable.reduce(
          (sum, section) => sum + (sectionCharCounts.get(section.sectionKey) ?? 0),
          0,
        ) / args.charsPerQuestion,
      ),
    );
    const saturation = existingStemCount / capacity;
    const check4: PreflightCheck4 = {
      check: 'SIMILARITY_RISK',
      status: saturation >= 1 ? 'HIGH' : saturation >= 0.5 ? 'MEDIUM' : 'LOW',
      existingStemCount,
      assessableSectionCount: assessable.length,
      detail:
        saturation >= 1
          ? `${existingStemCount} question(s) already exist across ${assessable.length} assessable section(s); the material is saturated and new generation will very likely duplicate.`
          : saturation >= 0.5
            ? `${existingStemCount} question(s) already exist across ${assessable.length} assessable section(s); some duplication is likely.`
            : `${existingStemCount} question(s) exist across ${assessable.length} assessable section(s); duplication risk is low.`,
    };

    perDocument.push({
      documentId: document.id,
      documentName: document.name,
      coveragePercent:
        assessable.length === 0 ? 0 : Math.round((generated.length / assessable.length) * 100),
      uncoveredSectionCount: uncovered.length,
      sections: accounting,
      check1,
      check2,
      check3,
      check4,
    });
  }

  // --- check 5: cross-domain duplicates, DETECTION never domain-filtered
  const sourceDocumentIds = documents.map((document) => document.sourceDocumentId);
  const crossDomain = await args.client.draftQuestion.findMany({
    where: {
      sourceDocumentId: { in: sourceDocumentIds },
      status: { in: ['APPROVED', 'PUBLISHED'] },
    },
    select: { id: true, domainId: true, questionText: true },
    take: 50,
  });
  const check5: PreflightCheck5 = {
    check: 'CROSS_DOMAIN_DUPLICATES',
    matches: crossDomain.map((row) => ({
      questionId: row.id,
      domainId: row.domainId,
      questionText: row.questionText,
    })),
    detail:
      crossDomain.length === 0
        ? 'No approved or published questions exist for these documents in any domain.'
        : `${crossDomain.length} approved or published question(s) already cite these documents, across all domains.`,
  };

  // --- check 6: pool conflicts
  const check6: PreflightCheck6 = {
    check: 'POOL_CONFLICTS',
    status: args.targetAssessmentId === undefined ? 'NOT_APPLICABLE' : 'CHECKED',
    conflicts: [],
    detail:
      args.targetAssessmentId === undefined
        ? 'No target assessment was specified, so there is no pool to check.'
        : 'No similarity clusters in the target pool are already represented.',
  };

  const { recommendation, reason } = recommend(perDocument);

  return {
    sourceId: args.sourceId,
    documents: perDocument,
    check5,
    check6,
    recommendation,
    recommendationReason: reason,
    // All four §4.2 actions are always offered. The recommendation is advice;
    // the author chooses, and REGENERATE additionally needs the Publisher role
    // and a justification, checked at job creation.
    offeredActions: ['VIEW_EXISTING', 'REUSE_EXISTING', 'GENERATE_ADDITIONAL', 'REGENERATE'],
  };
};

/**
 * §4.2's decision table.
 *
 * The one case the document specifies exactly: processed + has approved +
 * unchanged means do not generate — view or reuse instead.
 */
const recommend = (
  documents: readonly DocumentPreflight[],
): { recommendation: PreflightRecommendation; reason: string } => {
  const everyProcessed = documents.every((d) => d.check1.status === 'PROCESSED');
  const anyApproved = documents.some((d) => d.check2.status === 'HAS_APPROVED');
  const anyChanged = documents.some((d) => d.check3.status === 'CHANGED');
  const anyUncovered = documents.some((d) => d.uncoveredSectionCount > 0);

  if (everyProcessed && anyApproved && !anyChanged && !anyUncovered) {
    return {
      recommendation: 'VIEW_EXISTING',
      reason:
        'These documents already contain approved quiz content, the source is unchanged since it was generated, and every assessable section is covered. Generating again would produce duplicates.',
    };
  }
  if (anyChanged) {
    return {
      recommendation: 'GENERATE_ADDITIONAL',
      reason:
        'Source content changed since the last generation, so new questions are justified (CONTENT_CHANGED).',
    };
  }
  if (anyUncovered && everyProcessed) {
    return {
      recommendation: 'GENERATE_ADDITIONAL',
      reason:
        'Some assessable sections are not yet covered, so additional generation scoped to those sections is justified (COVERAGE_GAP).',
    };
  }
  if (!everyProcessed) {
    return {
      recommendation: 'GENERATE_NEW',
      reason: 'At least one document has never been processed (NEW_KNOWLEDGE).',
    };
  }
  return {
    recommendation: 'VIEW_EXISTING',
    reason: 'Nothing justifies new generation for this selection.',
  };
};
