// Review, approval, and publishing routes — MVP step 4 and 5.
//
//   PATCH /questions/:id                   edit a draft (new version, re-verify)
//   POST  /questions/:id/submit            AUTHOR_REVIEW → SUBMITTED (gated)
//   POST  /questions/:id/claim             DRAFT → AUTHOR_REVIEW
//   POST  /questions/:id/reviews           a review comment, no status change
//   POST  /questions/:id/duplicate         record a duplicate disposition
//   POST  /questions/:id/approve           SUBMITTED → APPROVED (gated + SoD)
//   POST  /questions/:id/request-changes   SUBMITTED → CHANGES_REQUESTED
//   POST  /questions/:id/reject            → REJECTED
//   GET   /questions/:id/gates             the gate checklist, advisory
//   GET   /questions/:id/versions          version history with field diffs
//   POST  /question-bank/publish           publish a batch
//   POST  /questions/:id/retire            retire a published question
//   GET   /question-bank                   the published inventory
//
// Each route declares a policy (G1/P1). The policy is the coarse gate; the
// transition's own permission and the 13 gates are enforced in the domain, so a
// route that forgot its policy still could not move a question.

import { z } from 'zod';
import type { FastifyReply } from 'fastify';
import type { ErrorCode, ProblemDetails } from '@knowzy/shared-types';
import {
  addReview,
  dispositionDuplicate,
  editDraftQuestion,
  evaluateGatesForQuestion,
  readVersionHistory,
  transitionQuestion,
  BreakGlassNotPermittedError,
  CommentRequiredError,
  EvidenceBrokenByEditError,
  GatesFailedError,
  NotEditableError,
  PermissionRequiredError,
  QuestionNotFoundError,
  TransitionNotPermittedError,
} from '@knowzy/domain';
import { systemClock } from '@knowzy/observability';
import { defineRoute, type RouteContext, type RouteDeps } from '../http/route.js';
import { toProblem } from '../http/problem.js';
import { replyFromMcpError } from './sources.js';

const problemReply = (
  reply: FastifyReply,
  ctx: RouteContext,
  instance: string,
  code: ErrorCode,
  detail: string,
  gateFailures?: ProblemDetails['gateFailures'],
): FastifyReply => {
  const problem = toProblem({
    code,
    correlationId: ctx.correlationId,
    instance,
    detail,
    ...(gateFailures === undefined ? {} : { gateFailures }),
  });
  return reply.status(problem.status).type('application/problem+json').send(problem);
};

/**
 * Maps a domain refusal to its declared error code.
 *
 * A gate failure carries the full checklist in `gateFailures`, because
 * error-handling.md §328 requires the client to be able to show every failure
 * at once rather than one per round trip.
 */
const replyFromReviewError = (
  error: unknown,
  ctx: RouteContext,
  reply: FastifyReply,
  instance: string,
): FastifyReply => {
  if (error instanceof GatesFailedError) {
    const failures = error.evaluation.failures.map((failure) => ({
      gate: failure.gate,
      code: failure.code as ErrorCode,
      passed: false,
      detail: failure.detail,
      field: failure.field,
    }));
    // Each gate has its OWN code in ERROR_REGISTRY (§5.7's table), so the
    // problem carries the first failure's real code rather than a generic one.
    // The status then matches the actual problem — SEPARATION_OF_DUTIES is a
    // 403, a missing option is a 422 — and the whole checklist travels in
    // gateFailures.
    const primary = (failures[0]?.code ?? 'VALIDATION_FAILED') as ErrorCode;
    return problemReply(
      reply,
      ctx,
      instance,
      primary,
      failures.length === 1
        ? (failures[0]?.detail ?? 'A gate did not pass.')
        : `${failures.length} gates did not pass. See gateFailures for the full checklist.`,
      failures,
    );
  }
  if (error instanceof TransitionNotPermittedError) {
    return problemReply(reply, ctx, instance, 'STATE_TRANSITION_INVALID', error.message);
  }
  if (error instanceof CommentRequiredError) {
    // No dedicated code exists, and inventing one for "you must type a
    // reason" would add a registry entry for a plain validation failure.
    return problemReply(reply, ctx, instance, 'VALIDATION_FAILED', error.message);
  }
  if (error instanceof PermissionRequiredError) {
    return problemReply(reply, ctx, instance, 'FORBIDDEN', error.message);
  }
  if (error instanceof QuestionNotFoundError) {
    return problemReply(reply, ctx, instance, 'NOT_FOUND', error.message);
  }
  if (error instanceof EvidenceBrokenByEditError) {
    return problemReply(reply, ctx, instance, 'EVIDENCE_UNVERIFIED', error.message);
  }
  if (error instanceof NotEditableError) {
    return problemReply(reply, ctx, instance, 'STATE_TRANSITION_INVALID', error.message);
  }
  if (error instanceof BreakGlassNotPermittedError) {
    return problemReply(reply, ctx, instance, 'FORBIDDEN', error.message);
  }
  throw error;
};

