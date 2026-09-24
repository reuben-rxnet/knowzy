// Generation routes — MVP step 3.
//
//   POST /generation/preflight            run the six checks (via MCP)
//   POST /generation/preflight/:id/decide record the author's chosen action
//   POST /generation-jobs                 create a job and run it
//   GET  /generation-jobs/:id             job state, counts, and rejections
//   GET  /questions/review                the author review queue
//
// The preflight runs through MCP because mcp-tools.md §9 puts it there. Job
// creation and the run are in-process domain calls, because §1.1 of that
// document is explicit that MCP is not a generic internal RPC layer: scoring,
// approval, and configuration reads are ordinary in-process calls, and so is
// this.

import { z } from 'zod';
import { GenerationExecutionModeSchema, GenerationProviderSchema } from '@knowzy/shared-types';
import type { FastifyReply } from 'fastify';
import type { ErrorCode } from '@knowzy/shared-types';
import { loadControlLayer } from '../generation/control-layer.js';
import {
  ContentDriftError,
  createGenerationJob,
  GenerationRefusedError,
  GenerationPreconditionError,
  GenerationScopeEmptyError,
  GenerationSelectionRequiredError,
  PreflightRequiredError,
  runGenerationJob,
  DocumentNotReadyError,
} from '@knowzy/domain';
import { systemClock } from '@knowzy/observability';
import { defineRoute, type RouteContext, type RouteDeps } from '../http/route.js';
import { ProviderResolutionError } from '../generation/provider-registry.js';
import { toProblem } from '../http/problem.js';
import { replyFromMcpError } from './sources.js';

const problemReply = (
  reply: FastifyReply,
  ctx: RouteContext,
  instance: string,
  code: ErrorCode,
  detail: string,
): FastifyReply => {
  const problem = toProblem({ code, correlationId: ctx.correlationId, instance, detail });
  return reply.status(problem.status).type('application/problem+json').send(problem);
};

/**
 * Maps a domain precondition failure onto its declared error code.
 *
 * Each of these has a code in ERROR_REGISTRY already, because workflows.md
 * §2.1 names them. Collapsing them into a generic 400 would lose the one thing
 * that tells an author what to do next.
 */
const replyFromGenerationError = (
  error: unknown,
  ctx: RouteContext,
  reply: FastifyReply,
  instance: string,
): FastifyReply => {
  if (error instanceof PreflightRequiredError) {
    return problemReply(reply, ctx, instance, 'PREFLIGHT_REQUIRED', error.message);
  }
  if (error instanceof ProviderResolutionError) {
    // Carries its own ErrorCode, so the registry's five distinct refusals
    // reach the caller as five distinct problem documents rather than as one
    // generic 500 -- which is what an unmapped throw would have produced.
    return problemReply(reply, ctx, instance, error.code, error.message);
  }
  if (error instanceof GenerationSelectionRequiredError) {
    return problemReply(reply, ctx, instance, 'GENERATION_SELECTION_REQUIRED', error.message);
  }
  if (error instanceof GenerationScopeEmptyError) {
    return problemReply(reply, ctx, instance, 'GENERATION_SCOPE_EMPTY', error.message);
  }
  if (error instanceof DocumentNotReadyError) {
    return problemReply(reply, ctx, instance, 'DOCUMENT_NOT_READY', error.message);
  }
  if (error instanceof ContentDriftError) {
    return problemReply(reply, ctx, instance, 'DOCUMENT_CONTENT_DRIFT', error.message);
  }
  if (error instanceof GenerationPreconditionError) {
    return problemReply(reply, ctx, instance, error.code as ErrorCode, error.message);
  }
  if (error instanceof GenerationRefusedError) {
    // A control-layer DECISION, already recorded on the job as REFUSED with its
    // reason. The detail carries the limit and the observed value, because an
    // author told only "budget exhausted" cannot plan around it.
    return problemReply(reply, ctx, instance, error.code, error.detail);
  }
  throw error;
};

const PreflightBody = z
  .object({
    sourceId: z.string().uuid(),
    documentIds: z.array(z.string().uuid()).min(1).max(10),
    objectiveIds: z.array(z.string().uuid()).optional(),
    targetAssessmentId: z.string().uuid().optional(),
  })
  .strict();

