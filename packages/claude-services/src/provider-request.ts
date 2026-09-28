// One way to send a request to a model provider — GATEWAY-M1 (2026-09-28).
//
// Before this file the readiness probe (openai.ts) and the generation client
// (openai-generation.ts) each built their own requests, and they had already
// drifted: generation honoured a custom auth header while Test connection
// always sent `Authorization: Bearer`, so a gateway key would have failed the
// test and passed at generation. Both now call `providerFetch`, so the rules
// below are written once:
//
//   * THE KEY IS REVEALED HERE AND NOWHERE ELSE in production code. It goes
//     either into the configured header or into the configured query
//     parameter -- never both, and with no fallback from one to the other.
//   * A QUERY-PARAMETER KEY EXISTS ONLY IN A LOCAL `URL` inside
//     `providerFetch`. The URL is never returned, stored, logged or put in an
//     error. Anything that must describe a URL uses `sanitizeUrl`.
//   * IT IS SENT ONLY TO AN ALLOW-LISTED HOST, over https (loopback excepted),
//     with REDIRECTS REFUSED -- a redirect is a way to receive a credential
//     meant for the first origin.
//   * FIXED EXTRA HEADERS are ordinary, non-secret configuration, validated by
//     the settings schema, and sent the same way to both clients.
//   * A TRANSPORT FAILURE IS CLASSIFIED, NOT QUOTED. `classifyTransportError`
//     turns an exception into a cause (DNS, TLS trust, timeout, ...) and a
//     sentence written here; the exception's own message, which may name
//     internals, is discarded.

import {
  isCredentialQueryParameter,
  type ProviderAuthLocation,
  type ProviderSettings,
  type RevealableSecret,
} from '@knowzy/shared-types';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** How the credential travels. Discriminated, so there is no "both". */
export type ProviderAuth =
  | { readonly location: 'HEADER'; readonly headerName: string }
  | { readonly location: 'QUERY_PARAMETER'; readonly parameterName: string };

/** The authentication a provider's settings describe. Absent means a Bearer header. */
export const authFromSettings = (settings: ProviderSettings | undefined): ProviderAuth => {
  const location: ProviderAuthLocation = settings?.authLocation ?? 'HEADER';
  if (location === 'QUERY_PARAMETER') {
    // The settings schema refuses QUERY_PARAMETER without a name, so this is
    // unreachable for stored settings; it fails closed for anything else.
    const parameterName = settings?.authQueryParameterName;
    if (parameterName === undefined) {
      throw new Error('Query-parameter authentication is configured without a parameter name.');
    }
    return { location, parameterName };
  }
  return { location: 'HEADER', headerName: settings?.authHeaderName ?? 'authorization' };
};

/** Everything a request needs besides its path and body. */
export interface ProviderEndpoint {
  readonly baseUrl: string;
  /** Hosts the credential may be sent to, `host` or `host:port`. */
  readonly allowedHosts: readonly string[];
  readonly auth: ProviderAuth;
  readonly extraHeaders: Readonly<Record<string, string>>;
  readonly apiKey: RevealableSecret;
}

/**
 * A URL with every credential-bearing query parameter's value replaced.
 *
 * Exact-name matching against `CREDENTIAL_QUERY_PARAMETERS`: a parameter that
 * merely CONTAINS "key" (`keyword`, `monkey`) is left alone, so a diagnostic
 * stays useful. Userinfo (`user:pass@`) is dropped entirely.
 */
export const sanitizeUrl = (input: string | URL): string => {
  let url: URL;
  try {
    url = new URL(input.toString());
  } catch {
    return '[unparseable URL]';
  }
  url.username = '';
  url.password = '';
  for (const name of [...url.searchParams.keys()]) {
    if (isCredentialQueryParameter(name)) url.searchParams.set(name, 'REDACTED');
  }
  return url.toString();
};

/**
 * Whether the credential may be sent to this base URL, and why not if not.
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
  if ([...url.searchParams.keys()].some(isCredentialQueryParameter)) {
    return {
      allowed: false,
      reason:
        'The base URL carries a credential in its query string. A credential goes in the credential reference, never in a stored URL. The key was not sent.',
    };
  }
  return { allowed: true, url };
};

export interface ProviderFetchInit {
  readonly method: 'GET' | 'POST';
  /** A JSON body, for POST. Readiness requests have none. */
  readonly body?: string;
  /**
   * False sends the request WITHOUT the credential -- the readiness probe's
   * anonymous comparison against a gateway that exposes no `/models`. Fixed
   * headers are still sent: they are routing, not authentication.
   */
  readonly withCredential?: boolean;
  readonly timeoutMs: number;
  readonly fetch?: typeof fetch;
}

/**
 * Sends one request. The caller must have checked `endpointPermission` and
 * passes the permitted URL; this function builds the request URL, attaches
 * the credential and returns only the Response.
 */
