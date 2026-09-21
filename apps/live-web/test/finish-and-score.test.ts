// "Finish and score" must send a request the API accepts.
//
// The reported defect: clicking Finish and score returned HTTP 400
// VALIDATION_FAILED — "Some of the information supplied is not valid" — on a
// control that supplies no information. The cause was not in the scoring flow
// at all. This client sent `content-type: application/json` on every call,
// including the POSTs with no body, and Fastify rejects a request that declares
// a JSON body and sends none while parsing it, before any handler runs. See
// apps/api/test/empty-json-body.test.ts for the server half.
//
// So the regression to prevent is a REQUEST SHAPE, and that is what this
// asserts: no body means no content-type. It is checked here, in the module
// that builds the request, because that is where the defect was and where it
// would come back.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// `api()` reads the selected demo subject from a cookie. In the browser that is
// Next's request store, which does not exist in a test process.
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'knowzy_learner' ? { name, value: 'learner@local.invalid' } : undefined,
  }),
}));

const { api } = await import('../src/lib/api.js');

interface Captured {
  readonly url: string;
  readonly init: RequestInit;
}

let calls: Captured[] = [];

const stubFetch = (): void => {
  calls = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ resultId: '01a0c399-0000-7000-8000-000000000000' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
};

const headersOf = (init: RequestInit): Record<string, string> =>
  Object.fromEntries(
    Object.entries((init.headers ?? {}) as Record<string, string>).map(([key, value]) => [
      key.toLowerCase(),
      value,
    ]),
  );

beforeEach(() => {
  process.env['API_INTERNAL_BASE_URL'] = 'http://api.test.invalid';
  stubFetch();
});

describe('the request "Finish and score" sends', () => {
  const completePath = '/api/v1/learning/sessions/01a0c399-1111-7000-8000-000000000000/complete';

  it('declares no content type, because it carries no body', async () => {
    const result = await api<{ resultId: string }>(completePath, {
      method: 'POST',
      idempotencyKey: 'live-web-complete-regression',
    });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);

    const call = calls[0];
    if (call === undefined) throw new Error('fetch was not called');

    expect(call.init.method).toBe('POST');
    expect(call.init.body).toBeUndefined();
    // The defect, stated directly: declaring JSON here is what produced the
    // 400. A body-less POST must not claim to carry one.
    expect(headersOf(call.init)['content-type']).toBeUndefined();
    // The identity and the idempotency key still travel, unchanged.
    expect(headersOf(call.init)['x-knowzy-subject']).toBe('learner@local.invalid');
    expect(headersOf(call.init)['idempotency-key']).toBe('live-web-complete-regression');
  });

  it('still declares JSON when there really is a body', async () => {
    // The other half of the same rule: answering a question does send a body,
    // and the API needs the content type to parse it. Losing this would break
    // every write in the portal.
    await api('/api/v1/learning/sessions/01a0c399-1111-7000-8000-000000000000/answers', {
      method: 'POST',
      body: { questionIndex: 0, selectedOption: 'B' },
      idempotencyKey: 'live-web-answer-regression',
    });

    const call = calls[0];
    if (call === undefined) throw new Error('fetch was not called');

    expect(headersOf(call.init)['content-type']).toBe('application/json');
    expect(call.init.body).toBe(JSON.stringify({ questionIndex: 0, selectedOption: 'B' }));
  });

  it('sends no content type on a plain read either', async () => {
    await api('/api/v1/learning/assessments');

    const call = calls[0];
    if (call === undefined) throw new Error('fetch was not called');

    expect(call.init.method).toBe('GET');
    expect(headersOf(call.init)['content-type']).toBeUndefined();
  });
});
