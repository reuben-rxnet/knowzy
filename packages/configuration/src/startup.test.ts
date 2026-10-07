// Exit criterion (implementation-roadmap.md Phase 1):
// "Startup validation exits non-zero on each fail-fast check (1–6, 9),
//  verified by test."
//
// Each fail-fast check is failed in isolation, from an otherwise-valid baseline,
// so a test that passes proves that check is the one doing the work.
//
// The non-zero exit itself is one line in each app's bootstrap
// (`catch (StartupFatalError) => process.exit(1)`); what is asserted here is
// the decision that drives it — `fatal === true` and a thrown
// StartupFatalError. That keeps the assertion meaningful without spawning a
// process per case.

import { describe, expect, it } from 'vitest';
import {
  CHECK_DISPOSITION,
  STARTUP_CHECKS,
  StartupFatalError,
  enforceStartup,
  formatStartupReport,
  validateStartup,
  type RawEnv,
  type StartupCheckId,
  type StartupInput,
  type StartupProbes,
} from './index.js';

// ---------------------------------------------------------------------------
// Baseline: a deployed API environment that passes every check.
// ---------------------------------------------------------------------------

const MIGRATION = '0016_competency_administration';

const validEnv: RawEnv = {
  KNOWZY_ENV: 'test',
  DATABASE_URL: 'postgresql://knowzy_app@db.internal:5432/knowzy',
  KEY_VAULT_URI: 'https://kv-knowzy-test.vault.azure.net',
  BLOB_ACCOUNT_URL: 'https://stknowzytest.blob.core.windows.net',
  BLOB_CONTAINER: 'artifacts',
  MCP_ENDPOINT: 'http://ca-knowzy-mcp.internal:8080',
  ENTRA_TENANT_ID: 'tenant-placeholder',
  ENTRA_API_CLIENT_ID: '00000000-0000-4000-8000-000000000001',
  ENTRA_API_AUDIENCE: 'api://knowzy-api',
  ANTHROPIC_API_KEY_REF: 'keyvault://kv-knowzy-test/secrets/anthropic-api-key',
  ENVELOPE_SIGNING_KEY_REF: 'keyvault://kv-knowzy-test/secrets/envelope-signing',
  OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp.internal:4318',
  OTEL_SERVICE_NAME: 'knowzy-api',
};

const healthyProbes: StartupProbes = {
  database: async () => ({ reachable: true, migrationVersion: MIGRATION }),
  keyVault: async () => ({ reachable: true, unresolvedRefs: [] }),
  mcp: async () => ({ reachable: true, registryVersion: '1' }),
  jwks: async () => ({ reachable: true }),
  blob: async () => ({ reachable: true, writable: true }),
  flagSwitches: async () => ({}),
  storedConfig: async () => ({}),
  mockAdaptersRegistered: () => false,
};

const baseline = (overrides: Partial<StartupInput> = {}): StartupInput => ({
  deployable: 'api',
  rawEnv: validEnv,
  expectedMigrationVersion: MIGRATION,
  expectedMcpRegistryVersion: '1',
  probes: healthyProbes,
  ...overrides,
});

const outcome = (report: Awaited<ReturnType<typeof validateStartup>>, id: StartupCheckId) => {
  const found = report.checks.find((c) => c.id === id);
  if (!found) throw new Error(`check ${id} was not reported`);
  return found;
};

// ---------------------------------------------------------------------------
// Baseline sanity — without this, a "fatal" assertion proves nothing.
// ---------------------------------------------------------------------------

describe('startup validation — healthy baseline', () => {
  it('passes every check and starts', async () => {
    const report = await validateStartup(baseline());
    expect(report.fatal).toBe(false);
    expect(report.ready).toBe(true);
    expect(() => enforceStartup(report)).not.toThrow();
  });

  it('reports an outcome for every declared check', async () => {
    const report = await validateStartup(baseline());
    expect(report.checks.map((c) => c.id).sort()).toEqual([...STARTUP_CHECKS].sort());
  });

  it('produces an operator-safe summary containing no credential', async () => {
    const report = await validateStartup(baseline());
    const text = formatStartupReport(report);
    expect(text).toContain('startup: api');
    expect(text).not.toContain('keyvault://');
    expect(text).not.toContain('postgresql://');
  });
});

// ---------------------------------------------------------------------------
// The seven fail-fast checks, each failed in isolation.
// ---------------------------------------------------------------------------

