// Competency administration routes -- COMPETENCY-M2.
//
// Specification: docs/competencies/COMPETENCY_ADMINISTRATION.md.
//
//   GET   /authoring/competencies/catalogue                 frameworks, versions, definitions
//   POST  /authoring/competencies/categories                create a category
//   PATCH /authoring/competencies/categories/:categoryId    edit, deactivate, reactivate
//   POST  /authoring/competencies/items                     create a competency
//   PATCH /authoring/competencies/items/:competencyId       edit, deactivate, reactivate
//   POST  /authoring/competencies/aliases                   create an alias
//   PATCH /authoring/competencies/aliases/:aliasId          edit, deactivate, reactivate
//   POST  /authoring/competencies/frameworks/:frameworkId/versions   draw up a version
//   POST  /authoring/competencies/versions/:versionId/approve        approve a version
//   GET   /authoring/competencies/role-targets              Role -> Competency Requirements
//   POST  /authoring/competencies/role-targets              propose a requirement
//   PATCH /authoring/competencies/role-targets/:targetId    edit a proposal
//   POST  /authoring/competencies/role-targets/:targetId/approve
//   POST  /authoring/competencies/role-targets/:targetId/retire
//
// Reads are `taxonomy.read`, as the taxonomy catalogue's are. Writes are
// `competency.manage`, which only KNOWZY_ADMINISTRATOR holds (decision A2).
// Separation of duties is NOT a permission: it is an identity comparison the
// service makes, and a CHECK in 0016 makes again.

import { z } from 'zod';
import {
  approveFrameworkVersion,
  approveRoleTarget,
  CompetencyAdminError,
  createCompetency,
  createCompetencyAlias,
  createCompetencyCategory,
  createFrameworkVersion,
  proposeRoleTarget,
  readCompetencyCatalogue,
  readRoleTargets,
  retireRoleTarget,
  updateCompetency,
  updateCompetencyAlias,
  updateCompetencyCategory,
  updateRoleTarget,
} from '@knowzy/domain';
import { systemClock } from '@knowzy/observability';
import type { ErrorCode } from '@knowzy/shared-types';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { defineRoute, type RouteContext, type RouteDeps } from '../http/route.js';
import { toProblem } from '../http/problem.js';

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

const actorFrom = (ctx: RouteContext) => ({
  userId: ctx.subject.userId,
  displayName: ctx.subject.displayName,
  roles: [...ctx.subject.roles],
  correlationId: ctx.correlationId,
  requestId: ctx.requestId,
});

const depsFrom = (deps: RouteDeps) => ({ prisma: deps.prisma, clock: systemClock });

const invalidField = (issuePath: readonly (string | number)[]): string =>
  issuePath.length === 0 ? 'body' : issuePath.join('.');

const Status = z.enum(['ACTIVE', 'RETIRED']);
const Uuid = z.string().uuid();

/**
 * Parse params and body, run the service, translate its refusal. One helper so
 * thirteen handlers cannot disagree about how a refusal is reported.
 */
const run = async <P extends z.ZodTypeAny, B extends z.ZodTypeAny>(
  ctx: RouteContext,
  request: FastifyRequest,
  reply: FastifyReply,
  schemas: { readonly params?: P; readonly body?: B },
  work: (params: z.infer<P>, body: z.infer<B>) => Promise<unknown>,
): Promise<unknown> => {
  const params = (schemas.params ?? z.object({})).safeParse(request.params ?? {});
  if (!params.success) {
    return problemReply(reply, ctx, request.url, 'VALIDATION_FAILED', 'A valid id is required.');
  }
  const body = (schemas.body ?? z.object({})).safeParse(request.body ?? {});
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
    return await work(params.data, body.data);
  } catch (error) {
    if (error instanceof CompetencyAdminError) {
      return problemReply(reply, ctx, request.url, error.code, error.message);
    }
    throw error;
  }
};

const CreateCategory = z
  .object({
    frameworkId: Uuid,
    code: z.string().min(1).max(60),
    name: z.string().min(1).max(200),
    kind: z.string().min(1).max(40),
  })
  .strict();
const UpdateCategory = z
  .object({
    name: z.string().min(1).max(200).optional(),
    kind: z.string().min(1).max(40).optional(),
    status: Status.optional(),
  })
  .strict();
const CreateCompetency = z
  .object({
    categoryId: Uuid,
    name: z.string().min(1).max(200),
    codeSegment: z.string().max(60).nullish(),
    levelScaleId: Uuid,
    description: z.string().max(2_000).nullish(),
    confirmDistinct: z.boolean().optional(),
  })
  .strict();
const UpdateCompetency = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2_000).nullish(),
    status: Status.optional(),
  })
  .strict();
