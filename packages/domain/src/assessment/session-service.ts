// The quiz session lifecycle — live-learning-portal.md §4 and workflows.md §6.
//
// §4.2, and everything here follows from it: "On creation, the session stores
// an IMMUTABLE SNAPSHOT of the selected questions... From that moment the quiz
// does NOT call SharePoint again. Retirement, edits, or republication
// mid-session cannot change an in-flight attempt. Scoring uses the snapshot, so
// a scored attempt is reproducible years later."
//
// The answer key lives in that snapshot, server-side, and the learner
// projection is built from an explicit field list — never by deleting fields
// from a row (security.md §8 K4). A projection built by omission fails open the
// first time someone adds a column.

import { createHash } from 'node:crypto';
import { createAuditWriter, type PrismaClient, type TransactionClient } from '@knowzy/database';
import type { Clock } from '@knowzy/observability';
import {
  FORBIDDEN_LEARNER_RESPONSE_KEYS,
  type LearnerQuestionDto,
  type OptionLetter,
  type SessionStatus,
} from '@knowzy/shared-types';
import {
  intersectWithSnapshot,
  selectQuestions,
  PoolInsufficientError,
  type EligibleQuestion,
  type SelectionConfig,
  type SnapshotMember,
} from './selection.js';
import { evaluatePool } from './assessment-service.js';
import {
  DEFAULT_GAP_THRESHOLD,
  scoreSession,
  type ProficiencyBandDefinition,
  type SnapshotQuestion,
} from './scoring.js';

export class NotEligibleError extends Error {
  constructor(
    readonly code: string,
    detail: string,
  ) {
    super(detail);
    this.name = 'NotEligibleError';
  }
}

export class SessionNotActiveError extends Error {
  readonly code = 'SESSION_NOT_ACTIVE';
  constructor(status: SessionStatus) {
    super(`This session is ${status}, so it no longer accepts answers.`);
    this.name = 'SessionNotActiveError';
  }
}

export class SequenceConflictError extends Error {
  readonly code = 'SESSION_SEQUENCE_CONFLICT';
  constructor(expected: number, received: number) {
    super(
      `This write is out of order (expected sequence ${expected}, received ${received}). Another tab or a stale client is writing; resynchronize and retry.`,
    );
    this.name = 'SequenceConflictError';
  }
}

export class SessionNotFoundError extends Error {
  readonly code = 'NOT_FOUND';
  constructor(id: string) {
    super(`No quiz session with id ${id} belongs to you.`);
    this.name = 'SessionNotFoundError';
  }
}

export interface LearnerContext {
  readonly userId: string;
  readonly displayName: string;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
  readonly correlationId: string;
  readonly requestId: string;
}

export interface SessionDeps {
  readonly prisma: PrismaClient;
  readonly clock: Clock;
  /** Idle window for an untimed assessment. §4.4, default 24 h. */
  readonly idleTimeoutMs?: number;
}

const DEFAULT_IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// The learner projection

/**
 * Builds the learner view from an EXPLICIT field list.
 *
 * K4: "snapshots are stored in a column set that the learner-facing query never
 * selects". Constructing the DTO field by field means adding a column to the
 * snapshot cannot leak it — the alternative, spreading the row and deleting
 * keys, fails open every time the schema grows.
 */
export const toLearnerQuestion = (
  snapshot: {
    readonly questionId: string;
    readonly presentationIndex: number;
    readonly questionType: string;
    readonly questionText: string;
    readonly answerPayload: unknown;
  },
  response: { readonly selectedOption: string | null; readonly isFlagged: boolean } | null,
): LearnerQuestionDto => {
  const payload = snapshot.answerPayload as { options: Record<'A' | 'B' | 'C' | 'D', string> };
  return {
    questionId: snapshot.questionId,
    presentationIndex: snapshot.presentationIndex,
    questionType: snapshot.questionType as LearnerQuestionDto['questionType'],
    questionText: snapshot.questionText,
    // Options only. `correctOption` sits beside them in answerPayload and is
    // never read here.
    options: {
      A: payload.options.A,
      B: payload.options.B,
      C: payload.options.C,
      D: payload.options.D,
    },
    selectedOption: (response?.selectedOption ?? null) as OptionLetter | null,
    isFlagged: response?.isFlagged ?? false,
  };
};

/**
 * A last line of defence — K3.
 *
 * The projection above is the real control; this asserts the result, because
 * "no answer key reaches the browser" is worth failing loudly for rather than
 * trusting a reviewer to have noticed.
 */
export const assertNoAnswerKey = (payload: unknown, where: string): void => {
  const walk = (value: unknown, depth: number): void => {
    if (depth > 8 || value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_LEARNER_RESPONSE_KEYS.includes(key)) {
        throw new Error(
          `RESPONSE_SHAPE_VIOLATION: ${where} contains the forbidden key "${key}". An answer key must never reach a learner during an active session.`,
        );
      }
      walk(child, depth + 1);
    }
  };
  walk(payload, 0);
};

// ---------------------------------------------------------------------------
// Session creation

export interface StartSessionArgs {
  readonly deps: SessionDeps;
  readonly learner: LearnerContext;
  readonly assessmentId: string;
  readonly idempotencyKey?: string;
}

export interface StartedSession {
  readonly sessionId: string;
  readonly totalQuestions: number;
  readonly currentIndex: number;
  readonly expiresAt: Date | null;
  readonly attemptNumber: number;
  readonly firstQuestion: LearnerQuestionDto;
  readonly resumed: boolean;
}