const DecisionBody = z
  .object({
    chosenAction: z.enum([
      'VIEW_EXISTING',
      'REUSE_EXISTING',
      'GENERATE_ADDITIONAL',
      'REGENERATE',
      'GENERATE_NEW',
    ]),
  })
  .strict();

const JobBody = z
  .object({
    preflightId: z.string().uuid(),
    scope: z.enum([
      'ENTIRE_DOCUMENT',
      'MODIFIED_SECTIONS_ONLY',
      'UNCOVERED_SECTIONS_ONLY',
      'OBJECTIVES',
      'SELECTED_SECTIONS',
    ]),
    domainId: z.string().uuid(),
    topicId: z.string().uuid(),
    reasonCode: z.enum([
      'NEW_KNOWLEDGE',
      'CONTENT_CHANGED',
      'COVERAGE_GAP',
      'NEW_OBJECTIVE',
      'PUBLISHER_REQUESTED',
    ]),
    requestedQuestionCount: z.number().int().min(1).max(50),
    justification: z.string().max(2_000).optional(),
    objectiveIds: z.array(z.string().uuid()).optional(),
    /**
     * Which provider drafts, and whose entitlement pays.
     *
     * Optional so an existing caller keeps working, and defaulted to the
     * deterministic generator rather than to "whatever is available" -- a
     * default that silently chose a model would spend money nobody asked to
     * spend.
     */
    providerId: GenerationProviderSchema.optional(),
    executionMode: GenerationExecutionModeSchema.optional(),
  })
  .strict();

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

