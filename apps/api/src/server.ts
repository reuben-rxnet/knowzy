// Knowzy API — Phase 1 surface.
//
// Phase 1 builds the request pipeline and the internal health surface only.
// The business namespaces (/api/v1/admin, /authoring, /learning, /reporting,
// /audit, /public) arrive with the phases that own them; adding an empty route
// now would create a route with no declared policy, which the registry test in
// access-control.md §4.3 P1 exists to forbid.
//
// What IS built here is the part every later route depends on: correlation,
// security headers, and the problem+json error contract.

import Fastify, { type FastifyInstance } from 'fastify';
import {
  ERROR_REGISTRY,
  PROBLEM_TYPE_BASE,
  type ErrorCode,
  type ProblemDetails,
} from '@knowzy/shared-types';
import { startCorrelation, type Logger } from '@knowzy/observability';
import type { StartupReport } from '@knowzy/configuration';

export interface ServerDeps {
  readonly logger: Logger;
  readonly environment: string;
  /** Re-evaluated by the readiness probe so a recovered dependency is noticed. */
  readonly readiness: () => Promise<StartupReport>;
  readonly startupReport: StartupReport;
}

/** Builds a problem+json body. E7: codes carry no dynamic content. */
export const toProblem = (args: {
  code: ErrorCode;
  correlationId: string;
  instance: string;
  detail?: string;
  details?: Record<string, unknown> | null;
  retryAfterSeconds?: number | null;
}): ProblemDetails => {
  const definition = ERROR_REGISTRY[args.code];
  return {
    type: `${PROBLEM_TYPE_BASE}${args.code}`,
    title: args.code
      .toLowerCase()
      .split('_')
      .join(' ')
      .replace(/^./, (c) => c.toUpperCase()),
    status: definition.status,
    code: args.code,
    category: definition.category,
    detail: args.detail ?? definition.message,
    retryable: definition.retryable,
    retryAfterSeconds: args.retryAfterSeconds ?? null,
    correlationId: args.correlationId,
    instance: args.instance,
    details: args.details ?? null,
    fieldErrors: null,
    gateFailures: null,
  };
};

export const buildServer = (deps: ServerDeps): FastifyInstance => {
  const app = Fastify({
    logger: false,
    // The API mints the correlation ID; a client value never becomes it (N1),
    // so Fastify's own request-id generation is not used as one.
    genReqId: () => startCorrelation().requestId,
    trustProxy: true,
    bodyLimit: 1_048_576,
  });

  // ---------------------------------------------------------------- pipeline
  app.addHook('onRequest', async (request, reply) => {
    const context = startCorrelation(request.headers['x-client-trace-id'] as string | undefined);
    request.correlation = context;

    // security.md §4. Set on every response including errors.
    reply.headers({
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'x-correlation-id': context.correlationId,
      'permissions-policy': 'camera=(), microphone=(), geolocation=()',
      'cross-origin-opener-policy': 'same-origin',
      'strict-transport-security': 'max-age=31536000; includeSubDomains',
    });
  });

  // A1/A4: nothing under the learning namespace is cacheable. Applied at the
  // pipeline level so a future route cannot forget it.
  app.addHook('onSend', async (request, reply, payload) => {
    if (request.url.startsWith('/api/v1/learning')) {
      reply.header('cache-control', 'no-store');
    }
    return payload;
  });

  // -------------------------------------------------------- error contract
  app.setErrorHandler((error, request, reply) => {
    const correlationId = request.correlation?.correlationId ?? 'c-unknown';
    const code: ErrorCode =
      error.statusCode === 404
        ? 'NOT_FOUND'
        : error.statusCode === 400
          ? 'VALIDATION_FAILED'
          : 'INTERNAL_ERROR';

    // F7/§10.1: plain language, a correlation ID, and nothing else. No stack,
    // no internal identifier, no provider body.
    deps.logger.error('request failed', {
      correlationId,
      route: request.url,
      method: request.method,
      statusCode: error.statusCode ?? 500,
      errorName: error.name,
    });

    const problem = toProblem({ code, correlationId, instance: request.url });
    reply.status(problem.status).type('application/problem+json').send(problem);
  });

  app.setNotFoundHandler((request, reply) => {
    const problem = toProblem({
      code: 'NOT_FOUND',
      correlationId: request.correlation?.correlationId ?? 'c-unknown',
      instance: request.url,
    });
    reply.status(problem.status).type('application/problem+json').send(problem);
  });

  // ------------------------------------------------------- internal routes
  // Not internet-exposed (architecture.md §7.1).

  app.get('/internal/health/live', async () => ({
    status: 'live',
    environment: deps.environment,
  }));

  app.get('/internal/health/ready', async (_request, reply) => {
    // Re-evaluated rather than cached, so a dependency that recovers is
    // noticed without a restart. Checks 7, 8, and 12 gate readiness only —
    // liveness stays healthy so a transient outage does not crash-loop the
    // platform (§9).
    const report = await deps.readiness();
    const failing = report.checks
      .filter((c) => c.disposition === 'READINESS' && c.result === 'FAIL')
      .map((c) => c.id);

    if (!report.ready) {
      reply.status(503);
      return { status: 'not-ready', failing, environment: deps.environment };
    }
    return { status: 'ready', environment: deps.environment };
  });

  app.get('/internal/health/startup', async () => ({
    environment: deps.startupReport.environment,
    deployable: deps.startupReport.deployable,
    // Safe to expose on an internal route: the report carries check ids and
    // safe messages, never a credential (asserted in the startup test suite).
    checks: deps.startupReport.checks.map((c) => ({
      id: c.id,
      result: c.result,
      disposition: c.disposition,
      detail: c.detail,
    })),
    forcedOffFlags: deps.startupReport.forcedOffFlags,
  }));

  app.get('/internal/metrics', async (_request, reply) => {
    // Prometheus exposition arrives with the OpenTelemetry wiring in Phase 11;
    // an empty 200 here would claim a metrics endpoint that reports nothing.
    reply.status(501).type('text/plain').send('# metrics not implemented in Phase 1\n');
  });

  return app;
};

declare module 'fastify' {
  interface FastifyRequest {
    correlation?: { correlationId: string; requestId: string; clientTraceId?: string };
  }
}
