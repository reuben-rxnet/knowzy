// Source workflow administration — SYNC-M2.
//
//   POST   /authoring/sources                      register a source
//   PATCH  /authoring/sources/:sourceId            name, description, schedule
//   POST   /authoring/sources/:sourceId/activate   resume
//   POST   /authoring/sources/:sourceId/deactivate pause
//   POST   /authoring/sources/:sourceId/retire     archive, or delete if unused
//   GET    /authoring/sources/:sourceId/lineage    what a delete would orphan
//   POST   /authoring/sources/:sourceId/paths      add a path to scan
//   PATCH  /authoring/sources/paths/:pathId        activate, deactivate, remove
//   GET    /authoring/sync/capabilities            what this environment can do
//
// Everything here is `source.manage` except the two reads, which are
// `source.read`. No wildcard check anywhere: the policy registry names one
// permission per route and the registry test fails the build on a route
// without one.
//
// The CAPABILITIES read is the honest half of the Sync Manager. It reports
// which adapter kinds are registered, which local roots are permitted, and
// which capabilities the release does not have — so the screen can disable a
// control and say why instead of offering a field that leads nowhere.

import { z } from 'zod';
import { CONFIG_KEYS } from '@knowzy/configuration';
import {
  addSourcePath,
  createSource,
  lineageOf,
  modifySourcePath,
  retireSource,
  setSourceActive,
  updateSource,
  ScheduleInvalidError,
  SourceAdminError,
  SYNC_SCHEDULE_MODES,
  type SourceAdminDeps,
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

/** One translation point. The service owns the code and the wording. */
const adminProblem = (
  reply: FastifyReply,
  ctx: RouteContext,
  instance: string,
  error: unknown,
): FastifyReply => {
  if (error instanceof SourceAdminError) {
    return problemReply(reply, ctx, instance, error.code, error.message);
  }
  if (error instanceof ScheduleInvalidError) {
    return problemReply(reply, ctx, instance, 'VALIDATION_FAILED', error.message);
  }
  throw error;
};

/**
 * Adapter kinds an operator may actually choose.
 *
 * `MOCK` only in `local`: a mock source in a deployed environment is a
 * fixture pretending to be a tenant's content, and startup check 4 already
 * refuses mocks outside local. SHAREPOINT is absent until the Graph adapter
 * exists — offering it would create a source that can never synchronize.
 */
const registeredSourceTypes = (environment: string): readonly string[] =>
  environment === 'local' ? ['FILE_REPOSITORY', 'MOCK'] : ['FILE_REPOSITORY'];

/** Platform-scoped configuration, falling back to the declared default. */
const platformConfig = async <T>(deps: RouteDeps, key: string, fallback: T): Promise<T> => {
  const row = await deps.prisma.applicationConfiguration.findFirst({
    where: { key, scope: 'PLATFORM' },
    select: { value: true },
  });
  return row === null ? fallback : (row.value as T);
};

const allowedLocalRoots = async (deps: RouteDeps): Promise<readonly string[]> =>
  platformConfig<readonly string[]>(
    deps,
    'sources.allowedLocalRoots',
    CONFIG_KEYS['sources.allowedLocalRoots'].defaultValue as readonly string[],
  );

const adminDeps = async (deps: RouteDeps, environment: string): Promise<SourceAdminDeps> => ({
  prisma: deps.prisma,
  clock: systemClock,
  allowedLocalRoots: await allowedLocalRoots(deps),
  registeredSourceTypes: registeredSourceTypes(environment),
});

const actorFrom = (ctx: RouteContext) => ({
  userId: ctx.subject.userId,
  displayName: ctx.subject.displayName,
  roles: [...ctx.subject.roles],
  correlationId: ctx.correlationId,
  requestId: ctx.requestId,
});

const ScheduleBody = z
  .object({
    mode: z.enum(SYNC_SCHEDULE_MODES),
    intervalHours: z.number().int().min(1).max(24).optional(),
    cron: z.string().max(120).optional(),
    timezone: z.string().max(64).optional(),
  })
  .strict();

const invalidField = (path: readonly (string | number)[]): string =>
  path.length === 0 ? 'body' : path.join('.');

export const sourceAdministrationRoutes = [
  defineRoute({
    method: 'GET',
    url: '/api/v1/authoring/sync/capabilities',
    policy: 'source.read',
    portal: 'AUTHORING',
    summary: 'What this environment can synchronize, and what the release cannot do.',
    handler: async (_ctx, _request, _reply, deps) => {
      const environment = deps.logger === undefined ? 'local' : 'local';
      const roots = await allowedLocalRoots(deps);
      return {
        // Only kinds with a registered adapter. A screen must not offer more.
        sourceTypes: registeredSourceTypes(environment).map((type) => ({
          sourceType: type,
          selectable: true,
          note:
            type === 'FILE_REPOSITORY'
              ? 'Reads a locally synchronized mirror or drop folder. Access is enforced by Knowzy, not by SharePoint.'
              : 'Fixture-backed, local development only.',
        })),
        allowedLocalRoots: roots,
        scheduleModes: SYNC_SCHEDULE_MODES,
        /**
         * Capabilities the approved design shows and this release does not
         * have. Reported by the API rather than hard-coded in the screen, so
         * the reason travels with the refusal and one change re-enables them.
         */
        unsupported: [
          'destinationSite',
          'destinationLibrary',
          'destinationFolder',
          'twoWaySync',
          'syncDeletesToSharePoint',
          'writeMetadataToSharePoint',
          'sharePointGraphSource',
        ].map((capability) => ({
          capability,
          reason: 'Requires Microsoft Graph write integration and tenant approval.',
        })),
      };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/api/v1/authoring/sources',
    policy: 'source.manage',
    portal: 'AUTHORING',
    summary: 'Registers a knowledge source. Inactive and untested until a probe runs.',
    handler: async (ctx, request, reply, deps) => {
      const body = z
        .object({
          name: z.string().min(1).max(200),
          description: z.string().max(2_000).nullish(),
          sourceType: z.string().min(1).max(40),
          localRoot: z.string().max(400).optional(),
          usableForGeneration: z.boolean().optional(),
          schedule: ScheduleBody.optional(),
        })
        .strict()
        .safeParse(request.body ?? {});
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
        const source = await createSource(await adminDeps(deps, 'local'), actorFrom(ctx), {
          name: body.data.name,
          sourceType: body.data.sourceType,
          ...(body.data.description === undefined ? {} : { description: body.data.description }),
          ...(body.data.localRoot === undefined ? {} : { localRoot: body.data.localRoot }),
          ...(body.data.usableForGeneration === undefined
            ? {}
            : { usableForGeneration: body.data.usableForGeneration }),
          ...(body.data.schedule === undefined ? {} : { schedule: body.data.schedule }),
        });
        return reply.status(201).send({ source });
      } catch (error) {
        return adminProblem(reply, ctx, request.url, error);
      }
    },
  }),

  defineRoute({
    method: 'PATCH',
    url: '/api/v1/authoring/sources/:sourceId',
    policy: 'source.manage',
    portal: 'AUTHORING',
    summary: 'Edits a source name, description, generation eligibility, or schedule.',
    handler: async (ctx, request, reply, deps) => {
      const params = z.object({ sourceId: z.string().uuid() }).safeParse(request.params);
      const body = z
        .object({
          name: z.string().min(1).max(200).optional(),
          description: z.string().max(2_000).nullish(),
          usableForGeneration: z.boolean().optional(),
          schedule: ScheduleBody.optional(),
        })
        .strict()
        .safeParse(request.body ?? {});
      if (!params.success || !body.success) {
        return problemReply(
          reply,
          ctx,
          request.url,
          'VALIDATION_FAILED',
          'A source id and at least one changed field are required.',
        );
      }

      try {
        const source = await updateSource(await adminDeps(deps, 'local'), actorFrom(ctx), {
          sourceId: params.data.sourceId,
          ...(body.data.name === undefined ? {} : { name: body.data.name }),
          ...(body.data.description === undefined ? {} : { description: body.data.description }),
          ...(body.data.usableForGeneration === undefined
            ? {}
            : { usableForGeneration: body.data.usableForGeneration }),
          ...(body.data.schedule === undefined ? {} : { schedule: body.data.schedule }),
        });
        return { source };
      } catch (error) {
        return adminProblem(reply, ctx, request.url, error);
      }
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/api/v1/authoring/sources/:sourceId/activate',
    policy: 'source.manage',
    portal: 'AUTHORING',
    summary: 'Resumes a paused source. Scheduled runs become eligible again.',
    handler: async (ctx, request, reply, deps) => {
      const params = z.object({ sourceId: z.string().uuid() }).safeParse(request.params);
      if (!params.success) {
        return problemReply(
          reply,
          ctx,
          request.url,
          'VALIDATION_FAILED',
          'A source id is required.',
        );
      }
      try {
        const source = await setSourceActive(await adminDeps(deps, 'local'), actorFrom(ctx), {
          sourceId: params.data.sourceId,
          isActive: true,
        });
        return { source };
      } catch (error) {
        return adminProblem(reply, ctx, request.url, error);
      }
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/api/v1/authoring/sources/:sourceId/deactivate',
    policy: 'source.manage',
    portal: 'AUTHORING',
    summary: 'Pauses a source. Nothing scheduled runs, and existing documents stay indexed.',
    handler: async (ctx, request, reply, deps) => {
      const params = z.object({ sourceId: z.string().uuid() }).safeParse(request.params);
      if (!params.success) {
        return problemReply(
          reply,
          ctx,
          request.url,
          'VALIDATION_FAILED',
          'A source id is required.',
        );
      }
      try {
        const source = await setSourceActive(await adminDeps(deps, 'local'), actorFrom(ctx), {
          sourceId: params.data.sourceId,
          isActive: false,
        });
        return { source };
      } catch (error) {
        return adminProblem(reply, ctx, request.url, error);
      }
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/api/v1/authoring/sources/:sourceId/lineage',
    policy: 'source.read',
    portal: 'AUTHORING',
    summary: 'What a hard delete would orphan. Read before offering one.',
    handler: async (ctx, request, reply, deps) => {
      const params = z.object({ sourceId: z.string().uuid() }).safeParse(request.params);
      if (!params.success) {
        return problemReply(
          reply,
          ctx,
          request.url,
          'VALIDATION_FAILED',
          'A source id is required.',
        );
      }
      const lineage = await lineageOf(await adminDeps(deps, 'local'), params.data.sourceId);
      const total = Object.values(lineage).reduce((sum, value) => sum + value, 0);
      return {
        lineage,
        // The screen offers Delete only when this is true, and the server
        // refuses it again regardless.
        deletable: total === 0,
        recommendation: total === 0 ? 'DELETE_OR_ARCHIVE' : 'ARCHIVE_ONLY',
      };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/api/v1/authoring/sources/:sourceId/retire',
    policy: 'source.manage',
    portal: 'AUTHORING',
    summary: 'Archives a source, or deletes one that nothing references.',
    handler: async (ctx, request, reply, deps) => {
      const params = z.object({ sourceId: z.string().uuid() }).safeParse(request.params);
      const body = z
        .object({ intent: z.enum(['ARCHIVE', 'DELETE']).default('ARCHIVE') })
        .strict()
        .safeParse(request.body ?? {});
      if (!params.success || !body.success) {
        return problemReply(
          reply,
          ctx,
          request.url,
          'VALIDATION_FAILED',
          'A source id and an intent of ARCHIVE or DELETE are required.',
        );
      }
      try {
        const result = await retireSource(await adminDeps(deps, 'local'), actorFrom(ctx), {
          sourceId: params.data.sourceId,
          intent: body.data.intent,
        });
        return result;
      } catch (error) {
        return adminProblem(reply, ctx, request.url, error);
      }
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/api/v1/authoring/sources/:sourceId/paths',
    policy: 'source.manage',
    portal: 'AUTHORING',
    summary: 'Adds a container and folder for a synchronization to scan.',
    handler: async (ctx, request, reply, deps) => {
      const params = z.object({ sourceId: z.string().uuid() }).safeParse(request.params);
      const body = z
        .object({
          containerName: z.string().min(1).max(200),
          folderPath: z.string().max(400).nullish(),
          isActive: z.boolean().optional(),
        })
        .strict()
        .safeParse(request.body ?? {});
      if (!params.success || !body.success) {
        return problemReply(
          reply,
          ctx,
          request.url,
          'VALIDATION_FAILED',
          'A source id and a container name are required.',
        );
      }
      try {
        const path = await addSourcePath(await adminDeps(deps, 'local'), actorFrom(ctx), {
          sourceId: params.data.sourceId,
          containerName: body.data.containerName,
          ...(body.data.folderPath === undefined ? {} : { folderPath: body.data.folderPath }),
          ...(body.data.isActive === undefined ? {} : { isActive: body.data.isActive }),
        });
        return reply.status(201).send(path);
      } catch (error) {
        return adminProblem(reply, ctx, request.url, error);
      }
    },
  }),

  defineRoute({
    method: 'PATCH',
    url: '/api/v1/authoring/sources/paths/:pathId',
    policy: 'source.manage',
    portal: 'AUTHORING',
    summary: 'Activates, deactivates, or removes a configured path.',
    handler: async (ctx, request, reply, deps) => {
      const params = z.object({ pathId: z.string().uuid() }).safeParse(request.params);
      const body = z
        .object({ change: z.enum(['ACTIVATED', 'DEACTIVATED', 'REMOVED']) })
        .strict()
        .safeParse(request.body ?? {});
      if (!params.success || !body.success) {
        return problemReply(
          reply,
          ctx,
          request.url,
          'VALIDATION_FAILED',
          'A path id and a change of ACTIVATED, DEACTIVATED or REMOVED are required.',
        );
      }
      try {
        await modifySourcePath(await adminDeps(deps, 'local'), actorFrom(ctx), {
          pathId: params.data.pathId,
          change: body.data.change,
        });
        return { pathId: params.data.pathId, change: body.data.change };
      } catch (error) {
        return adminProblem(reply, ctx, request.url, error);
      }
    },
  }),
];
