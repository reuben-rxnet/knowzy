// OpenAI (Codex) — OPENAI-CODEX-00: provider READINESS, not generation.
//
// This milestone ends before generation, and this file is where that is
// enforced rather than promised:
//
//   * The only requests it can make are `GET {base}/models` and
//     `GET {base}/models/{model}`. Neither carries a prompt, a document, a
//     question or anything about a person: the request is the key and a model
//     name. A contract test asserts no completion, response or chat endpoint
//     appears in this file.
//   * It never generates. Generation lives in `openai-generation.ts`
//     (OPENAI-CODEX-01), behind the registry's approval, enablement and
//     credential checks; this file is the readiness probe Test connection runs.
//
// FIVE RULES ABOUT THE KEY
//
//   1. It arrives as a `RevealableSecret` and is revealed in exactly one place:
//      the Authorization header below.
//   2. It is sent ONLY to an allow-listed host. The base URL is editable on a
//      screen; the allow-list is deployment configuration. Without the fence,
//      an administrator could point the base URL at any server and the
//      platform would hand that server the key.
//   3. It is sent ONLY over https, except to a loopback host the allow-list
//      names explicitly (a test double).
//   4. Redirects are REFUSED, not followed. A redirect to another origin is a
//      way to receive a header meant for the first one.
//   5. The provider's error MESSAGE is never kept. OpenAI's 401 body quotes a
//      masked form of the key ("Incorrect API key provided: sk-proj-...abcd");
//      only the machine-readable `error.code` and `error.type` survive, and
//      only when they are short identifiers.

import type { ProviderValidationStep, RevealableSecret } from '@knowzy/shared-types';

/** OpenAI's documented API host. The allow-list default for this provider. */
export const OPENAI_DEFAULT_HOSTS = ['api.openai.com'] as const;
export const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

export interface ReadinessLimits {
  /** As the provider reported in `x-ratelimit-limit-requests`, or null. */
  readonly requestsPerMinute: number | null;
  /** As reported in `x-ratelimit-limit-tokens`, or null. */
  readonly tokensPerMinute: number | null;
}

export interface ReadinessResult {
  readonly endpoint: ProviderValidationStep;
  readonly authentication: ProviderValidationStep;
  readonly model: ProviderValidationStep;
  readonly limits: ReadinessLimits;
}

export interface CheckReadinessArgs {
  readonly baseUrl: string;
  readonly modelId: string;
  readonly apiKey: RevealableSecret;
  /** Hosts the key may be sent to, `host` or `host:port`. */
  readonly allowedHosts: readonly string[];
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  readonly now?: () => number;
}

const notAttempted = (
  check: ProviderValidationStep['check'],
  detail: string,
): ProviderValidationStep => ({ check, result: 'NOT_ATTEMPTED', detail });

const IDENTIFIER = /^[a-z0-9_.-]{1,64}$/i;

/** `error.code` / `error.type` from a JSON body, and nothing else from it. */
const errorIdentifiers = async (response: Response): Promise<Record<string, string>> => {
  try {
    const body = (await response.json()) as { error?: { code?: unknown; type?: unknown } };
    const out: Record<string, string> = {};
    const code = body.error?.code;
    const type = body.error?.type;
    if (typeof code === 'string' && IDENTIFIER.test(code)) out['errorCode'] = code;
    if (typeof type === 'string' && IDENTIFIER.test(type)) out['errorType'] = type;
    return out;
  } catch {
    return {};
  }
};

const numberHeader = (response: Response, name: string): number | null => {
  const raw = response.headers.get(name);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
};

/**
 * Whether the key may be sent to this URL, and why not if not.
 *
 * Exported for a table test: this is the control that keeps a key from being
 * delivered to a host somebody typed.
 */
export const endpointPermission = (
  baseUrl: string,
  allowedHosts: readonly string[],
):
  | { readonly allowed: true; readonly url: URL }
  | { readonly allowed: false; readonly reason: string } => {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return { allowed: false, reason: 'The base URL is not a URL.' };
  }
  const allowed = allowedHosts.map((host) => host.toLowerCase());
  const host = url.host.toLowerCase();
  if (!allowed.includes(host) && !allowed.includes(url.hostname.toLowerCase())) {
    return {
      allowed: false,
      reason: `${url.hostname} is not an allowed host for this provider's credential (allowed: ${allowedHosts.join(', ')}). The key was not sent. Hosts are set by the deployment in LLM_ENDPOINT_ALLOWLIST, not on this screen.`,
    };
  }
  if (url.protocol !== 'https:' && !LOOPBACK.has(url.hostname)) {
    return { allowed: false, reason: 'The base URL is not https. The key was not sent.' };
  }
  if (url.username !== '' || url.password !== '') {
    return {
      allowed: false,
      reason: 'The base URL carries credentials of its own. The key was not sent.',
    };
  }
  return { allowed: true, url };
};

/**
 * Checks that OpenAI can be reached, accepts the key, and offers the model.
 *
 * Three steps, each with what it OBSERVED -- a status code, a round-trip time
 * -- and never a claim beyond it. A check that could not run says
 * NOT_ATTEMPTED and names what stopped it.
 */
