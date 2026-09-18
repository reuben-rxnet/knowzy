// Redaction — security.md §12.
//
// Applied at WRITE time, not display time: a record written unredacted cannot
// be un-leaked. Two independent mechanisms, because either alone has a known
// blind spot:
//
//   1. key-name denylists  — catches a secret in a well-named field
//   2. value-shape matching — catches a secret pasted into a field called
//                             `note`, which a key denylist never would
//
// A third denylist covers CONTENT: document bodies, question text, answer
// keys, and learner answers. Those are not secrets in the credential sense,
// but putting them in a 7-year audit store would be both a privacy problem and
// an answer-key exposure (audit-model.md §5).

export const REDACTED = '[redacted]';
export const REDACTED_CONTENT = '[content-withheld]';

/** Credential-shaped field names. Matched case-insensitively on the whole key. */
const SECRET_KEY_PATTERNS: readonly RegExp[] = [
  /^authorization$/i,
  /^proxy-authorization$/i,
  /^cookie$/i,
  /^set-cookie$/i,
  /secret/i,
  /password/i,
  /passphrase/i,
  /^pwd$/i,
  /token/i,
  /^apikey$/i,
  /^api[-_]?key$/i,
  /credential/i,
  /^client[-_]?secret$/i,
  /private[-_]?key/i,
  /^sas$/i,
  /signature/i,
];

/**
 * Content-shaped field names. These never belong in a log line or an audit
 * event; the field-level diff lives in draft_question_version instead.
 */
const CONTENT_KEY_PATTERNS: readonly RegExp[] = [
  /^extractedtext$/i,
  /^normalizedtext$/i,
  /^questiontext$/i,
  /^answerpayload$/i,
  /^responsepayload$/i,
  /^correctanswer$/i,
  /^correctoption$/i,
  /^correctoptions$/i,
  /^correctvalue$/i,
  /^acceptedanswers$/i,
  /^correctorder$/i,
  /^explanation$/i,
  /^supportingevidence$/i,
  /^sectiontext$/i,
  /^selectedoption$/i,
  /^optiona$/i,
  /^optionb$/i,
  /^optionc$/i,
  /^optiond$/i,
  /^body$/i,
  /^excerpt$/i,
  /^snippet$/i,
];

/**
 * Value shapes that are a secret regardless of the field they arrived in.
 *
 * The high-entropy rule deliberately excludes a SHA-256 hex digest and a UUID:
 * both are legitimately logged (content hashes and identifiers are how a record
 * is traced), and redacting them would destroy the audit trail this design
 * depends on.
 */
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/;
const PEM_PATTERN = /-----BEGIN [A-Z ]*(PRIVATE KEY|CERTIFICATE)-----/;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/i;
const SHA256_HEX = /^[0-9a-f]{64}$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE64ISH = /^[A-Za-z0-9+/_-]{32,}={0,2}$/;

const looksLikeSecretValue = (value: string): boolean => {
  if (JWT_PATTERN.test(value)) return true;
  if (PEM_PATTERN.test(value)) return true;
  if (BEARER_PATTERN.test(value)) return true;

  if (SHA256_HEX.test(value)) return false;
  if (UUID_PATTERN.test(value)) return false;

  // A long opaque token. Requires mixed character classes so an ordinary long
  // sentence or a file path does not trip it.
  if (BASE64ISH.test(value) && value.length >= 32) {
    const hasLower = /[a-z]/.test(value);
    const hasUpper = /[A-Z]/.test(value);
    const hasDigit = /[0-9]/.test(value);
    return hasLower && hasUpper && hasDigit;
  }
  return false;
};

const matchesAny = (patterns: readonly RegExp[], key: string): boolean =>
  patterns.some((p) => p.test(key));

/**
 * Exact key names that the credential patterns match but which are NOT
 * credentials.
 *
 * `/token/i` is deliberately broad, and it should stay that way — narrowing it
 * to catch fewer credential shapes would be the wrong trade. But it also
 * matches token COUNTS, which are cost figures the platform is required to
 * account for (architecture.md §365). Writing "[redacted]" over a number
 * misleads twice: the cost is lost, and the record implies a secret was there.
 *
 * The list is EXACT-MATCH and lowercase-compared, so it cannot be widened by
 * accident: `accessTokenCount` is not on it and stays redacted.
 */