const CreateAlias = z
  .object({
    subject: z.enum(['CATEGORY', 'COMPETENCY']),
    targetId: Uuid,
    alias: z.string().min(1).max(200),
    decision: z.string().min(1).max(40),
    note: z.string().max(2_000).nullish(),
  })
  .strict();
const UpdateAlias = z
  .object({
    decision: z.string().min(1).max(40).optional(),
    note: z.string().max(2_000).nullish(),
    status: Status.optional(),
  })
  .strict();
const CreateVersion = z.object({ versionLabel: z.string().min(1).max(200) }).strict();
const Approve = z
  .object({
    approvalReference: z.string().max(2_000),
    effectiveFrom: z.string().max(10).nullish(),
  })
  .strict();
const ProposeTarget = z
  .object({
    jobRoleId: Uuid,
    competencyId: Uuid,
    targetLevelId: Uuid,
    source: z.string().max(2_000),
    rationale: z.string().max(2_000).nullish(),
    effectiveFrom: z.string().max(10).nullish(),
  })
  .strict();
const UpdateTarget = z
  .object({
    targetLevelId: Uuid.optional(),
    source: z.string().max(2_000).optional(),
    rationale: z.string().max(2_000).nullish(),
    effectiveFrom: z.string().max(10).nullish(),
  })
  .strict();
const ApproveTarget = z.object({ approvalReference: z.string().max(2_000) }).strict();

/** Strip keys whose value is undefined, for exactOptionalPropertyTypes. */
const defined = <T extends Record<string, unknown>>(value: T) =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };

