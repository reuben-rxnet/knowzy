// A warning before anything that empties the demonstration data.
//
// WHY THIS EXISTS: `npm run verify` deletes draft questions, generation jobs
// and published references, because the integration suites share the
// development database and each one clears the tables it owns. That is correct
// behaviour for a test suite and a nasty surprise for the person who was
// halfway through a walkthrough -- it has now happened during a live
// demonstration, mid-click, and the data was not recoverable because nothing
// had recorded what was on screen.
//
// So the rule is: the destructive commands SAY SO FIRST, and they say it with
// the actual counts rather than a generic caution. "This will delete 6 draft
// questions and 5 published references" is a sentence somebody stops for;
// "warning: this may modify data" is one they have already scrolled past.
//
// Interactive runs ASK. Non-interactive runs (CI, a nested npm script, this
// file's own tests) print and continue: a prompt that blocks CI would be
// removed within a week, and then the warning would go with it.
//
//   KNOWZY_ASSUME_YES=1   proceed without asking, and say that it was set
//   KNOWZY_SKIP_WARNING=1 print nothing (for a nested invocation only)
//
// It NEVER touches the database itself. It counts, it prints, it exits 0 or 1.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { PrismaClient } from '@prisma/client';

/**
 * The repository .env, so the counts are REAL rather than "cannot tell".
 *
 * Loaded here for the same reason `vitest.setup.integration.ts` loads it: a
 * warning that always says "the database could not be read" is a warning
 * nobody believes, and the tests it precedes read the same .env.
 *
 * Existing environment variables win, so CI is unaffected.
 */
const loadDotEnv = (): void => {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  for (const rawLine of readFileSync(envPath, 'utf8').split('\n')) {
    const line = rawLine.replace(/\r$/, '').trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
};

/** What the integration suites delete, in the order a reader cares about. */
interface Casualties {
  readonly drafts: number;
  readonly publishedReferences: number;
  readonly generationJobs: number;
  readonly quizSessions: number;
}

const RULE = '='.repeat(72);

const countCasualties = async (prisma: PrismaClient): Promise<Casualties | null> => {
  try {
    const [drafts, publishedReferences, generationJobs, quizSessions] = await Promise.all([
      prisma.draftQuestion.count(),
      prisma.publishedQuestionReference.count(),
      prisma.generationJob.count(),
      prisma.quizSession.count(),
    ]);
    return { drafts, publishedReferences, generationJobs, quizSessions };
  } catch (error) {
    // Named, not swallowed. A warning that always says "cannot tell" is one
    // nobody believes, and the first version of this said exactly that for a
    // mistyped delegate name.
    console.log(`  (count unavailable: ${(error as Error).message.split('\n')[0]})`);
    // No database, no migration, wrong URL: none of those is a reason to stop
    // the command the developer actually asked for. The warning degrades to
    // "cannot tell", which is honest.
    return null;
  }
};

const total = (counts: Casualties): number =>
  counts.drafts + counts.publishedReferences + counts.generationJobs + counts.quizSessions;

const printWarning = (counts: Casualties | null, command: string): void => {
  console.log(`\n${RULE}`);
  console.log(`  DESTRUCTIVE: ${command} empties the demonstration data.`);
  console.log(RULE);
  if (counts === null) {
    console.log('  The database could not be read, so the cost cannot be shown.');
    console.log('  If it is running and migrated, expect the losses below anyway.');
  } else {
    console.log('  These rows exist now and will be deleted:');
    console.log(`    draft questions              ${counts.drafts}`);
    console.log(`    published question references ${counts.publishedReferences}`);
    console.log(`    generation jobs              ${counts.generationJobs}`);
    console.log(`    quiz sessions                ${counts.quizSessions}`);
  }
  console.log('');
  console.log('  What SURVIVES: knowledge sources, synchronized documents, extracted');
  console.log('  text, the taxonomy (domains, topics, departments, roles), users,');
  console.log('  roles, configuration and the audit trail.');
  console.log('');
  console.log('  What you will have to REDO afterwards: generate drafts, review and');
  console.log('  approve them, publish, and create an assessment. Generation history');
  console.log('  is gone, so the AI Usage figures restart from this point.');
  console.log('');
  console.log('  The MOCK QUESTION BANK IS A FILE and survives the wipe, so a');
  console.log('  republish of the same ids reports ALREADY_PUBLISHED. For a clean');
  console.log('  run delete fixtures/bank/.state/knowzy-question-bank.json first.');
  console.log(`${RULE}\n`);
};

const main = async (): Promise<void> => {
  const command = process.argv[2] ?? 'this command';
  if (process.env['KNOWZY_SKIP_WARNING'] === '1') return;
  loadDotEnv();

  const prisma = new PrismaClient();
  const counts = await countCasualties(prisma).finally(() => prisma.$disconnect());

  printWarning(counts, command);

  const nothingToLose = counts !== null && total(counts) === 0;
  if (nothingToLose) {
    console.log('  Nothing to lose: every table above is already empty. Continuing.\n');
    return;
  }
  if (process.env['KNOWZY_ASSUME_YES'] === '1') {
    console.log('  KNOWZY_ASSUME_YES=1 is set, so this was not asked. Continuing.\n');
    return;
  }
  if (!process.stdin.isTTY) {
    // CI, a hook, a nested script. The warning is the deliverable here; a
    // prompt nobody can answer would hang the build.
    console.log('  Not an interactive terminal, so this cannot be confirmed. Continuing.\n');
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question('  Type "yes" to continue, anything else to stop: ')).trim();
  rl.close();
  if (answer.toLowerCase() !== 'yes') {
    console.log('\n  Stopped. Nothing was deleted.\n');
    process.exit(1);
  }
  console.log('');
};

void main().catch((error) => {
  // A warning that crashes must not stop the command it warns about: the
  // developer asked for the tests, not for this.
  console.error(`
  The destructive-data warning could not run: ${(error as Error).message}
`);
});
