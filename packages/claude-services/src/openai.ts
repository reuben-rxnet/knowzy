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
//   1. It arrives as a `RevealableSecret` and is revealed in exactly one
//      production file, `provider-request.ts`, which both this probe and the
//      generation client send through (GATEWAY-M1). It goes in the configured
//      header OR the configured query parameter, never both.
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
import {
  classifyTransportError,
  endpointPermission,
  providerFetch,
  type ProviderAuth,
  type ProviderEndpoint,
} from './provider-request.js';

export { endpointPermission } from './provider-request.js';

/** OpenAI's documented API host. The allow-list default for this provider. */
export const OPENAI_DEFAULT_HOSTS = ['api.openai.com'] as const;
export const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';

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
  /** GATEWAY-M1. Absent means `Authorization: Bearer`. */
  readonly auth?: ProviderAuth;
  /** Fixed, non-secret headers from the provider's settings. */
  readonly extraHeaders?: Readonly<Record<string, string>>;
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
 * Checks that the endpoint can be reached, accepts the credential, and offers
 * the model -- with GET requests that carry no content.
 *
 * Each step records what it OBSERVED (a status code, a round-trip time) and
 * never a claim beyond it. A check that could not run says NOT_ATTEMPTED and
 * names what stopped it; a check the endpoint does not support says SKIPPED.
 *
 * GATEWAY-M1: an API gateway may expose no `/models` route. A 404 there is
 * not proof the credential failed, and not proof it worked. The probe then
 * repeats the same GET WITHOUT the credential: if the gateway refuses that
 * (401/403) while it answered the keyed request with 404, the credential
 * demonstrably got past its authentication, and AUTHENTICATION passes on that
 * observed difference. Model discovery is reported SKIPPED -- never PASSED --
 * because nothing confirmed the model.
 */
