// Startup validation — environment-and-configuration.md §9.
//
// The application validates configuration BEFORE accepting traffic and exits
// non-zero on failure. Starting degraded is worse than not starting: a platform
// running with writes pointed at the wrong list is a data-integrity incident,
// and one running with a mock adapter in production is a correctness incident.
//
// Disposition per check:
//   FAIL_FAST  — checks 1–6 and 9: the process must not start
//   READINESS  — checks 7, 8, 12: readiness not ready, liveness healthy, retry
//   DEGRADE    — checks 10, 11: fall back to the safe state and raise a finding
//
// The checks are pure over injected probes, so each one is individually
// assertable without spawning a process or standing up a dependency.

import { KnowzyEnvSchema, type KnowzyEnv } from '@knowzy/shared-types';
import {
  CONFIG_KEYS,
  CONFIG_KEY_LIST,
  type ConfigKey,
} from './keys.js';
import { FEATURE_FLAG_KEYS, ceilingPermits, type FeatureFlagKey } from './flags.js';
import {
  envVarsFor,
  isBrowserSafeVarName,
  looksSecretShaped,
  type Deployable,
  type RawEnv,
} from './env.js';

export const STARTUP_CHECKS = [
  'ENV_NAME',
  'REQUIRED_VARIABLES',
  'PUBLIC_VAR_SAFETY',
  'MOCK_ISOLATION',
  'DATABASE',
  'KEY_VAULT',
  'MCP_REACHABLE',
  'JWKS_REACHABLE',
  'CONFIG_RESOLVABLE',
  'FLAG_CEILINGS',
  'QUESTION_BANK_TARGET',
  'BLOB_WRITABLE',
] as const;
export type StartupCheckId = (typeof STARTUP_CHECKS)[number];

export type CheckDisposition = 'FAIL_FAST' | 'READINESS' | 'DEGRADE';

export const CHECK_DISPOSITION: Readonly<Record<StartupCheckId, CheckDisposition>> = {
  ENV_NAME: 'FAIL_FAST',
  REQUIRED_VARIABLES: 'FAIL_FAST',
  PUBLIC_VAR_SAFETY: 'FAIL_FAST',
  MOCK_ISOLATION: 'FAIL_FAST',
  DATABASE: 'FAIL_FAST',
  KEY_VAULT: 'FAIL_FAST',
  MCP_REACHABLE: 'READINESS',
  JWKS_REACHABLE: 'READINESS',
  CONFIG_RESOLVABLE: 'FAIL_FAST',
  FLAG_CEILINGS: 'DEGRADE',
  QUESTION_BANK_TARGET: 'DEGRADE',
  BLOB_WRITABLE: 'READINESS',
};

export type CheckResult = 'PASS' | 'FAIL' | 'NOT_RUN' | 'WARN';

export interface StartupCheckOutcome {
  readonly id: StartupCheckId;
  readonly result: CheckResult;
  readonly disposition: CheckDisposition;
  /** Safe for an operator log. Never contains a secret or a raw provider body. */
  readonly detail: string;
  /** Every problem at once, so an operator fixes one round rather than N. */
  readonly problems: readonly string[];
}

export interface StartupReport {
  readonly deployable: Deployable;
  readonly environment: KnowzyEnv | null;
  readonly checks: readonly StartupCheckOutcome[];
  /** True when a FAIL_FAST check failed: the process must exit non-zero. */
  readonly fatal: boolean;
  /** True when a READINESS check failed: serve liveness, not readiness. */
  readonly ready: boolean;
  /** Flags forced off by a ceiling or by an unverified bank target. */
  readonly forcedOffFlags: readonly FeatureFlagKey[];
  /** Findings to persist as PlatformConsistencyFinding rows. */
  readonly findings: readonly { checkKey: string; detail: string }[];
}

/**
 * Dependency probes. Each is optional: a deployable that does not use a
 * dependency reports NOT_RUN for it rather than a misleading PASS.
 */
