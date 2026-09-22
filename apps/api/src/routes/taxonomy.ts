// Taxonomy administration routes.
//
//   GET   /authoring/taxonomy/catalogue          everything, including inactive
//   POST  /authoring/taxonomy/domains            create a domain
//   PATCH /authoring/taxonomy/domains/:domainId  edit, activate, deactivate
//   POST  /authoring/taxonomy/topics             create a topic
//   PATCH /authoring/taxonomy/topics/:topicId    edit, activate, deactivate
//
// The read is separate from `GET /authoring/taxonomy` on purpose. That one
// serves SELECTION and hides everything inactive, which is right for a
// generate form and wrong for an administrator: somebody who cannot see a
// deactivated domain cannot reactivate it, and will create a second one with a
// colliding code instead.
//
// Writes are `taxonomy.manage`; the catalogue read is `taxonomy.read`, the same
// permission the selection read already uses, because seeing the catalogue is
// not the sensitive part -- adding to it is.

import { z } from 'zod';
import {
  createDomain,
  createTopic,
  readTaxonomy,
  updateDomain,
  updateTopic,
  TaxonomyError,
} from '@knowzy/domain';
import { systemClock } from '@knowzy/observability';
import { defineRoute, type RouteContext, type RouteDeps } from '../http/route.js';
import { toProblem } from '../http/problem.js';
import type { FastifyReply } from 'fastify';
import type { ErrorCode } from '@knowzy/shared-types';

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
 * One translation point for every taxonomy refusal.
 *
 * `TaxonomyError` carries the code AND the wording, so nothing is re-worded
 * here. A message written at the boundary drifts from the rule it describes,
 * and these messages have to name the colliding value to be useful.
 */
const taxonomyProblem = (
  reply: FastifyReply,
  ctx: RouteContext,
  instance: string,
  error: unknown,
): FastifyReply => {
  if (error instanceof TaxonomyError) {
    return problemReply(reply, ctx, instance, error.code, error.message);
  }
  throw error;
};

const actorFrom = (ctx: RouteContext) => ({
  userId: ctx.subject.userId,
  displayName: ctx.subject.displayName,
  roles: [...ctx.subject.roles],
  correlationId: ctx.correlationId,
  requestId: ctx.requestId,
});

const depsFrom = (deps: RouteDeps) => ({ prisma: deps.prisma, clock: systemClock });

const Query = z
  .object({
    query: z.string().max(200).optional(),
    active: z.enum(['true', 'false']).optional(),
    domainId: z.string().uuid().optional(),
  })
  .strict();

const CreateDomainBody = z
  .object({
    code: z.string().min(1).max(60),
    name: z.string().min(1).max(200),
    description: z.string().max(2_000).nullish(),
    requireSmeSignoff: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

const UpdateDomainBody = z
  .object({
    // Accepted, and refused by the service when anything references the
    // domain. Validated here only for shape: whether it MAY change is a
    // domain rule, not a request-shape rule.
    code: z.string().min(1).max(60).optional(),
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2_000).nullish(),
    requireSmeSignoff: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

const CreateTopicBody = z
  .object({
    domainId: z.string().uuid(),
    name: z.string().min(1).max(200),
    description: z.string().max(2_000).nullish(),
    isActive: z.boolean().optional(),
  })
  .strict();

const UpdateTopicBody = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2_000).nullish(),
    isActive: z.boolean().optional(),
  })
  .strict();

const invalidField = (issuePath: readonly (string | number)[]): string =>
  issuePath.length === 0 ? 'body' : issuePath.join('.');

