// Administration → AI Providers — configuring a provider through the product.
//
//   GET  /authoring/administration/providers                   the whole screen
//   PUT  /authoring/administration/providers/:id/settings      endpoint, model, key ref, on/off
//   PUT  /authoring/administration/providers/:id/approval      the data-processing approval
//   PUT  /authoring/administration/active-provider             which one generation uses
//   POST /authoring/administration/providers/:id/validate      a recorded readiness check
//
// AUTHORIZATION: the read is `governance.ai.read` (permission `report.read`)
// and every write is `governance.ai.manage` (`platform.configure`). No new
// policy names were minted -- these are the same two authorities the AI Usage
// page already separates: reading what a provider costs, and changing what it
// may do.
//
// WHAT THE VALIDATE ROUTE MAY SAY. It runs `validateProvider`, which checks
// configuration and nothing else, and it records the result. It does NOT call
// a provider, because no provider client exists in this build, and its
// response says so per check rather than reporting a green tick that would be
// read as "authentication succeeded". That distinction is the reason the route
// exists at all; if it is ever wired to a real client, LIVE_CALL becomes an
// attempted check and the outcome stops being INCOMPLETE on its own.

import { z } from 'zod';
import type { FastifyReply } from 'fastify';
import {
  readProviderAdministration,
  recordProviderValidation,
  setActiveProvider,
  setProviderApproval,
  setProviderSettings,
  ProviderAdminError,
} from '@knowzy/domain';
import {
  PROVIDER_CATALOGUE,
  assessProviderHealth,
  checkOpenAIReadiness,
  deriveReadiness,
  mayProbe,
  validateProvider,
  type ReadinessResult,
  type SecretCheck,
} from '@knowzy/claude-services';
import { REDACTED } from '@knowzy/configuration';
import {
  GenerationProviderSchema,
  ProviderSettingsSchema,
  type CallErrorClass,
  type ErrorCode,
  type GenerationProviderId,
  type ProviderHealthState,
} from '@knowzy/shared-types';
import { systemClock } from '@knowzy/observability';
import { defineRoute, type RouteContext, type RouteDeps } from '../http/route.js';
import { toProblem } from '../http/problem.js';
import { loadControlLayer, type ControlLayer } from '../generation/control-layer.js';
import { allowedHostsFor, auditedResolver, healthResolver } from '../secrets/platform-secrets.js';

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

const ProviderParams = z.object({ providerId: GenerationProviderSchema });

const actorFrom = (ctx: RouteContext) => ({
  userId: ctx.subject.userId,
  displayName: ctx.subject.displayName,
  roles: ctx.subject.roles,
});

const writeContext = (ctx: RouteContext, deps: RouteDeps) => ({
  prisma: deps.prisma,
  clock: systemClock,
  actor: actorFrom(ctx),
  correlationId: ctx.correlationId,
  requestId: ctx.requestId,
});

const replyFromAdminError = (
  error: unknown,
  ctx: RouteContext,
  reply: FastifyReply,
  instance: string,
): FastifyReply => {
  if (error instanceof ProviderAdminError) {
    return problemReply(reply, ctx, instance, error.code as ErrorCode, error.message);
  }
  throw error;
};

/**
 * Per-provider health, from the SAME samples the AI Usage page reads.
 *
 * Two screens computing health from two queries is how they end up disagreeing
 * in front of the person deciding whether to switch provider.
 */
const healthByProvider = async (
  deps: RouteDeps,
  control: ControlLayer,
): Promise<Record<string, { state: ProviderHealthState; reason: string }>> => {
  const since = new Date(
    systemClock.now().getTime() - control.settings.health.windowMinutes * 60_000,
  );
  const calls = await deps.prisma.generationProviderCall.findMany({
    where: { startedAt: { gte: since } },
    select: {
      providerId: true,
      outcome: true,
      startedAt: true,
      errorClass: true,
      latencyMs: true,
    },
  });

  const out: Record<string, { state: ProviderHealthState; reason: string }> = {};
  for (const assessment of control.registry.describe()) {
    const samples = calls
      .filter((call) => call.providerId === assessment.providerId)
      .map((call) => ({
        outcome: call.outcome,
        startedAt: call.startedAt,
        errorClass: (call.errorClass ?? null) as CallErrorClass | null,
        latencyMs: call.latencyMs,
      }));
    const health = assessProviderHealth(
      samples,
      {
        failureThreshold: control.settings.health.failureThreshold,
        windowMinutes: control.settings.health.windowMinutes,
      },
      systemClock.now(),
    );
    out[assessment.providerId] = { state: health.state, reason: health.reason };
  }
  return out;
};

