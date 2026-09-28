// GATEWAY-M1 — the shared request builder, the gateway readiness path, and the
// settings rules that keep a fixed header from becoming a place for a secret.
//
// No test reaches the network: every request goes to a fake fetch that
// records exactly what it was given, so "the key went here and nowhere else"
// is an assertion about the request, not about the code's intentions.

import { describe, expect, it } from 'vitest';
import { ProviderSettingsSchema, type RevealableSecret } from '@knowzy/shared-types';
import { checkOpenAIReadiness } from './openai.js';
import {
  authFromSettings,
  classifyTransportError,
  endpointPermission,
  providerFetch,
  sanitizeUrl,
  type ProviderEndpoint,
} from './provider-request.js';

const KEY = 'GATEWAY-TEST-KEY-0123456789abcdef';
const secret: RevealableSecret = {
  reveal: () => KEY,
  toString: () => '[redacted]',
  toJSON: () => '[redacted]',
};

const BASE = 'https://dev-apim-ai.luxottica.com/codex/openai/v1';
const HOSTS = ['dev-apim-ai.luxottica.com'];
const MODEL = 'gpt-5.3-codex_codeassist';

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

const recorder = (responder: (url: URL, init: RequestInit) => Response | Promise<Response>) => {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return responder(new URL(String(input)), init ?? {});
  }) as typeof fetch;
  return { fetch: impl, calls };
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const endpoint = (overrides: Partial<ProviderEndpoint> = {}): ProviderEndpoint => ({
  baseUrl: BASE,
  allowedHosts: HOSTS,
  auth: { location: 'QUERY_PARAMETER', parameterName: 'subscription-key' },
  extraHeaders: { 'x-openai-supplier': 'EssilorLuxottica' },
  apiKey: secret,
  ...overrides,
});

const permitted = (base = BASE): URL => {
  const result = endpointPermission(base, HOSTS);
  if (!result.allowed) throw new Error(result.reason);
  return result.url;
};

// ---------------------------------------------------------------------------

describe('sanitizeUrl', () => {
  it('redacts every credential-bearing parameter, by exact name, and nothing else', () => {
    const clean = sanitizeUrl(
      `${BASE}/models?subscription-key=${KEY}&API-KEY=abc&token=t&keyword=cats&monkey=1&limit=5`,
    );
    expect(clean).not.toContain(KEY);
    expect(clean).toContain('subscription-key=REDACTED');
    expect(clean).toContain('API-KEY=REDACTED');
    expect(clean).toContain('token=REDACTED');
    // Harmless names that merely CONTAIN "key" are left alone.
    expect(clean).toContain('keyword=cats');
    expect(clean).toContain('monkey=1');
    expect(clean).toContain('limit=5');
  });

  it('drops userinfo', () => {
    expect(sanitizeUrl('https://user:pass@example.com/x')).toBe('https://example.com/x');
  });
});

describe('endpointPermission', () => {
  it('refuses a base URL that carries a credential in its query string', () => {
    const result = endpointPermission(`${BASE}?subscription-key=${KEY}`, HOSTS);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toMatch(/query string/);
      expect(result.reason).not.toContain(KEY);
    }
  });

  it('refuses a host the deployment did not allow-list, before any key is sent', () => {
    const result = endpointPermission('https://elsewhere.example.com/v1', HOSTS);
    expect(result.allowed).toBe(false);
  });
});

describe('providerFetch', () => {
  it('QUERY_PARAMETER: adds the key to the URL at request time only, with the fixed header', async () => {
    const { fetch, calls } = recorder(() => json(200, { data: [] }));
    const config = endpoint();
    await providerFetch(config, permitted(), '/models', { method: 'GET', timeoutMs: 1000, fetch });

    const sent = new URL(calls[0]?.url ?? '');
    expect(sent.searchParams.get('subscription-key')).toBe(KEY);
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['x-openai-supplier']).toBe('EssilorLuxottica');
    expect(headers['authorization']).toBeUndefined();
    expect(JSON.stringify(headers)).not.toContain(KEY);
    expect(calls[0]?.init.redirect).toBe('error');
    // The configuration it was given still holds no credential URL.
    expect(JSON.stringify({ ...config, apiKey: undefined })).not.toContain(KEY);
    expect(config.baseUrl).toBe(BASE);
  });

  it('HEADER: puts the key in the named header and never in the URL', async () => {
    const { fetch, calls } = recorder(() => json(200, {}));
    await providerFetch(
      endpoint({ auth: { location: 'HEADER', headerName: 'Ocp-Apim-Subscription-Key' } }),
      permitted(),
      '/models',
      { method: 'GET', timeoutMs: 1000, fetch },
    );
    expect(calls[0]?.url).not.toContain(KEY);
    expect((calls[0]?.init.headers as Record<string, string>)['ocp-apim-subscription-key']).toBe(
      KEY,
    );
  });

  it('withCredential false sends no key anywhere, and still sends the fixed header', async () => {
    const { fetch, calls } = recorder(() => json(401, {}));
    await providerFetch(endpoint(), permitted(), '/models', {
      method: 'GET',
      withCredential: false,
      timeoutMs: 1000,
      fetch,
    });
    expect(calls[0]?.url).not.toContain(KEY);
    expect(JSON.stringify(calls[0]?.init.headers)).not.toContain(KEY);
    expect((calls[0]?.init.headers as Record<string, string>)['x-openai-supplier']).toBe(
      'EssilorLuxottica',
    );
  });
});

