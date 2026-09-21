// Assessment creation and publication — workflows.md §5.
//
// The publication step pins the ELIGIBILITY SNAPSHOT (§5.1): "the set of
// (questionId, publishedVersion) pairs that satisfied every criterion at that
// moment, plus the resolved selection configuration and the proficiency
// threshold set."
//
// That snapshot is what makes two promises keepable at once:
//
//   - "an assessment release never silently acquires questions the approver
//      never saw" — the snapshot bounds what may ever be served;
//   - "and never serves a retired one" — session creation re-filters against
//      current state and intersects.
//
// Validation runs BEFORE submit, because §5 returns "422 with the exact
// shortfall or conflict" rather than letting an unpublishable version through
// to an approver.

import { createAuditWriter, type PrismaClient, type TransactionClient } from '@knowzy/database';
import type { Clock } from '@knowzy/observability';
import type { SelectionStrategy } from '@knowzy/shared-types';
import type { ActorContext } from '../review/review-service.js';
import {
  assertValidBandSet,
  DEFAULT_PROFICIENCY_BANDS,
  type ProficiencyBandDefinition,
} from './scoring.js';
import { allocateEvenly, PoolInsufficientError, type SnapshotMember } from './selection.js';

export class AssessmentConfigError extends Error {
  readonly code = 'ASSESSMENT_CONFIG_INVALID';
  constructor(detail: string) {
    super(detail);
    this.name = 'AssessmentConfigError';
  }
}

export class AssessmentNotFoundError extends Error {
  readonly code = 'NOT_FOUND';
  constructor(id: string) {
    super(`No assessment version with id ${id}.`);
    this.name = 'AssessmentNotFoundError';
  }
}

export interface CreateAssessmentArgs {
  readonly prisma: PrismaClient;
  readonly clock: Clock;
  readonly actor: ActorContext;
  readonly name: string;
  readonly slug: string;
  readonly domainId: string;
  readonly description?: string;
  readonly topicIds: readonly string[];
  readonly questionCount: number;
  readonly selectionStrategy: SelectionStrategy;
  readonly passPercentage: number;
  readonly timeLimitMinutes?: number;
  readonly attemptLimit?: number;
  readonly allowBackNavigation?: boolean;
  readonly proficiencyThresholds?: readonly ProficiencyBandDefinition[];
  readonly selectionConfig?: Readonly<Record<string, unknown>>;
}

export interface CreatedAssessment {
  readonly assessmentId: string;
  readonly assessmentVersionId: string;
  readonly versionNumber: number;
}

export const createAssessment = async (args: CreateAssessmentArgs): Promise<CreatedAssessment> => {
  if (!args.actor.permissions.includes('assessment.manage')) {
    throw new AssessmentConfigError('Creating an assessment requires "assessment.manage".');
  }
  if (args.topicIds.length === 0) {
    throw new AssessmentConfigError(
      'An assessment must name at least one topic; the question pool is resolved per topic.',
    );
  }

  const bands = args.proficiencyThresholds ?? DEFAULT_PROFICIENCY_BANDS;
  // §5.3: an invalid band set blocks publication. Checked at CREATION too, so
  // the author learns immediately rather than at the publish step.
  assertValidBandSet(bands);

  if (args.passPercentage < 0 || args.passPercentage > 100) {
    throw new AssessmentConfigError('The pass percentage must be between 0 and 100.');
  }

  const auditWriter = createAuditWriter({ clock: args.clock });

  return args.prisma.$transaction(async (tx: TransactionClient) => {
    const assessment = await tx.assessment.create({
      data: {
        name: args.name,
        slug: args.slug,
        domainId: args.domainId,
        description: args.description ?? null,
        ownerUserId: args.actor.userId,
        status: 'DRAFT',
        createdByUserId: args.actor.userId,
      },
      select: { id: true },
    });

    const version = await tx.assessmentVersion.create({
      data: {
        assessmentId: assessment.id,
        versionNumber: 1,
        status: 'DRAFT',
        topicIds: [...args.topicIds],
        questionCount: args.questionCount,
        selectionStrategy: args.selectionStrategy,
        selectionConfig: (args.selectionConfig ?? {}) as object,
        passPercentage: args.passPercentage,
        proficiencyThresholds: bands.map((band) => ({ ...band })),
        attemptLimit: args.attemptLimit ?? null,
        timeLimitMinutes: args.timeLimitMinutes ?? null,
        allowBackNavigation: args.allowBackNavigation ?? true,
        createdByUserId: args.actor.userId,
      },
      select: { id: true, versionNumber: true },
    });

    await auditWriter.write(tx, {
      action: 'AUTHORING.ASSESSMENT.CREATED',
      outcome: 'SUCCESS',
      actorType: 'USER',
      actorUserId: args.actor.userId,
      actorDisplayName: args.actor.displayName,
      actorRoles: [...args.actor.roles],
      entityType: 'AssessmentVersion',
      entityId: version.id,
      entityLabel: args.name,
      domainId: args.domainId,
      correlationId: args.actor.correlationId,
      requestId: args.actor.requestId,
      portal: 'AUTHORING',
      detail: {
        questionCount: args.questionCount,
        strategy: args.selectionStrategy,
        topicCount: args.topicIds.length,
      },
    });

    return {
      assessmentId: assessment.id,
      assessmentVersionId: version.id,
      versionNumber: version.versionNumber,
    };
  });
};

