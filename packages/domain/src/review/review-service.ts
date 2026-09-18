// The review and approval service — workflows.md §3.
//
// One function performs every transition, because §3.2's rule is per
// transition and not per feature: "Every transition writes QuestionReview /
// QuestionApproval rows plus an AuditEvent IN THE SAME DATABASE TRANSACTION as
// the state change. A transition that cannot be audited does not commit."
//
// Having one implementation means that rule cannot be satisfied for approval
// and quietly forgotten for reject.

import { createAuditWriter, type PrismaClient, type TransactionClient } from '@knowzy/database';
import type { Clock } from '@knowzy/observability';
import type { AuditAction, QuestionStatus, ReviewKind, ReviewOutcome } from '@knowzy/shared-types';
import {
  evaluateApprovalGates,
  gateResultsForAudit,
  type GateEvaluation,
  type GatePolicyState,
  type GateSourceState,
  type GateSubject,
} from './gates.js';
import {
  evaluateApprovalSeparation,
  DEFAULT_SEPARATION_POLICIES,
  type SeparationPolicies,
} from './separation-of-duties.js';
import { requireTransition, type TransitionRule } from './transitions.js';

export class QuestionNotFoundError extends Error {
  readonly code = 'NOT_FOUND';
  constructor(questionId: string) {
    super(`No question with id ${questionId} is visible to you.`);
    this.name = 'QuestionNotFoundError';
  }
}

export class GatesFailedError extends Error {
  readonly code = 'GATE_FAILED';
  constructor(readonly evaluation: GateEvaluation) {
    super(
      // ALL failures in the message, not the first: error-handling.md §328
      // requires a checklist, and an author fixing one thing at a time is the
      // failure mode that produces.
      `This question cannot proceed yet: ${evaluation.failures
        .map((failure) => `${failure.code} — ${failure.detail}`)
        .join(' · ')}`,
    );
    this.name = 'GatesFailedError';
  }
}

export class PermissionRequiredError extends Error {
  readonly code = 'FORBIDDEN';
  constructor(permission: string) {
    super(`This transition requires the permission "${permission}".`);
    this.name = 'PermissionRequiredError';
  }
}

export interface ActorContext {
  readonly userId: string;
  readonly displayName: string;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
  readonly correlationId: string;
  readonly requestId: string;
}

export interface ReviewDeps {
  readonly prisma: PrismaClient;
  readonly clock: Clock;
  readonly policies?: Partial<SeparationPolicies>;
  readonly minQuestionTextLength?: number;
  readonly requiredMetadataFields?: readonly string[];
}

// ---------------------------------------------------------------------------
// Gate context assembly

interface LoadedQuestion {
  readonly subject: GateSubject;
  readonly status: QuestionStatus;
  readonly domainId: string;
  readonly topicId: string;
  readonly sourceId: string;
  readonly internalQuestionId: string;
  readonly requireSmeSignoff: boolean;
  readonly duplicateFlagThreshold: number;
  readonly evidenceMode: 'STRICT' | 'STANDARD';
}

const loadQuestion = async (
  prisma: PrismaClient,
  questionId: string,
): Promise<LoadedQuestion> => {
  const row = await prisma.draftQuestion.findUnique({
    where: { id: questionId },
    include: {
      domain: { select: { id: true, requireSmeSignoff: true } },
      generationJob: { select: { profile: { select: { duplicateFlagThreshold: true, evidenceStrictness: true } } } },
      versions: { orderBy: { version: 'desc' }, take: 1, select: { changedByUserId: true } },
    },
  });
  if (!row) throw new QuestionNotFoundError(questionId);

  const payload = row.answerPayload as {
    options: Record<'A' | 'B' | 'C' | 'D', string>;
    correctOption: string;
  };

  return {
    status: row.status,
    domainId: row.domainId,
    topicId: row.topicId,
    sourceId: row.sourceId,
    internalQuestionId: row.internalQuestionId,
    requireSmeSignoff: row.domain.requireSmeSignoff,
    duplicateFlagThreshold: Number(row.generationJob?.profile.duplicateFlagThreshold ?? 0.75),
    evidenceMode: row.evidenceVerificationMode,
    subject: {
      questionId: row.id,
      version: row.version,
      questionText: row.questionText,
      options: payload.options,
      correctOption: payload.correctOption,
      explanation: row.explanation,
      domainId: row.domainId,
      topicId: row.topicId,
      sourceMetadata: {},
      supportingEvidence: row.supportingEvidence,
      evidenceStartOffset: row.evidenceStartOffset,
      evidenceEndOffset: row.evidenceEndOffset,
      sectionKey: row.sectionKey,
      sourceContentHash: row.sourceContentHash,
      maxSimilarityScore: row.maxSimilarityScore === null ? null : Number(row.maxSimilarityScore),
      duplicateDisposition: row.duplicateDisposition,
      authorUserId: row.createdByUserId,
      // The last editor is the actor on the newest version snapshot, which is
      // what §3.4's editorMayApproveOwn is about — not whoever last touched
      // any field.
      lastEditorUserId: row.versions[0]?.changedByUserId ?? row.createdByUserId,
      needsRevalidation: row.needsRevalidation,
    },
  };
};

