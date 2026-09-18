// Subject introspection.
//
// Exists so the authorization spine is observable end to end: it proves a
// subject was resolved from the database, a policy was evaluated, and a
// DataScope was constructed and threaded to the handler.
//
// It returns the subject's own resolved access and nothing else — no other
// user's data, and no permission it does not hold.

import { defineRoute } from '../http/route.js';

export const whoamiRoutes = [
  defineRoute({
    method: 'GET',
    url: '/api/v1/authoring/whoami',
    policy: 'source.read',
    portal: 'AUTHORING',
    summary: 'The caller\u2019s resolved identity, roles, permissions, and data scope.',
    handler: async (ctx) => ({
      subject: {
        userId: ctx.subject.userId,
        displayName: ctx.subject.displayName,
        status: ctx.subject.status,
        roles: ctx.subject.roles,
        permissionCount: ctx.subject.permissions.length,
      },
      // Surfaced because "empty means unrestricted" is the rule most easily got
      // backwards (access-control.md §5); seeing it is how an operator
      // confirms a scope is intentional rather than accidental.
      dataScope: {
        domainIds: ctx.scope.domainIds,
        teamIds: ctx.scope.teamIds,
        sourceIds: ctx.scope.sourceIds,
        denySourceIds: ctx.scope.denySourceIds,
        interpretation: {
          domains: ctx.scope.domainIds.length === 0 ? 'unrestricted' : 'restricted',
          teams: ctx.scope.teamIds.length === 0 ? 'unrestricted' : 'restricted',
          sources: ctx.scope.sourceIds.length === 0 ? 'no allow-list' : 'allow-list applies',
        },
      },
      correlationId: ctx.correlationId,
    }),
  }),

  defineRoute({
    method: 'GET',
    url: '/api/v1/learning/whoami',
    policy: 'learning.access',
    portal: 'LIVE',
    summary: 'The learner\u2019s own resolved identity. Own-scoped only.',
    handler: async (ctx) => ({
      subject: {
        userId: ctx.subject.userId,
        displayName: ctx.subject.displayName,
        roles: ctx.subject.roles,
      },
      correlationId: ctx.correlationId,
    }),
  }),
] as const;