describe('authFromSettings', () => {
  it('defaults to a Bearer header, and reads query-parameter authentication without fallback', () => {
    expect(authFromSettings(undefined)).toEqual({
      location: 'HEADER',
      headerName: 'authorization',
    });
    expect(
      authFromSettings({
        authLocation: 'QUERY_PARAMETER',
        authQueryParameterName: 'subscription-key',
      }),
    ).toEqual({ location: 'QUERY_PARAMETER', parameterName: 'subscription-key' });
    expect(() => authFromSettings({ authLocation: 'QUERY_PARAMETER' })).toThrow();
  });
});

describe('classifyTransportError', () => {
  const withCause = (code: string, message = 'raw internal message') =>
    Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error(`${message} ${BASE}?subscription-key=${KEY}`), { code }),
    });

  it.each([
    ['ENOTFOUND', 'DNS'],
    ['EAI_AGAIN', 'DNS'],
    ['UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'TLS_TRUST'],
    ['SELF_SIGNED_CERT_IN_CHAIN', 'TLS_TRUST'],
    ['CERT_HAS_EXPIRED', 'TLS_CERTIFICATE'],
    ['ECONNREFUSED', 'CONNECTION_REFUSED'],
    ['ECONNRESET', 'CONNECTION_RESET'],
    ['UND_ERR_CONNECT_TIMEOUT', 'TIMEOUT'],
  ])('%s is %s, and the raw message and URL are discarded', (code, cause) => {
    const result = classifyTransportError(withCause(code), 'dev-apim-ai.luxottica.com', 10_000);
    expect(result.cause).toBe(cause);
    expect(result.detail).not.toContain(KEY);
    expect(result.detail).not.toContain('raw internal message');
    expect(result.detail).not.toContain('subscription-key');
  });

  it('names NODE_EXTRA_CA_CERTS for an internal certificate authority, and never offers to disable TLS', () => {
    const result = classifyTransportError(
      withCause('UNABLE_TO_VERIFY_LEAF_SIGNATURE'),
      'dev-apim-ai.luxottica.com',
      10_000,
    );
    expect(result.detail).toContain('NODE_EXTRA_CA_CERTS configuration required');
    expect(result.detail).not.toMatch(/NODE_TLS_REJECT_UNAUTHORIZED|rejectUnauthorized/);
  });

  it('recognises a refused redirect and a timeout', () => {
    const redirect = Object.assign(new TypeError('fetch failed'), {
      cause: new Error('unexpected redirect'),
    });
    expect(classifyTransportError(redirect, 'h', 1).cause).toBe('REDIRECT_REFUSED');
    const timeout = Object.assign(new Error('aborted'), { name: 'TimeoutError' });
    expect(classifyTransportError(timeout, 'h', 1).cause).toBe('TIMEOUT');
  });
});

// ---------------------------------------------------------------------------

describe('Test connection against an API Management gateway', () => {
  const probe = (fetch: typeof fetch) =>
    checkOpenAIReadiness({
      baseUrl: BASE,
      modelId: MODEL,
      apiKey: secret,
      allowedHosts: HOSTS,
      auth: { location: 'QUERY_PARAMETER', parameterName: 'subscription-key' },
      extraHeaders: { 'x-openai-supplier': 'EssilorLuxottica' },
      fetch,
    });

  it('no /models route: authentication by comparison, model discovery SKIPPED -- never PASSED', async () => {
    const { fetch, calls } = recorder((url) =>
      url.searchParams.has('subscription-key')
        ? json(404, { statusCode: 404, message: 'Resource not found' })
        : json(401, { statusCode: 401, message: `Access denied ${KEY}` }),
    );
    const result = await probe(fetch);

    expect(result.endpoint.result).toBe('PASSED');
    expect(result.authentication.result).toBe('PASSED');
    expect(result.authentication.facts).toMatchObject({
      httpStatus: 404,
      anonymousHttpStatus: 401,
    });
    expect(result.model.result).toBe('SKIPPED');
    expect(result.model.detail).toMatch(/^Model discovery is not exposed by this gateway\./);

    // Two GETs, both to /models, no body, and the anonymous one carried no key.
    expect(calls.map((c) => c.init.method)).toEqual(['GET', 'GET']);
    expect(calls.every((c) => c.init.body === undefined)).toBe(true);
    expect(calls.every((c) => new URL(c.url).pathname.endsWith('/models'))).toBe(true);
    expect(calls[1]?.url).not.toContain(KEY);
    // The gateway's own message -- which here quotes the key -- is not kept.
    expect(JSON.stringify(result)).not.toContain(KEY);
    expect(JSON.stringify(result)).not.toContain('Access denied');
  });

  it('no /models route and no difference without the key: authentication is NOT established', async () => {
    const { fetch } = recorder(() => json(404, {}));
    const result = await probe(fetch);
    expect(result.authentication.result).toBe('NOT_ATTEMPTED');
    expect(result.model.result).toBe('SKIPPED');
  });

  it('a 401 is an authentication rejection; a 403 is a gateway authorization rejection', async () => {
    const r401 = await probe(recorder(() => json(401, {})).fetch);
    expect(r401.authentication.result).toBe('FAILED');
    expect(r401.authentication.facts?.['cause']).toBe('AUTH_REJECTED');
    const r403 = await probe(recorder(() => json(403, {})).fetch);
    expect(r403.authentication.result).toBe('FAILED');
    expect(r403.authentication.facts?.['cause']).toBe('ACCESS_DENIED');
  });

  it('a 429 is a rate limit and a 503 is service unavailable', async () => {
    const limited = await probe(recorder(() => json(429, {})).fetch);
    expect(limited.authentication.facts?.['cause']).toBe('RATE_LIMITED');
    const down = await probe(recorder(() => json(503, {})).fetch);
    expect(down.endpoint.result).toBe('FAILED');
    expect(down.endpoint.facts?.['cause']).toBe('SERVICE_UNAVAILABLE');
  });

  it('a DNS failure is reported as DNS, with the key nowhere in the result', async () => {
    const failing = (async () => {
      throw Object.assign(new TypeError('fetch failed'), {
        cause: Object.assign(new Error(`getaddrinfo ENOTFOUND ${KEY}`), { code: 'ENOTFOUND' }),
      });
    }) as typeof fetch;
    const result = await probe(failing);
    expect(result.endpoint.result).toBe('FAILED');
    expect(result.endpoint.facts?.['cause']).toBe('DNS');
    expect(JSON.stringify(result)).not.toContain(KEY);
  });
});