/** Reads the source as it is NOW, for gates 11 and 12. */
const loadSourceState = async (
  prisma: PrismaClient,
  loaded: LoadedQuestion,
): Promise<GateSourceState> => {
  const row = await prisma.draftQuestion.findUniqueOrThrow({
    where: { id: loaded.subject.questionId },
    select: { sourceDocumentId: true, sourceId: true },
  });

  const doc = await prisma.knowledgeDocument.findFirst({
    where: { sourceId: row.sourceId, sourceDocumentId: row.sourceDocumentId },
    select: {
      status: true,
      contentHash: true,
      extractedText: true,
      localVersionCounter: true,
      id: true,
      source: { select: { isActive: true, archivedAt: true } },
    },
  });

  if (!doc) {
    return {
      documentFound: false,
      documentStatus: null,
      sourceIsActive: false,
      currentContentHash: null,
      section: null,
      evidenceMode: loaded.evidenceMode,
    };
  }

  const section = await prisma.documentSection.findFirst({
    where: {
      documentId: doc.id,
      sectionKey: loaded.subject.sectionKey,
      documentVersionCounter: doc.localVersionCounter,
    },
    select: { sectionKey: true, startOffset: true, endOffset: true },
  });

  return {
    documentFound: true,
    documentStatus: doc.status,
    sourceIsActive: doc.source.isActive && doc.source.archivedAt === null,
    currentContentHash: doc.contentHash,
    section:
      section === null
        ? null
        : {
            sectionKey: section.sectionKey,
            text: (doc.extractedText ?? '').slice(section.startOffset, section.endOffset),
            startOffset: section.startOffset,
          },
    evidenceMode: loaded.evidenceMode,
  };
};

const loadSmeEndorsement = async (
  prisma: PrismaClient,
  questionId: string,
): Promise<number | null> => {
  const endorsement = await prisma.questionReview.findFirst({
    where: { questionId, kind: 'SME', outcome: 'ENDORSED' },
    orderBy: { questionVersion: 'desc' },
    select: { questionVersion: true },
  });
  return endorsement?.questionVersion ?? null;
};

export interface GateContextResult {
  readonly evaluation: GateEvaluation;
  readonly loaded: LoadedQuestion;
}

export interface EvaluateGatesOptions {
  /** True only for an approval. See GatePolicyState.separationApplies. */
  readonly separationApplies?: boolean;
  readonly breakGlass?: { readonly justification: string };
}

export const evaluateGatesForQuestion = async (
  deps: ReviewDeps,
  questionId: string,
  actor: Pick<ActorContext, 'userId' | 'roles' | 'permissions'>,
  options: EvaluateGatesOptions = {},
): Promise<GateContextResult> => {
  const breakGlass = options.breakGlass;
  const loaded = await loadQuestion(deps.prisma, questionId);
  const source = await loadSourceState(deps.prisma, loaded);
  const policies: SeparationPolicies = { ...DEFAULT_SEPARATION_POLICIES, ...deps.policies };

  const separation = evaluateApprovalSeparation({
    approverUserId: actor.userId,
    approverRoles: actor.roles,
    approverPermissions: actor.permissions,
    authorUserId: loaded.subject.authorUserId,
    lastEditorUserId: loaded.subject.lastEditorUserId,
    policies,
    ...(breakGlass === undefined ? {} : { breakGlass }),
  });

  const policy: GatePolicyState = {
    minQuestionTextLength: deps.minQuestionTextLength ?? 15,
    requiredMetadataFields: deps.requiredMetadataFields ?? [],
    duplicateFlagThreshold: loaded.duplicateFlagThreshold,
    separationOfDuties: { permitted: separation.permitted, reason: separation.reason },
    // Defaults to true so a caller that forgets the flag gets the STRICTER
    // behaviour rather than a silently skipped gate.
    separationApplies: options.separationApplies ?? true,
    smeSignoffRequired: loaded.requireSmeSignoff,
    smeEndorsedVersion: loaded.requireSmeSignoff
      ? await loadSmeEndorsement(deps.prisma, questionId)
      : null,
  };

  return { evaluation: evaluateApprovalGates(loaded.subject, source, policy), loaded };
};

