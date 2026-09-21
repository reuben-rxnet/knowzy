// A POST that declares a JSON body and sends none is rejected, and that is the
// constraint the portals' API clients have to respect.
//
// This pins the server half of a real defect. Both portals' `api()` helper sent
// `content-type: application/json` on every call, including the POSTs that
// carry no body — "Finish and score", Test connection, Claim, Submit, and the
// three assessment steps. Fastify rejects such a request while parsing the
// body, before any handler or policy runs, and the API maps that to
// `VALIDATION_FAILED`. So the learner saw "Validation failed / Some of the
// information supplied is not valid" on a button that sends no information at
// all, and no amount of reading the scoring code explained it.
//
// The clients were fixed (they now send the header only with a body). This
// suite states why that fix is required, so the two halves cannot drift: if the
// API ever becomes tolerant of an empty JSON body, this is the test that says
// so out loud rather than a client quietly depending on the old behaviour.

import { describe, expect, it } from 'vitest';
import type { AuditWriter, PrismaClient } from '@knowzy/database';
import { nullLogger } from '@knowzy/observability';
import { buildServer } from '../src/server.js';
import type { RouteDeps } from '../src/http/route.js';

const stubDeps = (): RouteDeps => ({
  prisma: {} as PrismaClient,
  auditWriter: { write: async () => ({}) as never, writeMany: async () => 0 } as AuditWriter,
  logger: nullLogger,
  // Body parsing happens before any handler, so no identity is needed to
  // observe it — and refusing every subject keeps this suite away from the
  // database entirely.
  resolveSubject: async () => null,
});

const readinessReport = {
  deployable: 'api' as const,
  environment: 'test',
  checks: [],
  fatal: false,
  ready: true,
  forcedOffFlags: [],
  findings: [],
};

const server = () =>
  buildServer({
    logger: nullLogger,
    environment: 'test',
    startupReport: readinessReport,
    readiness: async () => readinessReport,
    routeDeps: stubDeps(),
  });

// The learner's "Finish and score" is the reported case; the others are the
// same request shape on the other three surfaces it broke.
const BODYLESS_POSTS: readonly string[] = [
  '/api/v1/learning/sessions/01a0c399-0000-7000-8000-000000000000/complete',
  '/api/v1/authoring/sources/01a0c399-0000-7000-8000-000000000000/test-connection',
  '/api/v1/authoring/questions/01a0c399-0000-7000-8000-000000000000/claim',
  '/api/v1/authoring/assessments/01a0c399-0000-7000-8000-000000000000/submit',
];

describe('a POST with no body must not declare one', () => {
  it('rejects an empty body that claims to be JSON, before the handler runs', async () => {
    const app = server();
    try {
      for (const url of BODYLESS_POSTS) {
        const response = await app.inject({
          method: 'POST',
          url,
          headers: {
            'content-type': 'application/json',
            'x-knowzy-subject': 'learner@local.invalid',
            'idempotency-key': 'empty-json-body-regression',
          },
        });

        expect(response.statusCode, url).toBe(400);
        expect(JSON.parse(response.body).code, url).toBe('VALIDATION_FAILED');
      }
    } finally {
      await app.close();
    }
  });

  it('accepts the same request when it does not claim to carry JSON', async () => {
    const app = server();
    try {
      for (const url of BODYLESS_POSTS) {
        const response = await app.inject({
          method: 'POST',
          url,
          headers: {
            'x-knowzy-subject': 'learner@local.invalid',
            'idempotency-key': 'empty-json-body-regression',
          },
        });

        // What comes back depends on the stubbed identity — the point is that
        // the request got PAST body parsing, so it is no longer a validation
        // failure about information the caller never sent.
        expect(response.statusCode, url).not.toBe(400);
      }
    } finally {
      await app.close();
    }
  });
});
