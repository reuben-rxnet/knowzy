import { defineWorkspace } from 'vitest/config';

// Test projects mirror repository-structure.md §7.
//
// `integration` is separated because it needs a migrated PostgreSQL; its tests
// skip themselves when DATABASE_URL is absent, so `npm test` works on a machine
// with no database while CI runs them for real.
export default defineWorkspace([
  {
    test: {
      name: 'unit',
      include: ['packages/*/src/**/*.test.ts'],
      environment: 'node',
      passWithNoTests: true,
    },
  },
  {
    test: {
      name: 'contract',
      include: ['packages/testing/contracts/**/*.test.ts'],
      environment: 'node',
      passWithNoTests: true,
    },
  },
  {
    test: {
      name: 'integration',
      include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
      environment: 'node',
      testTimeout: 30_000,
      passWithNoTests: true,
    },
  },
]);
