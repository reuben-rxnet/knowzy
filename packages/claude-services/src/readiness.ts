// Provider readiness — how far along the path to "usable" a provider is.
//
// `ProviderState` answers "would a generation request be refused, and why".
// Readiness answers the question an administrator actually has while setting
// a provider up: "what have I proved so far, and what is the next step". It is
// derived, never stored, from three things: the registry's assessment, the
// settings in force, and the LATEST recorded validation -- and only when that
// validation still describes those settings.
//
// THE ORDER, most permanent first, exactly as the registry orders state:
//
//   UNAVAILABLE               cannot ground / no client
//   BLOCKED_BY_CONFIGURATION  base URL, model or reference missing
//   CONFIGURED                complete; never validated, or not since a change
//   BLOCKED_BY_CONFIGURATION  the reference does not resolve / host refused
//   UNAVAILABLE               the endpoint did not answer
//   RESOLVED                  the secret was read; the key was not accepted
//   AUTHENTICATED             accepted; the model is not available
//   BLOCKED_BY_APPROVAL       technically ready; no approval recorded
//   BLOCKED_BY_CONFIGURATION  ready and approved; not enabled
//   UNAVAILABLE               ready, approved, enabled; this build cannot generate
//   AVAILABLE
//
// A validation recorded under different settings is not evidence about these
// ones, so a changed base URL, model or reference drops the provider back to
// CONFIGURED until somebody tests again.

import type {
  ProviderReadiness,
  ProviderSettings,
  ProviderStateAssessment,
  ProviderValidationStep,
} from '@knowzy/shared-types';
import type { ProviderCapabilities } from './provider.js';
import { missingSettings, settingsFingerprint } from './validation.js';

export interface DeriveReadinessInput {
  readonly assessment: ProviderStateAssessment;
  readonly capabilities: ProviderCapabilities;
  readonly settings: ProviderSettings | undefined;
  readonly latestValidation: {
    readonly steps: readonly ProviderValidationStep[];
    readonly validatedAt: string;
  } | null;
}

export const deriveReadiness = (input: DeriveReadinessInput): ProviderReadiness => {
  const { assessment, settings, capabilities } = input;
  const at = input.latestValidation?.validatedAt ?? null;
  const is = (
    state: ProviderReadiness['state'],
    reason: string,
    validatedAt: string | null = at,
  ) => ({
    state,
    reason,
    validatedAt,
  });

  if (assessment.providerId === 'DETERMINISTIC_LOCAL') {
    return is('AVAILABLE', 'Runs in this process; nothing to configure, resolve or authenticate.');
  }
  if (!assessment.groundingSafe) {
    return is(
      'UNAVAILABLE',
      'It performs its own retrieval, so it cannot be used for grounded generation.',
      null,
    );
  }
  if (!assessment.registered) {
    return is('UNAVAILABLE', 'No client for this provider exists in this build.', null);
  }

  const missing = missingSettings(settings);
  if (missing.length > 0) {
    return is(
      'BLOCKED_BY_CONFIGURATION',
      `Record ${missing.join(', ')} in this provider’s settings.`,
      null,
    );
  }

  const steps = input.latestValidation?.steps ?? [];
  const step = (check: ProviderValidationStep['check']) => steps.find((s) => s.check === check);
  const recordedFor = step('CONFIGURATION')?.facts?.['settingsFingerprint'];
  if (input.latestValidation === null || recordedFor !== settingsFingerprint(settings)) {
    return is(
      'CONFIGURED',
      input.latestValidation === null
        ? 'Configured and never tested. Run Test connection.'
        : 'The base URL, model or reference changed since the last test. Run Test connection again.',
    );
  }

  const secret = step('SECRET_RESOLUTION');
  if (secret?.result !== 'PASSED') {
    return is(
      'BLOCKED_BY_CONFIGURATION',
      secret?.detail ?? 'The credential reference did not resolve.',
    );
  }

  const endpoint = step('ENDPOINT');
  if (endpoint?.result === 'FAILED') {
    return endpoint.facts?.['cause'] === 'NOT_ALLOWED'
      ? is('BLOCKED_BY_CONFIGURATION', endpoint.detail)
      : is('UNAVAILABLE', endpoint.detail);
  }

  const authentication = step('AUTHENTICATION');
  if (authentication?.result !== 'PASSED') {
    return is(
      'RESOLVED',
      authentication?.detail ?? 'The secret was read; authentication was not established.',
    );
  }

  // GATEWAY-M1: a gateway that exposes no model discovery SKIPS the model
  // check. That is not a failure of the provider, so it does not hold the
  // ladder at AUTHENTICATED -- but every sentence above that rung says the
  // model is unverified, because it is.
  const model = step('MODEL');
  const modelSkipped = model?.result === 'SKIPPED';
  if (model?.result !== 'PASSED' && !modelSkipped) {
    return is('AUTHENTICATED', model?.detail ?? 'Authenticated; the model was not confirmed.');
  }
  const verified = modelSkipped
    ? 'Endpoint and key are verified; the model is unverified because this gateway exposes no model discovery.'
    : 'Endpoint, key and model are verified.';

  if (!assessment.approved) {
    return is(
      'BLOCKED_BY_APPROVAL',
      `${verified} No data-processing approval is recorded, so it will not be used to generate.`,
    );
  }
  if (settings?.enabled !== true) {
    return is('BLOCKED_BY_CONFIGURATION', 'Verified and approved, but not enabled.');
  }
  if (!capabilities.supportsGeneration) {
    return is(
      'UNAVAILABLE',
      'Verified, approved and enabled. Generating questions with it is not implemented in this build.',
    );
  }
  return is('AVAILABLE', 'Verified, approved, enabled and able to generate.');
};
