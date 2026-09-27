// P-5 and OPENAI-CODEX-00, end to end, against the real API and database.
//
// The whole path an administrator takes, through `buildServer` with real
// routes, a real subject resolver and PostgreSQL, a TEMPORARY local secure
// store holding a fake key, and a FAKE OPENAI on 127.0.0.1 — so nothing here
// touches the network or a real credential:
//
//   PUT  settings (localstore:// reference, base URL -> the fake)
//   POST validate -> secret resolved, endpoint + auth + model PASSED,
//                    readiness BLOCKED_BY_APPROVAL (no approval recorded)
//
// and then the promises P-5 makes, checked against every row it wrote:
//
//   * the key appears in NO audit_event and NO configuration_change row, and
//     in no response body;
//   * the REFERENCE appears in neither table either -- only its fingerprint;
//   * every audit row the path wrote has its keys declared (no _droppedKeys);
//   * the fake received the key ONLY in an Authorization header;
//   * a reference re-saved without the key box keeps the recorded reference.
//
// The provider settings row is restored afterwards: this suite shares the
// development database with everything else.

import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createSubjectResolver } from '@knowzy/authentication';
import { createAuditWriter, subjectLookupRepository } from '@knowzy/database';
import { createLocalSecureStore } from '@knowzy/configuration';
import { nullLogger, systemClock } from '@knowzy/observability';
import { buildServer } from '../src/server.js';
import type { RouteDeps } from '../src/http/route.js';

const DATABASE_URL = process.env['DATABASE_URL'];
const describeDb = DATABASE_URL ? describe : describe.skip;

const KEY = 'sk-proj-INTEGRATION-FAKE-KEY-9f8e7d6c5b4a3210';
/** Any recognisable PART of the key -- a truncated leak is still a leak. */
const KEY_FRAGMENT = 'INTEGRATION-FAKE-KEY';
const REFERENCE = 'localstore://openai-integration-key';
const ADMIN = 'knowzy-administrator@local.invalid';

const prisma = new PrismaClient(
  DATABASE_URL ? { datasources: { db: { url: DATABASE_URL } } } : undefined,
);

interface Received {
  readonly path: string;
  readonly authorization: string | undefined;
  readonly rawHeaders: string;
}

