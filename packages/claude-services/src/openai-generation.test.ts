// OPENAI-CODEX-01 — the generation client, against a fake fetch.
//
// No test reaches the network. The assertions are the ones that decide whether
// a model can be trusted inside this platform's governance: that it is sent
// the SAME prompt as every other provider, that nothing it can say bypasses the
// output schema, that every failure is classified the way the control layer's
// retry policy expects, and that the key goes only where it is meant to.

import { describe, expect, it } from 'vitest';
import type { RevealableSecret } from '@knowzy/shared-types';
import { frameGenerationPrompt } from './framing.js';
import {
  createOpenAIGenerationProvider,
  mapModelAnswer,
  OpenAIGenerationError,
  type OpenAICallConfig,
} from './openai-generation.js';

const KEY = 'sk-proj-GENERATION-TEST-KEY-abcdef0123456789';
const secret: RevealableSecret = {
  reveal: () => KEY,
  toString: () => '[redacted]',
  toJSON: () => '[redacted]',
};

const EVIDENCE =
  'A P1 incident must be acknowledged by the on-call engineer within fifteen minutes of the page.';
const section = { sectionKey: 'sec-1', label: 'Escalation', text: `Intro. ${EVIDENCE} More text.` };
const args = {
  sections: [section],
  doNotDuplicate: [],
  requestedQuestionCount: 1,
  domainName: 'Support Operations',
  topicName: 'Escalation',
};
const ctx = { mode: 'PLATFORM_MANAGED' as const, onBehalfOfUserId: null, correlationId: 'c-1' };

const answer = {
  questions: [
    {
      sectionKey: 'sec-1',
      questionText: 'Within what time must a P1 incident be acknowledged?',
      options: { A: 'Five minutes', B: 'Fifteen minutes', C: 'One hour', D: 'Four hours' },
      correctOption: 'B',
      explanation: 'The escalation procedure sets a fifteen-minute acknowledgement window.',
      supportingEvidence: EVIDENCE,
      modelConfidence: 0.8,
      difficulty: 'RECALL',
    },
  ],
  insufficient: [],
};

const config = (overrides: Partial<OpenAICallConfig> = {}): OpenAICallConfig => ({
  baseUrl: 'https://api.openai.com/v1',
  modelId: 'gpt-5-codex',
  apiKey: secret,
  allowedHosts: ['api.openai.com'],
  apiStyle: 'RESPONSES',
  auth: { location: 'HEADER', headerName: 'authorization' },
  extraHeaders: {},
  temperature: 0.2,
  maxOutputTokens: 4000,
  ...overrides,
});

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

const fake = (responder: (url: string) => Response | Promise<Response>) => {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return responder(String(input));
  }) as typeof fetch;
  return { fetch: impl, calls };
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const responsesBody = (text: string) => ({
  model: 'gpt-5-codex-2026-09-01',
  output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
  usage: { input_tokens: 812, output_tokens: 190 },
});

const provider = (fetchImpl: typeof fetch, cfg: Partial<OpenAICallConfig> = {}) =>
  createOpenAIGenerationProvider({
    modelId: 'gpt-5-codex',
    configure: async () => config(cfg),
    fetch: fetchImpl,
  });