export const aiProviderRoutes = [
  defineRoute({
    method: 'GET',
    url: '/api/v1/authoring/administration/providers',
    policy: 'governance.ai.read',
    portal: 'AUTHORING',
    summary:
      'Every declared AI provider with its state, settings, limits, health and last validation.',
    handler: async (ctx, _request, _reply, deps) => {
      const control = await loadControlLayer(deps.prisma);
      return readProviderAdministration({
        prisma: deps.prisma,
        clock: systemClock,
        assessments: control.registry.describe(),
        activeProvider: control.activeProvider,
        settings: control.providerSettings as Readonly<Record<string, unknown>>,
        settingsUpdatedAt: control.providerSettingsUpdatedAt,
        limits: control.settings.providerLimits as Readonly<Record<string, unknown>>,
        defaults: {
          perJobTokenBudget: control.settings.perJobTokenBudget,
          dailyTokenBudget: control.settings.dailyTokenBudget,
          weeklyTokenBudget: control.settings.weeklyTokenBudget,
          monthlyTokenBudget: control.settings.monthlyTokenBudget,
          concurrency: control.settings.concurrency,
          maxAttempts: control.settings.maxAttempts,
        },
        health: await healthByProvider(deps, control),
        canManage: ctx.subject.permissions.includes('platform.configure'),
      });
    },
  }),

  defineRoute({
    method: 'PUT',
    url: '/api/v1/authoring/administration/providers/:providerId/settings',
    policy: 'governance.ai.manage',
    portal: 'AUTHORING',
    summary: 'Sets a provider’s endpoint, model, credential REFERENCE and enabled state.',
    handler: async (ctx, request, reply, deps) => {
      const params = ProviderParams.safeParse(request.params);
      // An EMPTY object is valid and removes the entry, the same gesture the
      // limits form has. `ProviderSettingsSchema` is strict and validates
      // `apiKeyRef` as a keyvault:// reference, so a pasted key is refused
      // here rather than stored.
      // `removeApiKeyRef` travels beside the settings rather than inside them:
      // the credential field is write-only, so an absent reference now means
      // "keep the recorded one", and removing it is its own explicit gesture.
      const raw = (request.body ?? {}) as Record<string, unknown>;
      const removeApiKeyRef = raw['removeApiKeyRef'] === true;
      const { removeApiKeyRef: _flag, ...settingsBody } = raw;
      const body = ProviderSettingsSchema.safeParse(settingsBody);
      if (!params.success || !body.success) {
        return problemReply(
          reply,
          ctx,
          request.url,
          'VALIDATION_FAILED',
          body.success
            ? 'A known provider id is required.'
            : body.error.issues
                .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
                .join('; '),
        );
      }
      try {
        return await setProviderSettings({
          ...writeContext(ctx, deps),
          providerId: params.data.providerId,
          settings: body.data,
          removeApiKeyRef,
        });
      } catch (error) {
        return replyFromAdminError(error, ctx, reply, request.url);
      }
    },
  }),

  defineRoute({
    method: 'PUT',
    url: '/api/v1/authoring/administration/providers/:providerId/approval',
    policy: 'governance.ai.manage',
    portal: 'AUTHORING',
    summary: 'Records or withdraws a provider’s data-processing approval, with its reference.',
    handler: async (ctx, request, reply, deps) => {
      const params = ProviderParams.safeParse(request.params);
      const body = z
        .object({
          approved: z.boolean(),
          // Required when granting, and the domain refuses a short one. A
          // reference nobody can follow is not a record of an approval.
          approvalReference: z.string().max(200).optional(),
        })
        .strict()
        .safeParse(request.body ?? {});
      if (!params.success || !body.success) {
        return problemReply(
          reply,
          ctx,
          request.url,
          'VALIDATION_FAILED',
          'A known provider id and an approved flag are required.',
        );
      }
      const control = await loadControlLayer(deps.prisma);
      try {
        return await setProviderApproval({
          ...writeContext(ctx, deps),
          providerId: params.data.providerId,
          approved: body.data.approved,
          ...(body.data.approvalReference === undefined
            ? {}
            : { approvalReference: body.data.approvalReference }),
          assessment: control.registry.assess(params.data.providerId),
        });
      } catch (error) {
        return replyFromAdminError(error, ctx, reply, request.url);
      }
    },
  }),

  defineRoute({
    method: 'PUT',
    url: '/api/v1/authoring/administration/active-provider',
    policy: 'governance.ai.manage',
    portal: 'AUTHORING',
    summary: 'Sets the provider generation uses. Refused unless that provider is AVAILABLE.',
    handler: async (ctx, request, reply, deps) => {
      const body = z
        .object({ providerId: GenerationProviderSchema })
        .strict()
        .safeParse(request.body ?? {});
      if (!body.success) {
        return problemReply(
          reply,
          ctx,
          request.url,
          'VALIDATION_FAILED',
          'A provider id is required.',
        );
      }
      const control = await loadControlLayer(deps.prisma);
      try {
        return await setActiveProvider({
          ...writeContext(ctx, deps),
          providerId: body.data.providerId,
          assessment: control.registry.assess(body.data.providerId),
        });
      } catch (error) {
        return replyFromAdminError(error, ctx, reply, request.url);
      }
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/api/v1/authoring/administration/secrets',
    policy: 'governance.ai.read',
    portal: 'AUTHORING',
    summary:
      'The secret sources this deployable can read, and whether each is reachable. No names, no values.',
    handler: async (_ctx, _request, _reply, deps) => {
      const resolver = healthResolver(deps.secrets);
      return {
        asOf: systemClock.now().toISOString(),
        environment: deps.secrets?.environment ?? 'local',
        sources: await resolver.health(),
        permitted: resolver.sources,
      };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/api/v1/authoring/administration/providers/:providerId/validate',
    policy: 'governance.ai.manage',
    portal: 'AUTHORING',
    summary:
      'Test connection: capability, approval, implementation, configuration, secret resolution, and -- for a provider with a readiness client -- live endpoint, authentication and model checks. Never generates.',
    handler: async (ctx, request, reply, deps) => {
      const params = ProviderParams.safeParse(request.params);
      if (!params.success) {
        return problemReply(
          reply,
          ctx,
          request.url,
          'VALIDATION_FAILED',
          'A provider id is required.',
        );
      }
      const providerId: GenerationProviderId = params.data.providerId;
      const control = await loadControlLayer(deps.prisma);
      const assessment = control.registry.assess(providerId);
      const capabilities = PROVIDER_CATALOGUE[providerId];
      const settings = control.providerSettings[providerId];

      // Resolution and the live probe run only when every prerequisite that
      // would make them meaningless has passed: a provider that cannot ground
      // a question, has no client, or has no complete configuration is not
      // sent anywhere. APPROVAL is deliberately not a prerequisite -- see
      // validation.ts: these calls carry a key and a model name, nothing else.
      let secret: SecretCheck | null = null;
      let live: ReadinessResult | null = null;
      if (mayProbe({ assessment, capabilities, settings }) && settings?.apiKeyRef !== undefined) {
        const resolution = await auditedResolver(ctx, deps, providerId).resolve(
          settings.apiKeyRef,
          'PROVIDER_VALIDATION',
        );
        secret = {
          status: resolution.status,
          source: resolution.source,
          detail: resolution.status === 'RESOLVED' ? null : resolution.detail,
        };
        // Only OpenAI has a readiness client in this build. Any other
        // registered provider would reach here with `live` null, and every
        // live step then reads NOT_ATTEMPTED with the reason.
        if (resolution.status === 'RESOLVED' && providerId === 'OPENAI') {
          live = await checkOpenAIReadiness({
            baseUrl: settings.baseUrl ?? '',
            modelId: settings.modelId ?? '',
            apiKey: resolution.value,
            allowedHosts: allowedHostsFor(providerId, deps.secrets),
            ...(deps.secrets?.fetch === undefined ? {} : { fetch: deps.secrets.fetch }),
          });
        }
      }

      const report = validateProvider({ assessment, capabilities, settings, secret, live });
      const readiness = deriveReadiness({
        assessment,
        capabilities,
        settings,
        latestValidation: { steps: report.steps, validatedAt: systemClock.now().toISOString() },
      });

      try {
        const recorded = await recordProviderValidation({
          ...writeContext(ctx, deps),
          providerId,
          state: assessment.state,
          outcome: report.outcome,
          steps: report.steps,
          readinessState: readiness.state,
        });
        const payload = { ...recorded, readiness, limits: live?.limits ?? null };
        // Belt and braces: the payload is built from steps that never hold a
        // value, and this refuses to send one that somehow does.
        if (JSON.stringify(payload).includes(REDACTED)) {
          throw new Error('A redacted secret reached a validation payload.');
        }
        return payload;
      } catch (error) {
        return replyFromAdminError(error, ctx, reply, request.url);
      }
    },
  }),
];
