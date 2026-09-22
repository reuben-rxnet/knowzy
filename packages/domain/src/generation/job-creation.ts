// Generation job creation — workflows.md §2.1 preconditions and §2.3.
//
// This is the gate between "an author asked" and "content reaches Claude".
// Precondition 10 is the important one: a job cannot be created without a
// preflight whose DECISION is recorded, which is what makes the duplicate and
// coverage gate unavoidable rather than advisory.
//
// Scope resolution happens here too, and its output is PINNED on the job, so
// the exact input to a run is reproducible afterwards (§7).

import { createAuditWriter, type PrismaClient } from '@knowzy/database';
import type { Clock } from '@knowzy/observability';
import type { GenerationReasonCode, GenerationScope } from '@knowzy/shared-types';
import {
  resolveGenerationScope,
  type ResolvedGenerationScope,
  type ScopedDocument,
  type ScopedSection,
} from './scope.js';
import type { GenerationProfileSettings } from './generation-service.js';

export class PreflightRequiredError extends Error {
  readonly code = 'PREFLIGHT_REQUIRED';
  constructor(detail: string) {
    super(detail);
    this.name = 'PreflightRequiredError';
  }
}

export class GenerationPreconditionError extends Error {
  constructor(
    readonly code: string,
    detail: string,
  ) {
    super(detail);
    this.name = 'GenerationPreconditionError';
  }
}

export interface CreateJobArgs {
  readonly prisma: PrismaClient;
  readonly clock: Clock;
  readonly preflightId: string;
  readonly scope: GenerationScope;
  readonly domainId: string;
  readonly topicId: string;
  readonly reasonCode: GenerationReasonCode;
  readonly requestedQuestionCount: number;
  readonly justification?: string;
  readonly objectiveIds?: readonly string[];
  readonly actor: {
    readonly userId: string;
    readonly displayName: string;
    readonly roles: readonly string[];
    readonly permissions: readonly string[];
  };
  readonly correlationId: string;
  readonly requestId: string;
}

export interface CreatedJob {
  readonly jobId: string;
  readonly sourceId: string;
  readonly resolvedScope: ResolvedGenerationScope;
  readonly profile: GenerationProfileSettings;
  readonly requestedQuestionCount: number;
}

/** Which sections a scope selector resolves to, for the selected documents. */
const sectionsForScope = async (
  prisma: PrismaClient,
  documents: readonly { documentId: string; localVersionCounter: number }[],
  scope: GenerationScope,
): Promise<ScopedSection[]> => {
  const out: ScopedSection[] = [];

  for (const document of documents) {
    const row = await prisma.knowledgeDocument.findUnique({
      where: { id: document.documentId },
      select: { extractedText: true },
    });
    const text = row?.extractedText ?? '';

    const sections = await prisma.documentSection.findMany({
      where: {
        documentId: document.documentId,
        documentVersionCounter: document.localVersionCounter,
        // A non-assessable section is never generation input: §6.2 excludes it
        // from the coverage denominator, and generating from document furniture
        // would produce questions about a revision-history table.
        isAssessable: true,
        ...(scope === 'UNCOVERED_SECTIONS_ONLY'
          ? { coverageStatus: { in: ['NOT_COVERED', 'PARTIALLY_COVERED'] as const } }
          : {}),
        ...(scope === 'MODIFIED_SECTIONS_ONLY' ? { coverageStatus: 'MODIFIED' as const } : {}),
      },
      orderBy: { ordinal: 'asc' },
    });

    for (const section of sections) {
      out.push({
        sectionId: section.id,
        sectionKey: section.sectionKey,
        sectionKeyV1: section.sectionKeyV1,
        documentId: document.documentId,
        ordinal: section.ordinal,
        label: section.headingPath ?? section.heading ?? `Section ${section.ordinal}`,
        // Sliced from the stored normalized text with the stored offsets — the
        // same round-trip the extraction invariants guarantee (X2). If that
        // ever broke, generation would ground questions in the wrong words, so
        // it is read this way rather than from a second copy of the text.
        text: text.slice(section.startOffset, section.endOffset),
        sectionContentHash: section.sectionContentHash,
        startOffset: section.startOffset,
        assessableCharCount: section.assessableCharCount,
      });
    }
  }

  return out;
};

