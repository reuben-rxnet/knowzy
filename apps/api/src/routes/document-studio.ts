// AI Document Studio routes -- Slice 2
// (docs/competencies/AI_DOCUMENT_STUDIO_ARCHITECTURE.md §10).
//
//   GET  /authoring/document-studio/status                    the real readiness, computed per call
//   PUT  /authoring/document-studio/approvals/:providerId     record, replace or remove the
//                                                             DOCUMENT_RESTRUCTURE approval
//
// Neither route transforms anything; no route in the build can. The status is
// computed from the provider catalogue, the (empty) restructuring-client
// registry and configuration on every call, and each evaluation is audited.
// The read is `governance.ai.read`, as AI Usage is; the write is
// `governance.ai.manage`, as the generation approval is.

import { z } from 'zod';
import { DocumentStudioError, readDocumentStudioStatus, setPurposeApproval } from '@knowzy/domain';
import { systemClock } from '@knowzy/observability';
import { GenerationProviderSchema } from '@knowzy/shared-types';
import type { FastifyReply } from 'fastify';
import { defineRoute, type RouteContext, type RouteDeps } from '../http/route.js';
import { toProblem } from '../http/problem.js';

const context = (ctx: RouteContext, deps: RouteDeps) => ({
  prisma: deps.prisma,
  clock: systemClock,
  actor: {
    userId: ctx.subject.userId,
    displayName: ctx.subject.displayName,
    roles: ctx.subject.roles,
  },
  correlationId: ctx.correlationId,
  requestId: ctx.requestId,
});

const refuse = (
  reply: FastifyReply,
  ctx: RouteContext,
  instance: string,
  detail: string,
): FastifyReply => {
  const problem = toProblem({
    code: 'VALIDATION_FAILED',
    correlationId: ctx.correlationId,
    instance,
    detail,
  });
  return reply.status(problem.status).type('application/problem+json').send(problem);
};

export const documentStudioRoutes = [
  defineRoute({
    method: 'GET',
    url: '/api/v1/authoring/document-studio/status',
    policy: 'governance.ai.read',
    portal: 'AUTHORING',
    summary:
      'AI Document Studio readiness for DOCUMENT_RESTRUCTURE: per provider, capability, approval, client and configuration. Never transforms.',
    handler: async (ctx, _request, _reply, deps) => ({
      ...(await readDocumentStudioStatus(context(ctx, deps))),
      // For the SCREEN only: whether to offer the approval controls.
      canManage: ctx.subject.permissions.includes('platform.configure'),
    }),
  }),

  defineRoute({
    method: 'PUT',
    url: '/api/v1/authoring/document-studio/approvals/:providerId',
    policy: 'governance.ai.manage',
    portal: 'AUTHORING',
    summary:
      'Records, replaces or removes a provider’s DOCUMENT_RESTRUCTURE approval, with its reference. Enables nothing.',
    handler: async (ctx, request, reply, deps) => {
      const params = z.object({ providerId: GenerationProviderSchema }).safeParse(request.params);
      const body = z
        .object({ approved: z.boolean(), approvalReference: z.string().max(500).optional() })
        .strict()
        .safeParse(request.body ?? {});
      if (!params.success || !body.success) {
        return refuse(
          reply,
          ctx,
          request.url,
          'A known provider id and an approved flag are required.',
        );
      }
      try {
        return await setPurposeApproval({
          ...context(ctx, deps),
          providerId: params.data.providerId,
          approved: body.data.approved,
          ...(body.data.approvalReference === undefined
            ? {}
            : { approvalReference: body.data.approvalReference }),
        });
      } catch (error) {
        if (error instanceof DocumentStudioError) {
          return refuse(reply, ctx, request.url, error.message);
        }
        throw error;
      }
    },
  }),
];