// ---------------------------------------------------------------------------

export interface PoolMember extends SnapshotMember {
  readonly topicId: string;
  readonly similarityClusterId: string | null;
  readonly approvedAt: Date | null;
}

export interface PoolEvaluation {
  readonly members: readonly PoolMember[];
  readonly sizeByTopic: Readonly<Record<string, number>>;
  readonly sizeByObjective: Readonly<Record<string, number>>;
}

/**
 * The currently eligible published-question pool for a version.
 *
 * "Published questions only" is enforced HERE, at the source: the query reads
 * PublishedQuestionReference, which only exists for a question with a verified
 * bank item (G9), and filters on isActive and isPublished so a retired
 * question cannot enter a pool.
 */
export const evaluatePool = async (
  prisma: PrismaClient,
  args: { readonly domainId: string; readonly topicIds: readonly string[] },
): Promise<PoolEvaluation> => {
  const references = await prisma.publishedQuestionReference.findMany({
    where: {
      domainId: args.domainId,
      topicId: { in: [...args.topicIds] },
      status: 'PUBLISHED',
      isActive: true,
      isPublished: true,
    },
    select: {
      questionId: true,
      publishedVersion: true,
      topicId: true,
      learningObjectiveId: true,
      question: {
        select: {
          similarityClusterId: true,
          status: true,
          approvals: { orderBy: { decidedAt: 'desc' }, take: 1, select: { decidedAt: true } },
        },
      },
    },
  });

  const members: PoolMember[] = references
    // Belt and braces: the local question must still be PUBLISHED too. A
    // reference and a draft that disagree is a reconciliation problem, and the
    // pool is not the place to paper over it.
    .filter((reference) => reference.question.status === 'PUBLISHED')
    .map((reference) => ({
      questionId: reference.questionId,
      publishedVersion: reference.publishedVersion,
      topicId: reference.topicId,
      similarityClusterId: reference.question.similarityClusterId,
      approvedAt: reference.question.approvals[0]?.decidedAt ?? null,
    }));

  const sizeByTopic: Record<string, number> = {};
  for (const member of members) {
    sizeByTopic[member.topicId] = (sizeByTopic[member.topicId] ?? 0) + 1;
  }

  const sizeByObjective: Record<string, number> = {};
  for (const reference of references) {
    if (reference.learningObjectiveId === null) continue;
    sizeByObjective[reference.learningObjectiveId] =
      (sizeByObjective[reference.learningObjectiveId] ?? 0) + 1;
  }

  return { members, sizeByTopic, sizeByObjective };
};

export interface ValidationResult {
  readonly valid: boolean;
  readonly poolSize: number;
  readonly sizeByTopic: Readonly<Record<string, number>>;
  readonly problems: readonly { readonly code: string; readonly detail: string }[];
}

/**
 * Validates a version against the live pool — the §5 checks before submit.
 *
 * Returns problems rather than throwing, because the author needs the whole
 * list at once: "422 with the exact shortfall or conflict".
 */