// ---------------------------------------------------------------------------
// The transition

const AUDIT_FOR_TRANSITION: Readonly<Record<string, AuditAction>> = {
  'DRAFT->AUTHOR_REVIEW': 'AUTHORING.QUESTION.EDITED',
  'AUTHOR_REVIEW->DRAFT': 'AUTHORING.QUESTION.EDITED',
  'AUTHOR_REVIEW->SUBMITTED_FOR_APPROVAL': 'AUTHORING.QUESTION.SUBMITTED',
  'AUTHOR_REVIEW->REJECTED': 'AUTHORING.QUESTION.REJECTED',
  'AUTHOR_REVIEW->ARCHIVED': 'AUTHORING.QUESTION.ARCHIVED',
  'SUBMITTED_FOR_APPROVAL->APPROVED': 'AUTHORING.QUESTION.APPROVED',
  'SUBMITTED_FOR_APPROVAL->CHANGES_REQUESTED': 'AUTHORING.QUESTION.CHANGES_REQUESTED',
  'SUBMITTED_FOR_APPROVAL->REJECTED': 'AUTHORING.QUESTION.REJECTED',
  'CHANGES_REQUESTED->AUTHOR_REVIEW': 'AUTHORING.QUESTION.EDITED',
  'APPROVED->PUBLISHED': 'AUTHORING.QUESTION.PUBLISHED',
  'APPROVED->ARCHIVED': 'AUTHORING.QUESTION.ARCHIVED',
  'PUBLISHED->RETIRED': 'AUTHORING.QUESTION.RETIRED',
  'PUBLISHED->DRAFT': 'AUTHORING.QUESTION.EDITED',
  'REJECTED->ARCHIVED': 'AUTHORING.QUESTION.ARCHIVED',
  'RETIRED->ARCHIVED': 'AUTHORING.QUESTION.ARCHIVED',
};

export interface TransitionArgs {
  readonly deps: ReviewDeps;
  readonly questionId: string;
  readonly to: QuestionStatus;
  readonly actor: ActorContext;
  readonly comment?: string | null;
  /** Recorded as a QuestionReview alongside the transition. */
  readonly reviewKind?: ReviewKind;
  readonly breakGlass?: { readonly justification: string };
}

export interface TransitionResult {
  readonly questionId: string
  readonly from: QuestionStatus;
  readonly to: QuestionStatus;
  readonly version: number;
  readonly rule: TransitionRule;
  readonly gates: GateEvaluation | null;
  readonly viaBreakGlass: boolean;
}

const reviewOutcomeFor = (to: QuestionStatus): ReviewOutcome | null => {
  if (to === 'CHANGES_REQUESTED') return 'CHANGES_REQUESTED';
  if (to === 'REJECTED') return 'REJECTED';
  return null;
};