describeDb('provider readiness, end to end (P-5, OPENAI-CODEX-00)', () => {
  let fake: Server;
  let port = 0;
  const received: Received[] = [];
  let storeDir = '';
  let app: ReturnType<typeof buildServer>;
  let previousSettings: unknown = undefined;
  let hadRow = false;
  const startedAt = new Date();

  beforeAll(async () => {
    fake = createServer((request: IncomingMessage, response) => {
      received.push({
        path: request.url ?? '',
        authorization: request.headers['authorization'],
        rawHeaders: request.rawHeaders.join('\n'),
      });
      const ok = request.headers['authorization'] === `Bearer ${KEY}`;
      response.setHeader('content-type', 'application/json');
      if (!ok) {
        response.statusCode = 401;
        response.end(JSON.stringify({ error: { code: 'invalid_api_key', message: 'nope' } }));
        return;
      }
      response.setHeader('x-ratelimit-limit-requests', '500');
      response.statusCode = 200;
      response.end(
        JSON.stringify(request.url?.endsWith('/models') ? { data: [] } : { id: 'gpt-5-codex' }),
      );
    });
    await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
    port = (fake.address() as AddressInfo).port;

    storeDir = await mkdtemp(join(tmpdir(), 'knowzy-p5-'));
    const store = createLocalSecureStore(storeDir);
    await store.init();
    await store.set('openai-integration-key', KEY);

    const row = await prisma.applicationConfiguration.findFirst({
      where: { key: 'llm.providerSettings', scope: 'PLATFORM', scopeId: null },
      select: { value: true },
    });
    hadRow = row !== null;
    previousSettings = row?.value;

    const deps: RouteDeps = {
      prisma: prisma as never,
      auditWriter: createAuditWriter({ clock: systemClock }),
      logger: nullLogger,
      mcp: {} as never,
      providers: {} as never,
      secrets: {
        environment: 'local',
        localSecretDir: storeDir,
        keyVaultUri: null,
        extraAllowedHosts: [`127.0.0.1:${port}`],
      },
      resolveSubject: (headers) =>
        createSubjectResolver({
          environment: 'local',
          lookup: subjectLookupRepository(prisma as never),
        }).resolve(headers),
    };
    const report = {
      deployable: 'api' as const,
      environment: 'local',
      checks: [],
      fatal: false,
      ready: true,
      forcedOffFlags: [],
      findings: [],
    };
    app = buildServer({
      logger: nullLogger,
      environment: 'local',
      startupReport: report,
      readiness: async () => report,
      routeDeps: deps,
    });
  });

  afterAll(async () => {
    // Restore the provider settings exactly as found.
    if (hadRow) {
      await prisma.applicationConfiguration.updateMany({
        where: { key: 'llm.providerSettings', scope: 'PLATFORM', scopeId: null },
        data: { value: previousSettings as never },
      });
    } else {
      await prisma.applicationConfiguration.deleteMany({
        where: { key: 'llm.providerSettings', scope: 'PLATFORM', scopeId: null },
      });
    }
    await app?.close();
    await new Promise<void>((resolve) => fake.close(() => resolve()));
    await rm(storeDir, { recursive: true, force: true });
    await prisma.$disconnect();
  });

  const call = (method: 'PUT' | 'POST' | 'GET', url: string, body?: unknown) =>
    app.inject({
      method,
      url,
      headers: {
        'x-knowzy-subject': ADMIN,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    });

  it('records OpenAI settings with a localstore:// reference', async () => {
    const response = await call(
      'PUT',
      '/api/v1/authoring/administration/providers/OPENAI/settings',
      {
        enabled: false,
        displayName: 'OpenAI (Codex)',
        baseUrl: `http://127.0.0.1:${port}/v1`,
        modelId: 'gpt-5-codex',
        apiKeyRef: REFERENCE,
        temperature: 0.2,
        maxOutputTokens: 4000,
      },
    );
    expect(response.statusCode, response.body).toBe(200);
    expect(response.body).not.toContain(KEY);
  });

  it('refuses a pasted key in the reference box', async () => {
    const response = await call(
      'PUT',
      '/api/v1/authoring/administration/providers/OPENAI/settings',
      {
        apiKeyRef: KEY,
      },
    );
    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain(KEY);
  });

  it('KEEPS the recorded reference when the settings are re-saved without it', async () => {
    const response = await call(
      'PUT',
      '/api/v1/authoring/administration/providers/OPENAI/settings',
      {
        enabled: false,
        baseUrl: `http://127.0.0.1:${port}/v1`,
        modelId: 'gpt-5-codex',
      },
    );
    expect(response.statusCode, response.body).toBe(200);
    const read = await call('GET', '/api/v1/authoring/administration/providers');
    const openai = JSON.parse(read.body).providers.find(
      (row: { providerId: string }) => row.providerId === 'OPENAI',
    );
    expect(openai.credentialReference).toBe(REFERENCE);
    expect(openai.credentialSource).toBe('LOCAL_SECURE_STORE');
    expect(openai.capabilities).toEqual({
      supportsGeneration: true,
      supportsCostReporting: true,
      supportsTokenReporting: true,
      supportsStreaming: true,
      retrievalFree: true,
    });
  });

  it('Test connection resolves the secret, authenticates, finds the model -- and stops before generation', async () => {
    const response = await call(
      'POST',
      '/api/v1/authoring/administration/providers/OPENAI/validate',
    );
    expect(response.statusCode, response.body).toBe(200);
    expect(response.body).not.toContain(KEY_FRAGMENT);
    const report = JSON.parse(response.body);

    const result = (check: string) =>
      report.steps.find((step: { check: string }) => step.check === check)?.result;
    expect(result('SECRET_RESOLUTION')).toBe('PASSED');
    expect(result('ENDPOINT')).toBe('PASSED');
    expect(result('AUTHENTICATION')).toBe('PASSED');
    expect(result('MODEL')).toBe('PASSED');
    expect(result('GENERATION')).toBe('NOT_ATTEMPTED');
    // T-29 is open: technically ready, not approved.
    expect(result('APPROVAL')).toBe('FAILED');
    expect(report.readiness.state).toBe('BLOCKED_BY_APPROVAL');
    expect(report.limits.requestsPerMinute).toBe(500);

    // The fake saw the key only in the Authorization header, and only on the
    // two metadata paths.
    expect(received.map((r) => r.path)).toEqual(['/v1/models', '/v1/models/gpt-5-codex']);
    for (const r of received) {
      expect(r.authorization).toBe(`Bearer ${KEY}`);
      expect(r.path).not.toContain(KEY);
    }
  });

  it('shows the readiness on AI Usage & Budgets as well, derived the same way', async () => {
    const response = await call('GET', '/api/v1/authoring/governance/ai-usage');
    expect(JSON.parse(response.body).readiness.OPENAI.state).toBe('BLOCKED_BY_APPROVAL');
  });

  it('reports the secret sources without a name or a value', async () => {
    const response = await call('GET', '/api/v1/authoring/administration/secrets');
    const body = JSON.parse(response.body);
    const local = body.sources.find((s: { source: string }) => s.source === 'LOCAL_SECURE_STORE');
    expect(local).toMatchObject({ reachable: true, secretCount: 1 });
    expect(response.body).not.toContain('openai-integration-key');
    expect(response.body).not.toContain(KEY);
  });

  it('wrote the audit trail P-5 declares -- and no row holds the key or the reference', async () => {
    const audits = await prisma.$queryRawUnsafe<{ action: string; row: string; detail: string }[]>(
      `SELECT action, row_to_json(a)::text AS row, detail::text AS detail
         FROM audit_event a
        WHERE occurred_at >= $1 AND action LIKE 'ADMIN.CONFIGURATION.%'`,
      startedAt,
    );
    const actions = audits.map((a) => a.action);
    for (const expected of [
      'ADMIN.CONFIGURATION.PROVIDER_UPDATED',
      'ADMIN.CONFIGURATION.SECRET_REFERENCE_CREATED',
      'ADMIN.CONFIGURATION.SECRET_VALIDATED',
      'ADMIN.CONFIGURATION.PROVIDER_VALIDATED',
    ]) {
      expect(actions, expected).toContain(expected);
    }
    for (const audit of audits) {
      expect(audit.row, audit.action).not.toContain(KEY_FRAGMENT);
      expect(audit.row, audit.action).not.toContain('localstore://');
      expect(audit.detail, `${audit.action} dropped a key`).not.toContain('_droppedKeys');
    }

    const changes = await prisma.$queryRawUnsafe<{ row: string }[]>(
      `SELECT row_to_json(c)::text AS row FROM configuration_change c WHERE changed_at >= $1`,
      startedAt,
    );
    expect(changes.length).toBeGreaterThan(0);
    for (const change of changes) {
      expect(change.row).not.toContain(KEY_FRAGMENT);
      expect(change.row).not.toContain('localstore://');
    }

    const validations = await prisma.$queryRawUnsafe<{ row: string }[]>(
      `SELECT row_to_json(v)::text AS row FROM generation_provider_validation v WHERE validated_at >= $1`,
      startedAt,
    );
    for (const validation of validations) expect(validation.row).not.toContain(KEY_FRAGMENT);
  });
});