export interface StartupProbes {
  readonly database?: () => Promise<{ reachable: boolean; migrationVersion: string | null }>;
  readonly keyVault?: () => Promise<{ reachable: boolean; unresolvedRefs: readonly string[] }>;
  readonly mcp?: () => Promise<{ reachable: boolean; registryVersion: string | null }>;
  readonly jwks?: () => Promise<{ reachable: boolean }>;
  readonly blob?: () => Promise<{ reachable: boolean; writable: boolean }>;
  readonly questionBank?: () => Promise<{
    listResolved: boolean;
    mappingComplete: boolean;
    missing: readonly string[];
  }>;
  /** FeatureFlag rows as stored, keyed by flag. Absent keys use the declared default. */
  readonly flagSwitches?: () => Promise<Partial<Record<FeatureFlagKey, boolean>>>;
  /** ApplicationConfiguration rows as stored, for check 9. */
  readonly storedConfig?: () => Promise<Partial<Record<ConfigKey, unknown>>>;
  /** Whether a mock adapter or mock bank is registered in this process. */
  readonly mockAdaptersRegistered?: () => boolean;
}

export interface StartupInput {
  readonly deployable: Deployable;
  readonly rawEnv: RawEnv;
  readonly expectedMigrationVersion?: string;
  readonly expectedMcpRegistryVersion?: string;
  readonly probes?: StartupProbes;
}

const pass = (
  id: StartupCheckId,
  detail: string,
): StartupCheckOutcome => ({
  id,
  result: 'PASS',
  disposition: CHECK_DISPOSITION[id],
  detail,
  problems: [],
});

const fail = (
  id: StartupCheckId,
  detail: string,
  problems: readonly string[] = [],
): StartupCheckOutcome => ({
  id,
  result: 'FAIL',
  disposition: CHECK_DISPOSITION[id],
  detail,
  problems,
});

const warn = (
  id: StartupCheckId,
  detail: string,
  problems: readonly string[] = [],
): StartupCheckOutcome => ({
  id,
  result: 'WARN',
  disposition: CHECK_DISPOSITION[id],
  detail,
  problems,
});

const notRun = (id: StartupCheckId, detail: string): StartupCheckOutcome => ({
  id,
  result: 'NOT_RUN',
  disposition: CHECK_DISPOSITION[id],
  detail,
  problems: [],
});