export const generationRoutes = [
  defineRoute({
    method: 'POST',
    url: '/api/v1/authoring/generation/preflight',
    policy: 'question.generate',
    portal: 'AUTHORING',
    summary: 'Runs the six mandatory pre-generation checks for a document selection.',
    handler: async (ctx, request, reply, deps) => {
      const body = PreflightBody.safeParse(request.body ?? {});
      if (!body.success) {
        const field = body.error.issues[0]?.path.join('.') ?? 'body';
        return problemReply(
          reply,
          ctx,
          request.url,
          field === 'documentIds' ? 'GENERATION_SELECTION_REQUIRED' : 'VALIDATION_FAILED',
          `The field "${field}" is missing or invalid. Generation requires an explicit selection of 1-10 documents.`,
        );
      }
      try {
        return await callTool(ctx, deps, 'preflight_generation', {
          sourceId: body.data.sourceId,
          documentIds: body.data.documentIds,
          objectiveIds: body.data.objectiveIds ?? [],
          ...(body.data.targetAssessmentId === undefined
            ? {}
            : { targetAssessmentId: body.data.targetAssessmentId }),
        });
      } catch (error) {
        return replyFromMcpError(error, ctx, reply, request.url);
      }
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/api/v1/authoring/generation/preflight/:preflightId/decide',
    policy: 'question.generate',
    portal: 'AUTHORING',
    summary: 'Records the author’s chosen action against a preflight result.',
    handler: async (ctx, request, reply, deps) => {
      const params = z.object({ preflightId: z.string().uuid() }).safeParse(request.params);
      const body = DecisionBody.safeParse(request.body ?? {});
      if (!params.success || !body.success) {
        return problemReply(
          reply,
          ctx,
          request.url,
          'VALIDATION_FAILED',
          'A preflight id and a chosen action are both required.',
        );
      }
      try {
        return await callTool(ctx, deps, 'record_preflight_decision', {
          preflightId: params.data.preflightId,
          chosenAction: body.data.chosenAction,
        });
      } catch (error) {
        return replyFromMcpError(error, ctx, reply, request.url);
      }
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/api/v1/authoring/generation-jobs',
    policy: 'question.generate',
    portal: 'AUTHORING',
    summary: 'Creates a generation job from a decided preflight and runs it.',
    handler: async (ctx, request, reply, deps) => {
      const body = JobBody.safeParse(request.body ?? {});
      if (!body.success) {
        const field = body.error.issues[0]?.path.join('.') ?? 'body';
        return problemReply(
          reply,
          ctx,
          request.url,
          field === 'reasonCode' ? 'GENERATION_JUSTIFICATION_REQUIRED' : 'VALIDATION_FAILED',
          `The field "${field}" is missing or invalid.`,
        );
      }

      const requestedProvider = body.data.providerId ?? 'DETERMINISTIC_LOCAL';
      const requestedMode = body.data.executionMode ?? 'PLATFORM_MANAGED';

      try {
        // Resolved BEFORE the job row is created, and this ordering is the
        // point rather than a detail. A provider refusal must leave NOTHING
        // behind: resolving after `createGenerationJob` would persist a QUEUED
        // job for a provider that was never available, and a job row nobody
        // can explain is worse than a request that was turned away.
        //
        // The model comes from the profile only once the profile is loaded, so
        // the check that needs no profile happens here and the model-bearing
        // construction happens below. Splitting it keeps the refusal free.
        const capabilities = deps.providers.capabilitiesOf(requestedProvider);
        if (!capabilities.supportedExecutionModes.includes(requestedMode)) {
          return problemReply(
            reply,
            ctx,
            request.url,
            'PROVIDER_MODE_NOT_SUPPORTED',
            `${requestedProvider} supports ${capabilities.supportedExecutionModes.join(', ')} only.`,
          );
        }
        if (!deps.providers.registeredProviders.includes(requestedProvider)) {
          // Checked here too, and not only inside `resolve`, so an
          // unregistered provider also leaves no job row behind. Only the
          // final construction needs the profile's model, so everything that
          // does not need it is decided before anything is persisted.
          return problemReply(
            reply,
            ctx,
            request.url,
            'PROVIDER_NOT_REGISTERED',
            `${requestedProvider} is declared but not registered in this environment. ` +
              'No substitute provider is used.',
          );
        }
        if (!capabilities.retrievalFree) {
          return problemReply(
            reply,
            ctx,
            request.url,
            'PROVIDER_NOT_GROUNDING_SAFE',
            `${requestedProvider} retrieves its own context, so a question it drafts cannot be ` +
              'grounded in the selected sections alone.',
          );
        }

        const created = await createGenerationJob({
          prisma: deps.prisma,
          clock: systemClock,
          preflightId: body.data.preflightId,
          scope: body.data.scope,
          domainId: body.data.domainId,
          topicId: body.data.topicId,
          reasonCode: body.data.reasonCode,
          requestedQuestionCount: body.data.requestedQuestionCount,
          ...(body.data.justification === undefined
            ? {}
            : { justification: body.data.justification }),
          ...(body.data.objectiveIds === undefined ? {} : { objectiveIds: body.data.objectiveIds }),
          actor: {
            userId: ctx.subject.userId,
            displayName: ctx.subject.displayName,
            roles: ctx.subject.roles,
            permissions: ctx.subject.permissions,
          },
          correlationId: ctx.correlationId,
          requestId: ctx.requestId,
        });

        // DEVIATION from workflows.md §2.2, which returns 202 and enqueues the
        // run on the job runner. The run is executed in-process here instead.
        // `runGenerationJob` is a domain function with no process affinity, so
        // moving it behind the existing pg-boss queue is wiring, not redesign —
        // but until that happens this call is synchronous and a large job will
        // hold the request open. Recorded in MVP-Plan.md.
        const provider = await deps.providers.resolve({
          providerId: requestedProvider,
          executionMode: requestedMode,
          modelId: created.profile.modelId,
          requestingUserId: ctx.subject.userId,
        });

        // The control layer, resolved for this request: budgets, concurrency,
        // the retry policy and the prices, all from the declared llm.* keys.
        const control = await loadControlLayer(deps.prisma);

        const result = await runGenerationJob({
          prisma: deps.prisma,
          provider,
          control: { registry: control.registry, settings: control.settings },
          executionMode: requestedMode,
          onBehalfOfUserId: requestedMode === 'USER_MANAGED' ? ctx.subject.userId : null,
          clock: systemClock,
          scope: created.resolvedScope,
          profile: created.profile,
          requestedQuestionCount: created.requestedQuestionCount,
          context: {
            jobId: created.jobId,
            sourceId: created.sourceId,
            domainId: body.data.domainId,
            topicId: body.data.topicId,
            correlationId: ctx.correlationId,
            requestId: ctx.requestId,
            actorUserId: ctx.subject.userId,
            actorDisplayName: ctx.subject.displayName,
            actorRoles: ctx.subject.roles,
            reasonCode: body.data.reasonCode,
          },
        });

        return {
          jobId: result.jobId,
          status: result.status,
          scope: body.data.scope,
          sectionCount: created.resolvedScope.sections.length,
          requestedQuestionCount: created.requestedQuestionCount,
          acceptedQuestionCount: result.acceptedQuestionIds.length,
          questionIds: result.acceptedQuestionIds,
          // Reported, not hidden: an author needs to see that 3 of 5 candidates
          // were rejected and why, or the count looks like a platform failure.
          rejections: result.rejections,
          insufficientEvidenceSections: result.insufficientEvidenceSections,
          rejectionCounts: result.rejectionCounts,
          tokens: { input: result.inputTokens, output: result.outputTokens },
        };
      } catch (error) {
        return replyFromGenerationError(error, ctx, reply, request.url);
      }
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/api/v1/authoring/generation-jobs/:jobId',
    policy: 'question.read',
    portal: 'AUTHORING',
    summary: 'Returns a generation job with its counts and rejection reasons.',
    handler: async (ctx, request, reply, deps) => {
      const params = z.object({ jobId: z.string().uuid() }).safeParse(request.params);
      if (!params.success) {
        return problemReply(reply, ctx, request.url, 'VALIDATION_FAILED', 'A job id is required.');
      }

      const job = await deps.prisma.generationJob.findUnique({
        where: { id: params.data.jobId },
        include: {
          rejections: { orderBy: { createdAt: 'asc' } },
          documents: { include: { document: { select: { name: true } } } },
          _count: { select: { questions: true } },
        },
      });
      if (!job) {
        return problemReply(reply, ctx, request.url, 'NOT_FOUND', 'No such generation job.');
      }

      return {
        jobId: job.id,
        status: job.status,
        scope: job.scope,
        reasonCode: job.reasonCode,
        modelId: job.modelId,
        requestedQuestionCount: job.requestedQuestionCount,
        acceptedQuestionCount: job.acceptedQuestionCount,
        persistedQuestionCount: job._count.questions,
        rejectionCounts: job.rejectionCounts,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        durationMs: job.durationMs,
        tokens: { input: job.inputTokens, output: job.outputTokens },
        // The pinned input, so the run is reproducible from the record alone.
        resolvedSectionKeys: job.resolvedSectionKeys,
        documents: job.documents.map((row) => ({
          documentId: row.documentId,
          name: row.document.name,
          sourceVersionAtRun: row.sourceVersionAtRun,
          contentHashAtRun: row.contentHashAtRun,
          outcome: row.outcome,
        })),
        rejections: job.rejections.map((row) => ({
          reason: row.reason,
          detail: row.detail,
          sectionKey: row.sectionKey,
          matchedQuestionId: row.matchedQuestionId,
          similarityScore: row.similarityScore,
        })),
      };
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/api/v1/authoring/questions/review',
    policy: 'question.read',
    portal: 'AUTHORING',
    summary: 'The author review queue: drafts awaiting an author’s attention.',
    handler: async (ctx, request, reply, deps) => {
      const query = z
        .object({
          queue: z.enum(['author', 'approval', 'publish', 'published', 'all']).default('author'),
          domainId: z.string().uuid().optional(),
          jobId: z.string().uuid().optional(),
          // Every question generated from one document, whatever its state.
          // This is what "show me what already exists" needs: preflight
          // reports that approved or published questions already cite a
          // document, and the next question an author asks is WHICH.
          documentId: z.string().uuid().optional(),
          limit: z.coerce.number().int().min(1).max(100).default(25),
        })
        .safeParse(request.query ?? {});
      if (!query.success) {
        return problemReply(reply, ctx, request.url, 'VALIDATION_FAILED', 'Invalid queue filter.');
      }

      const statuses =
        query.data.queue === 'author'
          ? (['DRAFT', 'AUTHOR_REVIEW', 'CHANGES_REQUESTED'] as const)
          : query.data.queue === 'approval'
            ? (['SUBMITTED_FOR_APPROVAL'] as const)
            : query.data.queue === 'publish'
              ? // The publisher's queue: approved, and therefore publishable.
                // Approval is what makes a question eligible, so this is a
                // filter on the same list rather than a separate surface.
                (['APPROVED'] as const)
              : query.data.queue === 'published'
                ? (['PUBLISHED'] as const)
                : // 'all': no status filter. Every state a question can be in,
                  // including the ones the workflow queues deliberately hide —
                  // REJECTED, RETIRED, ARCHIVED — because "what already exists
                  // from this document" has to mean all of it.
                  null;

      // A question's lineage records the SOURCE system's document id — a
      // content hash — not the platform's row id, because the lineage has to
      // stay meaningful if the platform row is ever rebuilt. The UI holds the
      // platform id, so resolve one to the other rather than making every
      // caller know the difference.
      let sourceDocumentId: string | undefined;
      if (query.data.documentId !== undefined) {
        const document = await deps.prisma.knowledgeDocument.findUnique({
          where: { id: query.data.documentId },
          select: { sourceDocumentId: true },
        });
        if (document === null) {
          return problemReply(
            reply,
            ctx,
            request.url,
            'NOT_FOUND',
            'No document with that id is visible to you.',
          );
        }
        sourceDocumentId = document.sourceDocumentId;
      }

      const questions = await deps.prisma.draftQuestion.findMany({
        where: {
          ...(statuses === null ? {} : { status: { in: [...statuses] } }),
          ...(sourceDocumentId === undefined ? {} : { sourceDocumentId }),
          // P3: the caller's own scope, threaded in rather than re-derived.
          // Empty means unrestricted on the dimension (access-control.md §5).
          ...(ctx.scope.domainIds.length > 0 ? { domainId: { in: [...ctx.scope.domainIds] } } : {}),
          ...(query.data.domainId === undefined ? {} : { domainId: query.data.domainId }),
          ...(query.data.jobId === undefined ? {} : { generationJobId: query.data.jobId }),
        },
        orderBy: [{ confidenceScore: 'asc' }, { createdAt: 'asc' }],
        take: query.data.limit,
        include: {
          domain: { select: { code: true, name: true } },
          topic: { select: { name: true } },
        },
      });

      return {
        queue: query.data.queue,
        count: questions.length,
        items: questions.map((question) => {
          const payload = question.answerPayload as {
            options: Record<string, string>;
            correctOption: string;
          };
          return {
            questionId: question.id,
            status: question.status,
            version: question.version,
            questionText: question.questionText,
            // The author queue is an AUTHORING surface, so the proposed correct
            // answer belongs here. The learner projection is a different shape
            // built from an explicit field list, and never from this row.
            options: payload.options,
            proposedCorrectOption: payload.correctOption,
            explanation: question.explanation,
            domain: { code: question.domain.code, name: question.domain.name },
            topic: question.topic.name,
            source: {
              documentName: question.sourceDocumentName,
              folderPath: question.sourceFolderPath,
              url: question.sourceUrl,
              sectionKey: question.sectionKey,
              versionAtGeneration: question.sourceVersionAtGeneration,
            },
            // §5.2 requires all of this to be displayed, so all of it is served.
            evidence: {
              span: question.supportingEvidence,
              startOffset: question.evidenceStartOffset,
              endOffset: question.evidenceEndOffset,
              mode: question.evidenceVerificationMode,
              similarityScore: question.evidenceSimilarityScore,
              verified: true,
            },
            confidence: {
              score: question.confidenceScore,
              components: question.confidenceComponents,
            },
            duplicate: {
              maxSimilarityScore: question.maxSimilarityScore,
              disposition: question.duplicateDisposition,
              note: question.duplicateDispositionNote,
              // A flagged draft cannot be approved until this is dispositioned;
              // surfaced here so the queue can show the block before the author
              // spends time on it.
              blocksApproval:
                question.duplicateDispositionNote !== null &&
                question.duplicateDisposition === null,
            },
            generatedBy: { jobId: question.generationJobId, modelId: question.modelId },
            createdAt: question.createdAt,
          };
        }),
      };
    },
  }),
] as const;
