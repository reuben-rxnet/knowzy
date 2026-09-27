// "Test connection" — the chain, and what each link may honestly claim.
//
// Before P-5 this reported five checks and could establish only the first
// three: nothing could resolve a secret and nothing could call a provider, so
// CREDENTIAL and LIVE_CALL were NOT_ATTEMPTED for every external provider and
// the outcome was INCOMPLETE by construction. Since P-5 and OPENAI-CODEX-00 the
// chain is nine checks and the live ones are REAL:
//
//   CAPABILITY         can the provider ground a question at all
//   APPROVAL           is a data-processing approval recorded
//   IMPLEMENTATION     does this build have a client for it
//   CONFIGURATION      are the base URL, model and reference recorded
//   SECRET_RESOLUTION  does the reference resolve, here, now
//   ENDPOINT           did the allow-listed host answer
//   AUTHENTICATION     did the provider accept the key
//   MODEL              is the configured model available to that key
//   GENERATION         can this build generate with it
//
// THE RULE IS UNCHANGED: no step may claim more than was observed. The live
// steps come from `checkOpenAIReadiness`, which records what it saw (a status
// code, a round-trip time); this function only arranges them. GENERATION is
// NOT_ATTEMPTED for every provider whose client cannot generate -- this
// milestone ends before generation, and a validation that PASSED would read
// as "ready to generate", which is false.
//
// APPROVAL DOES NOT GATE THE LIVE CHECKS. They are metadata calls: the request
// is the key and a model name, with no prompt, document or person in it.
// Knowing that a key works before Privacy signs off is useful and harmless;
// GENERATING before then is what the approval governs, and the registry keeps
// refusing that with BLOCKED_BY_APPROVAL.
//
// Pure: no I/O. The caller resolves the secret and runs the probe.

import { createHash } from 'node:crypto';
import type {
  ProviderSettings,
  ProviderStateAssessment,
  ProviderValidationOutcome,
  ProviderValidationStep,
  SecretResolutionStatus,
  SecretSource,
} from '@knowzy/shared-types';
import type { ProviderCapabilities } from './provider.js';
import type { ReadinessResult } from './openai.js';

export interface SecretCheck {
  readonly status: SecretResolutionStatus;
  readonly source: SecretSource | null;
  /** The resolver's sentence. Never a value. */
  readonly detail: string | null;
}

export interface ValidateProviderInput {
  /** The registry's verdict. This function never second-guesses it. */
  readonly assessment: ProviderStateAssessment;
  readonly capabilities: ProviderCapabilities;
  readonly settings: ProviderSettings | undefined;
  /** Null when resolution was not attempted (a prerequisite failed). */
  readonly secret: SecretCheck | null;
  /** Null when the live probe was not run. */
  readonly live: ReadinessResult | null;
}

export interface ValidateProviderResult {
  readonly outcome: ProviderValidationOutcome;
  readonly steps: readonly ProviderValidationStep[];
}

const DETERMINISTIC = 'DETERMINISTIC_LOCAL';

/** The fields a network provider needs before anything live can run. */
export const REQUIRED_SETTINGS = ['baseUrl', 'modelId', 'apiKeyRef'] as const;

export const missingSettings = (settings: ProviderSettings | undefined): readonly string[] =>
  REQUIRED_SETTINGS.filter((field) => settings?.[field] === undefined);

/**
 * A fingerprint of the settings a validation depends on.
 *
 * Recorded on the CONFIGURATION step so a later read can tell whether the
 * validation still describes the configuration in force. The whole-row
 * `settingsUpdatedAt` cannot: it moves when ANY provider's settings change.
 */
export const settingsFingerprint = (settings: ProviderSettings | undefined): string =>
  createHash('sha256')
    .update(
      JSON.stringify([
        settings?.baseUrl ?? null,
        settings?.modelId ?? null,
        settings?.apiKeyRef ?? null,
      ]),
    )
    .digest('hex')
    .slice(0, 16);

/** Whether prerequisites allow the live probe. The caller asks before running it. */
export const mayProbe = (input: Omit<ValidateProviderInput, 'secret' | 'live'>): boolean =>
  input.assessment.providerId !== DETERMINISTIC &&
  input.assessment.groundingSafe &&
  input.assessment.registered &&
  missingSettings(input.settings).length === 0;

