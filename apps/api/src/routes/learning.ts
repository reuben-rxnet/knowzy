// Assessment authoring and the learner quiz surface — MVP steps 6 and 7.
//
// Authoring (AUTHORING portal):
//   POST /authoring/assessments                   create a draft
//   GET  /authoring/assessments/:id/validate      the pool check, all problems
//   POST /authoring/assessments/:id/submit        DRAFT → UNDER_REVIEW
//   POST /authoring/assessments/:id/approve       → APPROVED
//   POST /authoring/assessments/:id/publish       → PUBLISHED + snapshot pinned
//
// Learning (LIVE portal):
//   GET  /learning/assessments                    what this learner may start
//   POST /learning/sessions                       start or resume
//   GET  /learning/sessions/:id                   resume state
//   GET  /learning/sessions/:id/current           one question at a time
//   POST /learning/sessions/:id/answers           persist an answer
//   POST /learning/sessions/:id/complete          score (idempotent)
//   GET  /learning/results/:id                    the learner's own result
//
// Every learning route runs through `assertNoAnswerKey` on the way out. That is
// the K3 backstop; the real control is that the learner projection is built
// from an explicit field list (§4.6).

import { z } from 'zod';
import type { FastifyReply } from 'fastify';
import type { ErrorCode } from '@knowzy/shared-types';
import {
  assertNoAnswerKey,
  completeSession,
  createAssessment,
  currentQuestion,
  publishAssessmentVersion,
  readResult,
  recordSessionRecovery,
  resumeSession,
  startSession,
  submitAnswer,
  transitionAssessmentVersion,
  validateAssessmentVersion,
  AssessmentConfigError,
  AssessmentNotFoundError,
  InvalidBandSetError,
  NotEligibleError,
  PoolInsufficientError,
  SequenceConflictError,
  SessionNotActiveError,
  SessionNotFoundError,
} from '@knowzy/domain';
import { systemClock } from '@knowzy/observability';
import { defineRoute, type RouteContext, type RouteDeps } from '../http/route.js';
import { toProblem } from '../http/problem.js';

const problemReply = (
  reply: FastifyReply,
  ctx: RouteContext,
  instance: string,
  code: ErrorCode,
  detail: string,
  details?: Record<string, unknown>,
): FastifyReply => {
  const problem = toProblem({
    code,
    correlationId: ctx.correlationId,
    instance,
    detail,
    ...(details === undefined ? {} : { details }),
  });
  return reply.status(problem.status).type('application/problem+json').send(problem);
};

const replyFromLearningError = (
  error: unknown,
  ctx: RouteContext,
  reply: FastifyReply,
  instance: string,
): FastifyReply => {
  if (error instanceof PoolInsufficientError) {
    return problemReply(reply, ctx, instance, 'ASSESSMENT_POOL_INSUFFICIENT', error.message, {
      shortfall: error.shortfall,
    });
  }
  if (error instanceof SessionNotActiveError) {
    return problemReply(reply, ctx, instance, 'SESSION_NOT_ACTIVE', error.message);
  }
  if (error instanceof SequenceConflictError) {
    return problemReply(reply, ctx, instance, 'SESSION_SEQUENCE_CONFLICT', error.message);
  }
  if (error instanceof SessionNotFoundError || error instanceof AssessmentNotFoundError) {
    return problemReply(reply, ctx, instance, 'NOT_FOUND', error.message);
  }
  if (error instanceof InvalidBandSetError || error instanceof AssessmentConfigError) {
    // No dedicated code exists and this is an ordinary configuration refusal,
    // so VALIDATION_FAILED carries it with the precise detail.
    return problemReply(reply, ctx, instance, 'VALIDATION_FAILED', error.message);
  }
  if (error instanceof NotEligibleError) {
    // ASSESSMENT_NOT_ELIGIBLE already covers every eligibility condition in
    // §3.2 — closed window, attempt limit, missing version. The specific
    // reason travels in `detail`, which is what the learner card shows.
    const code: ErrorCode =
      error.code === 'FORBIDDEN'
        ? 'FORBIDDEN'
        : error.code === 'VALIDATION_FAILED'
          ? 'VALIDATION_FAILED'
          : 'ASSESSMENT_NOT_ELIGIBLE';
    return problemReply(reply, ctx, instance, code, error.message);
  }
  throw error;
};

