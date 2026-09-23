// The server-side API client.
//
// Every call to the Knowzy API happens HERE, in the Next.js server process,
// never from the browser. Three reasons, in order of importance:
//
//   1. Invariant 8: authorization is server-side. The browser never holds or
//      sends an identity header. It holds a cookie naming which demo subject to
//      act as; this module translates that into the header the API expects, and
//      the API then re-resolves roles and scope from the database anyway.
//   2. B1: a web app may not reach the database, and it also has no business
//      knowing the API's internal address. `API_INTERNAL_BASE_URL` is a
//      server-only variable; `readPublicEnv()` cannot return it.
//   3. No CORS surface. The browser talks only to its own origin.
//
// This is the BFF shape a real deployment uses, with a bearer token where the
// subject header sits today.

import { readProcessEnv } from '@knowzy/configuration';
import { currentSubject } from './identity';

const baseUrl = (): string => {
  // readProcessEnv, not process.env — C3 keeps one resolution path.
  const url = readProcessEnv()['API_INTERNAL_BASE_URL'];
  if (url === undefined || url.length === 0) {
    throw new Error(
      'API_INTERNAL_BASE_URL is not set. The web app cannot reach the API without it.',
    );
  }
  return url.replace(/\/+$/, '');
};

export interface ApiProblem {
  readonly status: number;
  readonly code: string;
  readonly title: string;
  readonly detail: string;
  readonly gateFailures?: readonly {
    gate: number;
    code: string;
    detail: string;
    field: string | null;
  }[];
}

export type ApiResult<T> =
  { readonly ok: true; readonly data: T } | { readonly ok: false; readonly problem: ApiProblem };

interface CallOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH';
  readonly body?: unknown;
  readonly idempotencyKey?: string;
}

/**
 * Calls the API as the currently selected subject.
 *
 * Returns a RESULT rather than throwing on a 4xx: a refused approval or an
 * insufficient pool is a normal outcome this UI must render, complete with the
 * reason. Throwing would turn every designed refusal into an error page.
 */
export const api = async <T>(path: string, options: CallOptions = {}): Promise<ApiResult<T>> => {
  const subject = await currentSubject();

  let response: Response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        // Only when there IS a body. A request that declares
        // `application/json` and sends nothing is malformed, and Fastify
        // rejects it before any handler runs — which turned every bodyless
        // POST (the learner's "Finish and score", Test connection, Claim,
        // Submit, and the assessment steps) into a 400 VALIDATION_FAILED that
        // looked like the page had sent bad data.
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        'x-knowzy-subject': subject.upn,
        ...(options.idempotencyKey === undefined
          ? {}
          : { 'idempotency-key': options.idempotencyKey }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      // Always fresh. A cached authoring list would show a question in a state
      // it has already left.
      cache: 'no-store',
    });
  } catch (error) {
    return {
      ok: false,
      problem: {
        status: 503,
        code: 'MCP_UNAVAILABLE',
        title: 'API unreachable',
        detail:
          error instanceof Error
            ? `The Knowzy API could not be reached: ${error.message}`
            : 'The Knowzy API could not be reached.',
      },
    };
  }

  const text = await response.text();
  const parsed: unknown = text.length === 0 ? null : safeJson(text);

  if (!response.ok) {
    const problem = (parsed ?? {}) as Partial<ApiProblem> & { gateFailures?: unknown };
    return {
      ok: false,
      problem: {
        status: response.status,
        code: problem.code ?? 'INTERNAL_ERROR',
        title: problem.title ?? 'Request failed',
        detail: problem.detail ?? `The API returned ${response.status}.`,
        ...(Array.isArray(problem.gateFailures)
          ? { gateFailures: problem.gateFailures as ApiProblem['gateFailures'] }
          : {}),
      },
    };
  }

  return { ok: true, data: parsed as T };
};

const safeJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