// ---------------------------------------------------------------------------

describe('provider settings: authentication and fixed headers', () => {
  const base = {
    baseUrl: BASE,
    modelId: MODEL,
    apiKeyRef: 'localstore://openai-api-key',
  };
  const problems = (settings: Record<string, unknown>): string[] => {
    const parsed = ProviderSettingsSchema.safeParse(settings);
    return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
  };

  it('accepts the Azure APIM Codex gateway configuration', () => {
    expect(
      problems({
        ...base,
        authLocation: 'QUERY_PARAMETER',
        authQueryParameterName: 'subscription-key',
        extraHeaders: { 'x-openai-supplier': 'EssilorLuxottica' },
      }),
    ).toEqual([]);
  });

  it.each([
    ['authorization'],
    ['Cookie'],
    ['proxy-authorization'],
    ['x-api-key'],
    ['ocp-apim-subscription-key'],
    ['x-access-token'],
    ['x-client-secret'],
    ['x-credential'],
  ])('refuses the credential-shaped header %s', (name) => {
    expect(problems({ ...base, extraHeaders: { [name]: 'value' } }).join(' ')).toMatch(
      /looks like a credential/,
    );
  });

  it.each([['host'], ['content-length'], ['content-type'], ['connection'], ['transfer-encoding']])(
    'refuses the protocol header %s',
    (name) => {
      expect(problems({ ...base, extraHeaders: { [name]: 'x' } }).join(' ')).toMatch(
        /controlled by the HTTP client/,
      );
    },
  );

  it('refuses empty, unprintable, duplicated and too many headers', () => {
    expect(problems({ ...base, extraHeaders: { 'x-a': '' } }).join(' ')).toMatch(/needs a value/);
    expect(problems({ ...base, extraHeaders: { '': 'v' } }).join(' ')).toMatch(/name is required/);
    expect(problems({ ...base, extraHeaders: { 'x-a': 'line\nbreak' } }).join(' ')).toMatch(
      /printable/,
    );
    expect(problems({ ...base, extraHeaders: { 'X-A': '1', 'x-a': '2' } }).join(' ')).toMatch(
      /configured twice/,
    );
    const six = Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [`x-h${n}`, 'v']));
    expect(problems({ ...base, extraHeaders: six }).join(' ')).toMatch(/at most 5/);
  });

  it('refuses a fixed header that duplicates the authentication header', () => {
    expect(
      problems({
        ...base,
        authHeaderName: 'x-gateway-auth',
        extraHeaders: { 'x-gateway-auth': 'v' },
      }).join(' '),
    ).toMatch(/is the authentication header/);
  });

  it('refuses two authentication settings at once -- there is no fallback between them', () => {
    expect(
      problems({
        ...base,
        authLocation: 'QUERY_PARAMETER',
        authQueryParameterName: 'subscription-key',
        authHeaderName: 'api-key',
      }).join(' '),
    ).toMatch(/second, unused authentication setting/);
    expect(problems({ ...base, authQueryParameterName: 'subscription-key' }).join(' ')).toMatch(
      /second, unused authentication setting/,
    );
    expect(problems({ ...base, authLocation: 'QUERY_PARAMETER' }).join(' ')).toMatch(
      /needs the parameter name/,
    );
  });
});