describe('the request', () => {
  it('sends the SAME system prompt every provider gets, the schema, and no tools', async () => {
    const { fetch, calls } = fake(() => json(200, responsesBody(JSON.stringify(answer))));
    await provider(fetch).generate(args, ctx);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.openai.com/v1/responses');
    const body = JSON.parse(String(calls[0]?.init.body));
    // The nonce is random per call, so compare with it normalised.
    const framed = frameGenerationPrompt({ ...args, nonce: 'N' });
    expect(body.instructions.replace(/KNOWZY-SOURCE-[0-9a-f]+/g, 'KNOWZY-SOURCE-N')).toBe(
      framed.system,
    );
    expect(body.tools).toEqual([]);
    expect(body.store).toBe(false);
    expect(body.text.format).toMatchObject({ type: 'json_schema', strict: true });
    expect(body.model).toBe('gpt-5-codex');
    expect(body.temperature).toBe(0.2);
    expect(body.max_output_tokens).toBe(4000);
  });

  it('speaks chat completions when configured to', async () => {
    const { fetch, calls } = fake(() =>
      json(200, {
        model: 'gpt-x',
        choices: [{ message: { content: JSON.stringify(answer) } }],
        usage: { prompt_tokens: 700, completion_tokens: 150 },
      }),
    );
    const result = await provider(fetch, { apiStyle: 'CHAT_COMPLETIONS' }).generate(args, ctx);
    expect(calls[0]?.url).toBe('https://api.openai.com/v1/chat/completions');
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(['system', 'user']);
    expect(body.response_format.type).toBe('json_schema');
    expect(result.inputTokens).toBe(700);
  });

  it('sends the key as a Bearer token by default, and as a gateway header when configured', async () => {
    const bearer = fake(() => json(200, responsesBody(JSON.stringify(answer))));
    await provider(bearer.fetch).generate(args, ctx);
    const headers = bearer.calls[0]?.init.headers as Record<string, string>;
    expect(headers['authorization']).toBe(`Bearer ${KEY}`);

    const gateway = fake(() => json(200, responsesBody(JSON.stringify(answer))));
    await provider(gateway.fetch, {
      auth: { location: 'HEADER', headerName: 'Ocp-Apim-Subscription-Key' },
    }).generate(args, ctx);
    const gh = gateway.calls[0]?.init.headers as Record<string, string>;
    expect(gh['ocp-apim-subscription-key']).toBe(KEY);
    expect(gh['authorization']).toBeUndefined();
    expect(gateway.calls[0]?.init.redirect).toBe('error');
  });

  it('GATEWAY-M1: puts the key in the query parameter at request time, with the fixed header, and nowhere else', async () => {
    const gateway = fake(() => json(200, responsesBody(JSON.stringify(answer))));
    await provider(gateway.fetch, {
      baseUrl: 'https://dev-apim-ai.luxottica.com/codex/openai/v1',
      allowedHosts: ['dev-apim-ai.luxottica.com'],
      modelId: 'gpt-5.3-codex_codeassist',
      auth: { location: 'QUERY_PARAMETER', parameterName: 'subscription-key' },
      extraHeaders: { 'x-openai-supplier': 'EssilorLuxottica' },
    }).generate(args, ctx);

    const call = gateway.calls[0];
    const url = new URL(call?.url ?? '');
    expect(`${url.origin}${url.pathname}`).toBe(
      'https://dev-apim-ai.luxottica.com/codex/openai/v1/responses',
    );
    expect(url.searchParams.get('subscription-key')).toBe(KEY);
    const headers = call?.init.headers as Record<string, string>;
    expect(headers['x-openai-supplier']).toBe('EssilorLuxottica');
    // No fallback: the key is not ALSO in a header.
    expect(headers['authorization']).toBeUndefined();
    expect(JSON.stringify(headers)).not.toContain(KEY);
    // And the body is the prompt, never the key.
    expect(String(call?.init.body)).not.toContain(KEY);
    expect(call?.init.redirect).toBe('error');
  });

  it('GATEWAY-M1: a network failure is thrown as a classified sentence, never the raw error', async () => {
    const failing = (async () => {
      const cause = Object.assign(
        new Error('getaddrinfo ENOTFOUND dev-apim-ai.luxottica.com?subscription-key=' + KEY),
        {
          code: 'ENOTFOUND',
        },
      );
      throw Object.assign(new TypeError('fetch failed'), { cause });
    }) as typeof fetch;
    const thrown = await provider(failing, {
      baseUrl: 'https://dev-apim-ai.luxottica.com/codex/openai/v1',
      allowedHosts: ['dev-apim-ai.luxottica.com'],
      auth: { location: 'QUERY_PARAMETER', parameterName: 'subscription-key' },
    })
      .generate(args, ctx)
      .then(
        () => null,
        (error: unknown) => error as OpenAIGenerationError,
      );
    expect(thrown?.code).toBe('DNS');
    expect(thrown?.message).not.toContain(KEY);
    expect(thrown?.message).not.toContain('subscription-key=');
    expect(JSON.stringify({ message: thrown?.message, code: thrown?.code })).not.toContain(KEY);
  });

  it('never calls a host that is not allow-listed', async () => {
    const { fetch, calls } = fake(() => json(200, {}));
    await expect(
      provider(fetch, { baseUrl: 'https://elsewhere.example.com/v1' }).generate(args, ctx),
    ).rejects.toMatchObject({ status: 403, code: 'ENDPOINT_NOT_ALLOWED' });
    expect(calls).toHaveLength(0);
  });
});

