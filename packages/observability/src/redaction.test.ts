// Exit criterion (implementation-roadmap.md Phase 1):
// "The redactor is proven against secret-shaped and content-shaped fixtures."
//
// Both directions are asserted. A redactor that removes everything is useless —
// the audit trail depends on identifiers, hashes, and correlation IDs surviving
// — so the "must survive" cases carry equal weight to the "must be removed"
// ones.

import { describe, expect, it } from 'vitest';
import {
  REDACTED,
  REDACTED_CONTENT,
  classifyUserAgent,
  isContentKey,
  isSecretKey,
  redact,
  truncateIp,
} from './redaction.js';

const asRecord = (value: unknown): Record<string, unknown> => value as Record<string, unknown>;

// ---------------------------------------------------------------------------
// Secret-shaped fixtures
// ---------------------------------------------------------------------------

describe('redact — secret-shaped by key name', () => {
  const secretKeys = [
    'authorization',
    'Authorization',
    'proxy-authorization',
    'cookie',
    'set-cookie',
    'clientSecret',
    'client_secret',
    'password',
    'passphrase',
    'pwd',
    'accessToken',
    'refresh_token',
    'apiKey',
    'api_key',
    'graphCredential',
    'privateKey',
    'signature',
  ];

  it.each(secretKeys)('removes the value of %s', (key) => {
    const out = asRecord(redact({ [key]: 'any-value-at-all' }));
    expect(out[key]).toBe(REDACTED);
  });

  it('classifies each secret key name', () => {
    for (const key of secretKeys) {
      expect(isSecretKey(key), key).toBe(true);
    }
  });

  it('removes a secret nested inside arrays and objects', () => {
    const out = asRecord(
      redact({
        sources: [{ name: 'ok', connection: { clientSecret: 'shhh', siteUrl: 'https://example' } }],
      }),
    );
    const sources = out['sources'] as Array<Record<string, unknown>>;
    const connection = asRecord(sources[0]?.['connection']);
    expect(connection['clientSecret']).toBe(REDACTED);
    expect(connection['siteUrl']).toBe('https://example');
  });
});

describe('redact — secret-shaped by value', () => {
  it('removes a JWT found in an innocently named field', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const out = asRecord(redact({ note: jwt }));
    expect(out['note']).toBe(REDACTED);
  });

  it('removes a PEM block', () => {
    const pem = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg...\n-----END PRIVATE KEY-----';
    const out = asRecord(redact({ detail: pem }));
    expect(out['detail']).toBe(REDACTED);
  });

  it('removes a Bearer header value', () => {
    const out = asRecord(redact({ header: 'Bearer abcdefghijklmnopqrstuvwxyz012345' }));
    expect(out['header']).toBe(REDACTED);
  });

  it('removes a long mixed-class opaque token', () => {
    const out = asRecord(redact({ note: 'aZ9bY8cX7dW6eV5fU4gT3hS2iR1jQ0kP' }));
    expect(out['note']).toBe(REDACTED);
  });
});

// ---------------------------------------------------------------------------
// Values that MUST survive — the audit trail depends on them
// ---------------------------------------------------------------------------