export const transitionQuestion = async (args: TransitionArgs): Promise<TransitionResult> => {
  const { deps, actor } = args;
  const comment = args.comment ?? null;

  const loaded = await loadQuestion(deps.prisma, args.questionId);
  const rule = requireTransition(loaded.status, args.to, comment);

  if (rule.permission !== null && !actor.permissions.includes(rule.permission)) {
    throw new PermissionRequiredError(rule.permission);
  }

  let gates: GateEvaluation | null = null;
  let viaBreakGlass = false;

  if (rule.gated) {
    const context = await evaluateGatesForQuestion(deps, args.questionId, actor, {
      // Separation of duties is only a gate on APPROVAL.
      separationApplies: args.to === 'APPROVED',
      ...(args.breakGlass === undefined ? {} : { breakGlass: args.breakGlass }),
    });
    gates = context.evaluation;

    if (!gates.passed) throw new GatesFailedError(gates);
    viaBreakGlass =
      args.breakGlass !== undefined &&
      gates.results.some(
        (result) => result.code === 'SEPARATION_OF_DUTIES' && result.detail.includes('break-glass'),
      );
  }

  const action = AUDIT_FOR_TRANSITION[`${loaded.status}->${args.to}`];
  if (!action) {
    // Unreachable while the table and TRANSITIONS agree, and asserted rather
    // than defaulted: an unaudited transition must not commit.
    throw new Error(
      `No audit action is declared for ${loaded.status} -> ${args.to}. A transition that cannot be audited does not commit.`,
    );
  }

  const auditWriter = createAuditWriter({ clock: deps.clock });
  const now = deps.clock.now();

  return deps.prisma.$transaction(async (tx: TransactionClient) => {
    const updated = await tx.draftQuestion.update({
      where: { id: args.questionId },
      data: {
        status: args.to,
        modifiedByUserId: actor.userId,
        ...(args.to === 'ARCHIVED' ? { archivedAt: now } : {}),
        ...(args.to === 'RETIRED' ? { retiredAt: now } : {}),
      },
      select: { id: true, version: true, status: true },
    });

    // A review row for every transition a human performed with an opinion.
    const outcome = reviewOutcomeFor(args.to);
    if (comment !== null && comment.trim().length > 0) {
      await tx.questionReview.create({
        data: {
          questionId: args.questionId,
          questionVersion: updated.version,
          reviewerUserId: actor.userId,
          kind: args.reviewKind ?? 'REVIEWER',
          outcome: outcome ?? 'COMMENTED',
          comment: comment.trim(),
          isBlocking: outcome !== null,
        },
      });
    }

    // An approval carries the gate results AS EVALUATED, so an auditor sees
    // what the platform checked then, not what it would check today.
    if (args.to === 'APPROVED' && gates !== null) {
      await tx.questionApproval.create({
        data: {
          questionId: args.questionId,
          questionVersion: updated.version,
          approverUserId: actor.userId,
          decision: 'APPROVED',
          comment: comment?.trim() ?? null,
          gateResults: gateResultsForAudit(gates) as object,
          // Stored separately from gateResults because §3.4's policies are
          // configuration: an auditor needs to see WHICH policy applied at the
          // time, not just that gate 13 passed.
          separationOfDutiesResult: {
            permitted: true,
            reason:
              gates.results.find((result) => result.code === 'SEPARATION_OF_DUTIES')?.detail ?? '',
            viaBreakGlass,
          },
          overrideJustification: viaBreakGlass ? (args.breakGlass?.justification ?? null) : null,
          overrideByUserId: viaBreakGlass ? actor.userId : null,
        },
      });
    }

    await auditWriter.write(tx, {
      action: viaBreakGlass ? 'AUTHORING.QUESTION.APPROVAL_OVERRIDE' : action,
      outcome: 'SUCCESS',
      actorType: 'USER',
      actorUserId: actor.userId,
      actorDisplayName: actor.displayName,
      actorRoles: [...actor.roles],
      entityType: 'DraftQuestion',
      entityId: args.questionId,
      entityLabel: args.questionId,
      domainId: loaded.domainId,
      sourceId: loaded.sourceId,
      previousValue: { status: loaded.status },
      newValue: { status: args.to },
      correlationId: actor.correlationId,
      requestId: actor.requestId,
      portal: 'AUTHORING',
      detail: {
        previousStatus: loaded.status,
        newStatus: args.to,
        version: updated.version,
        ...(gates === null
          ? {}
          : { gatesPassed: gates.passed, evaluatedGateCount: gates.results.length }),
        ...(viaBreakGlass ? { breakGlass: true } : {}),
      },
    });

    return {
      questionId: args.questionId,
      from: loaded.status,
      to: args.to,
      version: updated.version,
      rule,
      gates,
      viaBreakGlass,
    };
  });
};

// ---------------------------------------------------------------------------
// Standalone review comments

export interface AddReviewArgs {
  readonly deps: ReviewDeps;
  readonly questionId: string;
  readonly actor: ActorContext;
  readonly kind: ReviewKind;
  readonly outcome: ReviewOutcome;
  readonly comment: string;
}

/**
 * Records a review WITHOUT changing status.
 *
 * §3.3: the SME review is an advisory record by default. An SME endorsement is
 * version-bound, so it is stored against the version it was given for and a
 * later edit invalidates it automatically — no invalidation job needed.
 */