describe('the answer', () => {
  it('maps to the platform union, with the SERVED model and the REPORTED usage', async () => {
    const { fetch } = fake(() => json(200, responsesBody(JSON.stringify(answer))));
    const result = await provider(fetch).generate(args, ctx);
    expect('questions' in result.output && result.output.questions).toHaveLength(1);
    expect(result.modelId).toBe('gpt-5-codex-2026-09-01');
    expect(result).toMatchObject({
      inputTokens: 812,
      outputTokens: 190,
      tokenUsageReported: true,
      providerId: 'OPENAI',
    });
  });

  it('records a model refusal as insufficient evidence for every section, not as a question', async () => {
    const { fetch } = fake(() =>
      json(200, {
        model: 'm',
        output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'I cannot help.' }] }],
        usage: { input_tokens: 10, output_tokens: 2 },
      }),
    );
    const result = await provider(fetch).generate(args, ctx);
    expect('result' in result.output).toBe(true);
    expect(result.insufficientSections).toEqual([
      { sectionKey: 'sec-1', reason: 'The model declined to answer: I cannot help.' },
    ]);
  });

  it('treats output that does not parse as MALFORMED_OUTPUT, which is never retried', async () => {
    const { fetch } = fake(() => json(200, responsesBody('{"questions": [{"nope": 1}]}')));
    await expect(provider(fetch).generate(args, ctx)).rejects.toMatchObject({
      code: 'MALFORMED_OUTPUT',
    });
  });

  it('refuses a question the platform schema would refuse (a 5-char stem), rather than passing it on', () => {
    expect(() =>
      mapModelAnswer(
        { questions: [{ ...answer.questions[0], questionText: 'Why?' }], insufficient: [] },
        ['sec-1'],
      ),
    ).toThrow();
  });

  it('turns an empty answer into one insufficient result per section', () => {
    const mapped = mapModelAnswer({ questions: [], insufficient: [] }, ['a', 'b']);
    expect(mapped.insufficientSections.map((row) => row.sectionKey)).toEqual(['a', 'b']);
  });
});

describe('failures, as the control layer will classify them', () => {
  it('429 carries its status (RATE_LIMIT, retried)', async () => {
    const { fetch } = fake(() => json(429, { error: { code: 'rate_limit_exceeded' } }));
    await expect(provider(fetch).generate(args, ctx)).rejects.toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
    });
  });

  it('5xx carries its status (SERVER_ERROR, retried)', async () => {
    const { fetch } = fake(() => json(503, {}));
    await expect(provider(fetch).generate(args, ctx)).rejects.toMatchObject({ status: 503 });
  });

  it('a timeout is a TimeoutError (TIMEOUT, retried)', async () => {
    const { fetch } = fake(() => {
      const error = new Error('t');
      error.name = 'TimeoutError';
      throw error;
    });
    await expect(provider(fetch).generate(args, ctx)).rejects.toMatchObject({
      name: 'TimeoutError',
    });
  });

  it('keeps only the error CODE -- never a message, which can quote the key', async () => {
    const { fetch } = fake(() =>
      json(401, {
        error: {
          code: 'invalid_api_key',
          message: `Incorrect API key provided: ${KEY.slice(0, 12)}...`,
        },
      }),
    );
    const error = await provider(fetch)
      .generate(args, ctx)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OpenAIGenerationError);
    expect(JSON.stringify(error)).not.toContain(KEY.slice(0, 12));
    expect((error as Error).message).not.toContain('Incorrect API key');
    expect((error as OpenAIGenerationError).code).toBe('invalid_api_key');
  });
});
