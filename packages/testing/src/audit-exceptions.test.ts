// The audit gate is a deviation from security.md §14, so it is asserted rather
// than described: every rule that makes the exception register safe to have has
// a test that fails when the rule is removed.

import { describe, expect, it } from 'vitest';
import {
  advisoriesFromNpmAudit,
  evaluateAudit,
  parseExceptionRegister,
  type AuditAdvisory,
  type ExceptionRegister,
} from './audit-exceptions.js';

const NOW = new Date('2026-09-21T00:00:00Z');

const advisory = (overrides: Partial<AuditAdvisory> = {}): AuditAdvisory => ({
  ghsa: 'GHSA-aaaa-bbbb-cccc',
  severity: 'high',
  advisorySeverity: 'high',
  packageSeverity: 'high',
  packageName: 'left-pad',
  title: 'An example advisory',
  ...overrides,
});

const register = (
  overrides: Partial<ExceptionRegister['exceptions'][number]> = {},
): ExceptionRegister => ({
  version: 1,
  exceptions: [
    {
      id: 'EX-001',
      advisories: ['GHSA-aaaa-bbbb-cccc'],
      packages: ['left-pad'],
      expires: '2026-12-31',
      classification: 'breaking-change-required',
      reachability: 'not-reachable',
      reason: 'Build-time only.',
      ...overrides,
    },
  ],
});

describe('audit gate', () => {
  it('passes when every high advisory has a live exception', () => {
    const verdict = evaluateAudit({ advisories: [advisory()], register: register(), now: NOW });
    expect(verdict.ok).toBe(true);
    expect(verdict.suppressed).toHaveLength(1);
    expect(verdict.suppressed[0]?.exceptionId).toBe('EX-001');
  });

  it('blocks an advisory nobody has written down', () => {
    const verdict = evaluateAudit({
      advisories: [advisory({ ghsa: 'GHSA-zzzz-zzzz-zzzz', packageName: 'newly-broken' })],
      register: register(),
      now: NOW,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.blocking[0]?.reason).toBe('undeclared');
    // The whole point: a new advisory fails the build on the day it lands,
    // without anyone having to notice it.
    expect(verdict.blocking[0]?.packageName).toBe('newly-broken');
  });

  it('blocks once the exception has expired', () => {
    const verdict = evaluateAudit({
      advisories: [advisory()],
      register: register({ expires: '2026-09-20' }),
      now: NOW,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.blocking[0]?.reason).toBe('expired');
  });

  it('treats the expiry date itself as expired, not as the last good day', () => {
    const verdict = evaluateAudit({
      advisories: [advisory()],
      register: register({ expires: '2026-09-21' }),
      now: NOW,
    });
    expect(verdict.ok).toBe(false);
  });

  it('refuses to suppress an advisory the register itself calls reachable', () => {
    const verdict = evaluateAudit({
      advisories: [advisory()],
      register: register({ reachability: 'reachable' }),
      now: NOW,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.blocking[0]?.reason).toBe('reachable');
  });

  it('blocks on a stale exception, so the register cannot rot', () => {
    // The advisory was fixed upstream and is gone from the tree, but the entry
    // is still here. That is a register describing a tree that no longer
    // exists, which is how a real finding later gets excused by an old note.
    const verdict = evaluateAudit({ advisories: [], register: register(), now: NOW });
    expect(verdict.ok).toBe(false);
    expect(verdict.staleExceptions[0]?.id).toBe('EX-001');
  });

  it('ignores moderate and low advisories, matching --audit-level=high', () => {
    const verdict = evaluateAudit({
      advisories: [advisory({ ghsa: 'GHSA-mmmm-mmmm-mmmm', severity: 'moderate' })],
      register: { version: 1, exceptions: [] },
      now: NOW,
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.blocking).toHaveLength(0);
  });

  it('reads the register out of the Markdown document that explains it', () => {
    const markdown = [
      '# Security exceptions',
      '',
      'Some prose that a person reads.',
      '',
      '<!-- knowzy:security-exceptions -->',
      '',
      '```json',
      JSON.stringify(register(), null, 2),
      '```',
      '',
      'More prose.',
    ].join('\n');

    const parsed = parseExceptionRegister(markdown);
    expect(parsed.exceptions).toHaveLength(1);
    expect(parsed.exceptions[0]?.id).toBe('EX-001');
  });

  it('throws rather than assuming an empty register when the marker is missing', () => {
    // An unreadable register must never read as "no exceptions needed", which
    // would turn a documentation mistake into a silently passing build.
    expect(() => parseExceptionRegister('# Nothing here')).toThrow(/marker/);
  });

  it('blocks a moderate advisory whose package npm rolls up to high', () => {
    // Parity with the command this gate replaces. npm reports
    // GHSA-qx2v-qp2m-jg93 as moderate but rolls `postcss` up to high, and
    // `npm audit --audit-level=high` fails on the rollup. A gate that decided
    // on the advisory alone would be quieter than security.md §14 requires.
    const advisories = advisoriesFromNpmAudit({
      vulnerabilities: {
        postcss: {
          severity: 'high',
          via: [
            {
              title: 'PostCSS has XSS via Unescaped </style>',
              url: 'https://github.com/advisories/GHSA-qx2v-qp2m-jg93',
              severity: 'moderate',
            },
          ],
        },
      },
    });

    expect(advisories[0]?.advisorySeverity).toBe('moderate');
    expect(advisories[0]?.packageSeverity).toBe('high');
    expect(advisories[0]?.severity).toBe('high');

    const verdict = evaluateAudit({
      advisories,
      register: { version: 1, exceptions: [] },
      now: NOW,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.blocking[0]?.reason).toBe('undeclared');
  });

  it('extracts one advisory per package path from npm audit output', () => {
    const auditJson = {
      vulnerabilities: {
        postcss: {
          severity: 'high',
          via: [
            {
              title: 'PostCSS has XSS via Unescaped </style>',
              url: 'https://github.com/advisories/GHSA-qx2v-qp2m-jg93',
              severity: 'high',
            },
            'next',
          ],
        },
        next: { severity: 'high', via: ['postcss'] },
      },
    };

    const advisories = advisoriesFromNpmAudit(auditJson);
    expect(advisories).toHaveLength(1);
    expect(advisories[0]?.ghsa).toBe('GHSA-qx2v-qp2m-jg93');
    expect(advisories[0]?.packageName).toBe('postcss');
    // A `via` entry that is a package NAME rather than an advisory object is a
    // path, not a finding, and must not become one.
  });
});