const QuestionParams = z.object({ questionId: z.string().uuid() });
const CommentBody = z.object({ comment: z.string().min(1).max(4_000) }).strict();

const actorFrom = (ctx: RouteContext) => ({
  userId: ctx.subject.userId,
  displayName: ctx.subject.displayName,
  roles: ctx.subject.roles,
  permissions: ctx.subject.permissions,
  correlationId: ctx.correlationId,
  requestId: ctx.requestId,
});

const reviewDeps = (deps: RouteDeps) => ({ prisma: deps.prisma, clock: systemClock });

export const reviewRoutes = [
  defineRoute({
    method: 'PATCH',
    url: '/api/v1/authoring/questions/:questionId',
    policy: 'question.edit',
    portal: 'AUTHORING',
    summary: 'Edits a draft, creating a new version and re-verifying its evidence.',
    handler: async (ctx, request, reply, deps) => {
      const params = QuestionParams.safeParse(request.params);
      if (!params.success) {
        return problemReply(reply, ctx, request.url, 'VALIDATION_FAILED', 'A question id is required.');
      }
      const body = z
        .object({
          questionText: z.string().min(1).max(1_000).optional(),
          options: z
            .object({
              A: z.string().min(1).max(500).optional(),
              B: z.string().min(1).max(500).optional(),
              C: z.string().min(1).max(500).optional(),
              D: z.string().min(1).max(500).optional(),
            })
            .strict()
            .optional(),
          correctOption: z.enum(['A', 'B', 'C', 'D']).optional(),
          explanation: z.string().min(1).max(2_000).optional(),
          supportingEvidence: z.string().min(1).max(2_000).optional(),
        })
        .strict()
        .safeParse(request.body ?? {});
      if (!body.success) {
        return problemReply(reply, ctx, request.url, 'VALIDATION_FAILED', 'Invalid edit payload.');
      }

      try {
        return await editDraftQuestion({
          prisma: deps.prisma,
          clock: systemClock,
          questionId: params.data.questionId,
          actor: actorFrom(ctx),
          edit: body.data,
        });
      } catch (error) {
        return replyFromReviewError(error, ctx, reply, request.url);
      }
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/api/v1/authoring/questions/:questionId/claim',
    policy: 'question.edit',
    portal: 'AUTHORING',
    summary: 'Claims a draft for authoring (DRAFT to AUTHOR_REVIEW).',
    handler: async (ctx, request, reply, deps) => {
      const params = QuestionParams.safeParse(request.params);
      if (!params.success) {
        return problemReply(reply, ctx, request.url, 'VALIDATION_FAILED', 'A question id is required.');
      }
      try {
        return await transitionQuestion({
          deps: reviewDeps(deps),
          questionId: params.data.questionId,
          to: 'AUTHOR_REVIEW',
          actor: actorFrom(ctx),
        });
      } catch (error) {
        return replyFromReviewError(error, ctx, reply, request.url);
      }
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/api/v1/authoring/questions/:questionId/gates',
    policy: 'question.read',
    portal: 'AUTHORING',
    summary: 'The 13-gate checklist for a question. Advisory; the server re-evaluates.',
    handler: async (ctx, request, reply, deps) => {
      const params = QuestionParams.safeParse(request.params);
      if (!params.success) {
        return problemReply(reply, ctx, request.url, 'VALIDATION_FAILED', 'A question id is required.');
      }
      try {
        const context = await evaluateGatesForQuestion(reviewDeps(deps), params.data.questionId, {
          userId: ctx.subject.userId,
          roles: ctx.subject.roles,
          permissions: ctx.subject.permissions,
        });
        return {
          questionId: params.data.questionId,
          passed: context.evaluation.passed,
          // Every gate, passing and failing, so the validation panel can show
          // the whole checklist and an approver is never surprised (§5.7).
          gates: context.evaluation.results,
          failures: context.evaluation.failures,
          advisory:
            'This evaluation is advisory. The server re-evaluates every gate at the moment of the transition.',
        };
      } catch (error) {
        return replyFromReviewError(error, ctx, reply, request.url);
      }
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/api/v1/authoring/questions/:questionId/versions',
    policy: 'question.read',
    portal: 'AUTHORING',
    summary: 'Version history with the fields changed in each version.',
    handler: async (ctx, request, reply, deps) => {
      const params = QuestionParams.safeParse(request.params);
      if (!params.success) {
        return problemReply(reply, ctx, request.url, 'VALIDATION_FAILED', 'A question id is required.');
      }
      return { questionId: params.data.questionId, versions: await readVersionHistory(deps.prisma, params.data.questionId) };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/api/v1/authoring/questions/:questionId/reviews',
    policy: 'question.review',
    portal: 'AUTHORING',
    summary: 'Records a review comment without changing status.',
    handler: async (ctx, request, reply, deps) => {
      const params = QuestionParams.safeParse(request.params);
      const body = z
        .object({
          kind: z.enum(['AUTHOR', 'SME', 'REVIEWER']).default('REVIEWER'),
          outcome: z.enum(['ENDORSED', 'CHANGES_REQUESTED', 'REJECTED', 'COMMENTED']),
          comment: z.string().min(1).max(4_000),
        })
        .strict()
        .safeParse(request.body ?? {});
      if (!params.success || !body.success) {
        return problemReply(reply, ctx, request.url, 'VALIDATION_FAILED', 'A kind, outcome, and comment are required.');
      }
      try {
        return await addReview({
          deps: reviewDeps(deps),
          questionId: params.data.questionId,
          actor: actorFrom(ctx),
          kind: body.data.kind,
          outcome: body.data.outcome,
          comment: body.data.comment,
        });
      } catch (error) {
        return replyFromReviewError(error, ctx, reply, request.url);
      }
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/api/v1/authoring/questions/:questionId/duplicate-disposition',
    policy: 'question.review',
    portal: 'AUTHORING',
    summary: 'Records a duplicate disposition, which is what unblocks gate 10.',
    handler: async (ctx, request, reply, deps) => {
      const params = QuestionParams.safeParse(request.params);
      const body = z
        .object({
          disposition: z.enum(['DISTINCT', 'DUPLICATE']),
          note: z.string().min(10).max(2_000),
        })
        .strict()
        .safeParse(request.body ?? {});
      if (!params.success || !body.success) {
        return problemReply(
          reply,
          ctx,
          request.url,
          'VALIDATION_FAILED',
          'A disposition and a note of at least 10 characters are required.',
        );
      }
      try {
        return await dispositionDuplicate({
          deps: reviewDeps(deps),
          questionId: params.data.questionId,
          actor: actorFrom(ctx),
          disposition: body.data.disposition,
          note: body.data.note,
        });
      } catch (error) {
        return replyFromReviewError(error, ctx, reply, request.url);
      }
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/api/v1/authoring/questions/:questionId/submit',
    policy: 'question.submit',
    portal: 'AUTHORING',
    summary: 'Submits a question for approval. Every gate is evaluated first.',
    handler: async (ctx, request, reply, deps) => {
      const params = QuestionParams.safeParse(request.params);
      if (!params.success) {
        return problemReply(reply, ctx, request.url, 'VALIDATION_FAILED', 'A question id is required.');
      }
      try {
        const result = await transitionQuestion({
          deps: reviewDeps(deps),
          questionId: params.data.questionId,
          to: 'SUBMITTED_FOR_APPROVAL',
          actor: actorFrom(ctx),
        });
        return { ...result, gates: result.gates?.results ?? [] };
      } catch (error) {
        return replyFromReviewError(error, ctx, reply, request.url);
      }
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/api/v1/authoring/questions/:questionId/approve',
    policy: 'question.approve',
    portal: 'AUTHORING',
    summary: 'Approves a question. All gates plus separation of duties.',
    handler: async (ctx, request, reply, deps) => {
      const params = QuestionParams.safeParse(request.params);
      const body = z
        .object({
          comment: z.string().max(4_000).optional(),
          breakGlassJustification: z.string().min(30).max(4_000).optional(),
        })
        .strict()
        .safeParse(request.body ?? {});
      if (!params.success || !body.success) {
        return problemReply(reply, ctx, request.url, 'VALIDATION_FAILED', 'Invalid approval payload.');
      }
      try {
        const result = await transitionQuestion({
          deps: reviewDeps(deps),
          questionId: params.data.questionId,
          to: 'APPROVED',
          actor: actorFrom(ctx),
          comment: body.data.comment ?? null,
          ...(body.data.breakGlassJustification === undefined
            ? {}
            : { breakGlass: { justification: body.data.breakGlassJustification } }),
        });
        return {
          ...result,
          gates: result.gates?.results ?? [],
          // Surfaced so an override is never invisible in the response either.
          viaBreakGlass: result.viaBreakGlass,
        };
      } catch (error) {
        return replyFromReviewError(error, ctx, reply, request.url);
      }
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/api/v1/authoring/questions/:questionId/request-changes',
    policy: 'question.review',
    portal: 'AUTHORING',
    summary: 'Requests changes. A written comment is mandatory.',
    handler: async (ctx, request, reply, deps) => {
      const params = QuestionParams.safeParse(request.params);
      const body = CommentBody.safeParse(request.body ?? {});
      if (!params.success) {
        return problemReply(reply, ctx, request.url, 'VALIDATION_FAILED', 'A question id is required.');
      }
      if (!body.success) {
        return problemReply(
          reply,
          ctx,
          request.url,
          'VALIDATION_FAILED',
          'Requesting changes requires a written comment. The author has to be able to read why.',
        );
      }
      try {
        return await transitionQuestion({
          deps: reviewDeps(deps),
          questionId: params.data.questionId,
          to: 'CHANGES_REQUESTED',
          actor: actorFrom(ctx),
          comment: body.data.comment,
          reviewKind: 'REVIEWER',
        });
      } catch (error) {
        return replyFromReviewError(error, ctx, reply, request.url);
      }
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/api/v1/authoring/questions/:questionId/reject',
    policy: 'question.review',
    portal: 'AUTHORING',
    summary: 'Rejects a question. A written comment is mandatory.',
    handler: async (ctx, request, reply, deps) => {
      const params = QuestionParams.safeParse(request.params);
      const body = CommentBody.safeParse(request.body ?? {});
      if (!params.success) {
        return problemReply(reply, ctx, request.url, 'VALIDATION_FAILED', 'A question id is required.');
      }
      if (!body.success) {
        return problemReply(
          reply,
          ctx,
          request.url,
          'VALIDATION_FAILED',
          'Rejecting a question requires a written comment.',
        );
      }
      try {
        return await transitionQuestion({
          deps: reviewDeps(deps),
          questionId: params.data.questionId,
          to: 'REJECTED',
          actor: actorFrom(ctx),
          comment: body.data.comment,
          reviewKind: 'REVIEWER',
        });
      } catch (error) {
        return replyFromReviewError(error, ctx, reply, request.url);
      }
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/api/v1/authoring/question-bank/publish',
    policy: 'question.publish',
    portal: 'AUTHORING',
    summary: 'Publishes approved questions to the Question Bank, idempotently.',
    handler: async (ctx, request, reply, deps) => {
      const body = z
        .object({ questionIds: z.array(z.string().uuid()).min(1).max(50) })
        .strict()
        .safeParse(request.body ?? {});
      if (!body.success) {
        return problemReply(
          reply,
          ctx,
          request.url,
          'VALIDATION_FAILED',
          'Publishing requires an explicit list of 1-50 question ids.',
        );
      }

      // §4.2: the client's Idempotency-Key, so a replay returns the original
      // batch result rather than attempting a second publish.
      const idempotencyKey = request.headers['idempotency-key'];

      try {
        return await callTool(ctx, deps, 'publish_question_to_sharepoint', {
          questionIds: body.data.questionIds,
          ...(typeof idempotencyKey === 'string' && idempotencyKey.length >= 8
            ? { idempotencyKey }
            : {}),
        });
      } catch (error) {
        return replyFromMcpError(error, ctx, reply, request.url);
      }
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/api/v1/authoring/questions/:questionId/retire',
    policy: 'question.retire',
    portal: 'AUTHORING',
    summary: 'Retires a published question. The bank item is never deleted.',
    handler: async (ctx, request, reply, deps) => {
      const params = QuestionParams.safeParse(request.params);
      const body = z
        .object({ comment: z.string().min(10).max(2_000) })
        .strict()
        .safeParse(request.body ?? {});
      if (!params.success) {
        return problemReply(reply, ctx, request.url, 'VALIDATION_FAILED', 'A question id is required.');
      }
      if (!body.success) {
        return problemReply(
          reply,
          ctx,
          request.url,
          'VALIDATION_FAILED',
          'Retirement requires a written comment of at least 10 characters.',
        );
      }
      try {
        return await callTool(ctx, deps, 'retire_published_question', {
          questionId: params.data.questionId,
          comment: body.data.comment,
        });
      } catch (error) {
        return replyFromMcpError(error, ctx, reply, request.url);
      }
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/api/v1/authoring/question-bank',
    policy: 'question.read',
    portal: 'AUTHORING',
    summary: 'The published inventory, from the local projection.',
    handler: async (ctx, _request, _reply, deps) => {
      const references = await deps.prisma.publishedQuestionReference.findMany({
        where: {
          ...(ctx.scope.domainIds.length > 0 ? { domainId: { in: [...ctx.scope.domainIds] } } : {}),
        },
        orderBy: { publishedAt: 'desc' },
        take: 100,
        include: { question: { select: { id: true, questionText: true, status: true } } },
      });

      return {
        count: references.length,
        // The local PROJECTION, labelled as such: §8 reconciles it against the
        // bank, and a reader needs to know which one they are looking at.
        source: 'local-projection',
        items: references.map((reference) => ({
          bankQuestionId: reference.questionId,
          questionId: reference.question.id,
          questionText: reference.question.questionText,
          localStatus: reference.question.status,
          bankItemId: reference.sharePointItemId,
          publishedVersion: reference.publishedVersion,
          status: reference.status,
          isActive: reference.isActive,
          isPublished: reference.isPublished,
          publishedAt: reference.publishedAt,
          publishedByUserId: reference.publishedByUserId,
          retiredAt: reference.retiredAt,
          retireComment: reference.retireComment,
          reconciliationState: reference.reconciliationState,
        })),
      };
    },
  }),
] as const;

const callTool = async <T>(
  ctx: RouteContext,
  deps: RouteDeps,
  tool: string,
  args: Readonly<Record<string, unknown>>,
): Promise<T> =>
  deps.mcp.call<T>({
    tool,
    subject: ctx.subject,
    scope: ctx.scope,
    portal: ctx.portal,
    correlationId: ctx.correlationId,
    requestId: ctx.requestId,
    arguments: args,
  });