export const validateAssessmentVersion = async (
  prisma: PrismaClient,
  assessmentVersionId: string,
): Promise<ValidationResult> => {
  const version = await prisma.assessmentVersion.findUnique({
    where: { id: assessmentVersionId },
    include: { assessment: { select: { domainId: true } } },
  });
  if (!version) throw new AssessmentNotFoundError(assessmentVersionId);

  const problems: { code: string; detail: string }[] = [];

  try {
    assertValidBandSet(version.proficiencyThresholds as unknown as ProficiencyBandDefinition[]);
  } catch (error) {
    problems.push({
      code: 'ASSESSMENT_CONFIG_INVALID',
      detail: error instanceof Error ? error.message : 'The proficiency band set is invalid.',
    });
  }

  const pool = await evaluatePool(prisma, {
    domainId: version.assessment.domainId,
    topicIds: version.topicIds,
  });

  if (pool.members.length < version.questionCount) {
    problems.push({
      code: 'ASSESSMENT_POOL_INSUFFICIENT',
      detail: `The assessment asks for ${version.questionCount} question(s) and only ${pool.members.length} published question(s) are eligible.`,
    });
  }

  // Similarity clusters cap the effective pool: at most one member of each can
  // be served, so a pool of ten questions in two clusters can serve two.
  const clusters = new Set(
    pool.members.map((member) => member.similarityClusterId).filter((id) => id !== null),
  );
  const unclustered = pool.members.filter((member) => member.similarityClusterId === null).length;
  const effective = unclustered + clusters.size;
  if (effective < version.questionCount) {
    problems.push({
      code: 'POOL_DUPLICATE_CONFLICT',
      detail: `After selecting one question per similarity cluster only ${effective} of ${pool.members.length} question(s) remain, below the required ${version.questionCount}.`,
    });
  }

  if (
    version.selectionStrategy === 'TOPIC_BALANCED' ||
    version.selectionStrategy === 'TOPIC_DISTRIBUTION'
  ) {
    const config = version.selectionConfig as { topicCounts?: Record<string, number> };
    const counts =
      version.selectionStrategy === 'TOPIC_DISTRIBUTION'
        ? (config.topicCounts ?? {})
        : allocateEvenly([...version.topicIds].sort(), version.questionCount);

    for (const [topicId, required] of Object.entries(counts)) {
      const available = pool.sizeByTopic[topicId] ?? 0;
      if (available < required) {
        problems.push({
          code: 'ASSESSMENT_POOL_INSUFFICIENT',
          detail: `Topic ${topicId} needs ${required} question(s) and has ${available}.`,
        });
      }
    }
  }

  return {
    valid: problems.length === 0,
    poolSize: pool.members.length,
    sizeByTopic: pool.sizeByTopic,
    problems,
  };
};

// ---------------------------------------------------------------------------

export interface PublishAssessmentArgs {
  readonly prisma: PrismaClient;
  readonly clock: Clock;
  readonly actor: ActorContext;
  readonly assessmentVersionId: string;
}

export interface PublishedAssessment {
  readonly assessmentVersionId: string;
  readonly snapshotId: string;
  readonly poolSize: number;
  readonly sizeByTopic: Readonly<Record<string, number>>;
}

/**
 * Publishes a version and pins its eligibility snapshot.
 *
 * The snapshot is created in the SAME transaction as the status change: a
 * PUBLISHED version with no snapshot would be startable with an unbounded pool,
 * which is precisely what §5.1 exists to prevent.
 */
export const publishAssessmentVersion = async (
  args: PublishAssessmentArgs,
): Promise<PublishedAssessment> => {
  if (!args.actor.permissions.includes('assessment.publish')) {
    throw new AssessmentConfigError('Publishing an assessment requires "assessment.publish".');
  }

  const validation = await validateAssessmentVersion(args.prisma, args.assessmentVersionId);
  if (!validation.valid) {
    // Every problem in the message: §5 returns "422 with the exact shortfall or
    // conflict", and an author fixing one at a time is the failure that causes.
    throw new PoolInsufficientError(
      `This assessment cannot be published yet: ${validation.problems.map((problem) => problem.detail).join(' · ')}`,
      { required: 0, available: validation.poolSize },
    );
  }

  const version = await args.prisma.assessmentVersion.findUniqueOrThrow({
    where: { id: args.assessmentVersionId },
    include: { assessment: { select: { id: true, domainId: true, name: true } } },
  });

  const pool = await evaluatePool(args.prisma, {
    domainId: version.assessment.domainId,
    topicIds: version.topicIds,
  });

  const auditWriter = createAuditWriter({ clock: args.clock });
  const now = args.clock.now();

  return args.prisma.$transaction(async (tx: TransactionClient) => {
    const snapshot = await tx.assessmentEligibilitySnapshot.create({
      data: {
        assessmentVersionId: version.id,
        snapshotAt: now,
        strategy: version.selectionStrategy,
        resolvedSelectionConfig: {
          strategy: version.selectionStrategy,
          questionCount: version.questionCount,
          ...(version.selectionConfig as object),
        },
        // Copied, not referenced: §5.3 says the threshold set in force is
        // copied so a historical result stays interpretable after the
        // configuration changes.
        proficiencyThresholds: version.proficiencyThresholds as object,
        poolMembers: pool.members.map((member) => ({
          questionId: member.questionId,
          publishedVersion: member.publishedVersion,
          topicId: member.topicId,
        })),
        poolSizeByTopic: pool.sizeByTopic,
        poolSizeByObjective: pool.sizeByObjective,
      },
      select: { id: true },
    });

    await tx.assessmentVersion.update({
      where: { id: version.id },
      data: {
        status: 'PUBLISHED',
        publishedByUserId: args.actor.userId,
        publishedAt: now,
        modifiedByUserId: args.actor.userId,
      },
    });

    await tx.assessment.update({
      where: { id: version.assessment.id },
      data: {
        // The ASSESSMENT becomes ACTIVE; PUBLISHED is a VERSION state. Keeping
        // the two vocabularies distinct is what lets version N stay published
        // while N+1 is drafted (§5.3).
        status: 'ACTIVE',
        currentPublishedVersionId: version.id,
      },
    });

    await auditWriter.write(tx, {
      action: 'AUTHORING.ASSESSMENT.PUBLISHED',
      outcome: 'SUCCESS',
      actorType: 'USER',
      actorUserId: args.actor.userId,
      actorDisplayName: args.actor.displayName,
      actorRoles: [...args.actor.roles],
      entityType: 'AssessmentVersion',
      entityId: version.id,
      entityLabel: version.assessment.name,
      domainId: version.assessment.domainId,
      correlationId: args.actor.correlationId,
      requestId: args.actor.requestId,
      portal: 'AUTHORING',
      detail: {
        versionNumber: version.versionNumber,
        poolSize: pool.members.length,
        questionCount: version.questionCount,
        strategy: version.selectionStrategy,
      },
    });

    return {
      assessmentVersionId: version.id,
      snapshotId: snapshot.id,
      poolSize: pool.members.length,
      sizeByTopic: pool.sizeByTopic,
    };
  });
};

