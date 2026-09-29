// Structure-only competency import — docs/competencies/COMPETENCY_IMPORT_PLAN.md §6.
//
//   npx tsx scripts/competency-import.ts --file "<workbook.xlsx>"                                  dry run
//   npx tsx scripts/competency-import.ts --file "<workbook.xlsx>" --version-label 2024-05 --apply  apply
//   ... --report <out.json>      also write the plan (definitions only) as JSON
//   ... --operator "<label>"     free text recorded on the batch, AS free text
//
// DRY RUN IS THE DEFAULT and opens no database connection. Apply is one
// audited transaction, refused while any BLOCKING finding stands, and
// idempotent: a second apply of the same file records NO_CHANGES.
//
// The workbook is read locally and sent nowhere. The reader keeps text for the
// first rows only and the planner reads header rows only, so no person row --
// name, number, role, rating -- can reach the report, the JSON or the
// database. The report file is therefore safe to keep; the workbook is not,
// and stays out of version control (.gitignore).

import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import {
  applyCompetencyImportPlan,
  CompetencyImportError,
  formatCompetencyImportReport,
} from '@knowzy/domain';
import { systemClock } from '@knowzy/observability';
import { planFromWorkbook } from './lib/competency-workbook.js';

interface Options {
  readonly file: string;
  readonly apply: boolean;
  readonly versionLabel: string | null;
  readonly report: string | null;
  readonly operator: string | null;
}

const usage = (): never => {
  console.error(
    'usage: npx tsx scripts/competency-import.ts --file <workbook.xlsx> ' +
      '[--apply --version-label <label>] [--report <out.json>] [--operator <label>]',
  );
  process.exit(64);
};

const parse = (argv: readonly string[]): Options => {
  const value = (flag: string): string | null => {
    const index = argv.indexOf(flag);
    if (index === -1) return null;
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) return usage();
    return next;
  };
  const file = value('--file');
  if (file === null) return usage();
  const apply = argv.includes('--apply');
  const versionLabel = value('--version-label');
  if (apply && versionLabel === null) {
    console.error('--apply needs --version-label: a version label names exactly one source file.');
    process.exit(64);
  }
  return { file, apply, versionLabel, report: value('--report'), operator: value('--operator') };
};

const run = async (): Promise<void> => {
  const options = parse(process.argv.slice(2));
  const plan = planFromWorkbook(new Uint8Array(readFileSync(options.file)), options.file);

  console.log(formatCompetencyImportReport(plan));
  if (options.report !== null) {
    writeFileSync(options.report, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
    console.log(`\nPlan written to ${options.report} (definitions only).`);
  }

  if (!options.apply) {
    console.log(
      '\nDry run: nothing was written. Re-run with --apply --version-label <label> to import.',
    );
    if (plan.summary.blocking > 0) process.exitCode = 2;
    return;
  }

  const prisma = new PrismaClient();
  try {
    const result = await applyCompetencyImportPlan(
      { prisma, clock: systemClock },
      { label: options.operator, correlationId: randomUUID() },
      { plan, versionLabel: options.versionLabel as string },
    );
    console.log(`\nApplied: outcome ${result.outcome}, batch ${result.batchId}`);
    console.log(`  created ${JSON.stringify(result.created)}`);
  } catch (error) {
    if (error instanceof CompetencyImportError) {
      console.error(`\nRefused (${error.code}): ${error.message}`);
      process.exitCode = 2;
      return;
    }
    throw error;
  } finally {
    await prisma.$disconnect();
  }
};

void run();
