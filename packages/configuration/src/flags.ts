// Feature flags — environment-and-configuration.md §6.
//
// effective(flag) = environmentCeiling(flag, KNOWZY_ENV) AND runtimeSwitch(flag)
//
// The ceiling is what stops an administrator in `dev` enabling production
// writes, and stops a mis-set database row turning on something the environment
// was never provisioned for. F3: flags gate CAPABILITY, never authorization.
// F1: every flag declares the user-visible consequence of being off, because a
// flag whose off-state behaviour is undefined is not permitted.

import type { KnowzyEnv } from '@knowzy/shared-types';

/** Which environments may ever turn the flag on. `none` = not implemented. */
export type FlagCeiling = 'none' | readonly KnowzyEnv[];

export interface FlagDeclaration {
  readonly key: string;
  /** Runtime default when no FeatureFlag row exists. */
  readonly defaultEnabled: boolean;
  readonly ceiling: FlagCeiling;
  readonly owner: string;
  /** F1/F2: the designed off-state, not a crash or an empty screen. */
  readonly whenOff: string;
}

const ALL_ENVS: readonly KnowzyEnv[] = ['local', 'dev', 'test', 'prod'];
const LOWER_ONLY: readonly KnowzyEnv[] = ['local', 'dev'];

const flag = (d: FlagDeclaration): FlagDeclaration => d;

export const FEATURE_FLAGS = {
  'sharepoint.write.enabled': flag({
    key: 'sharepoint.write.enabled',
    defaultEnabled: false,
    // V3: dev ships with writes off, so the publish flow runs in dry-run mode
    // until someone deliberately enables it.
    ceiling: ['test', 'prod'],
    owner: 'Platform administrator',
    whenOff:
      'Publishing and retirement run in dry-run mode and the publish screen says so prominently.',
  }),
  // AI Document Studio M3 (AI_DOCUMENT_STUDIO_ARCHITECTURE.md §11.4). The
  // deterministic test preparation provider, which is NOT AI. LOCAL ONLY: the
  // ceiling is what makes "never available in production" a property rather
  // than a promise, and startup refuses a stored row that tries elsewhere.
  'documentStudio.testPreparation.enabled': flag({
    key: 'documentStudio.testPreparation.enabled',
    defaultEnabled: true,
    ceiling: ['local'],
    owner: 'Platform administrator',
    whenOff:
      'Only a live AI provider can prepare a document; until CP-5 is recorded the Studio says AI preparation is not yet enabled.',
  }),
  'generation.enabled': flag({
    key: 'generation.enabled',
    defaultEnabled: true,
    ceiling: ALL_ENVS,
    owner: 'Platform administrator',
    whenOff: 'The generation form is disabled with an explanation; existing drafts are unaffected.',
  }),
  'generation.objectiveDriven.required': flag({
    key: 'generation.objectiveDriven.required',
    defaultEnabled: false,
    ceiling: ALL_ENVS,
    owner: 'Quiz author lead',
    whenOff: 'Objective-driven generation is available but not mandatory.',
  }),
  'duplicate.claudeAdjudication.enabled': flag({
    key: 'duplicate.claudeAdjudication.enabled',
    defaultEnabled: true,
    ceiling: ALL_ENVS,
    owner: 'AI engineer',
    whenOff: 'Flag-band items show similarity scores without an advisory verdict.',
  }),
  'refresher.claudeSummary.enabled': flag({
    key: 'refresher.claudeSummary.enabled',
    defaultEnabled: true,
    ceiling: ALL_ENVS,
    owner: 'AI engineer',
    whenOff:
      'Refreshers show the approved explanation and citations only, with no generated summary.',
  }),
  'refresher.enterpriseSearch.enabled': flag({
    key: 'refresher.enterpriseSearch.enabled',
    defaultEnabled: true,
    ceiling: ALL_ENVS,
    owner: 'AI engineer',
    whenOff:
      'No source search; the approved explanation is shown with the honest no-resource statement.',
  }),
  'assessment.practiceMode.enabled': flag({
    key: 'assessment.practiceMode.enabled',
    defaultEnabled: false,
    ceiling: LOWER_ONLY,
    owner: 'Assessment manager',
    whenOff: 'The reserved PRACTICE session mode is unreachable.',
  }),
  'recognition.badges.enabled': flag({
    key: 'recognition.badges.enabled',
    defaultEnabled: true,
    ceiling: ALL_ENVS,
    owner: 'Business owner',
    whenOff: 'No new awards; existing badges remain visible.',
  }),
  'recognition.certificates.enabled': flag({
    key: 'recognition.certificates.enabled',
    defaultEnabled: true,
    ceiling: ALL_ENVS,
    owner: 'Business owner',
    whenOff: 'No new issuance; existing certificates remain downloadable and verifiable.',
  }),
  'certificate.verification.public': flag({
    key: 'certificate.verification.public',
    defaultEnabled: true,
    ceiling: ALL_ENVS,
    owner: 'Security architect',
    whenOff:
      'The public verification endpoint returns NOT_FOUND for every code and the UI stops offering the URL.',
  }),
  'certificate.includeLearnerName': flag({
    key: 'certificate.includeLearnerName',
    defaultEnabled: false,
    ceiling: ALL_ENVS,
    owner: 'Privacy owner',
    whenOff: "The learner's name is omitted from the certificate and from verification.",
  }),
  'certificate.verificationIncludesScore': flag({
    key: 'certificate.verificationIncludesScore',
    defaultEnabled: false,
    ceiling: ALL_ENVS,
    owner: 'Privacy owner',
    whenOff: 'Public verification omits the percentage score.',
  }),
  'reporting.publication.enabled': flag({
    key: 'reporting.publication.enabled',
    defaultEnabled: true,
    ceiling: ALL_ENVS,
    owner: 'Reporting lead',
    whenOff: 'Reports run and export; the publication lifecycle is unavailable.',
  }),
  'reporting.scheduled.enabled': flag({
    key: 'reporting.scheduled.enabled',
    defaultEnabled: false,
    // F6: not implemented. The row exists so the roadmap is visible and the
    // schema is stable.
    ceiling: 'none',
    owner: 'Reporting lead',
    whenOff: 'The ReportSchedule shape exists and is inert.',
  }),
  'access.requireTwoPersonAdminGrant': flag({
    key: 'access.requireTwoPersonAdminGrant',
    defaultEnabled: false,
    ceiling: ALL_ENVS,
    owner: 'Security architect',
    whenOff: 'A single administrator may grant administration.',
  }),
  'approval.breakGlass.enabled': flag({
    key: 'approval.breakGlass.enabled',
    defaultEnabled: false,
    ceiling: ALL_ENVS,
    owner: 'Platform administrator',
    whenOff: 'Separation-of-duties refusals cannot be overridden.',
  }),
  'source.liveSearch.enabled': flag({
    key: 'source.liveSearch.enabled',
    defaultEnabled: true,
    ceiling: ALL_ENVS,
    owner: 'Source administrator',
    whenOff: 'Indexed search only, labelled as such.',
  }),
  'notifications.email.enabled': flag({
    key: 'notifications.email.enabled',
    defaultEnabled: false,
    ceiling: 'none',
    owner: 'Platform administrator',
    whenOff: 'In-app delivery only.',
  }),
  'semantic.duplicateDetection.enabled': flag({
    key: 'semantic.duplicateDetection.enabled',
    defaultEnabled: false,
    ceiling: 'none',
    owner: 'AI engineer',
    whenOff: 'Lexical detection only; the reserved vector column stays unused.',
  }),
} as const;