const actorFrom = (ctx: RouteContext) => ({
  userId: ctx.subject.userId,
  displayName: ctx.subject.displayName,
  roles: ctx.subject.roles,
  permissions: ctx.subject.permissions,
  correlationId: ctx.correlationId,
  requestId: ctx.requestId,
});

const sessionDeps = (deps: RouteDeps) => ({ prisma: deps.prisma, clock: systemClock });

const IdParams = z.object({ assessmentVersionId: z.string().uuid() });
const SessionParams = z.object({ sessionId: z.string().uuid() });

export const learningRoutes = [
  // ------------------------------------------------------------- authoring

  defineRoute({
    method: 'GET',
    url: '/api/v1/authoring/taxonomy',
    policy: 'taxonomy.read',
    portal: 'AUTHORING',
    summary: 'The active domain and topic catalogue, for selection by name.',
    handler: async (ctx, _request, _reply, deps) => {
      const [domains, departments, jobRoles] = await Promise.all([
        deps.prisma.domain.findMany({
          where: {
            isActive: true,
            ...(ctx.scope.domainIds.length > 0 ? { id: { in: [...ctx.scope.domainIds] } } : {}),
          },
          orderBy: { name: 'asc' },
          include: { topics: { where: { isActive: true }, orderBy: { name: 'asc' } } },
        }),
        // NOT scoped by DataScope: a department is a filing label, not a
        // security boundary. Scoping it would silently hide half an
        // organization's filing options and look like a bug.
        deps.prisma.department.findMany({
          where: { isActive: true },
          orderBy: { name: 'asc' },
          select: { id: true, code: true, name: true },
        }),
        deps.prisma.jobRole.findMany({
          where: { isActive: true },
          orderBy: { name: 'asc' },
          select: { id: true, code: true, name: true },
        }),
      ]);

      return {
        domains: domains.map((domain) => ({
          domainId: domain.id,
          code: domain.code,
          name: domain.name,
          requireSmeSignoff: domain.requireSmeSignoff,
          topics: domain.topics.map((topic) => ({
            topicId: topic.id,
            name: topic.name,
            slug: topic.slug,
          })),
        })),
        // The organizational axes, ACTIVE ONLY, for the same reason the domains
        // above are: a selection surface that offers a deactivated entry lets
        // somebody file against it, which is what deactivation exists to stop.
        departments: departments.map((row) => ({
          departmentId: row.id,
          code: row.code,
          name: row.name,
        })),
        jobRoles: jobRoles.map((row) => ({
          jobRoleId: row.id,
          code: row.code,
          name: row.name,
        })),
      };
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/api/v1/authoring/assessments',
    policy: 'assessment.read',
    portal: 'AUTHORING',
    summary: 'Assessments with their published version and pinned pool size.',
    handler: async (ctx, _request, _reply, deps) => {
      const assessments = await deps.prisma.assessment.findMany({
        where: {
          ...(ctx.scope.domainIds.length > 0 ? { domainId: { in: [...ctx.scope.domainIds] } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          domain: { select: { name: true } },
          versions: {
            orderBy: { versionNumber: 'desc' },
            take: 1,
            include: {
              snapshots: { orderBy: { snapshotAt: 'desc' }, take: 1 },
              _count: { select: { sessions: true } },
            },
          },
        },
      });

      return {
        count: assessments.length,
        assessments: assessments.map((assessment) => {
          const version = assessment.versions[0];
          const snapshot = version?.snapshots[0];
          const pool = (snapshot?.poolMembers ?? []) as unknown[];
          return {
            assessmentId: assessment.id,
            name: assessment.name,
            domain: assessment.domain.name,
            status: assessment.status,
            assessmentVersionId: version?.id ?? null,
            versionNumber: version?.versionNumber ?? null,
            versionStatus: version?.status ?? null,
            questionCount: version?.questionCount ?? null,
            passPercentage: version === undefined ? null : Number(version.passPercentage),
            // The PINNED pool, which is what a session may draw from — not the
            // live pool, which may since have grown or shrunk.
            pinnedPoolSize: snapshot === undefined ? null : pool.length,
            sessionCount: version?._count.sessions ?? 0,
          };
        }),
      };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/api/v1/authoring/assessments',
    policy: 'assessment.manage',
    portal: 'AUTHORING',
    summary: 'Creates a draft assessment and its first version.',
    handler: async (ctx, request, reply, deps) => {
      const body = z
        .object({
          name: z.string().min(3).max(200),
          slug: z
            .string()
            .min(3)
            .max(120)
            .regex(/^[a-z0-9-]+$/, 'lowercase letters, digits, and hyphens only'),
          domainId: z.string().uuid(),
          description: z.string().max(2_000).optional(),
          topicIds: z.array(z.string().uuid()).min(1).max(50),
          questionCount: z.number().int().min(1).max(200),
          selectionStrategy: z
            .enum(['FIXED_SET', 'RANDOM_POOL', 'TOPIC_BALANCED', 'TOPIC_DISTRIBUTION'])
            .default('RANDOM_POOL'),
          passPercentage: z.number().min(0).max(100).default(70),
          timeLimitMinutes: z.number().int().min(1).max(600).optional(),
          attemptLimit: z.number().int().min(1).max(100).optional(),
          allowBackNavigation: z.boolean().optional(),
          // FIXED_SET: the exact published questions, in order. The question
          // count becomes the list's length.
          questionIds: z.array(z.string().uuid()).min(1).max(200).optional(),
        })
        .strict()
        .safeParse(request.body ?? {});
      if (!body.success) {
        const field = body.error.issues[0]?.path.join('.') ?? 'body';
        return problemReply(
          reply,
          ctx,
          request.url,
          'VALIDATION_FAILED',
          `The field "${field}" is missing or invalid.`,
        );
      }

      try {
        return await createAssessment({
          prisma: deps.prisma,
          clock: systemClock,
          actor: actorFrom(ctx),
          name: body.data.name,
          slug: body.data.slug,
          domainId: body.data.domainId,
          ...(body.data.description === undefined ? {} : { description: body.data.description }),
          topicIds: body.data.topicIds,
          questionCount: body.data.questionCount,
          selectionStrategy: body.data.selectionStrategy,
          passPercentage: body.data.passPercentage,
          ...(body.data.timeLimitMinutes === undefined
            ? {}
            : { timeLimitMinutes: body.data.timeLimitMinutes }),
          ...(body.data.attemptLimit === undefined ? {} : { attemptLimit: body.data.attemptLimit }),
          ...(body.data.allowBackNavigation === undefined
            ? {}
            : { allowBackNavigation: body.data.allowBackNavigation }),
          ...(body.data.questionIds === undefined
            ? {}
            : { fixedQuestionIds: body.data.questionIds }),
        });
      } catch (error) {
        return replyFromLearningError(error, ctx, reply, request.url);
      }
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/api/v1/authoring/assessments/:assessmentVersionId/validate',
    policy: 'assessment.read',
    portal: 'AUTHORING',
    summary: 'Validates a version against the live published-question pool.',
    handler: async (ctx, request, reply, deps) => {
      const params = IdParams.safeParse(request.params);
      if (!params.success) {
        return problemReply(
          reply,
          ctx,
          request.url,
          'VALIDATION_FAILED',
          'A version id is required.',
        );
      }
      try {
        const result = await validateAssessmentVersion(
          deps.prisma,
          params.data.assessmentVersionId,
        );
        return {
          ...result,
          // Every problem at once, so an author is not fixing one shortfall per
          // round trip.
          advisory:
            'Re-validated at submit and at publish. A pool that shrinks after this check will block publication.',
        };
      } catch (error) {
        return replyFromLearningError(error, ctx, reply, request.url);
      }
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/api/v1/authoring/assessments/:assessmentVersionId/submit',
    policy: 'assessment.manage',
    portal: 'AUTHORING',
    summary: 'Submits an assessment version for approval.',
    handler: async (ctx, request, reply, deps) => {
      const params = IdParams.safeParse(request.params);
      if (!params.success) {
        return problemReply(
          reply,
          ctx,
          request.url,
          'VALIDATION_FAILED',
          'A version id is required.',
        );
      }
      try {
        return await transitionAssessmentVersion({
          prisma: deps.prisma,
          clock: systemClock,
          actor: actorFrom(ctx),
          assessmentVersionId: params.data.assessmentVersionId,
          to: 'UNDER_REVIEW',
        });
      } catch (error) {
        return replyFromLearningError(error, ctx, reply, request.url);
      }
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/api/v1/authoring/assessments/:assessmentVersionId/approve',
    policy: 'assessment.publish',
    portal: 'AUTHORING',
    summary: 'Approves an assessment version.',
    handler: async (ctx, request, reply, deps) => {
      const params = IdParams.safeParse(request.params);
      if (!params.success) {
        return problemReply(
          reply,
          ctx,
          request.url,
          'VALIDATION_FAILED',
          'A version id is required.',
        );
      }
      try {
        return await transitionAssessmentVersion({
          prisma: deps.prisma,
          clock: systemClock,
          actor: actorFrom(ctx),
          assessmentVersionId: params.data.assessmentVersionId,
          to: 'APPROVED',
        });
      } catch (error) {
        return replyFromLearningError(error, ctx, reply, request.url);
      }
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/api/v1/authoring/assessments/:assessmentVersionId/publish',
    policy: 'assessment.publish',
    portal: 'AUTHORING',
    summary: 'Publishes a version and pins its eligibility snapshot.',
    handler: async (ctx, request, reply, deps) => {
      const params = IdParams.safeParse(request.params);
      if (!params.success) {
        return problemReply(
          reply,
          ctx,
          request.url,
          'VALIDATION_FAILED',
          'A version id is required.',
        );
      }
      try {
        const published = await publishAssessmentVersion({
          prisma: deps.prisma,
          clock: systemClock,
          actor: actorFrom(ctx),
          assessmentVersionId: params.data.assessmentVersionId,
        });
        return {
          ...published,
          note: 'The question set is pinned. A later republication of a question will not enter this release.',
        };
      } catch (error) {
        return replyFromLearningError(error, ctx, reply, request.url);
      }
    },
  }),

  // -------------------------------------------------------------- learning

  defineRoute({
    method: 'GET',
    url: '/api/v1/learning/assessments',
    policy: 'learning.assessment.list',
    portal: 'LIVE',
    summary: 'The assessments this learner may start, with a reason when they may not.',
    handler: async (ctx, _request, _reply, deps) => {
      const assessments = await deps.prisma.assessment.findMany({
        where: {
          status: 'ACTIVE',
          ...(ctx.scope.domainIds.length > 0 ? { domainId: { in: [...ctx.scope.domainIds] } } : {}),
        },
        include: {
          domain: { select: { name: true } },
          versions: { where: { status: 'PUBLISHED' }, orderBy: { versionNumber: 'desc' }, take: 1 },
        },
      });

      const now = systemClock.now();
      const items = await Promise.all(
        assessments.map(async (assessment) => {
          const version = assessment.versions[0];
          const attemptsUsed = await deps.prisma.assessmentResult.count({
            where: { learnerUserId: ctx.subject.userId, assessmentId: assessment.id },
          });
          const inProgress = await deps.prisma.quizSession.findFirst({
            where: {
              learnerUserId: ctx.subject.userId,
              assessmentId: assessment.id,
              status: 'IN_PROGRESS',
            },
            select: { id: true, currentIndex: true, totalQuestions: true },
          });

          // §3.2: "When an assessment is visible but not startable, the card
          // states the SPECIFIC REASON rather than disabling the button
          // silently."
          let blockedReason: string | null = null;
          if (!version) blockedReason = 'This assessment has no published version yet.';
          else if (version.availabilityStart && version.availabilityStart > now) {
            blockedReason = `Opens ${version.availabilityStart.toISOString()}.`;
          } else if (version.availabilityEnd && version.availabilityEnd < now) {
            blockedReason = 'This assessment has closed.';
          } else if (version.attemptLimit !== null && attemptsUsed >= version.attemptLimit) {
            blockedReason = `You have used all ${version.attemptLimit} attempt(s).`;
          }

          return {
            assessmentId: assessment.id,
            name: assessment.name,
            description: assessment.description,
            domain: assessment.domain.name,
            questionCount: version?.questionCount ?? null,
            passPercentage: version === undefined ? null : Number(version.passPercentage),
            timeLimitMinutes: version?.timeLimitMinutes ?? null,
            attemptsUsed,
            attemptLimit: version?.attemptLimit ?? null,
            startable: blockedReason === null,
            blockedReason,
            // §4.4: "The learner home surfaces any IN_PROGRESS session
            // prominently."
            inProgressSession:
              inProgress === null
                ? null
                : {
                    sessionId: inProgress.id,
                    answeredOf: `${inProgress.currentIndex} of ${inProgress.totalQuestions}`,
                  },
          };
        }),
      );

      const payload = { count: items.length, assessments: items };
      assertNoAnswerKey(payload, 'the assessment list');
      return payload;
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/api/v1/learning/sessions',
    policy: 'learning.session.create',
    portal: 'LIVE',
    summary: 'Starts a quiz session, or resumes the learner’s existing one.',
    handler: async (ctx, request, reply, deps) => {
      const body = z
        .object({ assessmentId: z.string().uuid() })
        .strict()
        .safeParse(request.body ?? {});
      if (!body.success) {
        return problemReply(
          reply,
          ctx,
          request.url,
          'VALIDATION_FAILED',
          'An assessmentId is required.',
        );
      }
      const idempotencyKey = request.headers['idempotency-key'];

      try {
        const started = await startSession({
          deps: sessionDeps(deps),
          learner: actorFrom(ctx),
          assessmentId: body.data.assessmentId,
          ...(typeof idempotencyKey === 'string' && idempotencyKey.length >= 8
            ? { idempotencyKey }
            : {}),
        });
        assertNoAnswerKey(started, 'the session-start response');
        return reply.status(started.resumed ? 200 : 201).send(started);
      } catch (error) {
        return replyFromLearningError(error, ctx, reply, request.url);
      }
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/api/v1/learning/sessions/:sessionId',
    policy: 'learning.session.own',
    portal: 'LIVE',
    summary: 'Resumes a session: the exact position and every saved answer.',
    handler: async (ctx, request, reply, deps) => {
      const params = SessionParams.safeParse(request.params);
      if (!params.success) {
        return problemReply(
          reply,
          ctx,
          request.url,
          'VALIDATION_FAILED',
          'A session id is required.',
        );
      }
      try {
        const resumed = await resumeSession({
          deps: sessionDeps(deps),
          learner: actorFrom(ctx),
          sessionId: params.data.sessionId,
        });
        // Every saved answer, so the client can restore its own review state
        // without holding any answer state of its own.
        const answers = await deps.prisma.quizResponse.findMany({
          where: { sessionId: params.data.sessionId, isLatest: true },
          orderBy: { presentationIndex: 'asc' },
          select: {
            presentationIndex: true,
            responsePayload: true,
            isFlagged: true,
            answeredAt: true,
          },
        });
        const payload = {
          ...resumed,
          savedAnswers: answers.map((answer) => ({
            presentationIndex: answer.presentationIndex,
            selectedOption:
              (answer.responsePayload as { selectedOption?: string }).selectedOption ?? null,
            isFlagged: answer.isFlagged,
            answeredAt: answer.answeredAt,
          })),
        };
        assertNoAnswerKey(payload, 'the session-resume response');
        return payload;
      } catch (error) {
        return replyFromLearningError(error, ctx, reply, request.url);
      }
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/api/v1/learning/sessions/:sessionId/current',
    policy: 'learning.session.own',
    portal: 'LIVE',
    summary: 'The current question, one at a time.',
    handler: async (ctx, request, reply, deps) => {
      const params = SessionParams.safeParse(request.params);
      if (!params.success) {
        return problemReply(
          reply,
          ctx,
          request.url,
          'VALIDATION_FAILED',
          'A session id is required.',
        );
      }
      try {
        const current = await currentQuestion({
          deps: sessionDeps(deps),
          learner: actorFrom(ctx),
          sessionId: params.data.sessionId,
        });
        assertNoAnswerKey(current, 'the current-question response');
        return current;
      } catch (error) {
        return replyFromLearningError(error, ctx, reply, request.url);
      }
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/api/v1/learning/sessions/:sessionId/answers',
    policy: 'learning.session.own',
    portal: 'LIVE',
    summary: 'Persists an answer server-side and returns the next question.',
    handler: async (ctx, request, reply, deps) => {
      const params = SessionParams.safeParse(request.params);
      const body = z
        .object({
          questionIndex: z.number().int().min(0),
          selectedOption: z.enum(['A', 'B', 'C', 'D']),
          clientElapsedMs: z.number().int().min(0).max(86_400_000).optional(),
          isFlagged: z.boolean().optional(),
          writeSequence: z.number().int().min(1).optional(),
        })
        .strict()
        .safeParse(request.body ?? {});
      if (!params.success || !body.success) {
        return problemReply(
          reply,
          ctx,
          request.url,
          'VALIDATION_FAILED',
          'A questionIndex and a selectedOption of A-D are required.',
        );
      }

      const idempotencyKey = request.headers['idempotency-key'];
      if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8) {
        // §4.5 makes the key the duplicate-submission control, so it is
        // required rather than optional: without it a double-click writes twice.
        return problemReply(
          reply,
          ctx,
          request.url,
          'VALIDATION_FAILED',
          'An Idempotency-Key header of at least 8 characters is required on an answer write.',
        );
      }

      try {
        const result = await submitAnswer({
          deps: sessionDeps(deps),
          learner: actorFrom(ctx),
          sessionId: params.data.sessionId,
          presentationIndex: body.data.questionIndex,
          selectedOption: body.data.selectedOption,
          ...(body.data.clientElapsedMs === undefined
            ? {}
            : { clientElapsedMs: body.data.clientElapsedMs }),
          ...(body.data.isFlagged === undefined ? {} : { isFlagged: body.data.isFlagged }),
          ...(body.data.writeSequence === undefined
            ? {}
            : { writeSequence: body.data.writeSequence }),
          idempotencyKey,
        });
        // §4.3: "The answer response contains NO correctness signal, no running
        // score, no explanation." The shape below carries none, and the
        // assertion proves it.
        assertNoAnswerKey(result, 'the answer response');
        return result;
      } catch (error) {
        return replyFromLearningError(error, ctx, reply, request.url);
      }
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/api/v1/learning/sessions/:sessionId/complete',
    policy: 'learning.session.own',
    portal: 'LIVE',
    summary: 'Completes a session and scores it. Idempotent.',
    handler: async (ctx, request, reply, deps) => {
      const params = SessionParams.safeParse(request.params);
      if (!params.success) {
        return problemReply(
          reply,
          ctx,
          request.url,
          'VALIDATION_FAILED',
          'A session id is required.',
        );
      }
      try {
        const result = await completeSession({
          deps: sessionDeps(deps),
          learner: actorFrom(ctx),
          sessionId: params.data.sessionId,
        });
        // The score and the per-topic breakdown, and still no answer key: a
        // learner learns how they did, not what the answers were.
        assertNoAnswerKey(result, 'the completion response');
        return result;
      } catch (error) {
        return replyFromLearningError(error, ctx, reply, request.url);
      }
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/api/v1/learning/sessions/:sessionId/recover',
    policy: 'learning.session.own',
    portal: 'LIVE',
    summary: 'Records a session recovery with its reason. Always audited.',
    handler: async (ctx, request, reply, deps) => {
      const params = SessionParams.safeParse(request.params);
      const body = z
        .object({ reason: z.string().min(5).max(500) })
        .strict()
        .safeParse(request.body ?? {});
      if (!params.success || !body.success) {
        return problemReply(
          reply,
          ctx,
          request.url,
          'VALIDATION_FAILED',
          'A session id and a reason are required. A recovery with no stated reason is not auditable.',
        );
      }
      try {
        return await recordSessionRecovery({
          deps: sessionDeps(deps),
          learner: actorFrom(ctx),
          sessionId: params.data.sessionId,
          reason: body.data.reason,
        });
      } catch (error) {
        return replyFromLearningError(error, ctx, reply, request.url);
      }
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/api/v1/learning/results/:resultId',
    policy: 'learning.result.own',
    portal: 'LIVE',
    summary: 'The learner’s own result, with topic performance and knowledge gaps.',
    handler: async (ctx, request, reply, deps) => {
      const params = z.object({ resultId: z.string().uuid() }).safeParse(request.params);
      if (!params.success) {
        return problemReply(
          reply,
          ctx,
          request.url,
          'VALIDATION_FAILED',
          'A result id is required.',
        );
      }
      try {
        const result = await readResult({
          deps: sessionDeps(deps),
          learner: actorFrom(ctx),
          resultId: params.data.resultId,
        });
        assertNoAnswerKey(result, 'the result response');
        return result;
      } catch (error) {
        return replyFromLearningError(error, ctx, reply, request.url);
      }
    },
  }),
] as const;