export const validateStartup = async (input: StartupInput): Promise<StartupReport> => {
  const { deployable, rawEnv, probes = {} } = input;
  const checks: StartupCheckOutcome[] = [];
  const forcedOffFlags: FeatureFlagKey[] = [];
  const findings: { checkKey: string; detail: string }[] = [];

  // ---------------------------------------------------- 1  ENV_NAME
  const envParsed = KnowzyEnvSchema.safeParse(rawEnv['KNOWZY_ENV']);
  const environment = envParsed.success ? envParsed.data : null;

  if (!environment) {
    checks.push(
      fail(
        'ENV_NAME',
        'KNOWZY_ENV is absent or not one of local, dev, test, prod.',
        [`KNOWZY_ENV=${rawEnv['KNOWZY_ENV'] ?? '(unset)'}`],
      ),
    );
    // Every later check depends on knowing the environment. Reporting NOT_RUN
    // is honest; a cascade of misleading failures is not.
    for (const id of STARTUP_CHECKS.slice(1) as StartupCheckId[]) {
      checks.push(notRun(id, 'Not run: the environment name is unknown.'));
    }
    return {
      deployable,
      environment,
      checks,
      fatal: true,
      ready: false,
      forcedOffFlags,
      findings,
    };
  }
  checks.push(pass('ENV_NAME', `Environment is ${environment}.`));

  const isLocal = environment === 'local';

  // -------------------------------------------- 2  REQUIRED_VARIABLES
  const declarations = envVarsFor(deployable);
  const missing: string[] = [];
  const malformed: string[] = [];
  const forbidden: string[] = [];

  for (const d of declarations) {
    const value = rawEnv[d.name];
    const required = d.requiredIn.includes(environment);
    const isForbidden = d.forbiddenIn?.includes(environment) ?? false;

    if (isForbidden && value !== undefined) {
      forbidden.push(`${d.name} must not be set in ${environment}`);
      continue;
    }
    if (value === undefined || value === '') {
      if (required) missing.push(d.name);
      continue;
    }
    const parsed = d.schema.safeParse(value);
    if (!parsed.success) {
      // The message, never the value: the value may be a credential.
      malformed.push(`${d.name}: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
    }
  }

  const varProblems = [...missing.map((m) => `${m} is required`), ...malformed, ...forbidden];
  checks.push(
    varProblems.length === 0
      ? pass('REQUIRED_VARIABLES', `${declarations.length} declared variables validated.`)
      : fail(
          'REQUIRED_VARIABLES',
          `${varProblems.length} environment variable problems.`,
          varProblems,
        ),
  );

  // ------------------------------------------- 3  PUBLIC_VAR_SAFETY
  const unsafePublic: string[] = [];
  for (const [name, value] of Object.entries(rawEnv)) {
    if (!name.startsWith('PUBLIC_') || value === undefined) continue;
    if (looksSecretShaped(value)) {
      unsafePublic.push(`${name} holds a secret-shaped value`);
    }
  }
  // A declared secret reference must never be exposed under a browser-safe name.
  for (const d of declarations) {
    if (d.name.endsWith('_REF') && isBrowserSafeVarName(d.name)) {
      unsafePublic.push(`${d.name} is a secret reference under a browser-safe name`);
    }
  }
  checks.push(
    unsafePublic.length === 0
      ? pass('PUBLIC_VAR_SAFETY', 'No PUBLIC_ variable holds a secret-shaped value.')
      : fail('PUBLIC_VAR_SAFETY', 'A PUBLIC_ variable holds a secret.', unsafePublic),
  );

  // --------------------------------------------- 4  MOCK_ISOLATION
  const mockProblems: string[] = [];
  if (!isLocal) {
    for (const name of ['MOCK_FIXTURE_ROOT', 'MOCK_FAULTS']) {
      if (rawEnv[name] !== undefined) {
        mockProblems.push(`${name} is set outside local`);
      }
    }
    if (probes.mockAdaptersRegistered?.() === true) {
      mockProblems.push('a mock adapter or mock question bank is registered outside local');
    }
  }
  checks.push(
    mockProblems.length === 0
      ? pass(
          'MOCK_ISOLATION',
          isLocal ? 'Local: mocks permitted.' : 'No mock adapter or MOCK_* variable present.',
        )
      : fail('MOCK_ISOLATION', 'Mock configuration present outside local.', mockProblems),
  );

  // -------------------------------------------------- 5  DATABASE
  if (!probes.database) {
    checks.push(notRun('DATABASE', 'This deployable does not connect to the database.'));
  } else {
    const db = await probes.database();
    if (!db.reachable) {
      checks.push(fail('DATABASE', 'The database is not reachable.'));
    } else if (
      input.expectedMigrationVersion &&
      db.migrationVersion !== input.expectedMigrationVersion
    ) {
      checks.push(
        fail('DATABASE', 'The database is not at the expected migration version.', [
          `expected ${input.expectedMigrationVersion}, found ${db.migrationVersion ?? '(none)'}`,
        ]),
      );
    } else {
      checks.push(
        pass('DATABASE', `Reachable at migration ${db.migrationVersion ?? '(unversioned)'}.`),
      );
    }
  }

  // ------------------------------------------------- 6  KEY_VAULT
  if (isLocal) {
    checks.push(notRun('KEY_VAULT', 'Local: no Key Vault, and no credential is needed.'));
  } else if (!probes.keyVault) {
    checks.push(notRun('KEY_VAULT', 'This deployable resolves no secret references.'));
  } else {
    const kv = await probes.keyVault();
    if (!kv.reachable) {
      checks.push(fail('KEY_VAULT', 'Key Vault is not reachable.'));
    } else if (kv.unresolvedRefs.length > 0) {
      checks.push(
        fail('KEY_VAULT', 'One or more declared secret references did not resolve.', [
          ...kv.unresolvedRefs,
        ]),
      );
    } else {
      checks.push(pass('KEY_VAULT', 'Every declared secret reference resolved.'));
    }
  }

  // --------------------------------------------- 7  MCP_REACHABLE
  if (!probes.mcp) {
    checks.push(notRun('MCP_REACHABLE', 'This deployable does not call the MCP server.'));
  } else {
    const mcp = await probes.mcp();
    if (!mcp.reachable) {
      checks.push(
        fail('MCP_REACHABLE', 'The MCP server is not reachable. Readiness withheld; retrying.'),
      );
    } else if (
      input.expectedMcpRegistryVersion &&
      mcp.registryVersion !== input.expectedMcpRegistryVersion
    ) {
      checks.push(
        fail('MCP_REACHABLE', 'The MCP tool registry version is not compatible.', [
          `expected ${input.expectedMcpRegistryVersion}, found ${mcp.registryVersion ?? '(none)'}`,
        ]),
      );
    } else {
      checks.push(pass('MCP_REACHABLE', 'Reachable, registry compatible.'));
    }
  }

  // -------------------------------------------- 8  JWKS_REACHABLE
  if (isLocal && !probes.jwks) {
    checks.push(notRun('JWKS_REACHABLE', 'Local: a stub issuer is used.'));
  } else if (!probes.jwks) {
    checks.push(notRun('JWKS_REACHABLE', 'This deployable does not validate tokens.'));
  } else {
    const jwks = await probes.jwks();
    checks.push(
      jwks.reachable
        ? pass('JWKS_REACHABLE', 'Entra JWKS reachable.')
        : fail('JWKS_REACHABLE', 'Entra JWKS is not reachable. Readiness withheld; retrying.'),
    );
  }

  // --------------------------------------- 9  CONFIG_RESOLVABLE
  //
  // A malformed DECLARATION is fatal — it is a code defect. A bad stored VALUE
  // falls back to the code default and raises a finding (P2): a single bad row
  // must not take the platform down.
  const declarationProblems: string[] = [];
  const badStoredValues: string[] = [];

  for (const key of CONFIG_KEY_LIST) {
    const d = CONFIG_KEYS[key];
    const parsedDefault = d.schema.safeParse(d.defaultValue);
    if (!parsedDefault.success) {
      declarationProblems.push(
        `${key}: code default fails its own schema (${parsedDefault.error.issues[0]?.message ?? 'invalid'})`,
      );
    }
  }

  if (probes.storedConfig) {
    const stored = await probes.storedConfig();
    for (const [key, value] of Object.entries(stored)) {
      const d = CONFIG_KEYS[key as ConfigKey];
      if (!d) {
        badStoredValues.push(`${key}: not a declared configuration key`);
        continue;
      }
      if (!d.schema.safeParse(value).success) {
        badStoredValues.push(`${key}: stored value out of range; using the code default`);
      }
    }
  }

  if (declarationProblems.length > 0) {
    checks.push(
      fail('CONFIG_RESOLVABLE', 'A configuration declaration is invalid.', declarationProblems),
    );
  } else if (badStoredValues.length > 0) {
    checks.push(
      warn(
        'CONFIG_RESOLVABLE',
        'Stored configuration values were rejected; code defaults are in use.',
        badStoredValues,
      ),
    );
    for (const problem of badStoredValues) {
      findings.push({ checkKey: 'configuration.storedValueRejected', detail: problem });
    }
  } else {
    checks.push(
      pass('CONFIG_RESOLVABLE', `${CONFIG_KEY_LIST.length} configuration keys resolvable.`),
    );
  }

  // ------------------------------------------ 10  FLAG_CEILINGS
  const ceilingViolations: string[] = [];
  const switches = probes.flagSwitches ? await probes.flagSwitches() : {};
  for (const key of FEATURE_FLAG_KEYS) {
    const stored = switches[key];
    if (stored === true && !ceilingPermits(key, environment)) {
      ceilingViolations.push(`${key} is enabled but the ${environment} ceiling forbids it`);
      forcedOffFlags.push(key);
    }
  }
  checks.push(
    ceilingViolations.length === 0
      ? pass('FLAG_CEILINGS', 'Every flag switch is within its environment ceiling.')
      : warn(
          'FLAG_CEILINGS',
          'Flags above their ceiling were forced off. Startup continues.',
          ceilingViolations,
        ),
  );
  for (const problem of ceilingViolations) {
    findings.push({ checkKey: 'featureFlag.aboveCeiling', detail: problem });
  }

  // ------------------------------------ 11  QUESTION_BANK_TARGET
  //
  // Checked only when writes are on. Failure forces the flag off rather than
  // blocking startup: the safe state for a write flag is off.
  const writeSwitchOn =
    (switches['sharepoint.write.enabled'] ?? false) &&
    ceilingPermits('sharepoint.write.enabled', environment);

  if (!writeSwitchOn) {
    checks.push(
      notRun('QUESTION_BANK_TARGET', 'Not run: sharepoint.write.enabled is off.'),
    );
  } else if (!probes.questionBank) {
    checks.push(
      warn('QUESTION_BANK_TARGET', 'Writes are enabled but no bank probe is available.', [
        'sharepoint.write.enabled forced off',
      ]),
    );
    forcedOffFlags.push('sharepoint.write.enabled');
    findings.push({
      checkKey: 'questionBank.unverified',
      detail: 'Writes enabled without a verifiable bank target; flag forced off.',
    });
  } else {
    const bank = await probes.questionBank();
    if (!bank.listResolved || !bank.mappingComplete) {
      checks.push(
        warn('QUESTION_BANK_TARGET', 'The Question Bank target is not fully verified.', [
          ...bank.missing,
          'sharepoint.write.enabled forced off',
        ]),
      );
      forcedOffFlags.push('sharepoint.write.enabled');
      findings.push({
        checkKey: 'questionBank.unverified',
        detail: `Bank target unverified: ${bank.missing.join('; ')}`,
      });
    } else {
      checks.push(pass('QUESTION_BANK_TARGET', 'List resolved and field mapping complete.'));
    }
  }

  // ------------------------------------------ 12  BLOB_WRITABLE
  if (!probes.blob) {
    checks.push(notRun('BLOB_WRITABLE', 'This deployable does not use blob storage.'));
  } else {
    const blob = await probes.blob();
    checks.push(
      blob.reachable && blob.writable
        ? pass('BLOB_WRITABLE', 'Blob container reachable and writable.')
        : fail('BLOB_WRITABLE', 'Blob storage is not writable. Readiness withheld.'),
    );
  }

  const fatal = checks.some((c) => c.disposition === 'FAIL_FAST' && c.result === 'FAIL');
  const ready =
    !fatal && !checks.some((c) => c.disposition === 'READINESS' && c.result === 'FAIL');

  return {
    deployable,
    environment,
    checks,
    fatal,
    ready,
    forcedOffFlags,
    findings,
  };
};

export class StartupFatalError extends Error {
  readonly report: StartupReport;

  constructor(report: StartupReport) {
    const failures = report.checks.filter(
      (c) => c.disposition === 'FAIL_FAST' && c.result === 'FAIL',
    );
    super(
      [
        `Startup validation failed for ${report.deployable} (${report.environment ?? 'unknown env'}).`,
        ...failures.flatMap((f) => [
          `  [${f.id}] ${f.detail}`,
          ...f.problems.map((p) => `      - ${p}`),
        ]),
      ].join('\n'),
    );
    this.name = 'StartupFatalError';
    this.report = report;
  }
}

/**
 * Throws StartupFatalError when a fail-fast check failed. The bootstrap in each
 * app catches it and exits non-zero, which keeps the exit path one line and the
 * decision testable.
 */
export const enforceStartup = (report: StartupReport): StartupReport => {
  if (report.fatal) throw new StartupFatalError(report);
  return report;
};

/** One line per check, for the operator log. Safe to print. */
export const formatStartupReport = (report: StartupReport): string =>
  [
    `startup: ${report.deployable} env=${report.environment ?? 'unknown'} ` +
      `fatal=${report.fatal} ready=${report.ready}`,
    ...report.checks.map(
      (c) =>
        `  ${c.result.padEnd(7)} ${c.id.padEnd(22)} ${c.detail}` +
        (c.problems.length > 0 ? `\n${c.problems.map((p) => `          - ${p}`).join('\n')}` : ''),
    ),
  ].join('\n');