export const addReview = async (
  args: AddReviewArgs,
): Promise<{ reviewId: string; questionVersion: number; kind: ReviewKind; outcome: ReviewOutcome }> => {
  const { deps, actor } = args;
  if (!actor.permissions.includes('question.review')) {
    throw new PermissionRequiredError('question.review');
  }
  if (args.comment.trim().length === 0) {
    throw new Error('A review comment cannot be empty. An empty opinion helps nobody.');
  }

  const loaded = await loadQuestion(deps.prisma, args.questionId);
  const auditWriter = createAuditWriter({ clock: deps.clock });

  return deps.prisma.$transaction(async (tx: TransactionClient) => {
    const review = await tx.questionReview.create({
      data: {
        questionId: args.questionId,
        questionVersion: loaded.subject.version,
        reviewerUserId: actor.userId,
        kind: args.kind,
        outcome: args.outcome,
        comment: args.comment.trim(),
        // An SME endorsement is advisory unless the domain requires sign-off,
        // in which case it becomes the blocking gate.
        isBlocking: args.kind === 'SME' && loaded.requireSmeSignoff,
      },
      select: { id: true, questionVersion: true },
    });

    await auditWriter.write(tx, {
      action: 'AUTHORING.QUESTION.EDITED',
      outcome: 'SUCCESS',
      actorType: 'USER',
      actorUserId: actor.userId,
      actorDisplayName: actor.displayName,
      actorRoles: [...actor.roles],
      entityType: 'QuestionReview',
      entityId: review.id,
      entityLabel: args.questionId,
      domainId: loaded.domainId,
      sourceId: loaded.sourceId,
      correlationId: actor.correlationId,
      requestId: actor.requestId,
      portal: 'AUTHORING',
      // The comment TEXT is not in the detail: audit-model.md §8 keeps
      // field-level content out of the audit store. It lives on QuestionReview.
      detail: {
        reviewKind: args.kind,
        reviewOutcome: args.outcome,
        version: review.questionVersion,
      },
    });

    return {
      reviewId: review.id,
      questionVersion: review.questionVersion,
      kind: args.kind,
      outcome: args.outcome,
    };
  });
};

export interface DispositionArgs {
  readonly deps: ReviewDeps;
  readonly questionId: string;
  readonly actor: ActorContext;
  readonly disposition: 'DISTINCT' | 'DUPLICATE';
  readonly note: string;
}

/**
 * Records a duplicate disposition, which is what unblocks gate 10.
 *
 * generation-governance.md §4.4: a flagged draft is "persisted with a
 * DUPLICATE_SUSPECTED warning... Approval is blocked until a reviewer
 * dispositions it (DISTINCT with a note, or DUPLICATE → reject)."
 */
export const dispositionDuplicate = async (
  args: DispositionArgs,
): Promise<{ questionId: string; disposition: string }> => {
  const { deps, actor } = args;
  if (!actor.permissions.includes('question.review')) {
    throw new PermissionRequiredError('question.review');
  }
  if (args.note.trim().length < 10) {
    throw new Error(
      'A duplicate disposition requires a note of at least 10 characters explaining the judgement.',
    );
  }

  const loaded = await loadQuestion(deps.prisma, args.questionId);
  const auditWriter = createAuditWriter({ clock: deps.clock });

  return deps.prisma.$transaction(async (tx: TransactionClient) => {
    await tx.draftQuestion.update({
      where: { id: args.questionId },
      data: {
        duplicateDisposition: args.disposition,
        duplicateDispositionNote: args.note.trim(),
        modifiedByUserId: actor.userId,
      },
    });

    await auditWriter.write(tx, {
      action: 'AUTHORING.QUESTION.DUPLICATE_DISPOSITIONED',
      outcome: 'SUCCESS',
      actorType: 'USER',
      actorUserId: actor.userId,
      actorDisplayName: actor.displayName,
      actorRoles: [...actor.roles],
      entityType: 'DraftQuestion',
      entityId: args.questionId,
      entityLabel: args.questionId,
      domainId: loaded.domainId,
      sourceId: loaded.sourceId,
      correlationId: actor.correlationId,
      requestId: actor.requestId,
      portal: 'AUTHORING',
      detail: { disposition: args.disposition },
    });

    return { questionId: args.questionId, disposition: args.disposition };
  });
};