export const checkOpenAIReadiness = async (args: CheckReadinessArgs): Promise<ReadinessResult> => {
  const doFetch = args.fetch ?? fetch;
  const now = args.now ?? Date.now;
  const timeoutMs = args.timeoutMs ?? 10_000;
  const noLimits: ReadinessLimits = { requestsPerMinute: null, tokensPerMinute: null };

  const permission = endpointPermission(args.baseUrl, args.allowedHosts);
  if (!permission.allowed) {
    return {
      endpoint: {
        check: 'ENDPOINT',
        result: 'FAILED',
        detail: permission.reason,
        facts: { cause: 'NOT_ALLOWED' },
      },
      authentication: notAttempted(
        'AUTHENTICATION',
        'Not attempted: the endpoint was refused, so the key was never sent.',
      ),
      model: notAttempted('MODEL', 'Not attempted: the endpoint was refused.'),
      limits: noLimits,
    };
  }

  const base = permission.url.toString().replace(/\/+$/, '');
  const get = async (path: string) => {
    const started = now();
    const response = await doFetch(`${base}${path}`, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        // THE one place the key is revealed.
        authorization: `Bearer ${args.apiKey.reveal()}`,
        accept: 'application/json',
      },
    });
    return { response, elapsedMs: now() - started };
  };

  // ------------------------------------------------ endpoint + authentication
  let list: Awaited<ReturnType<typeof get>>;
  try {
    list = await get('/models');
  } catch (error) {
    const timedOut =
      (error as Error).name === 'TimeoutError' || (error as Error).name === 'AbortError';
    return {
      endpoint: {
        check: 'ENDPOINT',
        result: 'FAILED',
        detail: timedOut
          ? `No response from ${permission.url.hostname} within ${timeoutMs} ms.`
          : `${permission.url.hostname} could not be reached (network error, TLS failure or a refused redirect).`,
        facts: { cause: timedOut ? 'TIMEOUT' : 'UNREACHABLE', host: permission.url.hostname },
      },
      authentication: notAttempted(
        'AUTHENTICATION',
        'Not attempted: the endpoint did not respond.',
      ),
      model: notAttempted('MODEL', 'Not attempted: the endpoint did not respond.'),
      limits: noLimits,
    };
  }

  const status = list.response.status;
  const endpoint: ProviderValidationStep = {
    check: 'ENDPOINT',
    result: 'PASSED',
    detail: `${permission.url.hostname} responded over ${permission.url.protocol.replace(':', '')} in ${list.elapsedMs} ms.`,
    facts: { host: permission.url.hostname, httpStatus: status, elapsedMs: list.elapsedMs },
  };
  const limits: ReadinessLimits = {
    requestsPerMinute: numberHeader(list.response, 'x-ratelimit-limit-requests'),
    tokensPerMinute: numberHeader(list.response, 'x-ratelimit-limit-tokens'),
  };

  if (status === 401 || status === 403) {
    const ids = await errorIdentifiers(list.response);
    return {
      endpoint,
      authentication: {
        check: 'AUTHENTICATION',
        result: 'FAILED',
        detail:
          status === 401
            ? 'The provider refused the key (401). Check that the secret in the store is the current key for this organization.'
            : 'The provider accepted the key but refused access (403). The key may lack permission for this project or organization.',
        facts: { httpStatus: status, ...ids },
      },
      model: notAttempted('MODEL', 'Not attempted: the key was not accepted.'),
      limits,
    };
  }
  if (status >= 500 || (status !== 200 && status !== 429)) {
    await list.response.body?.cancel();
    return {
      endpoint: {
        ...endpoint,
        result: 'FAILED',
        detail: `${permission.url.hostname} answered ${status}, which is not a models listing. Check the base URL (it normally ends in /v1).`,
        facts: { ...endpoint.facts, cause: 'UNEXPECTED_STATUS' },
      },
      authentication: notAttempted(
        'AUTHENTICATION',
        `Not established: the endpoint answered ${status}.`,
      ),
      model: notAttempted('MODEL', `Not attempted: the endpoint answered ${status}.`),
      limits,
    };
  }

  const authentication: ProviderValidationStep =
    status === 429
      ? {
          check: 'AUTHENTICATION',
          result: 'PASSED',
          detail:
            'The provider accepted the key and then refused the request for rate or quota (429). Authentication is established; the quota is not.',
          facts: { httpStatus: 429, ...(await errorIdentifiers(list.response)) },
        }
      : {
          check: 'AUTHENTICATION',
          result: 'PASSED',
          detail: 'The provider accepted the key and listed the models it can use.',
          facts: { httpStatus: 200 },
        };
  if (status === 200) await list.response.body?.cancel();

  // -------------------------------------------------------------------- model
  let model: ProviderValidationStep;
  try {
    const one = await get(`/models/${encodeURIComponent(args.modelId)}`);
    const code = one.response.status;
    const ids = code === 200 ? {} : await errorIdentifiers(one.response);
    if (code === 200) await one.response.body?.cancel();
    model =
      code === 200
        ? {
            check: 'MODEL',
            result: 'PASSED',
            detail: `The model ${args.modelId} is available to this key.`,
            facts: { httpStatus: 200, modelId: args.modelId },
          }
        : {
            check: 'MODEL',
            result: 'FAILED',
            detail:
              code === 404
                ? `The model ${args.modelId} is not available to this key (404). Check the model name, or whether this organization has access to it.`
                : `The model lookup answered ${code}.`,
            facts: { httpStatus: code, modelId: args.modelId, ...ids },
          };
  } catch {
    model = {
      check: 'MODEL',
      result: 'FAILED',
      detail: 'The model lookup did not complete (network error or timeout).',
      facts: { cause: 'UNREACHABLE', modelId: args.modelId },
    };
  }

  return { endpoint, authentication, model, limits };
};
