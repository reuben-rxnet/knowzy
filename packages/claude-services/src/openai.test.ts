// OPENAI-CODEX-00 — the readiness client, against a fake fetch.
//
// No test here reaches the network. Each case is a response OpenAI actually
// sends, and each asserts two things: what the check recorded, and that the
// key went nowhere except the Authorization header of an allow-listed host.

import { describe, expect, it } from 'vitest';
import type { RevealableSecret } from '@knowzy/shared-types';
import { checkOpenAIReadiness, createOpenAIProvider, endpointPermission } from './openai.js';
import { ProviderRefusedError } from './registry.js';

const KEY = 'sk-proj-FAKE-KEY-FOR-TESTS-ONLY-0123456789';
const secret: RevealableSecret = {
  reveal: () => KEY,
  toString: () => '[redacted]',
  toJSON: () => '[redacted]',
};

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

const fakeFetch = (
  responder: (url: string) => Response | Promise<Response>,
): { fetch: typeof fetch; calls: Call[] } => {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return responder(String(input));
  }) as typeof fetch;
  return { fetch: impl, calls };
};

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const base = {
  baseUrl: 'https://api.openai.com/v1',
  modelId: 'gpt-5-codex',
  apiKey: secret,
  allowedHosts: ['api.openai.com'],
};

describe('checkOpenAIReadiness', () => {
  it('passes endpoint, authentication and model on 200 / 200, and reads the rate limits', async () => {
    const { fetch, calls } = fakeFetch((url) =>
      url.endsWith('/models')
        ? json(
            200,
            { data: [] },
            { 'x-ratelimit-limit-requests': '500', 'x-ratelimit-limit-tokens': '30000' },
          )
        : json(200, { id: 'gpt-5-codex' }),
    );
    const result = await checkOpenAIReadiness({ ...base, fetch });
    expect([result.endpoint.result, result.authentication.result, result.model.result]).toEqual([
      'PASSED',
      'PASSED',
      'PASSED',
    ]);
    expect(result.limits).toEqual({ requestsPerMinute: 500, tokensPerMinute: 30000 });
    expect(calls.map((call) => call.url)).toEqual([
      'https://api.openai.com/v1/models',
      'https://api.openai.com/v1/models/gpt-5-codex',
    ]);
  });

  it('sends the key ONLY in the Authorization header, and refuses redirects', async () => {
    const { fetch, calls } = fakeFetch(() => json(200, {}));
    await checkOpenAIReadiness({ ...base, fetch });
    for (const call of calls) {
      expect((call.init.headers as Record<string, string>)['authorization']).toBe(`Bearer ${KEY}`);
      expect(call.url).not.toContain(KEY);
      expect(call.init.redirect).toBe('error');
      expect(call.init.method).toBe('GET');
      expect(call.init.body).toBeUndefined();
    }
  });

  it('records a 401 as an authentication failure -- WITHOUT the provider message, which quotes the key', async () => {
    const { fetch } = fakeFetch(() =>
      json(401, {
        error: {
          message: `Incorrect API key provided: ${KEY.slice(0, 8)}...${KEY.slice(-4)}. You can find your API key at ...`,
          type: 'invalid_request_error',
          code: 'invalid_api_key',
        },
      }),
    );
    const result = await checkOpenAIReadiness({ ...base, fetch });
    expect(result.endpoint.result).toBe('PASSED');
    expect(result.authentication.result).toBe('FAILED');
    expect(result.authentication.facts).toMatchObject({
      httpStatus: 401,
      errorCode: 'invalid_api_key',
    });
    expect(result.model.result).toBe('NOT_ATTEMPTED');
    const text = JSON.stringify(result);
    expect(text).not.toContain(KEY.slice(0, 8));
    expect(text).not.toContain(KEY.slice(-4));
    expect(text).not.toContain('Incorrect API key');
  });

  it('records a missing model as a MODEL failure after authentication passed', async () => {
    const { fetch } = fakeFetch((url) =>
      url.endsWith('/models')
        ? json(200, { data: [] })
        : json(404, { error: { code: 'model_not_found' } }),
    );
    const result = await checkOpenAIReadiness({ ...base, fetch });
    expect(result.authentication.result).toBe('PASSED');
    expect(result.model.result).toBe('FAILED');
    expect(result.model.facts).toMatchObject({ httpStatus: 404, errorCode: 'model_not_found' });
  });

  it('treats 429 as authenticated-but-throttled, not as an authentication failure', async () => {
    const { fetch } = fakeFetch(() => json(429, { error: { code: 'insufficient_quota' } }));
    const result = await checkOpenAIReadiness({ ...base, fetch });
    expect(result.authentication.result).toBe('PASSED');
    expect(result.authentication.detail).toMatch(/quota is not/i);
  });

  it('records an unreachable endpoint and attempts nothing after it', async () => {
    const { fetch } = fakeFetch(() => {
      throw new TypeError('fetch failed');
    });
    const result = await checkOpenAIReadiness({ ...base, fetch });
    expect(result.endpoint).toMatchObject({ result: 'FAILED', facts: { cause: 'UNREACHABLE' } });
    expect(result.authentication.result).toBe('NOT_ATTEMPTED');
    expect(result.model.result).toBe('NOT_ATTEMPTED');
  });

  it('records a timeout as a timeout', async () => {
    const { fetch } = fakeFetch(() => {
      const error = new Error('timed out');
      error.name = 'TimeoutError';
      throw error;
    });
    const result = await checkOpenAIReadiness({ ...base, fetch, timeoutMs: 5 });
    expect(result.endpoint.facts).toMatchObject({ cause: 'TIMEOUT' });
  });

  it('NEVER CALLS a host that is not allow-listed -- the key is not sent', async () => {
    const { fetch, calls } = fakeFetch(() => json(200, {}));
    const result = await checkOpenAIReadiness({
      ...base,
      baseUrl: 'https://attacker.example.com/v1',
      fetch,
    });
    expect(calls).toHaveLength(0);
    expect(result.endpoint).toMatchObject({ result: 'FAILED', facts: { cause: 'NOT_ALLOWED' } });
    expect(result.endpoint.detail).toMatch(/was not sent/);
  });
});

describe('endpointPermission', () => {
  const allowed = ['api.openai.com', 'localhost'];
  it.each([
    ['https://api.openai.com/v1', true],
    ['http://api.openai.com/v1', false],
    ['https://api.openai.com.evil.example/v1', false],
    ['https://user:pass@api.openai.com/v1', false],
    ['http://localhost:9999/v1', true],
    ['not a url', false],
  ])('%s -> %s', (url, expected) => {
    expect(endpointPermission(url, allowed).allowed).toBe(expected);
  });
});

describe('createOpenAIProvider', () => {
  it('declares that it cannot generate, and refuses if asked anyway', async () => {
    const provider = createOpenAIProvider('gpt-5-codex');
    expect(provider.capabilities.supportsGeneration).toBe(false);
    await expect(
      provider.generate({} as never, {
        mode: 'PLATFORM_MANAGED',
        onBehalfOfUserId: null,
        correlationId: 'c',
      }),
    ).rejects.toBeInstanceOf(ProviderRefusedError);
  });
});
