import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineWorkspace } from 'vitest/config';

// Test projects mirror repository-structure.md §7.
//
// `integration` is separated because it needs a migrated PostgreSQL; its tests
// skip themselves when DATABASE_URL is absent, so `npm test` works on a machine
// with no database while CI runs them for real.

/**
 * Resolve `@knowzy/*` to package SOURCE, not to `dist`.
 *
 * Without this, a cross-package import resolves through the package `exports`
 * map into `dist/index.js`, so a test asserts against whatever was last built.
 * That is not a slow feedback loop — it is a test that can pass against code
 * that no longer exists: deleting a guard from `src` and re-running the suite
 * leaves it green until someone rebuilds. Found by mutating an adapter's
 * permission filter and watching the conformance suite stay green.
 *
 * The root tsconfig carries the same mapping in `compilerOptions.paths` for
 * dependency-cruiser's benefit; this is the runtime half of it.
 */
const packagesDir = fileURLToPath(new URL('./packages', import.meta.url));
const workspaceAliases = Object.fromEntries(
  readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => [`@knowzy/${entry.name}`, `${packagesDir}/${entry.name}/src/index.ts`]),
);

export default defineWorkspace([
  {
    resolve: { alias: workspaceAliases },
    test: {
      name: 'unit',
      include: ['packages/*/src/**/*.test.ts'],
      environment: 'node',
      passWithNoTests: true,
    },
  },
  {
    resolve: { alias: workspaceAliases },
    test: {
      name: 'contract',
      include: ['packages/testing/contracts/**/*.test.ts'],
      environment: 'node',
      passWithNoTests: true,
    },
  },
  {
    resolve: { alias: workspaceAliases },
    test: {
      name: 'integration',
      include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
      environment: 'node',
      testTimeout: 30_000,
      passWithNoTests: true,
      /**
       * ONE file at a time. These suites share a single PostgreSQL database and
       * mutate the same rows — a generation suite and a review suite both clear
       * `draft_question`. Run in parallel they fail for reasons that have
       * nothing to do with the code, and worse, they can PASS while hiding a
       * real defect because one file's leftovers satisfy another's setup.
       *
       * Per-file schemas or a database per worker would restore the
       * parallelism; until then correctness is worth the wall-clock.
       */
      fileParallelism: false,
      // fileParallelism alone was not enough: the runner still gave each file
      // its own worker. A single fork makes the serialization actual.
      pool: 'forks',
      poolOptions: { forks: { singleFork: true } },
      // Populates DATABASE_URL from .env so these suites RUN locally instead of
      // skipping. A silent skip is indistinguishable from a pass.
      setupFiles: ['./vitest.setup.integration.ts'],
    },
  },
]);
