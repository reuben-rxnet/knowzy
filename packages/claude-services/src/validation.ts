// "Test connection", and the line it must not cross.
//
// A connection test for an AI provider is a request to be told something
// definite, and the honest answer in this build is definite but partial. So
// this reports a CHAIN rather than a verdict: five checks in the order the
// platform enforces them, each with PASSED, FAILED or NOT_ATTEMPTED, and each
// with a sentence saying why.
//
// The rule it exists to keep: **nothing here may report a successful
// authentication, a reachable model or a valid key, because nothing here calls
// a provider.** No provider client is implemented in this build (architecture
// .md §9.0), so LIVE_CALL is always NOT_ATTEMPTED and the overall outcome is
// INCOMPLETE rather than PASSED. A test that printed "Authentication
// successful" from a configuration read would be worse than no test: it would
// be the exact false assurance somebody would cite when a deployment failed.
//
// What it DOES establish is real and worth a button:
//
//   * that a provider can ground a question at all;
//   * that a data-processing approval has been recorded for it;
//   * that a client for it exists in this build;
//   * that a credential REFERENCE is recorded, and whether the platform can
//     resolve it here.
//
// Those four are the reasons a generation request is refused today, in the
// order they are enforced, and each one names what to do next.
//
// Pure: no I/O, no clock, no database. The caller supplies the assessment, the
// settings and whether the reference resolves; this decides what may be said.

import type {
  ProviderStateAssessment,
  ProviderSettings,
  ProviderValidationOutcome,
  ProviderValidationStep,
} from '@knowzy/shared-types';

export interface ValidateProviderInput {
  /** The registry's verdict. This function never second-guesses it. */
  readonly assessment: ProviderStateAssessment;
  readonly settings: ProviderSettings | undefined;
  /**
   * Whether the platform can RESOLVE the recorded reference in this
   * environment — not whether the credential is valid, which only a call could
   * establish.
   *
   * `null` means the platform has no way to find out: there is no secret
   * resolver in this build, so a recorded reference for an external provider is
   * "recorded, unresolvable here". Saying so is the point.
   */
  readonly credentialResolves: boolean | null;
}

export interface ValidateProviderResult {
  readonly outcome: ProviderValidationOutcome;
  readonly steps: readonly ProviderValidationStep[];
}

/** The deterministic provider is the one case where every check is genuinely met. */
const DETERMINISTIC = 'DETERMINISTIC_LOCAL';

export const validateProvider = (input: ValidateProviderInput): ValidateProviderResult => {
  const { assessment, settings } = input;
  const steps: ProviderValidationStep[] = [];

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
            'No data-processing approval is recorded. Record one before enabling the provider — a credential alone is not authorization.',
        },
  );

  // --------------------------------------------------------- implementation
  steps.push(
    assessment.registered
      ? {
          check: 'IMPLEMENTATION',
          result: 'PASSED',
          detail: 'A client for this provider is implemented in this build.',
        }
      : {
          check: 'IMPLEMENTATION',
          result: 'FAILED',
          detail:
            'No client for this provider exists in this build. Configuration cannot supply one; it ships in a release.',
        },
  );

  // ------------------------------------------------------------- credential
  steps.push(credentialStep(assessment.providerId, settings, input.credentialResolves));

  // -------------------------------------------------------------- live call
  //
  // Never attempted, and the detail says why rather than leaving a reader to
  // conclude the test was inconclusive by accident.
  steps.push(
    assessment.providerId === DETERMINISTIC
      ? {
          check: 'LIVE_CALL',
          result: 'PASSED',
          detail:
            'The deterministic generator runs in this process. Nothing is called over a network, so there is nothing left to verify.',
        }
      : {
          check: 'LIVE_CALL',
          result: 'NOT_ATTEMPTED',
          detail:
            'No request was sent. This build implements no client for this provider, so authentication, endpoint reachability and model availability are UNVERIFIED — this result does not claim them.',
        },
  );

  return { outcome: outcomeOf(steps), steps };
};

const credentialStep = (
  providerId: string,
  settings: ProviderSettings | undefined,
  resolves: boolean | null,
): ProviderValidationStep => {
  if (providerId === DETERMINISTIC) {
    return {
      check: 'CREDENTIAL',
      result: 'PASSED',
      detail: 'The deterministic generator needs no credential.',
    };
  }
  if (settings?.apiKeyRef === undefined) {
    return {
      check: 'CREDENTIAL',
      result: 'FAILED',
      detail:
        'No credential reference is recorded. Record a keyvault://{vault}/secrets/{name} reference — never the key itself.',
    };
  }
  if (resolves === true) {
    return {
      check: 'CREDENTIAL',
      result: 'PASSED',
      detail:
        'The recorded reference resolves in this environment. Whether the secret behind it is valid is not established here.',
    };
  }
  if (resolves === false) {
    return {
      check: 'CREDENTIAL',
      result: 'FAILED',
      detail:
        'A reference is recorded but does not resolve in this environment. Check that the secret exists in the named vault and that this deployable can read it.',
    };
  }
  return {
    check: 'CREDENTIAL',
    result: 'NOT_ATTEMPTED',
    detail:
      'A reference is recorded. This build has no secret resolver, so whether it resolves cannot be checked here.',
  };
};

/**
 * One outcome from five results.
 *
 * Any FAILED makes the whole thing FAILED -- the chain is conjunctive, and a
 * provider that fails one check cannot be used. Otherwise INCOMPLETE if
 * anything was not attempted, and only PASSED when every check actually ran
 * and passed. There is no outcome meaning "probably fine".
 */
const outcomeOf = (steps: readonly ProviderValidationStep[]): ProviderValidationOutcome => {
  if (steps.some((step) => step.result === 'FAILED')) return 'FAILED';
  if (steps.some((step) => step.result === 'NOT_ATTEMPTED')) return 'INCOMPLETE';
  return 'PASSED';
};