describe('fail-fast check 1 — ENV_NAME', () => {
  it('is fatal when KNOWZY_ENV is absent', async () => {
    const { KNOWZY_ENV: _dropped, ...withoutEnv } = validEnv;
    const report = await validateStartup(baseline({ rawEnv: withoutEnv }));
    expect(outcome(report, 'ENV_NAME').result).toBe('FAIL');
    expect(report.fatal).toBe(true);
    expect(() => enforceStartup(report)).toThrow(StartupFatalError);
  });

  it('is fatal when KNOWZY_ENV is not a known environment', async () => {
    const report = await validateStartup(
      baseline({ rawEnv: { ...validEnv, KNOWZY_ENV: 'staging' } }),
    );
    expect(report.fatal).toBe(true);
  });

  it('marks later checks NOT_RUN rather than cascading misleading failures', async () => {
    const report = await validateStartup(baseline({ rawEnv: { ...validEnv, KNOWZY_ENV: '' } }));
    expect(outcome(report, 'DATABASE').result).toBe('NOT_RUN');
    expect(outcome(report, 'KEY_VAULT').result).toBe('NOT_RUN');
  });
});

describe('fail-fast check 2 — REQUIRED_VARIABLES', () => {
  it('is fatal when a required variable is missing', async () => {
    const { DATABASE_URL: _dropped, ...withoutDb } = validEnv;
    const report = await validateStartup(baseline({ rawEnv: withoutDb }));
    const check = outcome(report, 'REQUIRED_VARIABLES');
    expect(check.result).toBe('FAIL');
    expect(check.problems).toContain('DATABASE_URL is required');
    expect(report.fatal).toBe(true);
  });

  it('names EVERY missing variable at once, so one fix round suffices', async () => {
    const { DATABASE_URL: _a, MCP_ENDPOINT: _b, OTEL_SERVICE_NAME: _c, ...sparse } = validEnv;
    const report = await validateStartup(baseline({ rawEnv: sparse }));
    const problems = outcome(report, 'REQUIRED_VARIABLES').problems.join('\n');
    expect(problems).toContain('DATABASE_URL');
    expect(problems).toContain('MCP_ENDPOINT');
    expect(problems).toContain('OTEL_SERVICE_NAME');
  });

  it('is fatal when a secret reference is a literal value rather than a reference', async () => {
    const report = await validateStartup(
      baseline({
        rawEnv: { ...validEnv, ANTHROPIC_API_KEY_REF: 'sk-ant-not-a-reference' },
      }),
    );
    expect(outcome(report, 'REQUIRED_VARIABLES').result).toBe('FAIL');
    expect(report.fatal).toBe(true);
  });

  it('never echoes the offending value, which may be a credential', async () => {
    const report = await validateStartup(
      baseline({
        rawEnv: { ...validEnv, ANTHROPIC_API_KEY_REF: 'sk-ant-super-secret-value' },
      }),
    );
    const problems = outcome(report, 'REQUIRED_VARIABLES').problems.join('\n');
    expect(problems).not.toContain('super-secret-value');
  });

  it('refuses a localstore:// reference outside the local environment (P-5)', async () => {
    // The local secure store is a developer convenience. A deployed service
    // configured to read one would be reading a file nobody governs.
    const report = await validateStartup(
      baseline({
        rawEnv: { ...validEnv, OPENAI_API_KEY_REF: 'localstore://openai-api-key' },
      }),
    );
    expect(outcome(report, 'REQUIRED_VARIABLES').problems.join('\n')).toMatch(
      /OPENAI_API_KEY_REF: a localstore:\/\/ reference is permitted only in the local environment/,
    );
    expect(report.fatal).toBe(true);
  });

  it('refuses KNOWZY_LOCAL_SECRET_DIR outside the local environment (P-5)', async () => {
    const report = await validateStartup(
      baseline({ rawEnv: { ...validEnv, KNOWZY_LOCAL_SECRET_DIR: '/repo/.secrets' } }),
    );
    expect(outcome(report, 'REQUIRED_VARIABLES').problems.join('\n')).toMatch(
      /KNOWZY_LOCAL_SECRET_DIR must not be set/,
    );
  });
});

describe('fail-fast check 3 — PUBLIC_VAR_SAFETY', () => {
  it('is fatal when a PUBLIC_ variable holds a Key Vault reference', async () => {
    const report = await validateStartup(
      baseline({
        rawEnv: {
          ...validEnv,
          PUBLIC_SOMETHING: 'keyvault://kv-knowzy-test/secrets/leaked',
        },
      }),
    );
    expect(outcome(report, 'PUBLIC_VAR_SAFETY').result).toBe('FAIL');
    expect(report.fatal).toBe(true);
  });

  it('is fatal when a PUBLIC_ variable holds a JWT', async () => {
    const report = await validateStartup(
      baseline({
        rawEnv: {
          ...validEnv,
          PUBLIC_TOKEN: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.abcdefghijklmnop',
        },
      }),
    );
    expect(report.fatal).toBe(true);
  });

  it('permits an ordinary PUBLIC_ value', async () => {
    const report = await validateStartup(
      baseline({ rawEnv: { ...validEnv, PUBLIC_API_BASE_URL: 'https://api.example.internal' } }),
    );
    expect(outcome(report, 'PUBLIC_VAR_SAFETY').result).toBe('PASS');
  });
});

