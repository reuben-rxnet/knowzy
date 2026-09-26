// Wires the real dependency probes into the shared startup validator.
//
// The validator itself lives in @knowzy/configuration so it is testable without
// standing up a dependency (see its test suite, which covers exit criterion 4).
// This module supplies the probes and nothing else.

import {
  validateStartup,
  readProcessEnv,
  type Deployable,
  type StartupProbes,
  type StartupReport,
} from '@knowzy/configuration';
import { probeDatabase, type PrismaClient } from '@knowzy/database';

export const EXPECTED_MIGRATION = '0012_reporting_read_models';

export interface ApiStartupDeps {
  readonly prisma: PrismaClient;
  /** Absent in local, where there is no Key Vault and no credential is needed. */
  readonly keyVault?: () => Promise<{ reachable: boolean; unresolvedRefs: readonly string[] }>;
  readonly mcp?: () => Promise<{ reachable: boolean; registryVersion: string | null }>;
  readonly jwks?: () => Promise<{ reachable: boolean }>;
  readonly blob?: () => Promise<{ reachable: boolean; writable: boolean }>;
  /** True if a mock adapter is registered in this process — check 4. */
  readonly mockAdaptersRegistered: () => boolean;
}

export const runApiStartupValidation = async (
  deps: ApiStartupDeps,
  deployable: Deployable = 'api',
): Promise<StartupReport> => {
  const probes: StartupProbes = {
    database: () => probeDatabase(deps.prisma),
    mockAdaptersRegistered: deps.mockAdaptersRegistered,

    // Configuration and flag rows feed checks 9, 10, and 11. Read defensively:
    // a database that is reachable but unmigrated must produce a clear
    // migration failure from check 5, not a confusing cascade here.
    storedConfig: async () => {
      try {
        const rows = await deps.prisma.applicationConfiguration.findMany({
          where: { scope: 'PLATFORM' },
          select: { key: true, value: true },
        });
        return Object.fromEntries(rows.map((r) => [r.key, r.value])) as Record<string, unknown>;
      } catch {
        return {};
      }
    },

    flagSwitches: async () => {
      try {
        const env = readProcessEnv()['KNOWZY_ENV'] ?? '';
        const rows = await deps.prisma.featureFlag.findMany({
          where: { environment: env },
          select: { key: true, enabled: true },
        });
        return Object.fromEntries(rows.map((r) => [r.key, r.enabled]));
      } catch {
        return {};
      }
    },

    ...(deps.keyVault ? { keyVault: deps.keyVault } : {}),
    ...(deps.mcp ? { mcp: deps.mcp } : {}),
    ...(deps.jwks ? { jwks: deps.jwks } : {}),
    ...(deps.blob ? { blob: deps.blob } : {}),
  };

  return validateStartup({
    deployable,
    rawEnv: readProcessEnv(),
    expectedMigrationVersion: EXPECTED_MIGRATION,
    probes,
  });
};