export const validateProvider = (input: ValidateProviderInput): ValidateProviderResult => {
  const { assessment, settings } = input;
  const steps: ProviderValidationStep[] = [];

  if (assessment.providerId === DETERMINISTIC) {
    const inProcess = (check: ProviderValidationStep['check'], detail: string) =>
      steps.push({ check, result: 'PASSED', detail });
    inProcess('CAPABILITY', 'The deterministic generator quotes only the sections it is given.');
    inProcess('APPROVAL', 'Nothing leaves this process, so no data-processing approval is needed.');
    inProcess('IMPLEMENTATION', 'The deterministic generator is built into every environment.');
    inProcess('CONFIGURATION', 'It needs no endpoint, model or credential.');
    inProcess('SECRET_RESOLUTION', 'It needs no secret.');
    inProcess('ENDPOINT', 'It runs in this process; there is no network endpoint.');
    inProcess('AUTHENTICATION', 'There is nothing to authenticate to.');
    inProcess('MODEL', 'The model is the platform’s own: knowzy-deterministic-local-1.');
    inProcess('GENERATION', 'It generates in this build.');
    return { outcome: 'PASSED', steps };
  }

  // ------------------------------------------------------------- capability
  steps.push(
    assessment.groundingSafe
      ? {
          check: 'CAPABILITY',
          result: 'PASSED',
          detail:
            'The provider performs no retrieval of its own, so a question it drafts can be grounded in the selected sections.',
        }
      : {
          check: 'CAPABILITY',
          result: 'FAILED',
          detail:
            'The provider performs its own retrieval, so it cannot be used for grounded generation. No approval or credential changes this.',
        },
  );

  // --------------------------------------------------------------- approval
  steps.push(
    assessment.approved
      ? {
          check: 'APPROVAL',
          result: 'PASSED',
          detail: 'A data-processing approval is recorded for this provider.',
        }
      : {
          check: 'APPROVAL',
          result: 'FAILED',
          detail:
            'No data-processing approval is recorded. The readiness checks below still run -- they send only the key and a model name -- but no question will be generated until one is.',
        },
  );

  // --------------------------------------------------------- implementation
  steps.push(
    assessment.registered
      ? {
          check: 'IMPLEMENTATION',
          result: 'PASSED',
          detail: input.capabilities.supportsGeneration
            ? 'A client for this provider is implemented in this build.'
            : 'A readiness client for this provider is implemented in this build (endpoint, authentication, model).',
        }
      : {
          check: 'IMPLEMENTATION',
          result: 'FAILED',
          detail:
            'No client for this provider exists in this build. Configuration cannot supply one; it ships in a release.',
        },
  );

  // ---------------------------------------------------------- configuration
  const missing = missingSettings(settings);
  steps.push(
    missing.length === 0
      ? {
          check: 'CONFIGURATION',
          result: 'PASSED',
          detail: `Base URL, model and credential reference are recorded${settings?.enabled === true ? '' : '; the provider is not enabled'}.`,
          facts: {
            settingsFingerprint: settingsFingerprint(settings),
            enabled: settings?.enabled === true,
          },
        }
      : {
          check: 'CONFIGURATION',
          result: 'FAILED',
          detail: `Not recorded: ${missing.join(', ')}. Set them in this provider’s settings.`,
          facts: { settingsFingerprint: settingsFingerprint(settings) },
        },
  );

  // ------------------------------------------------------- secret resolution
  const blocker = !assessment.groundingSafe
    ? 'the provider cannot ground a question'
    : !assessment.registered
      ? 'no client exists in this build'
      : missing.length > 0
        ? 'the configuration is incomplete'
        : null;

  if (input.secret === null) {
    steps.push({
      check: 'SECRET_RESOLUTION',
      result: 'NOT_ATTEMPTED',
      detail: `Not attempted: ${blocker ?? 'no resolution was run'}.`,
    });
  } else {
    steps.push(
      input.secret.status === 'RESOLVED'
        ? {
            check: 'SECRET_RESOLUTION',
            result: 'PASSED',
            detail: `The reference resolved from ${input.secret.source ?? 'its source'}. The value was not recorded or displayed.`,
            facts: { source: input.secret.source ?? 'UNKNOWN' },
          }
        : {
            check: 'SECRET_RESOLUTION',
            result: 'FAILED',
            detail:
              input.secret.detail ?? `The reference did not resolve (${input.secret.status}).`,
            facts: { status: input.secret.status, source: input.secret.source ?? 'UNKNOWN' },
          },
    );
  }

  // ------------------------------------------------------------ live checks
  if (input.live === null) {
    const why =
      blocker ??
      (input.secret !== null && input.secret.status !== 'RESOLVED'
        ? 'the secret did not resolve, so there was no key to send'
        : 'the probe was not run');
    for (const check of ['ENDPOINT', 'AUTHENTICATION', 'MODEL'] as const) {
      steps.push({ check, result: 'NOT_ATTEMPTED', detail: `Not attempted: ${why}. UNVERIFIED.` });
    }
  } else {
    steps.push(input.live.endpoint, input.live.authentication, input.live.model);
  }

  // ------------------------------------------------------------- generation
  steps.push(
    input.capabilities.supportsGeneration
      ? {
          check: 'GENERATION',
          result: 'NOT_ATTEMPTED',
          detail:
            'A test connection never generates a question: it would spend tokens to prove what the checks above establish.',
        }
      : {
          check: 'GENERATION',
          result: 'NOT_ATTEMPTED',
          detail:
            'Generating questions with this provider is not implemented in this build. Readiness ends here.',
        },
  );

  return { outcome: outcomeOf(steps), steps };
};

/**
 * One outcome from the results.
 *
 * Any FAILED makes the whole thing FAILED -- the chain is conjunctive. Otherwise
 * INCOMPLETE if anything was not attempted, and only PASSED when every check
 * ran and passed. There is no outcome meaning "probably fine".
 */
export const outcomeOf = (steps: readonly ProviderValidationStep[]): ProviderValidationOutcome => {
  if (steps.some((step) => step.result === 'FAILED')) return 'FAILED';
  if (steps.some((step) => step.result === 'NOT_ATTEMPTED')) return 'INCOMPLETE';
  return 'PASSED';
};
