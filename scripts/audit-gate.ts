// The dependency audit gate — the I/O half.
//
// CI calls `npm run audit:gate` instead of `npm audit --audit-level=high`. The
// difference is only that a high or critical advisory may be suppressed by a
// dated, reasoned entry in docs/SECURITY-EXCEPTIONS.md; everything else still
// fails, including an advisory nobody wrote down and an entry that has expired.
// The decision itself lives in @knowzy/testing/src/audit-exceptions.ts and is
// unit-tested there.
//
// `npm audit` exits non-zero when it finds anything, so its exit code is
// ignored here on purpose: this script decides, not npm.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  advisoriesFromNpmAudit,
  evaluateAudit,
  parseExceptionRegister,
} from '../packages/testing/src/audit-exceptions.ts';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const registerPath = `${repoRoot}docs/SECURITY-EXCEPTIONS.md`;

const runNpmAudit = (): unknown => {
  try {
    const stdout = execFileSync('npm', ['audit', '--json'], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      shell: process.platform === 'win32',
    });
    return JSON.parse(stdout);
  } catch (error) {
    // npm exits 1 when it finds vulnerabilities and still prints the report.
    const stdout = (error as { stdout?: string }).stdout;
    if (typeof stdout === 'string' && stdout.trim().startsWith('{')) {
      return JSON.parse(stdout);
    }
    throw new Error(
      `npm audit produced no parseable report: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

const main = (): void => {
  const advisories = advisoriesFromNpmAudit(runNpmAudit());
  const register = parseExceptionRegister(readFileSync(registerPath, 'utf8'));
  const verdict = evaluateAudit({ advisories, register, now: new Date() });

  const highs = advisories.filter((a) => a.severity === 'high' || a.severity === 'critical');
  process.stdout.write(
    `audit gate: ${highs.length} high/critical advisor${highs.length === 1 ? 'y' : 'ies'} in the tree, ` +
      `${verdict.suppressed.length} covered by a documented exception, ${verdict.blocking.length} blocking.\n\n`,
  );

  for (const item of verdict.suppressed) {
    process.stdout.write(
      `  EXCEPTED  ${item.ghsa}  ${item.packageName}  (${item.exceptionId}, expires ${item.expires})\n`,
    );
  }

  for (const item of verdict.blocking) {
    process.stdout.write(`\n  BLOCKING  ${item.ghsa}  ${item.packageName}  [${item.severity}]\n`);
    process.stdout.write(`            ${item.reason}: ${item.detail}\n`);
  }

  for (const stale of verdict.staleExceptions) {
    process.stdout.write(
      `\n  STALE     ${stale.id} covers ${stale.advisories.join(', ')}, which no longer appear in the tree.\n` +
        `            Remove the entry: the register describes what is here, not what used to be.\n`,
    );
  }

  if (!verdict.ok) {
    process.stdout.write(
      `\naudit gate FAILED. security.md §14 fails the build on a high or critical finding; ` +
        `docs/SECURITY-EXCEPTIONS.md is the only way to defer one, and it has to say why and until when.\n`,
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write('\naudit gate passed.\n');
};

main();