export const createGenerationJob = async (args: CreateJobArgs): Promise<CreatedJob> => {
  const { prisma, clock } = args;

  // --- precondition 10: a preflight with a RECORDED DECISION
  const preflight = await prisma.generationPreflight.findUnique({
    where: { id: args.preflightId },
    select: {
      id: true,
      sourceId: true,
      documentIds: true,
      chosenAction: true,
      expiresAt: true,
    },
  });
  if (!preflight) {
    throw new PreflightRequiredError('No preflight with that id exists.');
  }
  if (preflight.chosenAction === null) {
    throw new PreflightRequiredError(
      'This preflight has no recorded decision. The duplicate and coverage gate cannot be skipped.',
    );
  }
  if (preflight.expiresAt.getTime() <= clock.now().getTime()) {
    throw new PreflightRequiredError(
      'This preflight has expired. Run it again so the decision rests on current state.',
    );
  }
  if (preflight.chosenAction === 'VIEW_EXISTING' || preflight.chosenAction === 'REUSE_EXISTING') {
    throw new PreflightRequiredError(
      `The recorded decision was ${preflight.chosenAction}, which does not authorize generation.`,
    );
  }

  // --- precondition 9 and I17: reason code, and what REGENERATE requires
  if (args.reasonCode === 'PUBLISHER_REQUESTED') {
    if (!args.actor.permissions.includes('question.regenerate')) {
      throw new GenerationPreconditionError(
        'FORBIDDEN',
        'Full regeneration requires the Publisher role (question.regenerate).',
      );
    }
    if (!args.justification || args.justification.trim().length < 20) {
      throw new GenerationPreconditionError(
        'GENERATION_JUSTIFICATION_REQUIRED',
        'PUBLISHER_REQUESTED regeneration requires a written justification of at least 20 characters.',
      );
    }
  }
  if (preflight.chosenAction === 'REGENERATE' && args.reasonCode !== 'PUBLISHER_REQUESTED') {
    throw new GenerationPreconditionError(
      'GENERATION_JUSTIFICATION_REQUIRED',
      'A REGENERATE decision requires reason code PUBLISHER_REQUESTED.',
    );
  }

  // --- precondition 2 and 3: the source
  const source = await prisma.knowledgeSource.findFirst({
    where: { id: preflight.sourceId, archivedAt: null },
    select: { id: true, name: true, isActive: true, usableForGeneration: true },
  });
  if (!source || !source.isActive) {
    throw new GenerationPreconditionError('SOURCE_FORBIDDEN', 'The source is not active.');
  }
  if (!source.usableForGeneration) {
    throw new GenerationPreconditionError(
      'SOURCE_NOT_GENERATION_ENABLED',
      `Source "${source.name}" is not marked usable for generation.`,
    );
  }

  // --- precondition 7: domain and topic exist, and the topic is in the domain
  const topic = await prisma.topic.findFirst({
    where: { id: args.topicId, domainId: args.domainId, isActive: true },
    select: { id: true, name: true, domain: { select: { id: true, name: true, isActive: true } } },
  });
  if (!topic || !topic.domain.isActive) {
    throw new GenerationPreconditionError(
      'TAXONOMY_MISSING',
      'The domain and topic must both exist, be active, and the topic must belong to the domain.',
    );
  }

  // --- precondition 8: a profile
  const profileRow = await prisma.generationProfile.findFirst({
    where: { name: 'Default' },
    select: {
      id: true,
      promptVersionId: true,
      modelId: true,
      evidenceStrictness: true,
      duplicateFlagThreshold: true,
      duplicateBlockThreshold: true,
      maxQuestionsPerSection: true,
      maxQuestionsPerDocument: true,
      coverageSettings: true,
    },
  });
  if (!profileRow) {
    throw new GenerationPreconditionError(
      'PROFILE_NOT_AVAILABLE',
      'No generation profile is enabled.',
    );
  }
  const coverage = profileRow.coverageSettings as { minAssessableChars?: number };

  // --- precondition 5: every document ACTIVE, EXTRACTED, non-excluded
  const documentRows = await prisma.knowledgeDocument.findMany({
    where: { id: { in: [...preflight.documentIds] }, sourceId: source.id },
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
      status: true,
      extractionStatus: true,
      isExcludedFromGeneration: true,
    },
  });

  for (const document of documentRows) {
    if (
      document.status !== 'ACTIVE' ||
      document.extractionStatus !== 'EXTRACTED' ||
      document.isExcludedFromGeneration ||
      document.contentHash === null
    ) {
      throw new GenerationPreconditionError(
        'DOCUMENT_NOT_READY',
        `"${document.name}" is not ready for generation (status ${document.status}, extraction ${document.extractionStatus}).`,
      );
    }
  }

  const documents: ScopedDocument[] = documentRows.map((document) => ({
    documentId: document.id,
    sourceDocumentId: document.sourceDocumentId,
    name: document.name,
    sourceUrl: document.sourceUrl,
    folderPath: document.folderPath,
    containerName: document.containerName,
    sourceVersion: document.sourceVersion,
    sourceETag: document.sourceETag,
    contentHash: document.contentHash ?? '',
    localVersionCounter: document.localVersionCounter,
  }));

  const sections = await sectionsForScope(prisma, documents, args.scope);

  // Throws GENERATION_SELECTION_REQUIRED or GENERATION_SCOPE_EMPTY with the
  // reason, which is the honest answer when "all sections already covered".
  const resolvedScope = resolveGenerationScope({
    scope: args.scope,
    documents,
    sections,
    objectiveIds: args.objectiveIds ?? [],
  });

  const profile: GenerationProfileSettings = {
    profileId: profileRow.id,
    promptVersionId: profileRow.promptVersionId,
    modelId: profileRow.modelId,
    evidenceMode: profileRow.evidenceStrictness,
    thresholds: {
      flagThreshold: Number(profileRow.duplicateFlagThreshold),
      blockThreshold: Number(profileRow.duplicateBlockThreshold),
    },
    minAssessableChars: coverage.minAssessableChars ?? 300,
    maxQuestionsPerSection: profileRow.maxQuestionsPerSection,
    domainName: topic.domain.name,
    topicName: topic.name,
  };

  const auditWriter = createAuditWriter({ clock });

  const jobId = await prisma.$transaction(async (tx) => {
    const job = await tx.generationJob.create({
      data: {
        preflightId: preflight.id,
        sourceId: source.id,
        profileId: profileRow.id,
        promptVersionId: profileRow.promptVersionId,
        // Replaced by the generator's own id when the run starts. Captured at
        // run time, never resolved later.
        modelId: profileRow.modelId,
        domainId: args.domainId,
        topicId: args.topicId,
        scope: args.scope,
        objectiveIds: [...(args.objectiveIds ?? [])],
        // The pinned, reproducible input.
        resolvedSectionKeys: resolvedScope.sections.map((section) => section.sectionKey),
        requestedQuestionCount: args.requestedQuestionCount,
        reasonCode: args.reasonCode,
        justification: args.justification ?? null,
        status: 'QUEUED',
        correlationId: args.correlationId,
        createdByUserId: args.actor.userId,
      },
      select: { id: true },
    });

    await auditWriter.write(tx, {
      action:
        args.reasonCode === 'PUBLISHER_REQUESTED'
          ? 'AUTHORING.GENERATION.REGENERATION_REQUESTED'
          : 'AUTHORING.GENERATION.REQUESTED',
      outcome: 'SUCCESS',
      actorType: 'USER',
      actorUserId: args.actor.userId,
      actorDisplayName: args.actor.displayName,
      actorRoles: [...args.actor.roles],
      entityType: 'GenerationJob',
      entityId: job.id,
      entityLabel: job.id,
      domainId: args.domainId,
      sourceId: source.id,
      correlationId: args.correlationId,
      requestId: args.requestId,
      portal: 'AUTHORING',
      detail: {
        scope: args.scope,
        reasonCode: args.reasonCode,
        documentCount: documents.length,
        sectionCount: resolvedScope.sections.length,
        requestedQuestionCount: args.requestedQuestionCount,
        preflightId: preflight.id,
      },
    });

    return job.id;
  });

  return {
    jobId,
    sourceId: source.id,
    resolvedScope,
    profile,
    requestedQuestionCount: args.requestedQuestionCount,
  };
};