export type FeatureFlagKey = keyof typeof FEATURE_FLAGS;
export const FEATURE_FLAG_KEYS = Object.keys(FEATURE_FLAGS) as readonly FeatureFlagKey[];

export const flagDeclaration = (key: FeatureFlagKey): FlagDeclaration => FEATURE_FLAGS[key];

/** True when the environment is permitted to enable this flag at all. */
export const ceilingPermits = (key: FeatureFlagKey, env: KnowzyEnv): boolean => {
  const ceiling = FEATURE_FLAGS[key].ceiling;
  if (ceiling === 'none') return false;
  return ceiling.includes(env);
};

export interface FlagResolution {
  readonly key: FeatureFlagKey;
  readonly effective: boolean;
  readonly runtimeSwitch: boolean;
  readonly ceilingPermits: boolean;
  /** True when the runtime switch was on but the ceiling forced it off. */
  readonly forcedOffByCeiling: boolean;
}

/**
 * Resolves one flag. `runtimeSwitch` is the FeatureFlag row value, or the
 * declared default when no row exists.
 */
export const resolveFlag = (
  key: FeatureFlagKey,
  env: KnowzyEnv,
  runtimeSwitch?: boolean,
): FlagResolution => {
  const runtime = runtimeSwitch ?? FEATURE_FLAGS[key].defaultEnabled;
  const permitted = ceilingPermits(key, env);
  return {
    key,
    effective: permitted && runtime,
    runtimeSwitch: runtime,
    ceilingPermits: permitted,
    forcedOffByCeiling: runtime && !permitted,
  };
};