const SAFE_KEY_EXCEPTIONS: ReadonlySet<string> = new Set([
  'inputtokencount',
  'outputtokencount',
  'totaltokencount',
  'tokencount',
]);

export const isSecretKey = (key: string): boolean => {
  if (SAFE_KEY_EXCEPTIONS.has(key.toLowerCase())) return false;
  return matchesAny(SECRET_KEY_PATTERNS, key);
};
export const isContentKey = (key: string): boolean => matchesAny(CONTENT_KEY_PATTERNS, key);

export interface RedactOptions {
  /** Redact content-shaped keys as well as secrets. Default true. */
  readonly redactContent?: boolean;
  /** Maximum recursion depth before the subtree is dropped. */
  readonly maxDepth?: number;
  /** Maximum string length retained; longer values are truncated with a marker. */
  readonly maxStringLength?: number;
}

const DEFAULTS: Required<RedactOptions> = {
  redactContent: true,
  maxDepth: 8,
  maxStringLength: 2048,
};

/**
 * Deep-redacts an arbitrary value. Total and non-throwing: a redactor that can
 * throw is a redactor that gets bypassed by a try/catch somewhere upstream.
 */
export const redact = (value: unknown, options: RedactOptions = {}): unknown => {
  const opts = { ...DEFAULTS, ...options };
  const seen = new WeakSet<object>();

  const walk = (node: unknown, depth: number, keyHint: string | null): unknown => {
    if (depth > opts.maxDepth) return '[truncated-depth]';

    if (node === null || node === undefined) return node;

    if (typeof node === 'string') {
      if (keyHint !== null && isSecretKey(keyHint)) return REDACTED;
      if (keyHint !== null && opts.redactContent && isContentKey(keyHint)) return REDACTED_CONTENT;
      if (looksLikeSecretValue(node)) return REDACTED;
      if (node.length > opts.maxStringLength) {
        return `${node.slice(0, opts.maxStringLength)}…[truncated]`;
      }
      return node;
    }

    if (typeof node === 'number' || typeof node === 'boolean' || typeof node === 'bigint') {
      return typeof node === 'bigint' ? node.toString() : node;
    }

    if (node instanceof Date) return node.toISOString();
    if (node instanceof Error) {
      return { name: node.name, message: walk(node.message, depth + 1, null) };
    }

    if (Array.isArray(node)) {
      if (seen.has(node)) return '[circular]';
      seen.add(node);
      return node.map((item) => walk(item, depth + 1, keyHint));
    }

    if (typeof node === 'object') {
      if (seen.has(node)) return '[circular]';
      seen.add(node);
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (isSecretKey(k)) {
          out[k] = REDACTED;
          continue;
        }
        if (opts.redactContent && isContentKey(k)) {
          out[k] = REDACTED_CONTENT;
          continue;
        }
        out[k] = walk(v, depth + 1, k);
      }
      return out;
    }

    // Functions, symbols — never legitimately logged.
    return '[unloggable]';
  };

  return walk(value, 0, null);
};

/**
 * Truncates an IP before storage — audit-model.md §3.1 H6.
 * /24 for IPv4, /48 for IPv6. The full address is never persisted.
 */
export const truncateIp = (ip: string | null | undefined): string | null => {
  if (!ip) return null;
  const trimmed = ip.trim();
  if (trimmed.length === 0) return null;

  if (trimmed.includes(':')) {
    const groups = trimmed.split(':').filter((g) => g.length > 0);
    return `${groups.slice(0, 3).join(':')}::/48`;
  }

  const octets = trimmed.split('.');
  if (octets.length !== 4) return null;
  return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
};

/**
 * Classifies a user agent — the raw string is never stored (§5).
 */
export const classifyUserAgent = (ua: string | null | undefined): string | null => {
  if (!ua) return null;
  const s = ua.toLowerCase();
  const mobile = /iphone|ipad|android|mobile/.test(s);
  let engine = 'unknown';
  if (/edg\//.test(s)) engine = 'edge';
  else if (/chrome\/|crios/.test(s)) engine = 'chromium';
  else if (/firefox\/|fxios/.test(s)) engine = 'firefox';
  else if (/safari\//.test(s)) engine = 'safari';
  else if (/bot|crawler|spider/.test(s)) engine = 'bot';
  return `${mobile ? 'mobile' : 'desktop'}-${engine}`;
};