describe('fail-fast check 4 — MOCK_ISOLATION', () => {
  it('is fatal when MOCK_FIXTURE_ROOT is set outside local', async () => {
    const report = await validateStartup(
      baseline({ rawEnv: { ...validEnv, MOCK_FIXTURE_ROOT: '/fixtures' } }),
    );
    expect(outcome(report, 'MOCK_ISOLATION').result).toBe('FAIL');
    expect(report.fatal).toBe(true);
  });

  it('is fatal when a mock adapter is registered outside local', async () => {
    const report = await validateStartup(
      baseline({
        probes: { ...healthyProbes, mockAdaptersRegistered: () => true },
      }),
    );
    expect(outcome(report, 'MOCK_ISOLATION').result).toBe('FAIL');
    expect(report.fatal).toBe(true);
  });

  it('permits mocks in local', async () => {
    const report = await validateStartup(
      baseline({
        rawEnv: {
          KNOWZY_ENV: 'local',
          DATABASE_URL: 'postgresql://knowzy:knowzy@localhost:5432/knowzy',
          MCP_ENDPOINT: 'stdio',
          PUBLIC_API_BASE_URL: 'http://localhost:3002',
          MOCK_FIXTURE_ROOT: './fixtures/knowledge',
        },
        probes: { ...healthyProbes, mockAdaptersRegistered: () => true },
      }),
    );
    expect(outcome(report, 'MOCK_ISOLATION').result).toBe('PASS');
    expect(report.fatal).toBe(false);
  });
});

describe('fail-fast check 5 — DATABASE', () => {
  it('is fatal when the database is unreachable', async () => {
    const report = await validateStartup(
      baseline({
        probes: {
          ...healthyProbes,
          database: async () => ({ reachable: false, migrationVersion: null }),
        },
      }),
    );
    expect(outcome(report, 'DATABASE').result).toBe('FAIL');
    expect(report.fatal).toBe(true);
  });

  it('is fatal when the migration version is behind', async () => {
    const report = await validateStartup(
      baseline({
        probes: {
          ...healthyProbes,
          database: async () => ({
            reachable: true,
            migrationVersion: '0001_platform_prerequisites',
          }),
        },
      }),
    );
    const check = outcome(report, 'DATABASE');
    expect(check.result).toBe('FAIL');
    expect(check.problems.join()).toContain(MIGRATION);
    expect(report.fatal).toBe(true);
  });
});

describe('fail-fast check 6 — KEY_VAULT', () => {
  it('is fatal when Key Vault is unreachable in a deployed environment', async () => {
    const report = await validateStartup(
      baseline({
        probes: {
          ...healthyProbes,
          keyVault: async () => ({ reachable: false, unresolvedRefs: [] }),
        },
      }),
    );
    expect(outcome(report, 'KEY_VAULT').result).toBe('FAIL');
    expect(report.fatal).toBe(true);
  });

  it('is fatal when a declared secret reference does not resolve', async () => {
    const report = await validateStartup(
      baseline({
        probes: {
          ...healthyProbes,
          keyVault: async () => ({
            reachable: true,
            unresolvedRefs: ['ANTHROPIC_API_KEY_REF'],
          }),
        },
      }),
    );
    expect(outcome(report, 'KEY_VAULT').result).toBe('FAIL');
    expect(report.fatal).toBe(true);
  });

  it('is NOT_RUN in local, where no credential is needed', async () => {
    const report = await validateStartup(
      baseline({
        rawEnv: {
          KNOWZY_ENV: 'local',
          DATABASE_URL: 'postgresql://knowzy:knowzy@localhost:5432/knowzy',
          MCP_ENDPOINT: 'stdio',
        },
      }),
    );
    expect(outcome(report, 'KEY_VAULT').result).toBe('NOT_RUN');
    expect(report.fatal).toBe(false);
  });
});

describe('fail-fast check 9 — CONFIG_RESOLVABLE', () => {
  it('passes for the shipped catalogue: every code default satisfies its own schema', async () => {
    const report = await validateStartup(baseline());
    expect(outcome(report, 'CONFIG_RESOLVABLE').result).toBe('PASS');
  });

  it('warns and raises a finding for a bad stored value, using the code default (P2)', async () => {
    const report = await validateStartup(
      baseline({
        probes: {
          ...healthyProbes,
          storedConfig: async () => ({ 'duplicate.blockThreshold': 42 }),
        },
      }),
    );
    const check = outcome(report, 'CONFIG_RESOLVABLE');
    expect(check.result).toBe('WARN');
    // A single bad row must not take the platform down.
    expect(report.fatal).toBe(false);
    expect(report.findings.map((f) => f.checkKey)).toContain('configuration.storedValueRejected');
  });

  it('warns for an undeclared key rather than reading it (P1)', async () => {
    const report = await validateStartup(
      baseline({
        probes: {
          ...healthyProbes,
          storedConfig: async () => ({ 'not.a.declared.key': true }) as Record<string, unknown>,
        },
      }),
    );
    expect(outcome(report, 'CONFIG_RESOLVABLE').problems.join()).toContain(
      'not a declared configuration key',
    );
  });
});

