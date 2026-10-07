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
// GATEWAY-M1 adds a FAKE AZURE API MANAGEMENT GATEWAY on the same server,
// under /gateway: it takes the key as a `subscription-key` QUERY PARAMETER,
// wants a fixed `x-openai-supplier` header, exposes no /models route (404 with
// the key, 401 without), and quotes the key in its error body. The suite then
// checks that Test connection reports that honestly -- authentication by
// comparison, model discovery SKIPPED -- sends no body and no content, and
// that no response, audit row, configuration change or LOG LINE holds the key
// or a credential-bearing URL.
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
import { systemClock, type Logger } from '@knowzy/observability';
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
  readonly method: string;
  readonly authorization: string | undefined;
  readonly supplier: string | undefined;
  readonly contentLength: string | undefined;
  readonly rawHeaders: string;
}

/** Every line the API logs during the suite, so "no log holds the key" is checked, not assumed. */
const logged: string[] = [];
const capture = (level: string) => (message: string, context?: unknown) => {
  logged.push(`${level} ${message} ${JSON.stringify(context ?? {})}`);
};
const captureLogger: Logger = {
  debug: capture('debug'),
  info: capture('info'),
  warn: capture('warn'),
  error: capture('error'),
  child: () => captureLogger,
};

describeDb('provider readiness, end to end (P-5, OPENAI-CODEX-00)', () => {
  let fake: Server;
  let port = 0;
  const received: Received[] = [];
  let storeDir = '';
  let app: ReturnType<typeof buildServer>;
  let previousSettings: unknown = undefined;
  let hadRow = false;
  /** llm.approvedProviders as found, restored exactly afterwards. */
  let previousApproved: unknown = undefined;
  const startedAt = new Date();

  beforeAll(async () => {
    fake = createServer((request: IncomingMessage, response) => {
      received.push({
        path: request.url ?? '',
        method: request.method ?? '',
        authorization: request.headers['authorization'],
        supplier: request.headers['x-openai-supplier'] as string | undefined,
        contentLength: request.headers['content-length'],
        rawHeaders: request.rawHeaders.join('\n'),
      });
      response.setHeader('content-type', 'application/json');

      // GATEWAY-M1: the fake API Management gateway.
      if ((request.url ?? '').startsWith('/gateway/')) {
        const url = new URL(request.url ?? '', 'http://127.0.0.1');
        const keyed = url.searchParams.get('subscription-key') === KEY;
        const routed = request.headers['x-openai-supplier'] === 'EssilorLuxottica';
        response.statusCode = keyed && routed ? 404 : 401;
        response.end(
          JSON.stringify({ statusCode: response.statusCode, message: `denied for ${KEY}` }),
        );
        return;
      }

      const ok = request.headers['authorization'] === `Bearer ${KEY}`;
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

    // THE SUITE ASSUMES OPENAI UNAPPROVED (APPROVAL is expected to FAIL and the
    // gate to read BLOCKED_BY_APPROVAL). On a machine where a real approval is
    // recorded -- as since 2026-09-28 -- that premise is ESTABLISHED here, not
    // assumed: the value is set for the suite and restored exactly afterwards.
    // Written directly, like the settings row above, so the real approval's
    // AUDIT HISTORY is never touched by a test.
    const approved = await prisma.applicationConfiguration.findFirst({
      where: { key: 'llm.approvedProviders', scope: 'PLATFORM', scopeId: null },
      select: { value: true },
    });
    previousApproved = approved?.value;
    if (approved !== null) {
      await prisma.applicationConfiguration.updateMany({
        where: { key: 'llm.approvedProviders', scope: 'PLATFORM', scopeId: null },
        data: {
          value: ((approved.value as unknown[]) ?? []).filter((id) => id !== 'OPENAI') as never,
        },
      });
    }

    const deps: RouteDeps = {
      prisma: prisma as never,
      auditWriter: createAuditWriter({ clock: systemClock }),
      logger: captureLogger,
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
      logger: captureLogger,
      environment: 'local',
      startupReport: report,
      readiness: async () => report,
      routeDeps: deps,
    });
  });

  afterAll(async () => {
    if (previousApproved !== undefined) {
      await prisma.applicationConfiguration.updateMany({
        where: { key: 'llm.approvedProviders', scope: 'PLATFORM', scopeId: null },
        data: { value: previousApproved as never },
      });
    }
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

  it('GATEWAY-M1: Test connection speaks to an APIM gateway -- query-parameter key, fixed header, honest SKIP', async () => {
    received.length = 0;
    const put = await call('PUT', '/api/v1/authoring/administration/providers/OPENAI/settings', {
      enabled: false,
      displayName: 'Codex via Azure APIM',
      baseUrl: `http://127.0.0.1:${port}/gateway/codex/openai/v1`,
      modelId: 'gpt-5.3-codex_codeassist',
      apiKeyRef: REFERENCE,
      apiStyle: 'RESPONSES',
      authLocation: 'QUERY_PARAMETER',
      authQueryParameterName: 'subscription-key',
      extraHeaders: { 'x-openai-supplier': 'EssilorLuxottica' },
    });
    expect(put.statusCode, put.body).toBe(200);
    expect(put.body).not.toContain(KEY_FRAGMENT);

    const response = await call(
      'POST',
      '/api/v1/authoring/administration/providers/OPENAI/validate',
    );
    expect(response.statusCode, response.body).toBe(200);
    expect(response.body).not.toContain(KEY_FRAGMENT);
    expect(response.body).not.toContain('subscription-key=');
    expect(response.body).not.toContain('denied for');
    const report = JSON.parse(response.body);
    const result = (check: string) =>
      report.steps.find((step: { check: string }) => step.check === check)?.result;
    expect(result('SECRET_RESOLUTION')).toBe('PASSED');
    expect(result('ENDPOINT')).toBe('PASSED');
    expect(result('AUTHENTICATION')).toBe('PASSED');
    expect(result('MODEL')).toBe('SKIPPED');
    expect(result('MODEL_EXECUTION')).toBe('NOT_ATTEMPTED');
    expect(result('GENERATION')).toBe('NOT_ATTEMPTED');
    expect(result('APPROVAL')).toBe('FAILED');
    expect(report.outcome).not.toBe('PASSED');
    expect(report.readiness.state).toBe('BLOCKED_BY_APPROVAL');
    expect(report.readiness.reason).toMatch(/model is unverified/);

    // Exactly two content-free GETs to /models: keyed, then anonymous. No
    // body, no prompt, no Authorization header, and the fixed header on both.
    expect(received.map((r) => r.method)).toEqual(['GET', 'GET']);
    expect(received.every((r) => r.contentLength === undefined)).toBe(true);
    expect(
      received.every(
        (r) => new URL(r.path, 'http://x').pathname === '/gateway/codex/openai/v1/models',
      ),
    ).toBe(true);
    expect(received.every((r) => r.supplier === 'EssilorLuxottica')).toBe(true);
    expect(received.every((r) => r.authorization === undefined)).toBe(true);
    expect(new URL(received[0]?.path ?? '', 'http://x').searchParams.get('subscription-key')).toBe(
      KEY,
    );
    expect(received[1]?.path).not.toContain(KEY);

    // The screen's read shows the configuration and never the key.
    const read = await call('GET', '/api/v1/authoring/administration/providers');
    expect(read.body).not.toContain(KEY_FRAGMENT);
    const openai = JSON.parse(read.body).providers.find(
      (row: { providerId: string }) => row.providerId === 'OPENAI',
    );
    expect(openai).toMatchObject({
      authLocation: 'QUERY_PARAMETER',
      authQueryParameterName: 'subscription-key',
      extraHeaders: { 'x-openai-supplier': 'EssilorLuxottica' },
      credentialConfigured: true,
      state: 'BLOCKED_BY_APPROVAL',
    });
  });

  it('GATEWAY-M1: generation stays blocked without an approval -- it cannot even be made active', async () => {
    const response = await call('PUT', '/api/v1/authoring/administration/active-provider', {
      providerId: 'OPENAI',
    });
    expect(response.statusCode).not.toBe(200);
    expect(response.body).not.toContain(KEY_FRAGMENT);
  });

  it('GATEWAY-M1: refuses a fixed header that would carry a secret, and names it', async () => {
    const response = await call(
      'PUT',
      '/api/v1/authoring/administration/providers/OPENAI/settings',
      {
        baseUrl: `http://127.0.0.1:${port}/gateway/codex/openai/v1`,
        modelId: 'gpt-5.3-codex_codeassist',
        authLocation: 'QUERY_PARAMETER',
        authQueryParameterName: 'subscription-key',
        extraHeaders: { 'Ocp-Apim-Subscription-Key': KEY },
      },
    );
    expect(response.statusCode).toBe(400);
    expect(response.body).toMatch(/looks like a credential/);
    expect(response.body).not.toContain(KEY_FRAGMENT);
  });

  // The Author identity was retired by the Authoring Role Simplification
  // (2026-10-07); the screen's provider menu is read by the administrator.
  it('GEN-PROVIDER-M1: the provider choices are readable, and nothing configurational leaks', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/authoring/generation/providers',
      headers: { 'x-knowzy-subject': 'knowzy-administrator@local.invalid' },
    });
    expect(response.statusCode, response.body).toBe(200);
    for (const secretish of [
      KEY_FRAGMENT,
      'localstore://',
      '127.0.0.1',
      'subscription-key',
      'x-openai-supplier',
    ]) {
      expect(response.body, secretish).not.toContain(secretish);
    }
    const body = JSON.parse(response.body) as {
      activeProvider: string;
      providers: { providerId: string; available: boolean; state: string; reason: string }[];
    };
    const deterministic = body.providers.find((p) => p.providerId === 'DETERMINISTIC_LOCAL');
    expect(deterministic?.available).toBe(true);
    // OpenAI is disabled and unapproved in this suite: listed, with its reason, and not available.
    const openai = body.providers.find((p) => p.providerId === 'OPENAI');
    expect(openai?.available).toBe(false);
    expect(openai?.reason.length).toBeGreaterThan(10);
  });

  it('GATEWAY-M1: no log line holds the key or a credential-bearing URL', () => {
    const all = logged.join('\n');
    expect(all).not.toContain(KEY_FRAGMENT);
    expect(all).not.toContain('subscription-key=');
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
      'ADMIN.CONFIGURATION.SECRET_VALIDATED',
      'ADMIN.CONFIGURATION.PROVIDER_VALIDATED',
    ]) {
      expect(actions, expected).toContain(expected);
    }
    // CREATED on a database where OpenAI had no reference, UPDATED where one
    // was already configured (as on a development machine that has run Test
    // connection for real). Either is the reference change being audited.
    expect(
      actions.some(
        (action) =>
          action === 'ADMIN.CONFIGURATION.SECRET_REFERENCE_CREATED' ||
          action === 'ADMIN.CONFIGURATION.SECRET_REFERENCE_UPDATED',
      ),
    ).toBe(true);
    for (const audit of audits) {
      expect(audit.row, audit.action).not.toContain(KEY_FRAGMENT);
      expect(audit.row, audit.action).not.toContain('subscription-key=');
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