export const competencyRoutes = [
  defineRoute({
    method: 'GET',
    url: '/api/v1/authoring/competencies/catalogue',
    policy: 'taxonomy.read',
    portal: 'AUTHORING',
    summary: 'Competency frameworks: versions, domains, categories, competencies and aliases.',
    handler: async (_ctx, _request, _reply, deps) => ({
      frameworks: await readCompetencyCatalogue(depsFrom(deps)),
    }),
  }),

  defineRoute({
    method: 'POST',
    url: '/api/v1/authoring/competencies/categories',
    policy: 'competency.manage',
    portal: 'AUTHORING',
    summary: 'Creates a competency category. Its code is permanent from creation.',
    handler: async (ctx, request, reply, deps) =>
      run(ctx, request, reply, { body: CreateCategory }, async (_p, body) => ({
        category: await createCompetencyCategory(depsFrom(deps), actorFrom(ctx), body),
      })),
  }),

  defineRoute({
    method: 'PATCH',
    url: '/api/v1/authoring/competencies/categories/:categoryId',
    policy: 'competency.manage',
    portal: 'AUTHORING',
    summary: 'Edits a category name or domain, or deactivates or reactivates it.',
    handler: async (ctx, request, reply, deps) =>
      run(
        ctx,
        request,
        reply,
        { params: z.object({ categoryId: Uuid }), body: UpdateCategory },
        async (params, body) => ({
          category: await updateCompetencyCategory(depsFrom(deps), actorFrom(ctx), {
            categoryId: params.categoryId,
            ...defined(body),
          }),
        }),
      ),
  }),

  defineRoute({
    method: 'POST',
    url: '/api/v1/authoring/competencies/items',
    policy: 'competency.manage',
    portal: 'AUTHORING',
    summary: 'Creates a competency in an active category. A near match needs confirmation.',
    handler: async (ctx, request, reply, deps) =>
      run(ctx, request, reply, { body: CreateCompetency }, async (_p, body) => ({
        competency: await createCompetency(depsFrom(deps), actorFrom(ctx), defined(body)),
      })),
  }),

  defineRoute({
    method: 'PATCH',
    url: '/api/v1/authoring/competencies/items/:competencyId',
    policy: 'competency.manage',
    portal: 'AUTHORING',
    summary: 'Edits a competency name or description, or deactivates or reactivates it.',
    handler: async (ctx, request, reply, deps) =>
      run(
        ctx,
        request,
        reply,
        { params: z.object({ competencyId: Uuid }), body: UpdateCompetency },
        async (params, body) => ({
          competency: await updateCompetency(depsFrom(deps), actorFrom(ctx), {
            competencyId: params.competencyId,
            ...defined(body),
          }),
        }),
      ),
  }),

  defineRoute({
    method: 'POST',
    url: '/api/v1/authoring/competencies/aliases',
    policy: 'competency.manage',
    portal: 'AUTHORING',
    summary: 'Records an alias: a source label and the decision that maps it.',
    handler: async (ctx, request, reply, deps) =>
      run(ctx, request, reply, { body: CreateAlias }, async (_p, body) => ({
        alias: await createCompetencyAlias(depsFrom(deps), actorFrom(ctx), defined(body)),
      })),
  }),

  defineRoute({
    method: 'PATCH',
    url: '/api/v1/authoring/competencies/aliases/:aliasId',
    policy: 'competency.manage',
    portal: 'AUTHORING',
    summary: 'Edits an alias decision or note, or deactivates or reactivates it.',
    handler: async (ctx, request, reply, deps) =>
      run(
        ctx,
        request,
        reply,
        { params: z.object({ aliasId: Uuid }), body: UpdateAlias },
        async (params, body) => ({
          alias: await updateCompetencyAlias(depsFrom(deps), actorFrom(ctx), {
            aliasId: params.aliasId,
            ...defined(body),
          }),
        }),
      ),
  }),

  defineRoute({
    method: 'POST',
    url: '/api/v1/authoring/competencies/frameworks/:frameworkId/versions',
    policy: 'competency.manage',
    portal: 'AUTHORING',
    summary: 'Draws up a DRAFT version: a snapshot of the current definitions and their editors.',
    handler: async (ctx, request, reply, deps) =>
      run(
        ctx,
        request,
        reply,
        { params: z.object({ frameworkId: Uuid }), body: CreateVersion },
        async (params, body) => ({
          version: await createFrameworkVersion(depsFrom(deps), actorFrom(ctx), {
            frameworkId: params.frameworkId,
            versionLabel: body.versionLabel,
          }),
        }),
      ),
  }),

  defineRoute({
    method: 'POST',
    url: '/api/v1/authoring/competencies/versions/:versionId/approve',
    policy: 'competency.manage',
    portal: 'AUTHORING',
    summary: 'Approves a DRAFT version. Refused for its editors and when its hash is stale.',
    handler: async (ctx, request, reply, deps) =>
      run(
        ctx,
        request,
        reply,
        { params: z.object({ versionId: Uuid }), body: Approve },
        async (params, body) => ({
          version: await approveFrameworkVersion(depsFrom(deps), actorFrom(ctx), {
            versionId: params.versionId,
            ...defined(body),
          }),
        }),
      ),
  }),

  defineRoute({
    method: 'GET',
    url: '/api/v1/authoring/competencies/role-targets',
    policy: 'taxonomy.read',
    portal: 'AUTHORING',
    summary: 'Role -> Competency Requirements: every target, and what a proposal may choose.',
    handler: async (_ctx, _request, _reply, deps) => readRoleTargets(depsFrom(deps)),
  }),

  defineRoute({
    method: 'POST',
    url: '/api/v1/authoring/competencies/role-targets',
    policy: 'competency.manage',
    portal: 'AUTHORING',
    summary: 'Proposes a requirement for a role. The source is required; none is invented.',
    handler: async (ctx, request, reply, deps) =>
      run(ctx, request, reply, { body: ProposeTarget }, async (_p, body) => ({
        target: await proposeRoleTarget(depsFrom(deps), actorFrom(ctx), defined(body)),
      })),
  }),

  defineRoute({
    method: 'PATCH',
    url: '/api/v1/authoring/competencies/role-targets/:targetId',
    policy: 'competency.manage',
    portal: 'AUTHORING',
    summary: 'Edits a PROPOSED requirement. An approved one is revised by a new proposal.',
    handler: async (ctx, request, reply, deps) =>
      run(
        ctx,
        request,
        reply,
        { params: z.object({ targetId: Uuid }), body: UpdateTarget },
        async (params, body) => ({
          target: await updateRoleTarget(depsFrom(deps), actorFrom(ctx), {
            targetId: params.targetId,
            ...defined(body),
          }),
        }),
      ),
  }),

  defineRoute({
    method: 'POST',
    url: '/api/v1/authoring/competencies/role-targets/:targetId/approve',
    policy: 'competency.manage',
    portal: 'AUTHORING',
    summary: 'Approves a requirement. Needs an approved framework version and another approver.',
    handler: async (ctx, request, reply, deps) =>
      run(
        ctx,
        request,
        reply,
        { params: z.object({ targetId: Uuid }), body: ApproveTarget },
        async (params, body) => ({
          target: await approveRoleTarget(depsFrom(deps), actorFrom(ctx), {
            targetId: params.targetId,
            approvalReference: body.approvalReference,
          }),
        }),
      ),
  }),

  defineRoute({
    method: 'POST',
    url: '/api/v1/authoring/competencies/role-targets/:targetId/retire',
    policy: 'competency.manage',
    portal: 'AUTHORING',
    summary: 'Retires a proposed or approved requirement, recording who and when.',
    handler: async (ctx, request, reply, deps) =>
      run(ctx, request, reply, { params: z.object({ targetId: Uuid }) }, async (params) => ({
        target: await retireRoleTarget(depsFrom(deps), actorFrom(ctx), {
          targetId: params.targetId,
        }),
      })),
  }),
];