export const providerFetch = (
  endpoint: ProviderEndpoint,
  permitted: URL,
  path: string,
  init: ProviderFetchInit,
): Promise<Response> => {
  const base = permitted.toString().replace(/\/+$/, '');
  // Held only in this scope. Never returned, logged or thrown.
  const url = new URL(`${base}${path}`);
  const headers: Record<string, string> = { accept: 'application/json' };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  for (const [name, value] of Object.entries(endpoint.extraHeaders)) {
    headers[name.trim().toLowerCase()] = value;
  }

  if (init.withCredential !== false) {
    if (endpoint.auth.location === 'QUERY_PARAMETER') {
      // THE one place the key is revealed into a URL.
      url.searchParams.set(endpoint.auth.parameterName, endpoint.apiKey.reveal());
    } else {
      const name = endpoint.auth.headerName.toLowerCase();
      // THE one place the key is revealed into a header.
      headers[name] =
        name === 'authorization' ? `Bearer ${endpoint.apiKey.reveal()}` : endpoint.apiKey.reveal();
    }
  }

  return (init.fetch ?? fetch)(url, {
    method: init.method,
    redirect: 'error',
    signal: AbortSignal.timeout(init.timeoutMs),
    headers,
    ...(init.body === undefined ? {} : { body: init.body }),
  });
};

// ---------------------------------------------------------------------------
// Transport failures
// ---------------------------------------------------------------------------

export type TransportFailureCause =
  | 'DNS'
  | 'TIMEOUT'
  | 'TLS_TRUST'
  | 'TLS_CERTIFICATE'
  | 'CONNECTION_REFUSED'
  | 'CONNECTION_RESET'
  | 'REDIRECT_REFUSED'
  | 'UNREACHABLE';

/** Certificate-chain errors an internal certificate authority produces. */
const TLS_TRUST_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_UNTRUSTED',
]);
const TLS_CERTIFICATE_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'CERT_REVOKED',
]);
const DNS_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'EAI_FAIL', 'EAI_NONAME']);
const TIMEOUT_CODES = new Set([
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

/** Every error in a cause chain, including an AggregateError's members. */
const causeChain = (error: unknown): readonly Record<string, unknown>[] => {
  const out: Record<string, unknown>[] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 6 || value === null || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    out.push(record);
    visit(record['cause'], depth + 1);
    const members = record['errors'];
    if (Array.isArray(members)) for (const member of members) visit(member, depth + 1);
  };
  visit(error, 0);
  return out;
};

/**
 * What went wrong below HTTP, in words written here.
 *
 * Reads only the machine-readable `code` and `name` of each error in the
 * chain. The messages are never read into the result, so a message that
 * quotes a URL cannot leak one.
 */
export const classifyTransportError = (
  error: unknown,
  host: string,
  timeoutMs: number,
): { readonly cause: TransportFailureCause; readonly detail: string } => {
  const chain = causeChain(error);
  const codes = chain.map((entry) => String(entry['code'] ?? ''));
  const names = chain.map((entry) => String(entry['name'] ?? ''));
  const messages = chain.map((entry) => String(entry['message'] ?? '').toLowerCase());

  if (
    names.includes('TimeoutError') ||
    names.includes('AbortError') ||
    codes.some((c) => TIMEOUT_CODES.has(c))
  ) {
    return {
      cause: 'TIMEOUT',
      detail: `No response from ${host} within ${timeoutMs} ms. Check the network route to it (VPN, proxy, firewall).`,
    };
  }
  if (codes.some((c) => DNS_CODES.has(c))) {
    return {
      cause: 'DNS',
      detail: `${host} could not be resolved from this server. An internal host usually needs the corporate DNS or VPN to be reachable from the API container.`,
    };
  }
  if (codes.some((c) => TLS_TRUST_CODES.has(c))) {
    return {
      cause: 'TLS_TRUST',
      detail: `${host} presented a certificate this server does not trust, typically one issued by an internal certificate authority. NODE_EXTRA_CA_CERTS configuration required: give the API container that CA's certificate. TLS verification was not, and will not be, disabled.`,
    };
  }
  if (codes.some((c) => TLS_CERTIFICATE_CODES.has(c))) {
    return {
      cause: 'TLS_CERTIFICATE',
      detail: `${host} presented a certificate that is expired, not yet valid, revoked or issued for another name. The connection was refused.`,
    };
  }
  if (codes.includes('ECONNREFUSED')) {
    return { cause: 'CONNECTION_REFUSED', detail: `${host} refused the connection.` };
  }
  if (codes.includes('ECONNRESET') || codes.includes('UND_ERR_SOCKET')) {
    return {
      cause: 'CONNECTION_RESET',
      detail: `The connection to ${host} was closed before a response arrived.`,
    };
  }
  // undici reports a refused redirect (redirect: 'error') this way. It is
  // matched on the fixed phrase, and the phrase is not repeated.
  if (messages.some((m) => m.includes('redirect'))) {
    return {
      cause: 'REDIRECT_REFUSED',
      detail: `${host} answered with a redirect, which is refused: following it could deliver the credential to another origin.`,
    };
  }
  return {
    cause: 'UNREACHABLE',
    detail: `${host} could not be reached (network error).`,
  };
};
