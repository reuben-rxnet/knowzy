// Route definition and policy enforcement — access-control.md §4.3.
//
// P1: "Every route and every tool declares a policy. A registry test enumerates
// both and fails the build on an undeclared handler — there is no 'trusted
// internal' path."
//
// That is enforced structurally here: `defineRoute` requires a `policy`, so a
// route without one does not typecheck, and every definition passes through
// ROUTE_REGISTRY so the completeness test can enumerate them.
//
// P2: the policy runs BEFORE input validation, so an error shape cannot be used
// to probe a schema.
// P4: denials are audited with the policy name and reason — a denial is a
// security signal, not a 403 to be swallowed.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { DataScope, PortalContext, Subject } from '@knowzy/shared-types';
import { authorize, type PolicyName } from '@knowzy/authorization';
import type { AuditWriter, PrismaClient } from '@knowzy/database';
import type { Logger } from '@knowzy/observability';
import type { McpClient } from '../mcp/client.js';
import { toProblem } from './problem.js';

export interface RouteContext {
  readonly subject: Subject;
  readonly scope: DataScope;
  readonly correlationId: string;
  readonly requestId: string;
  readonly portal: PortalContext;
}

export interface RouteDeps {
  readonly prisma: PrismaClient;
  /**
   * The only path from the API to a knowledge source (ADR-003).
   *
   * It is a dependency rather than an import so a test can substitute a fake,
   * and because B2 forbids this app from importing the adapter package at all.
   */
  readonly mcp: McpClient;
  readonly auditWriter: AuditWriter;
  readonly logger: Logger;
  readonly resolveSubject: (
    headers: Readonly<Record<string, string | string[] | undefined>>,
  ) => Promise<Subject | null>;
}

export interface KnowzyRoute {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly url: string;
  /** Required. A route with no policy cannot be defined. */
  readonly policy: PolicyName;
  /** Which portal's callers may reach this route. */
  readonly portal: PortalContext;
  readonly summary: string;
  readonly handler: (
    ctx: RouteContext,
    request: FastifyRequest,
    reply: FastifyReply,
    deps: RouteDeps,
  ) => Promise<unknown>;
}

/** Identity function that pins the type, so `policy` cannot be omitted. */
export const defineRoute = (route: KnowzyRoute): KnowzyRoute => route;

export const routeKey = (route: Pick<KnowzyRoute, 'method' | 'url'>): string =>
  `${route.method} ${route.url}`;

/**
 * Registers routes with the policy gate in front of every handler.
 *
 * The gate is a preHandler rather than something each handler calls, because a
 * check a handler has to remember is a check a handler will eventually forget.
 */
export const registerRoutes = (
  app: FastifyInstance,
  routes: readonly KnowzyRoute[],
  deps: RouteDeps,
): void => {
  for (const route of routes) {
    app.route({
      method: route.method,
      url: route.url,

      preHandler: async (request, reply) => {
        const correlationId = request.correlation?.correlationId ?? 'c-unknown';
        const requestId = request.correlation?.requestId ?? null;

        let subject: Subject | null = null;
        try {
          subject = await deps.resolveSubject(request.headers);
        } catch (error: unknown) {
          // A resolver that throws is a configuration problem, not an
          // anonymous request. Never fall through to "no subject".
          deps.logger.error('subject resolution failed', {
            correlationId,
            route: route.url,
            errorName: error instanceof Error ? error.name : 'Unknown',
          });
          const problem = toProblem({
            code: 'INTERNAL_ERROR',
            correlationId,
            instance: request.url,
          });
          return reply.status(problem.status).type('application/problem+json').send(problem);
        }

        const decision = authorize({ subject, policy: route.policy, portal: route.portal });

        if (!decision.allowed) {
          await deps.auditWriter.write(deps.prisma, {
            action:
              decision.code === 'UNAUTHENTICATED'
                ? 'PLATFORM.AUTH.TOKEN_REJECTED'
                : decision.code === 'PORTAL_ACCESS_DENIED'
                  ? 'PLATFORM.AUTH.PORTAL_ACCESS_DENIED'
                  : 'PLATFORM.SECURITY.AUTHORIZATION_DENIED',
            outcome: 'DENIED',
            actorType: subject ? 'USER' : 'SYSTEM',
            actorUserId: subject?.userId ?? null,
            actorDisplayName: subject?.displayName ?? null,
            actorRoles: subject ? [...subject.roles] : [],
            entityType: 'Route',
            entityId: routeKey(route),
            entityLabel: routeKey(route),
            correlationId,
            requestId,
            portal: route.portal === 'SYSTEM' ? null : route.portal,
            policyName: decision.policyName,
            denyReason: decision.reason,
            ipAddress: request.ip,
            detail: {
              route: route.url,
              policyName: decision.policyName,
              reasonDetail: decision.reason,
            },
          });

          const code =
            decision.code === 'UNAUTHENTICATED'
              ? 'UNAUTHENTICATED'
              : decision.code === 'PORTAL_ACCESS_DENIED'
                ? 'PORTAL_ACCESS_DENIED'
                : 'FORBIDDEN';

          const problem = toProblem({
            code,
            correlationId,
            instance: request.url,
            detail: decision.reason,
          });
          return reply.status(problem.status).type('application/problem+json').send(problem);
        }

        // P3: the scope travels with the request so the handler must thread it
        // into the repository rather than re-deriving it.
        request.routeContext = {
          subject: subject as Subject,
          scope: decision.scope,
          correlationId,
          requestId: request.correlation?.requestId ?? 'r-unknown',
          portal: route.portal,
        };
        return undefined;
      },

      handler: async (request, reply) => {
        const ctx = request.routeContext;
        if (!ctx) {
          // Unreachable: preHandler either sets it or replies. Asserted rather
          // than assumed, because the alternative is an unauthorized handler.
          throw new Error(`Route ${routeKey(route)} ran without a route context.`);
        }
        return route.handler(ctx, request, reply, deps);
      },
    });
  }
};

declare module 'fastify' {
  interface FastifyRequest {
    routeContext?: RouteContext;
  }
}