export const startSession = async (args: StartSessionArgs): Promise<StartedSession> => {
  const { deps, learner } = args;
  const prisma = deps.prisma;

  if (!learner.permissions.includes('learning.session.create')) {
    throw new NotEligibleError(
      'FORBIDDEN',
      'Starting an assessment requires "learning.session.create".',
    );
  }

  // §4.5: "Parallel sessions for one assessment — blocked by default; an
  // existing IN_PROGRESS session must be resumed or abandoned." Resuming is
  // the friendlier half of that rule, so it happens automatically.
  const existing = await prisma.quizSession.findFirst({
    where: {
      learnerUserId: learner.userId,
      assessmentId: args.assessmentId,
      status: 'IN_PROGRESS',
    },
    select: { id: true },
  });
  if (existing) {
    const resumed = await resumeSession({ deps, learner, sessionId: existing.id });
    return { ...resumed, resumed: true };
  }

  const assessment = await prisma.assessment.findUnique({
    where: { id: args.assessmentId },
    include: {
      versions: { where: { status: 'PUBLISHED' }, orderBy: { versionNumber: 'desc' }, take: 1 },
    },
  });
  if (!assessment) throw new SessionNotFoundError(args.assessmentId);

  const version = assessment.versions[0];
  // Eligibility condition 1.
  if (!version) {
    throw new NotEligibleError(
      'ASSESSMENT_NOT_AVAILABLE',
      'This assessment has no published version.',
    );
  }

  const now = deps.clock.now();
  // Condition 2: the availability window.
  if (version.availabilityStart && version.availabilityStart > now) {
    throw new NotEligibleError(
      'ASSESSMENT_NOT_AVAILABLE',
      `This assessment opens on ${version.availabilityStart.toISOString()}.`,
    );
  }
  if (version.availabilityEnd && version.availabilityEnd < now) {
    throw new NotEligibleError('ASSESSMENT_NOT_AVAILABLE', 'This assessment has closed.');
  }

  // Condition 6: attempts used against the limit.
  const attemptsUsed = await prisma.assessmentResult.count({
    where: { learnerUserId: learner.userId, assessmentId: args.assessmentId },
  });
  if (version.attemptLimit !== null && attemptsUsed >= version.attemptLimit) {
    throw new NotEligibleError(
      'ATTEMPT_LIMIT_REACHED',
      `You have used all ${version.attemptLimit} attempt(s) for this assessment.`,
    );
  }

  const snapshot = await prisma.assessmentEligibilitySnapshot.findFirst({
    where: { assessmentVersionId: version.id },
    orderBy: { snapshotAt: 'desc' },
  });
  if (!snapshot) {
    // A PUBLISHED version with no snapshot is an authoring defect, and the
    // learner is told it is not their problem.
    throw new NotEligibleError(
      'ASSESSMENT_NOT_AVAILABLE',
      'This assessment is temporarily unavailable. Its question set has not been pinned.',
    );
  }

  // §5.1: re-filter against CURRENT state, then intersect with the snapshot.
  const live = await evaluatePool(prisma, {
    domainId: assessment.domainId,
    topicIds: version.topicIds,
  });
  const pinned = snapshot.poolMembers as unknown as SnapshotMember[];
  const pool: EligibleQuestion[] = intersectWithSnapshot(
    pinned,
    live.members.map((member) => ({
      questionId: member.questionId,
      publishedVersion: member.publishedVersion,
      topicId: member.topicId,
      similarityClusterId: member.similarityClusterId,
      approvedAt: member.approvedAt,
    })),
  );

  const resolved = snapshot.resolvedSelectionConfig as {
    questionCount?: number;
    fixedOrder?: SnapshotMember[];
    topicCounts?: Record<string, number>;
  };
  const config: SelectionConfig = {
    strategy: snapshot.strategy,
    questionCount: resolved.questionCount ?? version.questionCount,
    ...(resolved.fixedOrder === undefined ? {} : { fixedOrder: resolved.fixedOrder }),
    ...(resolved.topicCounts === undefined ? {} : { topicCounts: resolved.topicCounts }),
  };

  // The seed is the session id, so it must exist before selection. Derived
  // deterministically from the learner, assessment, and attempt so a retry of
  // a lost response reproduces the same session rather than a second one.
  const sessionId = deriveSessionId({
    learnerUserId: learner.userId,
    assessmentVersionId: version.id,
    attemptNumber: attemptsUsed + 1,
    idempotencyKey: args.idempotencyKey ?? null,
  });

  const selection = selectQuestions(pool, config, sessionId);

  // The answer keys, read from the LOCAL published projection. §4.1 has the API
  // call get_quiz_questions through MCP; here the published reference and the
  // draft row already hold the authoritative text and key, and reading them
  // directly avoids a round trip that could only return the same data. The
  // snapshot is what matters, and it is built once, now.
  const keys = await prisma.publishedQuestionReference.findMany({
    where: { questionId: { in: selection.selected.map((q) => q.questionId) } },
    select: {
      questionId: true,
      publishedVersion: true,
      topicId: true,
      learningObjectiveId: true,
      domainId: true,
      question: {
        select: {
          questionType: true,
          questionText: true,
          answerPayload: true,
          explanation: true,
          sourceDocumentName: true,
          sourceUrl: true,
          sectionKey: true,
          supportingEvidence: true,
        },
      },
    },
  });
  const keyByQuestionId = new Map(keys.map((row) => [row.questionId, row]));

  const missing = selection.selected.filter((q) => !keyByQuestionId.has(q.questionId));
  if (missing.length > 0) {
    throw new PoolInsufficientError(
      `${missing.length} selected question(s) could not be read from the published bank projection.`,
      {
        required: selection.selected.length,
        available: selection.selected.length - missing.length,
      },
    );
  }

  const auditWriter = createAuditWriter({ clock: deps.clock });
  const expiresAt =
    version.timeLimitMinutes === null
      ? new Date(now.getTime() + (deps.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS))
      : new Date(now.getTime() + version.timeLimitMinutes * 60 * 1000);

  await prisma.$transaction(async (tx: TransactionClient) => {
    await tx.quizSession.create({
      data: {
        id: sessionId,
        learnerUserId: learner.userId,
        assessmentId: args.assessmentId,
        assessmentVersionId: version.id,
        eligibilitySnapshotId: snapshot.id,
        mode: 'SCORED',
        status: 'IN_PROGRESS',
        // Stored, so the selection is reproducible (§6.1).
        selectionSeed: selection.seed,
        totalQuestions: selection.selected.length,
        currentIndex: 0,
        startedAt: now,
        expiresAt,
        lastActivityAt: now,
        writeSequence: 0,
        attemptNumber: attemptsUsed + 1,
        idempotencyKey: args.idempotencyKey ?? null,
        correlationId: learner.correlationId,
      },
    });

    for (const [index, question] of selection.selected.entries()) {
      const source = keyByQuestionId.get(question.questionId);
      if (!source) continue;
      await tx.quizSessionQuestion.create({
        data: {
          sessionId,
          presentationIndex: index,
          questionId: question.questionId,
          // Pinned: the version served is the version the approver pinned.
          publishedVersion: question.publishedVersion,
          questionType: source.question.questionType,
          questionText: source.question.questionText,
          // The answer key, server-side only.
          answerPayload: source.question.answerPayload as object,
          explanation: source.question.explanation,
          domainId: source.domainId,
          topicId: source.topicId,
          learningObjectiveId: source.learningObjectiveId,
          sourceReferences: {
            documentName: source.question.sourceDocumentName,
            url: source.question.sourceUrl,
            sectionKey: source.question.sectionKey,
            supportingEvidence: source.question.supportingEvidence,
          },
          snapshotAt: now,
        },
      });
    }

    await auditWriter.write(tx, {
      action: 'LEARNING.SESSION.CREATED',
      outcome: 'SUCCESS',
      actorType: 'USER',
      actorUserId: learner.userId,
      actorDisplayName: learner.displayName,
      actorRoles: [...learner.roles],
      entityType: 'QuizSession',
      entityId: sessionId,
      entityLabel: sessionId,
      domainId: assessment.domainId,
      correlationId: learner.correlationId,
      requestId: learner.requestId,
      portal: 'LIVE',
      detail: {
        assessmentVersionId: version.id,
        attemptNumber: attemptsUsed + 1,
        totalQuestions: selection.selected.length,
        strategy: selection.strategy,
        poolSize: pool.length,
      },
    });
  });

  const current = await currentQuestion({ deps, learner, sessionId });
  return {
    sessionId,
    totalQuestions: selection.selected.length,
    currentIndex: 0,
    expiresAt,
    attemptNumber: attemptsUsed + 1,
    firstQuestion: current.question,
    resumed: false,
  };
};

