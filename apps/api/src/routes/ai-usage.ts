// Governance → AI Usage & Budgets — the read model and the one write.
//
//   GET /authoring/governance/ai-usage                  the whole page
//   PUT /authoring/governance/ai-usage/providers/:id/limits   set a ceiling
//
// AUTHORIZATION, and why these two keys:
//
//   * the read is `report.read`, which the seeded matrix already grants to the
//     Reporting User, the Report Publisher, the Manager, the Auditor and the
//     KNOWZY Administrator. No new permission key was minted: this page reports
//     on platform activity, which is what that key means, and inventing
//     `governance.read` would have meant a role migration for a read that the
//     existing key already describes.
//   * the write is `platform.configure`, held by the KNOWZY Administrator
//     alone. Reading what a provider costs and RAISING what it may spend are
//     not the same authority.

import { z } from 'zod';
import type { FastifyReply } from 'fastify';
import {
  readAiUsage,
  readProviderReadiness,
  setProviderLimits,
  ProviderLimitError,
} from '@knowzy/domain';
import { GenerationProviderSchema, ProviderLimitsSchema } from '@knowzy/shared-types';
import type { ErrorCode } from '@knowzy/shared-types';
import { systemClock } from '@knowzy/observability';
import { defineRoute, type RouteContext } from '../http/route.js';
import { toProblem } from '../http/problem.js';
import { loadControlLayer } from '../generation/control-layer.js';

/** The same shape the other routes use: one problem document, one status. */
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

export const aiUsageRoutes = [
  defineRoute({
    method: 'GET',
    url: '/api/v1/authoring/governance/ai-usage',
    policy: 'governance.ai.read',
    portal: 'AUTHORING',
    summary: 'AI usage, token and cost accounting, budget windows, and provider health.',
    handler: async (_ctx, request, _reply, deps) => {
      const query = z
        .object({
          windowDays: z.coerce.number().int().min(1).max(365).optional(),
          historyLimit: z.coerce.number().int().min(1).max(200).optional(),
        })
        .safeParse(request.query ?? {});

      const control = await loadControlLayer(deps.prisma);

      const summary = await readAiUsage({
        db: deps.prisma,
        clock: systemClock,
        registry: control.registry,
        settings: control.settings,
        ...(query.success && query.data.windowDays !== undefined
          ? { windowDays: query.data.windowDays }
          : {}),
        ...(query.success && query.data.historyLimit !== undefined
          ? { historyLimit: query.data.historyLimit }
          : {}),
      });

      // The same readiness ladder AI Providers shows, derived by the same
      // function from the same latest validation (readProviderReadiness), so
      // the two screens cannot disagree about how far a provider has got.
      const readiness = await readProviderReadiness({
        prisma: deps.prisma,
        assessments: control.registry.describe(),
        settings: control.providerSettings,
      });

      return {
        ...summary,
        readiness,
        // The SERVER decides who may change a ceiling, and says so in the
        // payload. The screen then renders the control or not; it never
        // becomes the authority, and the PUT below re-checks regardless.
        canManageBudgets: _ctx.subject.permissions.includes('platform.configure'),
      };
    },
  }),

  defineRoute({
    method: 'PUT',
    url: '/api/v1/authoring/governance/ai-usage/providers/:providerId/limits',
    policy: 'governance.ai.manage',
    portal: 'AUTHORING',
    summary: 'Sets the per-provider token and concurrency ceilings.',
    handler: async (ctx, request, reply, deps) => {
      const params = z.object({ providerId: GenerationProviderSchema }).safeParse(request.params);
      if (!params.success) {
        return problemReply(
          reply,
          ctx,
          request.url,
          'VALIDATION_FAILED',
          'A declared provider id is required.',
        );
      }

      // An empty object is VALID and meaningful: it removes the override and
      // returns the provider to the platform ceiling. Distinct from setting a
      // ceiling of zero, which forbids generation for that provider.
      const body = ProviderLimitsSchema.safeParse(request.body ?? {});
      if (!body.success) {
        return problemReply(
          reply,
          ctx,
          request.url,
          'VALIDATION_FAILED',
          'Limits must be whole numbers: perJobTokenBudget, dailyTokenBudget, weeklyTokenBudget, monthlyTokenBudget, concurrency.',
        );
      }

      try {
        const result = await setProviderLimits({
          prisma: deps.prisma,
          clock: systemClock,
          actor: {
            userId: ctx.subject.userId,
            displayName: ctx.subject.displayName,
            roles: ctx.subject.roles,
          },
          correlationId: ctx.correlationId,
          requestId: ctx.requestId,
          providerId: params.data.providerId,
          limits: body.data,
        });
        return result;
      } catch (error) {
        if (error instanceof ProviderLimitError) {
          return problemReply(reply, ctx, request.url, 'VALIDATION_FAILED', error.message);
        }
        throw error;
      }
    },
  }),
];
