#!/usr/bin/env node
// Generates prisma/migrations/0002_init/migration.sql.
//
// Why this exists: data-model.md §15 requires checked-in migrations, with
// hand-written SQL only for what Prisma cannot express. 0001 hand-writes the
// extensions, the UUIDv7 function, and the partitioned audit table; 0003
// hand-writes the constraints, partial indexes, and triggers. Everything in
// between is ordinary DDL that Prisma generates better than a human, so it is
// generated once at setup and committed.
//
// The diff is schema-to-schema (prerequisites.prisma -> schema.prisma), so no
// shadow database is needed and later migrations are not replayed.
//
// Run once per clone:  npm run -w @knowzy/database bootstrap:init-migration
// Then commit the result. Re-running is safe: it refuses to overwrite unless
// --force is passed.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const prismaDir = join(pkgRoot, 'prisma');
const outDir = join(prismaDir, 'migrations', '0002_init');
const outFile = join(outDir, 'migration.sql');

const force = process.argv.includes('--force');

const fail = (message) => {
  process.stderr.write(`generate-init-migration: ${message}\n`);
  process.exit(1);
};

if (existsSync(outFile) && !force) {
  process.stdout.write(
    `0002_init/migration.sql already exists. Nothing to do.\n` +
      `Pass --force to regenerate (only correct if schema.prisma changed and 0002 has never been applied anywhere).\n`,
  );
  process.exit(0);
}

// -------------------------------------------------------------------------
// Guard: prerequisites.prisma must still describe what 0001 creates.
//
// A drift here would make 0002 attempt to recreate audit_event. Comparing the
// normalized AuditEvent block in both schemas catches that before it reaches a
// database.
// -------------------------------------------------------------------------
const readBlock = (text, header) => {
  const start = text.indexOf(header);
  if (start === -1) return null;
  const open = text.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return null;
};

/**
 * Reduces a model block to the lines that define the TABLE SHAPE: fields, the
 * primary key, and the table name.
 *
 * Two things are excluded deliberately:
 *   - `@@index`, because prerequisites.prisma omits indexes on purpose. 0001
 *     creates the partitioned table with its primary key only; 0002_init adds
 *     the indexes under Prisma's own generated names.
 *   - doc comments, which carry no DDL.
 *
 * Carriage returns are stripped FIRST. With core.autocrlf=true on Windows a
 * checked-out line ends in CR, and CR is a line terminator that `.` does not
 * match -- so stripping comments before trimming silently strips nothing. That
 * bug made this guard reject a schema that was in fact correct.
 */
const normalize = (block) =>
  block
    .split('\n')
    .map((line) => line.replace(/\r/g, '').trim())
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.startsWith('@@index'))
    .map((line) => line.replace(/\s+/g, ' '))
    .sort()
    .join('\n');

const schemaText = readFileSync(join(prismaDir, 'schema.prisma'), 'utf8');
const prereqText = readFileSync(join(prismaDir, 'prerequisites.prisma'), 'utf8');

const schemaAudit = readBlock(schemaText, 'model AuditEvent');
const prereqAudit = readBlock(prereqText, 'model AuditEvent');

if (!schemaAudit || !prereqAudit) {
  fail('could not locate the AuditEvent model in one of the schemas.');
}

if (normalize(schemaAudit) !== normalize(prereqAudit)) {
  fail(
    'prerequisites.prisma and schema.prisma describe different AuditEvent models.\n' +
      '  Migration 0001 created the partitioned audit_event table from the prerequisites\n' +
      '  shape. Reconcile the two before generating 0002, or 0002 will try to recreate it.\n' +
      '  See the INVARIANT note in prisma/prerequisites.prisma.',
  );
}

// -------------------------------------------------------------------------
// Generate.
// -------------------------------------------------------------------------
process.stdout.write('AuditEvent models match. Generating 0002_init...\n');

// Resolve the Prisma CLI and run it with THIS node, rather than shelling out
// to `npx`. Node 20+ refuses to spawn a .cmd or .bat without a shell (the
// CVE-2024-27980 hardening), so `execFileSync('npx.cmd', ...)` fails on Windows
// with EINVAL. Invoking the CLI's JS entry point directly is both portable and
// faster, and it removes the shell-quoting hazard for paths containing spaces.
const resolvePrismaCli = () => {
  const req = createRequire(import.meta.url);
  const manifestPath = req.resolve('prisma/package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const binRel = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.prisma;
  if (!binRel) fail('could not find the prisma CLI entry point in its package.json.');
  return join(dirname(manifestPath), binRel);
};

let sql;
try {
  sql = execFileSync(
    process.execPath,
    [
      resolvePrismaCli(),
      'migrate',
      'diff',
      '--from-schema-datamodel',
      join('prisma', 'prerequisites.prisma'),
      '--to-schema-datamodel',
      join('prisma', 'schema.prisma'),
      '--script',
    ],
    { cwd: pkgRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
} catch (error) {
  // Surface the real reason. Swallowing it cost a debugging cycle once already.
  const detail = [error?.stderr, error?.stdout, error?.message]
    .filter((s) => typeof s === 'string' && s.trim().length > 0)
    .join('\n');
  fail(`prisma migrate diff failed.\n${detail}`);
}

if (!sql || sql.trim().length === 0) {
  fail('prisma migrate diff produced no SQL, which cannot be right.');
}

if (/audit_event/i.test(sql) && /CREATE TABLE\s+"?audit_event"?/i.test(sql)) {
  fail(
    'the generated SQL would create audit_event, which 0001 already created as a\n' +
      '  partitioned table. Check prisma/prerequisites.prisma.',
  );
}

const header = [
  '-- ---------------------------------------------------------------------------',
  '-- 0002  Init (GENERATED — do not hand-edit)',
  '--',
  '-- Generated by scripts/generate-init-migration.mjs as the delta from',
  '-- prisma/prerequisites.prisma (the state 0001 leaves behind) to',
  '-- prisma/schema.prisma.',
  '--',
  '-- Creates every table, enum, foreign key, and plain index except:',
  '--   * extensions, uuid_generate_v7(), and the partitioned audit_event table',
  '--     (0001, hand-written)',
  '--   * CHECK constraints, partial and expression indexes, triggers, and the',
  '--     append-only rules (0003, hand-written)',
  '--',
  '-- Regenerate with: npm run -w @knowzy/database bootstrap:init-migration -- --force',
  '-- ---------------------------------------------------------------------------',
  '',
].join('\n');

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, `${header}${sql}`, 'utf8');

const lines = sql.split('\n').length;
process.stdout.write(
  `Wrote ${outFile}\n  ${lines} statements-ish. Review it, then commit it.\n` +
    `  Next: npm run db:migrate && npm run db:seed\n`,
);