/**
 * A deterministic session id.
 *
 * The seed IS the session id (§6.1), so deriving it from the learner, version,
 * attempt, and any client idempotency key means a retried start request
 * resumes the same session instead of creating a second one with a different
 * question set.
 */
export const deriveSessionId = (args: {
  readonly learnerUserId: string;
  readonly assessmentVersionId: string;
  readonly attemptNumber: number;
  readonly idempotencyKey: string | null;
}): string => {
  const digest = createHash('sha256')
    .update(
      `${args.learnerUserId}|${args.assessmentVersionId}|${args.attemptNumber}|${args.idempotencyKey ?? ''}`,
      'utf8',
    )
    .digest('hex');
  // Formatted as a UUID so it fits the column, with version 4 and the RFC
  // variant bits set. It is derived, not random — that is the point.
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `4${digest.slice(13, 16)}`,
    `${((Number.parseInt(digest.slice(16, 17), 16) & 0x3) | 0x8).toString(16)}${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join('-');
};

// ---------------------------------------------------------------------------
// Reading the current question

export interface CurrentQuestionResult {
  readonly sessionId: string;
  readonly status: SessionStatus;
  readonly currentIndex: number;
  readonly totalQuestions: number;
  readonly answeredCount: number;
  readonly remainingSeconds: number | null;
  readonly question: LearnerQuestionDto;
  readonly allowBackNavigation: boolean;
}

const loadSession = async (prisma: PrismaClient, learnerUserId: string, sessionId: string) => {
  const session = await prisma.quizSession.findFirst({
    // Scoped to the learner: a session id is not an authorization token.
    where: { id: sessionId, learnerUserId },
    include: {
      assessmentVersion: {
        select: {
          allowBackNavigation: true,
          passPercentage: true,
          proficiencyThresholds: true,
          scoreOnExpiry: true,
        },
      },
    },
  });
  if (!session) throw new SessionNotFoundError(sessionId);
  return session;
};

export const currentQuestion = async (args: {
  readonly deps: SessionDeps;
  readonly learner: LearnerContext;
  readonly sessionId: string;
}): Promise<CurrentQuestionResult> => {
  const session = await loadSession(args.deps.prisma, args.learner.userId, args.sessionId);

  // A session legitimately sits at currentIndex === totalQuestions: §4.5
  // advances the cursor past each saved answer, so answering the last question
  // leaves the cursor one past the end, and the session stays IN_PROGRESS
  // until the learner presses Finish. §4.4 requires the resume to work — and
  // that is the state a learner is MOST likely to come back to, because it is
  // what closing the tab after the last question produces.
  //
  // So "one past the end" presents the LAST question, with the answer already
  // saved against it. The caller sees answeredCount === totalQuestions and
  // offers completion. Reading the raw cursor threw NOT_FOUND here, which made
  // a fully answered attempt the one attempt that could not be reopened.
  const presentationIndex =
    session.totalQuestions > 0
      ? Math.min(session.currentIndex, session.totalQuestions - 1)
      : session.currentIndex;

  const snapshot = await args.deps.prisma.quizSessionQuestion.findFirst({
    where: { sessionId: session.id, presentationIndex },
  });
  if (!snapshot) {
    throw new SessionNotFoundError(
      `${args.sessionId} (no snapshot question at index ${presentationIndex})`,
    );
  }

  const latest = await args.deps.prisma.quizResponse.findFirst({
    where: { sessionId: session.id, presentationIndex, isLatest: true },
  });
  const answeredCount = await args.deps.prisma.quizResponse.count({
    where: { sessionId: session.id, isLatest: true },
  });

  const question = toLearnerQuestion(
    snapshot,
    latest === null
      ? null
      : {
          selectedOption:
            (latest.responsePayload as { selectedOption?: string }).selectedOption ?? null,
          isFlagged: latest.isFlagged,
        },
  );
  assertNoAnswerKey(question, 'the current-question response');

  return {
    sessionId: session.id,
    status: session.status,
    // The index of the question actually being presented, which is the clamped
    // one. Reporting the raw cursor here would render as "Question 5 of 4".
    currentIndex: presentationIndex,
    totalQuestions: session.totalQuestions,
    answeredCount,
    // §4.7: the SERVER holds the deadline; the client renders a countdown from
    // this. Client clock skew cannot extend an attempt.
    remainingSeconds:
      session.expiresAt === null
        ? null
        : Math.max(
            0,
            Math.floor((session.expiresAt.getTime() - args.deps.clock.now().getTime()) / 1000),
          ),
    question,
    allowBackNavigation: session.assessmentVersion.allowBackNavigation,
  };
};

/** §4.4: state lives entirely server-side, so resume is just a read. */
export const resumeSession = async (args: {
  readonly deps: SessionDeps;
  readonly learner: LearnerContext;
  readonly sessionId: string;
}): Promise<Omit<StartedSession, 'resumed'>> => {
  const session = await loadSession(args.deps.prisma, args.learner.userId, args.sessionId);
  const current = await currentQuestion(args);
  return {
    sessionId: session.id,
    totalQuestions: session.totalQuestions,
    // From the presented question, not the raw cursor: the two differ once
    // every question has been answered.
    currentIndex: current.currentIndex,
    expiresAt: session.expiresAt,
    attemptNumber: session.attemptNumber,
    firstQuestion: current.question,
  };
};

// ---------------------------------------------------------------------------
// Answering

export interface SubmitAnswerArgs {
  readonly deps: SessionDeps;
  readonly learner: LearnerContext;
  readonly sessionId: string;
  readonly presentationIndex: number;
  readonly selectedOption: OptionLetter;
  readonly clientElapsedMs?: number;
  readonly isFlagged?: boolean;
  /** §4.5: per (session, index, submission). A repeat returns the original. */
  readonly idempotencyKey: string;
  /** Monotonic; an out-of-order write is rejected rather than applied. */
  readonly writeSequence?: number;
}

export interface SubmitAnswerResult {
  readonly sessionId: string;
  readonly savedIndex: number;
  readonly revision: number;
  readonly completed: boolean;
  readonly nextQuestion: LearnerQuestionDto | null;
  readonly answeredCount: number;
  readonly totalQuestions: number;
  readonly replayed: boolean;
}

export const submitAnswer = async (args: SubmitAnswerArgs): Promise<SubmitAnswerResult> => {
  const { deps, learner } = args;
  const prisma = deps.prisma;
  const session = await loadSession(prisma, learner.userId, args.sessionId);

  if (session.status !== 'IN_PROGRESS') throw new SessionNotActiveError(session.status);

  const now = deps.clock.now();
  if (session.expiresAt !== null && session.expiresAt <= now) {
    // §4.7: on expiry the server refuses further answers. Expiring here rather
    // than waiting for a sweeper means the refusal is immediate and honest.
    await expireSession({ deps, learner, sessionId: session.id });
    throw new SessionNotActiveError('EXPIRED');
  }

  if (args.presentationIndex < 0 || args.presentationIndex >= session.totalQuestions) {
    throw new NotEligibleError(
      'VALIDATION_FAILED',
      `Question index ${args.presentationIndex} is outside this session (0-${session.totalQuestions - 1}).`,
    );
  }
  if (
    !session.assessmentVersion.allowBackNavigation &&
    args.presentationIndex < session.currentIndex
  ) {
    throw new NotEligibleError(
      'VALIDATION_FAILED',
      'This assessment does not permit going back to an earlier question.',
    );
  }

  // Idempotency FIRST: a double-click returns the original result rather than
  // writing a second revision (§4.5).
  const replay = await prisma.quizResponse.findFirst({
    where: { sessionId: session.id, idempotencyKey: args.idempotencyKey },
  });
  if (replay) {
    const answered = await prisma.quizResponse.count({
      where: { sessionId: session.id, isLatest: true },
    });
    return {
      sessionId: session.id,
      savedIndex: replay.presentationIndex,
      revision: replay.revision,
      completed: session.currentIndex >= session.totalQuestions,
      nextQuestion: await nextQuestionOrNull(deps, session.id, session.currentIndex),
      answeredCount: answered,
      totalQuestions: session.totalQuestions,
      replayed: true,
    };
  }

  const expectedSequence = session.writeSequence + 1;
  if (args.writeSequence !== undefined && args.writeSequence !== expectedSequence) {
    throw new SequenceConflictError(expectedSequence, args.writeSequence);
  }

  const priorRevisions = await prisma.quizResponse.count({
    where: { sessionId: session.id, presentationIndex: args.presentationIndex },
  });

  const auditWriter = createAuditWriter({ clock: deps.clock });

  const outcome = await prisma.$transaction(async (tx: TransactionClient) => {
    // A change is a NEW REVISION with the prior value retained (§4.3), so the
    // answer history is never overwritten.
    if (priorRevisions > 0) {
      await tx.quizResponse.updateMany({
        where: { sessionId: session.id, presentationIndex: args.presentationIndex, isLatest: true },
        data: { isLatest: false },
      });
    }

    const saved = await tx.quizResponse.create({
      data: {
        sessionId: session.id,
        presentationIndex: args.presentationIndex,
        revision: priorRevisions + 1,
        // No correctness in the payload: the response records what the learner
        // chose, and scoring compares it to the snapshot later.
        responsePayload: { type: 'MULTIPLE_CHOICE_4', selectedOption: args.selectedOption },
        isLatest: true,
        answeredAt: now,
        clientElapsedMs: args.clientElapsedMs ?? null,
        serverElapsedMs: Math.max(0, now.getTime() - session.lastActivityAt.getTime()),
        isFlagged: args.isFlagged ?? false,
        writeSequence: expectedSequence,
        idempotencyKey: args.idempotencyKey,
      },
      select: { revision: true, presentationIndex: true },
    });

    // The cursor only ever moves FORWARD past an answered question. Answering
    // question 2 again does not rewind the learner.
    const nextIndex = Math.max(
      session.currentIndex,
      args.presentationIndex === session.currentIndex
        ? session.currentIndex + 1
        : session.currentIndex,
    );

    await tx.quizSession.update({
      where: { id: session.id },
      data: {
        currentIndex: Math.min(nextIndex, session.totalQuestions),
        writeSequence: expectedSequence,
        lastActivityAt: now,
      },
    });

    await auditWriter.write(tx, {
      action: 'LEARNING.SESSION.ANSWER_SAVED',
      outcome: 'SUCCESS',
      actorType: 'USER',
      actorUserId: learner.userId,
      actorDisplayName: learner.displayName,
      actorRoles: [...learner.roles],
      entityType: 'QuizSession',
      entityId: session.id,
      entityLabel: session.id,
      correlationId: learner.correlationId,
      requestId: learner.requestId,
      portal: 'LIVE',
      // The CHOICE is not audited: audit-model.md §8 keeps per-answer content
      // out of a seven-year store. It lives on QuizResponse with a two-year
      // retention. What is audited is that an answer was saved, and where.
      detail: {
        presentationIndex: args.presentationIndex,
        revision: saved.revision,
        writeSequence: expectedSequence,
      },
    });

    return { revision: saved.revision, nextIndex: Math.min(nextIndex, session.totalQuestions) };
  });

  const answeredCount = await prisma.quizResponse.count({
    where: { sessionId: session.id, isLatest: true },
  });
  const completed = outcome.nextIndex >= session.totalQuestions;

  return {
    sessionId: session.id,
    savedIndex: args.presentationIndex,
    revision: outcome.revision,
    completed,
    nextQuestion: completed ? null : await nextQuestionOrNull(deps, session.id, outcome.nextIndex),
    answeredCount,
    totalQuestions: session.totalQuestions,
    replayed: false,
  };
};

const nextQuestionOrNull = async (
  deps: SessionDeps,
  sessionId: string,
  index: number,
): Promise<LearnerQuestionDto | null> => {
  const snapshot = await deps.prisma.quizSessionQuestion.findFirst({
    where: { sessionId, presentationIndex: index },
  });
  if (!snapshot) return null;
  const latest = await deps.prisma.quizResponse.findFirst({
    where: { sessionId, presentationIndex: index, isLatest: true },
  });
  const question = toLearnerQuestion(
    snapshot,
    latest === null
      ? null
      : {
          selectedOption:
            (latest.responsePayload as { selectedOption?: string }).selectedOption ?? null,
          isFlagged: latest.isFlagged,
        },
  );
  assertNoAnswerKey(question, 'the next-question response');
  return question;
};

// ---------------------------------------------------------------------------
// Completion and scoring

export interface CompletionResult {
  readonly sessionId: string;
  readonly resultId: string;
  readonly totalQuestions: number;
  readonly correctAnswers: number;
  readonly incorrectAnswers: number;
  readonly unansweredCount: number;
  readonly percentageScore: number;
  readonly passed: boolean;
  readonly proficiencyBand: string;
  readonly resultState: string;
  readonly timeTakenSeconds: number;
  readonly topics: readonly {
    readonly topicId: string;
    readonly questionsAsked: number;
    readonly correct: number;
    readonly topicAccuracy: number;
    readonly topicBand: string;
    readonly isKnowledgeGap: boolean;
    readonly gapState: string;
  }[];
  readonly knowledgeGaps: readonly string[];
  readonly replayed: boolean;
}

export interface CompleteSessionArgs {
  readonly deps: SessionDeps;
  readonly learner: LearnerContext;
  readonly sessionId: string;
  readonly gapThreshold?: number;
  readonly minTopicQuestions?: number;
  /** EXPIRED when an expiry sweep completes the session rather than a learner. */
  readonly resultState?: 'SCORED' | 'EXPIRED' | 'ABANDONED';
}

export const completeSession = async (args: CompleteSessionArgs): Promise<CompletionResult> => {
  const { deps, learner } = args;
  const prisma = deps.prisma;
  const session = await loadSession(prisma, learner.userId, args.sessionId);

  // §4.5: "POST /sessions/{id}/complete is idempotent; a second call returns
  // the existing result ID."
  const existing = await prisma.assessmentResult.findUnique({
    where: { sessionId: session.id },
    include: { topicResults: true },
  });
  if (existing) {
    return {
      sessionId: session.id,
      resultId: existing.id,
      totalQuestions: existing.totalQuestions,
      correctAnswers: existing.correctAnswers,
      incorrectAnswers: existing.incorrectAnswers,
      unansweredCount: existing.unansweredCount,
      percentageScore: Number(existing.percentageScore),
      passed: existing.passed,
      proficiencyBand: existing.proficiencyBand,
      resultState: existing.resultState,
      timeTakenSeconds: existing.timeTakenSeconds,
      topics: existing.topicResults.map((topic) => ({
        topicId: topic.topicId,
        questionsAsked: topic.questionsAsked,
        correct: topic.correct,
        topicAccuracy: Number(topic.topicAccuracy),
        topicBand: topic.topicBand,
        isKnowledgeGap: topic.isKnowledgeGap,
        gapState: topic.gapState,
      })),
      knowledgeGaps: existing.topicResults
        .filter((topic) => topic.isKnowledgeGap)
        .map((topic) => topic.topicId),
      replayed: true,
    };
  }

  if (session.status !== 'IN_PROGRESS' && args.resultState === undefined) {
    throw new SessionNotActiveError(session.status);
  }

  // Scored from the SNAPSHOT, so the attempt is reproducible years later even
  // if the question has since been edited or retired (§4.2).
  const snapshotQuestions = await prisma.quizSessionQuestion.findMany({
    where: { sessionId: session.id },
    orderBy: { presentationIndex: 'asc' },
  });
  const responses = await prisma.quizResponse.findMany({
    where: { sessionId: session.id, isLatest: true },
  });

  const questions: SnapshotQuestion[] = snapshotQuestions.map((row) => {
    const payload = row.answerPayload as { correctOption: string };
    return {
      presentationIndex: row.presentationIndex,
      questionId: row.questionId,
      publishedVersion: row.publishedVersion,
      topicId: row.topicId,
      learningObjectiveId: row.learningObjectiveId,
      correctOption: payload.correctOption,
    };
  });

  const score = scoreSession({
    questions,
    responses: responses.map((row) => ({
      presentationIndex: row.presentationIndex,
      selectedOption: (row.responsePayload as { selectedOption?: string }).selectedOption ?? null,
    })),
    passPercentage: Number(session.assessmentVersion.passPercentage),
    bands: session.assessmentVersion
      .proficiencyThresholds as unknown as ProficiencyBandDefinition[],
    ...(args.gapThreshold === undefined ? {} : { gapThreshold: args.gapThreshold }),
    ...(args.minTopicQuestions === undefined ? {} : { minTopicQuestions: args.minTopicQuestions }),
    ...(args.resultState === undefined ? {} : { resultState: args.resultState }),
  });

  const now = deps.clock.now();
  const timeTakenSeconds = Math.max(
    0,
    Math.floor((now.getTime() - session.startedAt.getTime()) / 1000),
  );
  const auditWriter = createAuditWriter({ clock: deps.clock });

  const resultId = await prisma.$transaction(async (tx: TransactionClient) => {
    const result = await tx.assessmentResult.create({
      data: {
        sessionId: session.id,
        learnerUserId: learner.userId,
        assessmentId: session.assessmentId,
        assessmentVersionId: session.assessmentVersionId,
        attemptNumber: session.attemptNumber,
        totalQuestions: score.totalQuestions,
        correctAnswers: score.correctAnswers,
        incorrectAnswers: score.incorrectAnswers,
        unansweredCount: score.unansweredCount,
        percentageScore: score.percentageScore,
        passed: score.passed,
        proficiencyBand: score.proficiencyBand,
        // Copied onto the result, so it stays interpretable after the
        // configuration changes (§5.3).
        appliedThresholds: score.appliedThresholds.map((band) => ({ ...band })),
        passPercentageApplied: score.passPercentageApplied,
        timeTakenSeconds,
        startedAt: session.startedAt,
        completedAt: now,
        resultState: score.resultState,
        scoringEngineVersion: score.scoringEngineVersion,
        correlationId: learner.correlationId,
      },
      select: { id: true },
    });

    for (const topic of score.topics) {
      await tx.topicResult.create({
        data: {
          resultId: result.id,
          topicId: topic.topicId,
          questionsAsked: topic.questionsAsked,
          correct: topic.correct,
          incorrect: topic.incorrect,
          unanswered: topic.unanswered,
          topicAccuracy: topic.topicAccuracy,
          topicBand: topic.topicBand,
          isKnowledgeGap: topic.isKnowledgeGap,
          gapState: topic.gapState,
        },
      });
    }

    for (const objective of score.objectives) {
      await tx.objectiveResult.create({
        data: {
          resultId: result.id,
          objectiveId: objective.objectiveId,
          questionsAsked: objective.questionsAsked,
          correct: objective.correct,
          incorrect: objective.incorrect,
          unanswered: objective.unanswered,
          accuracy: objective.accuracy,
          band: objective.band,
          // The same minimum-evidence rule as a topic: one question about an
          // objective is not enough to call it a gap (§5.4).
          gapState:
            objective.questionsAsked < (args.minTopicQuestions ?? 2)
              ? 'INSUFFICIENT_EVIDENCE'
              : objective.accuracy < (args.gapThreshold ?? DEFAULT_GAP_THRESHOLD)
                ? 'GAP'
                : 'NO_GAP',
        },
      });
    }

    await tx.quizSession.update({
      where: { id: session.id },
      data: {
        status: score.resultState === 'EXPIRED' ? 'EXPIRED' : 'COMPLETED',
        completedAt: now,
        lastActivityAt: now,
      },
    });

    await auditWriter.write(tx, {
      action: 'LEARNING.RESULT.SCORED',
      outcome: 'SUCCESS',
      actorType: 'USER',
      actorUserId: learner.userId,
      actorDisplayName: learner.displayName,
      actorRoles: [...learner.roles],
      entityType: 'AssessmentResult',
      entityId: result.id,
      entityLabel: result.id,
      correlationId: learner.correlationId,
      requestId: learner.requestId,
      portal: 'LIVE',
      detail: {
        percentageScore: score.percentageScore,
        passed: score.passed,
        proficiencyBand: score.proficiencyBand,
        totalQuestions: score.totalQuestions,
        correctAnswers: score.correctAnswers,
        unansweredCount: score.unansweredCount,
        scoringEngineVersion: score.scoringEngineVersion,
        resultState: score.resultState,
      },
    });

    return result.id;
  });

  return {
    sessionId: session.id,
    resultId,
    totalQuestions: score.totalQuestions,
    correctAnswers: score.correctAnswers,
    incorrectAnswers: score.incorrectAnswers,
    unansweredCount: score.unansweredCount,
    percentageScore: score.percentageScore,
    passed: score.passed,
    proficiencyBand: score.proficiencyBand,
    resultState: score.resultState,
    timeTakenSeconds,
    topics: score.topics.map((topic) => ({
      topicId: topic.topicId,
      questionsAsked: topic.questionsAsked,
      correct: topic.correct,
      topicAccuracy: topic.topicAccuracy,
      topicBand: topic.topicBand,
      isKnowledgeGap: topic.isKnowledgeGap,
      gapState: topic.gapState,
    })),
    knowledgeGaps: score.topics
      .filter((topic) => topic.isKnowledgeGap)
      .map((topic) => topic.topicId),
    replayed: false,
  };
};

/**
 * Expires a session — §4.4.
 *
 * SCORE_PARTIAL scores what was submitted with unanswered counted incorrect and
 * labels the result EXPIRED. VOID records no result at all, which is why the
 * two policies are distinguished rather than both scoring.
 */
export const expireSession = async (args: {
  readonly deps: SessionDeps;
  readonly learner: LearnerContext;
  readonly sessionId: string;
}): Promise<{ sessionId: string; status: SessionStatus; resultId: string | null }> => {
  const session = await loadSession(args.deps.prisma, args.learner.userId, args.sessionId);
  if (session.status !== 'IN_PROGRESS') {
    return { sessionId: session.id, status: session.status, resultId: null };
  }

  if (session.assessmentVersion.scoreOnExpiry === 'VOID') {
    const auditWriter = createAuditWriter({ clock: args.deps.clock });
    await args.deps.prisma.$transaction(async (tx: TransactionClient) => {
      await tx.quizSession.update({
        where: { id: session.id },
        data: { status: 'EXPIRED', completedAt: args.deps.clock.now() },
      });
      await auditWriter.write(tx, {
        action: 'LEARNING.SESSION.EXPIRED',
        outcome: 'SUCCESS',
        actorType: 'SYSTEM',
        actorUserId: args.learner.userId,
        actorDisplayName: args.learner.displayName,
        entityType: 'QuizSession',
        entityId: session.id,
        entityLabel: session.id,
        correlationId: args.learner.correlationId,
        requestId: args.learner.requestId,
        portal: 'LIVE',
        detail: { expiryPolicy: 'VOID', scored: false },
      });
    });
    return { sessionId: session.id, status: 'EXPIRED', resultId: null };
  }

  const result = await completeSession({ ...args, resultState: 'EXPIRED' });
  return { sessionId: session.id, status: 'EXPIRED', resultId: result.resultId };
};

/**
 * Records a recovery read — §4.2.
 *
 * "The only exception is recovery: if the snapshot row is unreadable, a
 * recovery path may re-read by QuestionID and version. ANY recovery read is
 * audited as LEARNING.SESSION.RECOVERED with the reason."
 */
export const recordSessionRecovery = async (args: {
  readonly deps: SessionDeps;
  readonly learner: LearnerContext;
  readonly sessionId: string;
  readonly reason: string;
}): Promise<{ sessionId: string; recoveryCount: number }> => {
  const session = await loadSession(args.deps.prisma, args.learner.userId, args.sessionId);
  const auditWriter = createAuditWriter({ clock: args.deps.clock });

  return args.deps.prisma.$transaction(async (tx: TransactionClient) => {
    const updated = await tx.quizSession.update({
      where: { id: session.id },
      data: { recoveryCount: { increment: 1 }, lastActivityAt: args.deps.clock.now() },
      select: { recoveryCount: true },
    });

    await auditWriter.write(tx, {
      action: 'LEARNING.SESSION.RECOVERED',
      outcome: 'SUCCESS',
      actorType: 'USER',
      actorUserId: args.learner.userId,
      actorDisplayName: args.learner.displayName,
      actorRoles: [...args.learner.roles],
      entityType: 'QuizSession',
      entityId: session.id,
      entityLabel: session.id,
      correlationId: args.learner.correlationId,
      requestId: args.learner.requestId,
      portal: 'LIVE',
      detail: { reason: args.reason, recoveryCount: updated.recoveryCount },
    });

    return { sessionId: session.id, recoveryCount: updated.recoveryCount };
  });
};

// ---------------------------------------------------------------------------

export interface ResultView {
  readonly resultId: string;
  readonly percentageScore: number;
  readonly passed: boolean;
  readonly proficiencyBand: string;
  readonly resultState: string;
  readonly totalQuestions: number;
  readonly correctAnswers: number;
  readonly incorrectAnswers: number;
  readonly unansweredCount: number;
  readonly timeTakenSeconds: number;
  readonly completedAt: Date;
  readonly attemptNumber: number;
  readonly appliedThresholds: unknown;
  readonly topics: readonly {
    readonly topicId: string;
    readonly topicName: string;
    readonly questionsAsked: number;
    readonly correct: number;
    readonly topicAccuracy: number;
    readonly topicBand: string;
    readonly isKnowledgeGap: boolean;
    readonly gapState: string;
  }[];
  readonly knowledgeGaps: readonly {
    readonly topicId: string;
    readonly topicName: string;
    readonly topicAccuracy: number;
  }[];
  /**
   * The accuracy below which a topic is a gap. The API scores every session
   * with the default, so this is the value that was applied; if a caller ever
   * passes another, it must be stored on the result and read back here.
   */
  readonly gapThreshold: number;
}

/**
 * The learner's own result.
 *
 * Answer keys and explanations are governed by `showAnswersAfterCompletion`, so
 * they are NOT part of this view: it returns performance, not content. A
 * review-answers surface is a separate read with its own gate.
 */
export const readResult = async (args: {
  readonly deps: SessionDeps;
  readonly learner: LearnerContext;
  readonly resultId: string;
}): Promise<ResultView> => {
  const result = await args.deps.prisma.assessmentResult.findFirst({
    // Own-scoped: a learner reads their own results and no one else's.
    where: { id: args.resultId, learnerUserId: args.learner.userId },
    include: { topicResults: { include: { topic: { select: { name: true } } } } },
  });
  if (!result) throw new SessionNotFoundError(args.resultId);

  const topics = result.topicResults.map((topic) => ({
    topicId: topic.topicId,
    topicName: topic.topic.name,
    questionsAsked: topic.questionsAsked,
    correct: topic.correct,
    topicAccuracy: Number(topic.topicAccuracy),
    topicBand: topic.topicBand,
    isKnowledgeGap: topic.isKnowledgeGap,
    gapState: topic.gapState,
  }));

  const view: ResultView = {
    resultId: result.id,
    percentageScore: Number(result.percentageScore),
    passed: result.passed,
    proficiencyBand: result.proficiencyBand,
    resultState: result.resultState,
    totalQuestions: result.totalQuestions,
    correctAnswers: result.correctAnswers,
    incorrectAnswers: result.incorrectAnswers,
    unansweredCount: result.unansweredCount,
    timeTakenSeconds: result.timeTakenSeconds,
    completedAt: result.completedAt,
    attemptNumber: result.attemptNumber,
    appliedThresholds: result.appliedThresholds,
    topics,
    knowledgeGaps: topics
      .filter((topic) => topic.isKnowledgeGap)
      .map((topic) => ({
        topicId: topic.topicId,
        topicName: topic.topicName,
        topicAccuracy: topic.topicAccuracy,
      })),
    gapThreshold: DEFAULT_GAP_THRESHOLD,
  };

  assertNoAnswerKey(view, 'the result response');
  return view;
};

/** One question of a finished attempt, with what the learner chose and the key. */
export interface ReviewedQuestion {
  readonly presentationIndex: number;
  readonly questionText: string;
  readonly options: Readonly<Record<string, string>>;
  readonly selectedOption: string | null;
  readonly correctOption: string;
  readonly isCorrect: boolean;
  readonly explanation: string;
}

export type ResultReview =
  | { readonly available: true; readonly questions: readonly ReviewedQuestion[] }
  | { readonly available: false; readonly reason: 'POLICY' | 'NOT_FINISHED' };

/**
 * Question review (live-learning-portal.md §6, item 3): each question of the
 * learner's OWN finished attempt with their answer, the correct answer and the
 * approved explanation.
 *
 * This is the ONE learner read that carries an answer key, and it is gated
 * three ways: the result is the caller's own; the session is TERMINAL (a
 * result exists only after scoring, and the status is checked as well, so an
 * in-progress attempt can never be reviewed -- §4.6); and the assessment
 * version allows it (`showAnswersAfterCompletion`, default true; an
 * assessment with a small pool and several attempts sets it false). It reads
 * the SESSION'S SNAPSHOT of each question, so the review shows exactly what
 * was asked, even if the question was edited or retired since.
 */
export const readResultReview = async (args: {
  readonly deps: SessionDeps;
  readonly learner: LearnerContext;
  readonly resultId: string;
}): Promise<ResultReview> => {
  const result = await args.deps.prisma.assessmentResult.findFirst({
    where: { id: args.resultId, learnerUserId: args.learner.userId },
    select: {
      session: {
        select: {
          status: true,
          assessmentVersion: { select: { showAnswersAfterCompletion: true } },
          questions: {
            orderBy: { presentationIndex: 'asc' },
            select: {
              presentationIndex: true,
              questionText: true,
              answerPayload: true,
              explanation: true,
            },
          },
          responses: {
            where: { isLatest: true },
            select: { presentationIndex: true, responsePayload: true },
          },
        },
      },
    },
  });
  if (!result) throw new SessionNotFoundError(args.resultId);
  const session = result.session;
  if (session.status === 'IN_PROGRESS') return { available: false, reason: 'NOT_FINISHED' };
  if (!session.assessmentVersion.showAnswersAfterCompletion) {
    return { available: false, reason: 'POLICY' };
  }
  const chosen = new Map(
    session.responses.map((row) => [
      row.presentationIndex,
      (row.responsePayload as { selectedOption?: string }).selectedOption ?? null,
    ]),
  );
  return {
    available: true,
    questions: session.questions.map((question) => {
      const payload = question.answerPayload as {
        options: Record<string, string>;
        correctOption: string;
      };
      const selectedOption = chosen.get(question.presentationIndex) ?? null;
      return {
        presentationIndex: question.presentationIndex,
        questionText: question.questionText,
        options: payload.options,
        selectedOption,
        correctOption: payload.correctOption,
        isCorrect: selectedOption === payload.correctOption,
        explanation: question.explanation,
      };
    }),
  };
};
