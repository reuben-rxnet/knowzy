// Exit criterion (implementation-roadmap.md Phase 2):
// "The policy registry test passes: EVERY route has a declared policy, and a
//  planted undeclared handler fails the build."
//
// access-control.md §4.3 P1 puts it more bluntly: "there is no 'trusted
// internal' path". This suite is what makes that checkable rather than
// aspirational — it enumerates what Fastify actually registered and compares it
// with the declared registry, so the two cannot drift.

import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { isPolicyName, POLICY_NAMES } from '@knowzy/authorization';
import { nullLogger } from '@knowzy/observability';
import type { AuditWriter, PrismaClient } from '@knowzy/database';
import { buildServer } from '../src/server.js';
import { registerRoutes, routeKey, type KnowzyRoute, type RouteDeps } from '../src/http/route.js';
import { ALL_ROUTES } from '../src/routes/index.js';

/**
 * Routes that are deliberately not policy-gated: the internal health and
 * metrics surface. They are not internet-exposed (architecture.md §7.1) and
 * carry no tenant data. Anything else appearing here is a finding.
 */
const UNGATED_PREFIXES = ['/internal/'];

const stubDeps = (): RouteDeps => ({
  prisma: {} as PrismaClient,
  auditWriter: { write: async () => ({}) as never, writeMany: async () => 0 } as AuditWriter,
  logger: nullLogger,
  resolveSubject: async () => null,
});

/** Collects what Fastify actually registered, via the onRoute hook. */
const collectRegisteredRoutes = (routes: readonly KnowzyRoute[] = ALL_ROUTES): string[] => {
  const seen: string[] = [];
  const app = Fastify({ logger: false });
  app.addHook('onRoute', (r) => {
    const methods = Array.isArray(r.method) ? r.method : [r.method];
    for (const m of methods) {
      if (m === 'HEAD') continue;
      seen.push(`${m} ${r.url}`);
    }
  });
  registerRoutes(app, routes, stubDeps());
  return seen;
};

describe('policy registry completeness', () => {
  it('declares a valid policy for every route in the registry', () => {
    expect(ALL_ROUTES.length).toBeGreaterThan(0);
    for (const route of ALL_ROUTES) {
      expect(isPolicyName(route.policy), `${routeKey(route)} -> ${route.policy}`).toBe(true);
      expect(POLICY_NAMES, routeKey(route)).toContain(route.policy);
      expect(route.summary.trim().length, routeKey(route)).toBeGreaterThan(0);
    }
  });

  it('registers exactly the routes the registry declares', () => {
    const registered = collectRegisteredRoutes().sort();
    const declared = ALL_ROUTES.map(routeKey).sort();
    expect(registered).toEqual(declared);
  });

  it('gates every /api route on the full server, leaving only /internal ungated', () => {
    const gated = new Set(ALL_ROUTES.map(routeKey));
    const seen: string[] = [];

    const app = buildServer({
      logger: nullLogger,
      environment: 'test',
      startupReport: {
        deployable: 'api',
        environment: 'test',
        checks: [],
        fatal: false,
        ready: true,
        forcedOffFlags: [],
        findings: [],
      },
      readiness: async () => ({
        deployable: 'api',
        environment: 'test',
        checks: [],
        fatal: false,
        ready: true,
        forcedOffFlags: [],
        findings: [],
      }),
      routeDeps: stubDeps(),
    });

    // Fastify exposes its routing table once ready; printRoutes is the stable
    // way to read it without depending on internals.
    const table = app.printRoutes({ commonPrefix: false });
    for (const line of table.split('\n')) {
      const match = /^\s*[└├─\s]*(\/\S*)\s+\((.+)\)\s*$/.exec(line);
      if (!match) continue;
      const [, url, methods] = match;
      for (const method of (methods ?? '').split(',').map((m) => m.trim())) {
        if (method === 'HEAD' || method.length === 0) continue;
        seen.push(`${method} ${url}`);
      }
    }

    const ungoverned = seen.filter(
      (key) => !gated.has(key) && !UNGATED_PREFIXES.some((p) => key.includes(p)),
    );

    expect(
      ungoverned,
      'every route must declare a policy; only /internal/* may be ungated',
    ).toEqual([]);
  });
});

describe('a planted undeclared route is caught', () => {
  it('fails the registered-vs-declared comparison', () => {
    // The type system already forbids a route without a `policy`. What this
    // asserts is the other half: a route registered OUTSIDE the registry is
    // detected, which is the realistic mistake — someone calls app.get()
    // directly and bypasses registerRoutes entirely.
    const app = Fastify({ logger: false });
    const seen: string[] = [];
    app.addHook('onRoute', (r) => {
      const methods = Array.isArray(r.method) ? r.method : [r.method];
      for (const m of methods) if (m !== 'HEAD') seen.push(`${m} ${r.url}`);
    });

    registerRoutes(app, ALL_ROUTES, stubDeps());
    // The bypass.
    app.get('/api/v1/authoring/planted-undeclared', async () => ({ ok: true }));

    const declared = new Set(ALL_ROUTES.map(routeKey));
    const ungoverned = seen.filter((k) => !declared.has(k));

    expect(ungoverned).toEqual(['GET /api/v1/authoring/planted-undeclared']);
  });
});

describe('policy catalogue', () => {
  it('names each policy after a permission an administrator can grant', () => {
    for (const name of POLICY_NAMES) {
      expect(name, name).toMatch(/^[a-z][a-z.]*[a-z]$/);
    }
  });
});