/** Moves a DRAFT version through submit and approve — §5's sequence. */
export const transitionAssessmentVersion = async (args: {
  readonly prisma: PrismaClient;
  readonly clock: Clock;
  readonly actor: ActorContext;
  readonly assessmentVersionId: string;
  readonly to: 'UNDER_REVIEW' | 'APPROVED';
}): Promise<{ assessmentVersionId: string; status: string }> => {
  const required = args.to === 'UNDER_REVIEW' ? 'assessment.manage' : 'assessment.approve';
  if (!args.actor.permissions.includes(required)) {
    throw new AssessmentConfigError(`This transition requires "${required}".`);
  }

  const version = await args.prisma.assessmentVersion.findUnique({
    where: { id: args.assessmentVersionId },
    include: { assessment: { select: { domainId: true, name: true } } },
  });
  if (!version) throw new AssessmentNotFoundError(args.assessmentVersionId);

  const expectedFrom = args.to === 'UNDER_REVIEW' ? 'DRAFT' : 'UNDER_REVIEW';
  if (version.status !== expectedFrom) {
    throw new AssessmentConfigError(
      `A version in ${version.status} cannot move to ${args.to}; it must be ${expectedFrom}.`,
    );
  }

  if (args.to === 'UNDER_REVIEW') {
    // Validated at submit, so an approver never reviews something unpublishable.
    const validation = await validateAssessmentVersion(args.prisma, args.assessmentVersionId);
    if (!validation.valid) {
      throw new AssessmentConfigError(
        `This version cannot be submitted: ${validation.problems.map((p) => p.detail).join(' · ')}`,
      );
    }
  }

  const auditWriter = createAuditWriter({ clock: args.clock });
  const now = args.clock.now();

  return args.prisma.$transaction(async (tx: TransactionClient) => {
    const updated = await tx.assessmentVersion.update({
      where: { id: args.assessmentVersionId },
      data: {
        status: args.to,
        ...(args.to === 'UNDER_REVIEW'
          ? { submittedByUserId: args.actor.userId, submittedAt: now }
          : { approvedByUserId: args.actor.userId, approvedAt: now }),
        modifiedByUserId: args.actor.userId,
      },
      select: { id: true, status: true },
    });

    await auditWriter.write(tx, {
      action:
        args.to === 'UNDER_REVIEW'
          ? 'AUTHORING.ASSESSMENT.SUBMITTED'
          : 'AUTHORING.ASSESSMENT.APPROVED',
      outcome: 'SUCCESS',
      actorType: 'USER',
      actorUserId: args.actor.userId,
      actorDisplayName: args.actor.displayName,
      actorRoles: [...args.actor.roles],
      entityType: 'AssessmentVersion',
      entityId: updated.id,
      entityLabel: version.assessment.name,
      domainId: version.assessment.domainId,
      correlationId: args.actor.correlationId,
      requestId: args.actor.requestId,
      portal: 'AUTHORING',
      previousValue: { status: version.status },
      newValue: { status: args.to },
      detail: { previousStatus: version.status, newStatus: args.to },
    });

    return { assessmentVersionId: updated.id, status: updated.status };
  });
};