export const taxonomyRoutes = [
  defineRoute({
    method: 'GET',
    url: '/api/v1/authoring/taxonomy/catalogue',
    policy: 'taxonomy.read',
    portal: 'AUTHORING',
    summary: 'Every domain and topic, including deactivated ones, for administration.',
    handler: async (ctx, request, reply, deps) => {
      const query = Query.safeParse(request.query ?? {});
      if (!query.success) {
        return problemReply(
          reply,
          ctx,
          request.url,
          'VALIDATION_FAILED',
          `The query parameter "${invalidField(query.error.issues[0]?.path ?? [])}" is invalid.`,
        );
      }

      const catalogue = await readTaxonomy(depsFrom(deps), {
        ...(query.data.query === undefined ? {} : { query: query.data.query }),
        ...(query.data.active === undefined ? {} : { active: query.data.active === 'true' }),
        ...(query.data.domainId === undefined ? {} : { domainId: query.data.domainId }),
      });

      return {
        domains: catalogue.domains,
        topics: catalogue.topics,
        counts: {
          domains: catalogue.domains.length,
          activeDomains: catalogue.domains.filter((domain) => domain.isActive).length,
          topics: catalogue.topics.length,
          activeTopics: catalogue.topics.filter((topic) => topic.isActive).length,
        },
      };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/api/v1/authoring/taxonomy/domains',
    policy: 'taxonomy.manage',
    portal: 'AUTHORING',
    summary: 'Creates a domain. The code is permanent once anything references it.',
    handler: async (ctx, request, reply, deps) => {
      const body = CreateDomainBody.safeParse(request.body ?? {});
      if (!body.success) {
        return problemReply(
          reply,
          ctx,
          request.url,
          'VALIDATION_FAILED',
          `The field "${invalidField(body.error.issues[0]?.path ?? [])}" is missing or invalid.`,
        );
      }

      try {
        const domain = await createDomain(depsFrom(deps), actorFrom(ctx), {
          code: body.data.code,
          name: body.data.name,
          ...(body.data.description === undefined ? {} : { description: body.data.description }),
          ...(body.data.requireSmeSignoff === undefined
            ? {}
            : { requireSmeSignoff: body.data.requireSmeSignoff }),
          ...(body.data.isActive === undefined ? {} : { isActive: body.data.isActive }),
        });
        return reply.status(201).send({ domain });
      } catch (error) {
        return taxonomyProblem(reply, ctx, request.url, error);
      }
    },
  }),

  defineRoute({
    method: 'PATCH',
    url: '/api/v1/authoring/taxonomy/domains/:domainId',
    policy: 'taxonomy.manage',
    portal: 'AUTHORING',
    summary: 'Edits a domain display name, description, SME rule, or active state.',
    handler: async (ctx, request, reply, deps) => {
      const params = z.object({ domainId: z.string().uuid() }).safeParse(request.params);
      const body = UpdateDomainBody.safeParse(request.body ?? {});
      if (!params.success || !body.success) {
        return problemReply(
          reply,
          ctx,
          request.url,
          'VALIDATION_FAILED',
          'A domain id and at least one changed field are required.',
        );
      }

      try {
        const domain = await updateDomain(depsFrom(deps), actorFrom(ctx), {
          domainId: params.data.domainId,
          ...(body.data.code === undefined ? {} : { code: body.data.code }),
          ...(body.data.name === undefined ? {} : { name: body.data.name }),
          ...(body.data.description === undefined ? {} : { description: body.data.description }),
          ...(body.data.requireSmeSignoff === undefined
            ? {}
            : { requireSmeSignoff: body.data.requireSmeSignoff }),
          ...(body.data.isActive === undefined ? {} : { isActive: body.data.isActive }),
        });
        return { domain };
      } catch (error) {
        return taxonomyProblem(reply, ctx, request.url, error);
      }
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/api/v1/authoring/taxonomy/topics',
    policy: 'taxonomy.manage',
    portal: 'AUTHORING',
    summary: 'Creates a topic inside exactly one domain.',
    handler: async (ctx, request, reply, deps) => {
      const body = CreateTopicBody.safeParse(request.body ?? {});
      if (!body.success) {
        return problemReply(
          reply,
          ctx,
          request.url,
          'VALIDATION_FAILED',
          `The field "${invalidField(body.error.issues[0]?.path ?? [])}" is missing or invalid.`,
        );
      }

      try {
        const topic = await createTopic(depsFrom(deps), actorFrom(ctx), {
          domainId: body.data.domainId,
          name: body.data.name,
          ...(body.data.description === undefined ? {} : { description: body.data.description }),
          ...(body.data.isActive === undefined ? {} : { isActive: body.data.isActive }),
        });
        return reply.status(201).send({ topic });
      } catch (error) {
        return taxonomyProblem(reply, ctx, request.url, error);
      }
    },
  }),

  defineRoute({
    method: 'PATCH',
    url: '/api/v1/authoring/taxonomy/topics/:topicId',
    policy: 'taxonomy.manage',
    portal: 'AUTHORING',
    summary: 'Edits a topic name, description, or active state. It never changes domain.',
    handler: async (ctx, request, reply, deps) => {
      const params = z.object({ topicId: z.string().uuid() }).safeParse(request.params);
      const body = UpdateTopicBody.safeParse(request.body ?? {});
      if (!params.success || !body.success) {
        return problemReply(
          reply,
          ctx,
          request.url,
          'VALIDATION_FAILED',
          'A topic id and at least one changed field are required.',
        );
      }

      try {
        const topic = await updateTopic(depsFrom(deps), actorFrom(ctx), {
          topicId: params.data.topicId,
          ...(body.data.name === undefined ? {} : { name: body.data.name }),
          ...(body.data.description === undefined ? {} : { description: body.data.description }),
          ...(body.data.isActive === undefined ? {} : { isActive: body.data.isActive }),
        });
        return { topic };
      } catch (error) {
        return taxonomyProblem(reply, ctx, request.url, error);
      }
    },
  }),
];
