// Exit criterion (implementation-roadmap.md Phase 1):
// "Every §5 boundary rule in repository-structure.md is enforced in CI and
//  demonstrably fails on a planted violation."
//
// A boundary configuration that has never been observed rejecting anything is
// a boundary nobody should trust. This suite plants a real violation on disk,
// runs the real dependency-cruiser configuration, asserts the specific rule
// fires, and removes the file again.
//
// It is slow by test standards (one process spawn per case) and that is the
// correct trade: these rules are the structural guarantees behind
// "no domain service can reach Graph by another path" and "no answer-key-capable
// code in a browser bundle".

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const PLANTED = 'planted-boundary-violation.ts';

/** Files this suite created, removed in afterEach even when an assertion fails. */
const planted: string[] = [];

const plantFile = (relativePath: string, contents: string): string => {
  const absolute = join(REPO_ROOT, relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents, 'utf8');
  planted.push(absolute);
  return absolute;
};

interface CruiseResult {
  readonly exitCode: number;
  readonly output: string;
}

/**
 * Resolves the dependency-cruiser CLI and runs it with THIS node.
 *
 * Not via `npx`: Node 20+ refuses to spawn a .cmd or .bat without a shell (the
 * CVE-2024-27980 hardening), so `execFileSync('npx.cmd', ...)` fails on Windows
 * and — worse — fails *silently* from a test's point of view, returning empty
 * output. That made all nine assertions below "pass the failure": they saw a
 * non-zero exit and no rule name, which is indistinguishable from a broken
 * config. Resolving the JS entry point directly is portable and observable.
 */
const resolveDepcruiseCli = (): string => {
  const manifestPath = join(REPO_ROOT, 'node_modules', 'dependency-cruiser', 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    bin?: Record<string, string>;
  };
  const rel = manifest.bin?.['depcruise'];
  if (!rel) throw new Error('could not resolve the depcruise CLI entry point');
  return join(dirname(manifestPath), rel);
};

const runDependencyCruiser = (target: string): CruiseResult => {
  const args = [
    resolveDepcruiseCli(),
    '--config',
    '.dependency-cruiser.cjs',
    '--output-type',
    'err',
    ...target.split(' '),
  ];
  try {
    const output = execFileSync(process.execPath, args, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { exitCode: 0, output };
  } catch (error: unknown) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { exitCode: e.status ?? 1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
};

afterEach(() => {
  for (const file of planted) rmSync(file, { force: true });
  planted.length = 0;
});

describe('boundary rules fire on a planted violation', () => {
  it('B1 — a web app cannot import @knowzy/database', () => {
    plantFile(
      `apps/live-web/src/${PLANTED}`,
      [
        '// PLANTED by packages/testing/contracts/boundaries.test.ts.',
        '// If this file survives a test run, delete it.',
        "import { createPrismaClient } from '@knowzy/database';",
        'export const violation = createPrismaClient;',
        '',
      ].join('\n'),
    );

    const result = runDependencyCruiser('apps/live-web');
    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain('b1-web-no-server-packages');
  });

  it('B2 — apps/api cannot import the adapter package', () => {
    plantFile(
      `apps/api/src/${PLANTED}`,
      [
        '// PLANTED by packages/testing/contracts/boundaries.test.ts.',
        "import { PACKAGE_NAME } from '@knowzy/knowledge-source-adapters';",
        'export const violation = PACKAGE_NAME;',
        '',
      ].join('\n'),
    );

    const result = runDependencyCruiser('apps/api');
    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain('b2-api-no-adapters');
  });

  it('B3 — @knowzy/domain cannot reach adapter vocabulary, even transitively', () => {
    plantFile(
      `packages/domain/src/${PLANTED}`,
      [
        '// PLANTED by packages/testing/contracts/boundaries.test.ts.',
        "import { PACKAGE_NAME } from '@knowzy/knowledge-source-adapters';",
        'export const violation = PACKAGE_NAME;',
        '',
      ].join('\n'),
    );

    const result = runDependencyCruiser('packages/domain');
    expect(result.exitCode).not.toBe(0);
    expect(result.output).toMatch(/b3-domain-no-external-vocabulary/);
  });

  it('B4 — @knowzy/claude-services cannot reach a database client', () => {
    plantFile(
      `packages/claude-services/src/${PLANTED}`,
      [
        '// PLANTED by packages/testing/contracts/boundaries.test.ts.',
        "import { createPrismaClient } from '@knowzy/database';",
        'export const violation = createPrismaClient;',
        '',
      ].join('\n'),
    );

    const result = runDependencyCruiser('packages/claude-services');
    expect(result.exitCode).not.toBe(0);
    expect(result.output).toMatch(/b4-claude-services-no-(data-access|prisma)/);
  });

  it('B5 — an adapter cannot import @knowzy/database', () => {
    plantFile(
      `packages/knowledge-source-adapters/src/${PLANTED}`,
      [
        '// PLANTED by packages/testing/contracts/boundaries.test.ts.',
        "import { createPrismaClient } from '@knowzy/database';",
        'export const violation = createPrismaClient;',
        '',
      ].join('\n'),
    );

    const result = runDependencyCruiser('packages/knowledge-source-adapters');
    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain('b5-adapters-are-pure');
  });

  it('B6 — @knowzy/shared-ui cannot import anything but shared-types', () => {
    plantFile(
      `packages/shared-ui/src/${PLANTED}`,
      [
        '// PLANTED by packages/testing/contracts/boundaries.test.ts.',
        "import { PACKAGE_NAME } from '@knowzy/domain';",
        'export const violation = PACKAGE_NAME;',
        '',
      ].join('\n'),
    );

    const result = runDependencyCruiser('packages/shared-ui');
    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain('b6-shared-ui-is-a-design-system');
  });

  it('B7 — @knowzy/shared-types cannot import a workspace package', () => {
    plantFile(
      `packages/shared-types/src/${PLANTED}`,
      [
        '// PLANTED by packages/testing/contracts/boundaries.test.ts.',
        "import { redact } from '@knowzy/observability';",
        'export const violation = redact;',
        '',
      ].join('\n'),
    );

    const result = runDependencyCruiser('packages/shared-types');
    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain('b7-shared-types-is-the-graph-root');
  });

  it('B8 — a package cannot import from an app', () => {
    plantFile(
      `packages/domain/src/${PLANTED}`,
      [
        '// PLANTED by packages/testing/contracts/boundaries.test.ts.',
        "import { QUEUE_AUDIT_PARTITION_MAINTENANCE } from '../../../apps/jobs/src/index.js';",
        'export const violation = QUEUE_AUDIT_PARTITION_MAINTENANCE;',
        '',
      ].join('\n'),
    );

    const result = runDependencyCruiser('packages/domain');
    expect(result.exitCode).not.toBe(0);
    expect(result.output).toMatch(/b8-apps-are-leaves|b10-no-deep-imports/);
  });
});

describe('the clean tree passes', () => {
  // Without this, every assertion above could be passing for the wrong reason —
  // a permanently broken configuration also "fails on a planted violation".
  it('reports no boundary error across apps and packages', () => {
    const result = runDependencyCruiser('apps packages');
    expect(result.output).not.toMatch(/^error /im);
    expect(result.exitCode).toBe(0);
  });
});