export const checkOpenAIReadiness = async (args: CheckReadinessArgs): Promise<ReadinessResult> => {
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
  const host = permission.url.hostname;

  const endpoint: ProviderEndpoint = {
    baseUrl: args.baseUrl,
    allowedHosts: args.allowedHosts,
    auth: args.auth ?? { location: 'HEADER', headerName: 'authorization' },
    extraHeaders: args.extraHeaders ?? {},
    apiKey: args.apiKey,
  };
  const get = async (path: string, withCredential = true) => {
    const started = now();
    const response = await providerFetch(endpoint, permission.url, path, {
      method: 'GET',
      withCredential,
      timeoutMs,
      ...(args.fetch === undefined ? {} : { fetch: args.fetch }),
    });
    return { response, elapsedMs: now() - started };
  };

  // ------------------------------------------------ endpoint + authentication
  let list: Awaited<ReturnType<typeof get>>;
  try {
    list = await get('/models');
  } catch (error) {
    const failure = classifyTransportError(error, host, timeoutMs);
    return {
      endpoint: {
        check: 'ENDPOINT',
        result: 'FAILED',
        detail: failure.detail,
        facts: { cause: failure.cause, host },
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
  const reached: ProviderValidationStep = {
    check: 'ENDPOINT',
    result: 'PASSED',
    detail: `${host} responded over ${permission.url.protocol.replace(':', '')} in ${list.elapsedMs} ms.`,
    facts: { host, httpStatus: status, elapsedMs: list.elapsedMs },
  };
  const limits: ReadinessLimits = {
    requestsPerMinute: numberHeader(list.response, 'x-ratelimit-limit-requests'),
    tokensPerMinute: numberHeader(list.response, 'x-ratelimit-limit-tokens'),
  };

  if (status === 401 || status === 403) {
    const ids = await errorIdentifiers(list.response);
    return {
      endpoint: reached,
      authentication: {
        check: 'AUTHENTICATION',
        result: 'FAILED',
        detail:
          status === 401
            ? 'The endpoint refused the credential (401). Check that the secret in the store is the current key, and that the authentication location and name match what the endpoint expects.'
            : 'The endpoint refused access (403): the gateway or provider did not authorize this credential for this API, or its quota is exhausted.',
        facts: {
          httpStatus: status,
          cause: status === 401 ? 'AUTH_REJECTED' : 'ACCESS_DENIED',
          ...ids,
        },
      },
      model: notAttempted('MODEL', 'Not attempted: the credential was not accepted.'),
      limits,
    };
  }

  if (status === 404) {
    await list.response.body?.cancel();
    return {
      endpoint: {
        ...reached,
        detail: `${reached.detail} It has no /models route (404).`,
      },
      authentication: await authenticationByComparison(get, host, timeoutMs),
      model: {
        check: 'MODEL',
        result: 'SKIPPED',
        detail:
          'Model discovery is not exposed by this gateway. The model or deployment name is unverified until the first generation call. If this endpoint is not a gateway, check the base URL.',
        facts: { httpStatus: 404, modelId: args.modelId },
      },
      limits,
    };
  }

  if (status === 429) {
    const ids = await errorIdentifiers(list.response);
    return {
      endpoint: reached,
      authentication: {
        check: 'AUTHENTICATION',
        result: 'PASSED',
        detail:
          'The endpoint accepted the credential and then refused the request for rate or quota (429). Authentication is established; the quota is not.',
        facts: { httpStatus: 429, cause: 'RATE_LIMITED', ...ids },
      },
      model: notAttempted('MODEL', 'Not attempted: the endpoint is rate limiting this credential.'),
      limits,
    };
  }

  if (status !== 200) {
    await list.response.body?.cancel();
    const unavailable = status === 502 || status === 503 || status === 504;
    return {
      endpoint: {
        ...reached,
        result: 'FAILED',
        detail: unavailable
          ? `${host} answered ${status}: the service behind it is unavailable. Try again later.`
          : `${host} answered ${status}, which is not a models listing. Check the base URL (it normally ends in /v1).`,
        facts: {
          ...reached.facts,
          cause: unavailable ? 'SERVICE_UNAVAILABLE' : 'UNEXPECTED_STATUS',
        },
      },
      authentication: notAttempted(
        'AUTHENTICATION',
        `Not established: the endpoint answered ${status}.`,
      ),
      model: notAttempted('MODEL', `Not attempted: the endpoint answered ${status}.`),
      limits,
    };
  }

  await list.response.body?.cancel();
  const authentication: ProviderValidationStep = {
    check: 'AUTHENTICATION',
    result: 'PASSED',
    detail: 'The endpoint accepted the credential and listed the models it can use.',
    facts: { httpStatus: 200 },
  };

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
            detail: `The model ${args.modelId} is available to this credential.`,
            facts: { httpStatus: 200, modelId: args.modelId },
          }
        : {
            check: 'MODEL',
            result: 'FAILED',
            detail:
              code === 404
                ? `The model ${args.modelId} is not available to this credential (404). Check the model name -- on Azure, the deployment name -- or whether this organization has access to it.`
                : `The model lookup answered ${code}.`,
            facts: { httpStatus: code, modelId: args.modelId, ...ids },
          };
  } catch (error) {
    const failure = classifyTransportError(error, host, timeoutMs);
    model = {
      check: 'MODEL',
      result: 'FAILED',
      detail: `The model lookup did not complete. ${failure.detail}`,
      facts: { cause: failure.cause, modelId: args.modelId },
    };
  }

  return { endpoint: reached, authentication, model, limits };
};

/**
 * Authentication established by the difference between a keyed and an
 * anonymous request to the same route. Only an observed refusal of the
 * anonymous request counts; anything else leaves authentication unproven.
 */
const authenticationByComparison = async (
  get: (
    path: string,
    withCredential?: boolean,
  ) => Promise<{ response: Response; elapsedMs: number }>,
  host: string,
  timeoutMs: number,
): Promise<ProviderValidationStep> => {
  let anonymousStatus: number;
  try {
    const anonymous = await get('/models', false);
    anonymousStatus = anonymous.response.status;
    await anonymous.response.body?.cancel();
  } catch (error) {
    const failure = classifyTransportError(error, host, timeoutMs);
    return notAttempted(
      'AUTHENTICATION',
      `Not established: the comparison request without the credential did not complete. ${failure.detail}`,
    );
  }
  if (anonymousStatus === 401 || anonymousStatus === 403) {
    return {
      check: 'AUTHENTICATION',
      result: 'PASSED',
      detail: `Without the credential the gateway answered ${anonymousStatus}; with it, 404 for /models. The credential got past the gateway's authentication.`,
      facts: { httpStatus: 404, anonymousHttpStatus: anonymousStatus },
    };
  }
  return {
    check: 'AUTHENTICATION',
    result: 'NOT_ATTEMPTED',
    detail: `Not established: the gateway answered ${anonymousStatus} without the credential and 404 with it, so the difference proves nothing about the key. It is unverified until the first generation call.`,
    facts: { httpStatus: 404, anonymousHttpStatus: anonymousStatus },
  };
};