// ---------------------------------------------------------------------------
// Non-fatal dispositions — the other half of the contract. A check that should
// withhold readiness must not crash-loop the platform, and a write flag must
// degrade to off rather than blocking a release.
// ---------------------------------------------------------------------------

describe('readiness checks do not crash the process', () => {
  it('withholds readiness but is not fatal when MCP is unreachable', async () => {
    const report = await validateStartup(
      baseline({
        probes: {
          ...healthyProbes,
          mcp: async () => ({ reachable: false, registryVersion: null }),
        },
      }),
    );
    expect(outcome(report, 'MCP_REACHABLE').result).toBe('FAIL');
    expect(report.fatal).toBe(false);
    expect(report.ready).toBe(false);
    expect(() => enforceStartup(report)).not.toThrow();
  });

  it('withholds readiness but is not fatal when JWKS is unreachable', async () => {
    const report = await validateStartup(
      baseline({ probes: { ...healthyProbes, jwks: async () => ({ reachable: false }) } }),
    );
    expect(report.fatal).toBe(false);
    expect(report.ready).toBe(false);
  });

  it('withholds readiness but is not fatal when blob storage is not writable', async () => {
    const report = await validateStartup(
      baseline({
        probes: { ...healthyProbes, blob: async () => ({ reachable: true, writable: false }) },
      }),
    );
    expect(report.fatal).toBe(false);
    expect(report.ready).toBe(false);
  });
});

describe('degrading checks fall back to the safe state', () => {
  it('forces a flag off when it exceeds its environment ceiling, and continues', async () => {
    const report = await validateStartup(
      baseline({
        rawEnv: { ...validEnv, KNOWZY_ENV: 'dev' },
        probes: {
          ...healthyProbes,
          // dev's ceiling forbids writes (V3).
          flagSwitches: async () => ({ 'sharepoint.write.enabled': true }),
        },
      }),
    );
    expect(outcome(report, 'FLAG_CEILINGS').result).toBe('WARN');
    expect(report.forcedOffFlags).toContain('sharepoint.write.enabled');
    expect(report.fatal).toBe(false);
    expect(report.findings.map((f) => f.checkKey)).toContain('featureFlag.aboveCeiling');
  });

  it('forces writes off when the bank target is unverified, rather than blocking startup', async () => {
    const report = await validateStartup(
      baseline({
        probes: {
          ...healthyProbes,
          flagSwitches: async () => ({ 'sharepoint.write.enabled': true }),
          questionBank: async () => ({
            listResolved: true,
            mappingComplete: false,
            missing: ['correctAnswer is unmapped'],
          }),
        },
      }),
    );
    expect(outcome(report, 'QUESTION_BANK_TARGET').result).toBe('WARN');
    expect(report.forcedOffFlags).toContain('sharepoint.write.enabled');
    expect(report.fatal).toBe(false);
  });

  it('does not run the bank check when writes are off', async () => {
    const report = await validateStartup(baseline());
    expect(outcome(report, 'QUESTION_BANK_TARGET').result).toBe('NOT_RUN');
  });
});

// ---------------------------------------------------------------------------
// The disposition table itself is part of the contract.
// ---------------------------------------------------------------------------

describe('check dispositions match the documented table', () => {
  it('classifies checks 1–6 and 9 as fail-fast', () => {
    const failFast: StartupCheckId[] = [
      'ENV_NAME',
      'REQUIRED_VARIABLES',
      'PUBLIC_VAR_SAFETY',
      'MOCK_ISOLATION',
      'DATABASE',
      'KEY_VAULT',
      'CONFIG_RESOLVABLE',
    ];
    for (const id of failFast) {
      expect(CHECK_DISPOSITION[id], id).toBe('FAIL_FAST');
    }
  });

  it('classifies checks 7, 8, and 12 as readiness', () => {
    for (const id of ['MCP_REACHABLE', 'JWKS_REACHABLE', 'BLOB_WRITABLE'] as StartupCheckId[]) {
      expect(CHECK_DISPOSITION[id], id).toBe('READINESS');
    }
  });

  it('classifies checks 10 and 11 as degrading', () => {
    for (const id of ['FLAG_CEILINGS', 'QUESTION_BANK_TARGET'] as StartupCheckId[]) {
      expect(CHECK_DISPOSITION[id], id).toBe('DEGRADE');
    }
  });
});