describe('redact — identifiers and hashes survive', () => {
  it('keeps a SHA-256 content hash', () => {
    const hash = 'a'.repeat(64);
    const out = asRecord(redact({ contentHash: hash }));
    expect(out['contentHash']).toBe(hash);
  });

  it('keeps a UUID', () => {
    const id = '018f3c2a-7b1e-7c4d-9a2b-5e6f7a8b9c0d';
    const out = asRecord(redact({ entityId: id }));
    expect(out['entityId']).toBe(id);
  });

  it('keeps a correlation id', () => {
    const out = asRecord(redact({ correlationId: 'c-8f2a3b4c5d6e7f8091a2b3c4d5e6f708' }));
    expect(out['correlationId']).toBe('c-8f2a3b4c5d6e7f8091a2b3c4d5e6f708');
  });

  it('keeps a Key Vault reference, which is not a secret value', () => {
    const ref = 'keyvault://knowzy-dev/secrets/sp-support-ops-client';
    const out = asRecord(redact({ secretRef: ref }));
    // The key contains "secret", so the value is removed by key rule — which is
    // the conservative outcome. Asserted so the behaviour is intentional and
    // visible rather than surprising.
    expect(out['secretRef']).toBe(REDACTED);

    const underNeutralKey = asRecord(redact({ reference: ref }));
    expect(underNeutralKey['reference']).toBe(ref);
  });

  it('keeps ordinary counts, codes, and prose', () => {
    const out = asRecord(
      redact({
        count: 47,
        errorCode: 'SOURCE_FOLDER_NOT_FOUND',
        reason: 'The folder path was not found in this library.',
        passed: true,
      }),
    );
    expect(out['count']).toBe(47);
    expect(out['errorCode']).toBe('SOURCE_FOLDER_NOT_FOUND');
    expect(out['reason']).toBe('The folder path was not found in this library.');
    expect(out['passed']).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Content-shaped fixtures — audit-model.md §5
// ---------------------------------------------------------------------------

describe('redact — content-shaped', () => {
  const contentKeys = [
    'extractedText',
    'questionText',
    'answerPayload',
    'responsePayload',
    'correctAnswer',
    'correctOption',
    'explanation',
    'supportingEvidence',
    'sectionText',
    'selectedOption',
    'optionA',
    'excerpt',
    'snippet',
  ];

  it.each(contentKeys)('withholds %s', (key) => {
    const out = asRecord(redact({ [key]: 'some content' }));
    expect(out[key]).toBe(REDACTED_CONTENT);
  });

  it('classifies each content key name', () => {
    for (const key of contentKeys) {
      expect(isContentKey(key), key).toBe(true);
    }
  });

  it('withholds an answer key even when nested in a plausible payload', () => {
    const out = asRecord(
      redact({
        question: {
          questionId: 'KNZ-NET-2026-000412',
          questionText: 'Which command clears the ARP cache?',
          answerPayload: { options: { A: 'a', B: 'b', C: 'c', D: 'd' }, correctOption: 'B' },
          explanation: 'The Linux jump host uses iproute2.',
        },
      }),
    );
    const question = asRecord(out['question']);
    expect(question['questionId']).toBe('KNZ-NET-2026-000412');
    expect(question['questionText']).toBe(REDACTED_CONTENT);
    expect(question['answerPayload']).toBe(REDACTED_CONTENT);
    expect(question['explanation']).toBe(REDACTED_CONTENT);
  });

  it('can be told to keep content, for a non-audit sink that legitimately needs it', () => {
    const out = asRecord(redact({ questionText: 'hello' }, { redactContent: false }));
    expect(out['questionText']).toBe('hello');
  });
});

// ---------------------------------------------------------------------------
// Robustness — a redactor that throws is a redactor that gets bypassed
// ---------------------------------------------------------------------------

describe('redact — total and non-throwing', () => {
  it('handles null, undefined, and primitives', () => {
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
    expect(redact(42)).toBe(42);
    expect(redact(true)).toBe(true);
  });

  it('handles a circular structure', () => {
    const node: Record<string, unknown> = { name: 'root' };
    node['self'] = node;
    expect(() => redact(node)).not.toThrow();
    expect(asRecord(redact(node))['self']).toBe('[circular]');
  });

  it('bounds recursion depth', () => {
    let deep: Record<string, unknown> = { value: 'leaf' };
    for (let i = 0; i < 40; i += 1) deep = { nested: deep };
    expect(() => redact(deep)).not.toThrow();
    expect(JSON.stringify(redact(deep))).toContain('[truncated-depth]');
  });

  it('truncates a very long string rather than retaining it whole', () => {
    const long = 'x'.repeat(5000);
    const out = asRecord(redact({ note: long }));
    expect(String(out['note'])).toContain('[truncated]');
    expect(String(out['note']).length).toBeLessThan(long.length);
  });

  it('serializes an Error without leaking a stack', () => {
    const out = asRecord(redact({ err: new Error('boom') }));
    const err = asRecord(out['err']);
    expect(err['message']).toBe('boom');
    expect(err['stack']).toBeUndefined();
  });

  it('renders a bigint rather than throwing on serialization', () => {
    const out = asRecord(redact({ size: 10n }));
    expect(out['size']).toBe('10');
  });

  it('refuses to log a function', () => {
    const out = asRecord(redact({ fn: () => undefined }));
    expect(out['fn']).toBe('[unloggable]');
  });
});

// ---------------------------------------------------------------------------
// H6 — IP truncation before storage
// ---------------------------------------------------------------------------

describe('truncateIp', () => {
  it('truncates IPv4 to /24', () => {
    expect(truncateIp('203.0.113.42')).toBe('203.0.113.0/24');
  });

  it('truncates IPv6 to /48', () => {
    expect(truncateIp('2001:db8:1234:5678:9abc:def0:1234:5678')).toBe('2001:db8:1234::/48');
  });

  it('returns null for absent or malformed input rather than storing it', () => {
    expect(truncateIp(null)).toBeNull();
    expect(truncateIp(undefined)).toBeNull();
    expect(truncateIp('')).toBeNull();
    expect(truncateIp('not-an-ip')).toBeNull();
  });

  it('never returns the full address', () => {
    expect(truncateIp('203.0.113.42')).not.toContain('42');
  });
});

describe('classifyUserAgent', () => {
  it('classifies rather than storing the raw string', () => {
    const chrome =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
    expect(classifyUserAgent(chrome)).toBe('desktop-chromium');
  });

  it('detects mobile', () => {
    const ios =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
    expect(classifyUserAgent(ios)).toBe('mobile-safari');
  });

  it('returns null when absent', () => {
    expect(classifyUserAgent(null)).toBeNull();
  });
});

describe('safe-key exceptions', () => {
  it('keeps token COUNTS, which are cost figures rather than credentials', () => {
    expect(isSecretKey('inputTokenCount')).toBe(false);
    expect(isSecretKey('outputTokenCount')).toBe(false);
    expect(isSecretKey('totalTokenCount')).toBe(false);
    expect(redact({ inputTokenCount: 1375, outputTokenCount: 820 })).toEqual({
      inputTokenCount: 1375,
      outputTokenCount: 820,
    });
  });

  it('still redacts anything else containing "token"', () => {
    // The exception list is exact-match, so it cannot be widened by accident.
    for (const key of ['accessToken', 'token', 'refreshToken', 'accessTokenCount', 'oboTokenRef']) {
      expect(isSecretKey(key), key).toBe(true);
    }
  });
});
