// A problem+json response, rendered.
//
// Every refusal in this system carries a code, a human-readable detail, and
// sometimes a list of failed gates. ux-design.md §9.1 requires the reason to be
// shown rather than a generic failure, so this component exists once and every
// surface uses it — an approval blocked by gate 7 reads as gate 7, not as
// "something went wrong".
//
// UI-M2 moved it onto the shared states, which also fixed a real problem: this
// used to depend on `legacy.css` class names, so the moment a refusal was
// rendered somewhere the legacy stylesheet does not reach — inside a drawer,
// for instance — it lost its panel entirely and read as loose text.
//
// The three states are not decoration. They say different things:
//
//   refusal      the platform understood and declined — a permission, a gate,
//                a state transition that is not allowed. Nothing is broken.
//   unavailable  a dependency could not be reached. Retrying may work.
//   error        anything else.
//
// Telling them apart matters here, because most "failures" in this product are
// governance working as designed.

import { ErrorState, RefusalState, ServiceUnavailableState } from '@knowzy/shared-ui';
import { t, type CopyKey } from '../copy';
import type { ApiProblem } from '../lib/api';

/** Refusals: the server understood the request and declined it. */
const REFUSAL_CODES = new Set([
  'FORBIDDEN',
  'GATE_FAILED',
  'SEPARATION_OF_DUTIES',
  'INVALID_STATE_TRANSITION',
  'DUPLICATE_BLOCKS_APPROVAL',
  'ELIGIBILITY_REFUSED',
  'GENERATION_SCOPE_EMPTY',
  // UX-M2: generation controls. Each is a control holding, not a fault.
  'GENERATION_JUSTIFICATION_REQUIRED',
  'PREFLIGHT_REQUIRED',
  'PROVIDER_NOT_APPROVED',
  'PROVIDER_NOT_GROUNDING_SAFE',
  'PROVIDER_NOT_REGISTERED',
  'PROVIDER_CREDENTIAL_UNAVAILABLE',
  'BUDGET_EXCEEDED',
  'GENERATION_CONCURRENCY_LIMIT',
  'TAXONOMY_INACTIVE',
  'TAXONOMY_MAPPING_REQUIRED',
  // COMPETENCY-M2: catalogue and approval rules holding.
  'COMPETENCY_DUPLICATE',
  'COMPETENCY_NEAR_MATCH',
  'COMPETENCY_INACTIVE',
  'COMPETENCY_VERSION_STALE',
  'COMPETENCY_FRAMEWORK_NOT_APPROVED',
]);

/**
 * UX-M2: what the reader can DO about the commonest refusals, in plain words.
 * The server's detail stays as the reason; this is the next step, which the
 * detail -- written for an audit row -- rarely states.
 */
const NEXT_STEP: Readonly<Record<string, CopyKey>> = {
  FORBIDDEN: 'problem.nextForbidden',
  SEPARATION_OF_DUTIES: 'problem.nextSeparation',
  GATE_FAILED: 'problem.nextGate',
  GENERATION_JUSTIFICATION_REQUIRED: 'problem.nextJustification',
  PREFLIGHT_REQUIRED: 'problem.nextPreflight',
  GENERATION_SELECTION_REQUIRED: 'problem.nextSelection',
  GENERATION_SCOPE_EMPTY: 'problem.nextScopeEmpty',
  PROVIDER_NOT_APPROVED: 'problem.nextProviderApproval',
  PROVIDER_NOT_GROUNDING_SAFE: 'problem.nextProviderCapability',
  PROVIDER_NOT_REGISTERED: 'problem.nextProviderUnavailable',
  PROVIDER_CREDENTIAL_UNAVAILABLE: 'problem.nextProviderConfiguration',
  BUDGET_EXCEEDED: 'problem.nextBudget',
  GENERATION_CONCURRENCY_LIMIT: 'problem.nextConcurrency',
  LLM_UNAVAILABLE: 'problem.nextRetry',
  REQUEST_TIMEOUT: 'problem.nextRetry',
  MCP_UNAVAILABLE: 'problem.nextRetry',
  VERSION_CONFLICT: 'problem.nextReload',
  COMPETENCY_NEAR_MATCH: 'problem.nextCompetencyNearMatch',
  COMPETENCY_VERSION_STALE: 'problem.nextCompetencyStale',
  COMPETENCY_FRAMEWORK_NOT_APPROVED: 'problem.nextCompetencyFramework',
  COMPETENCY_INACTIVE: 'problem.nextCompetencyInactive',
};

const UNAVAILABLE_CODES = new Set(['MCP_UNAVAILABLE', 'SOURCE_UNAVAILABLE', 'UPSTREAM_TIMEOUT']);

export const Problem = ({
  problem,
  actingAs,
}: {
  problem: ApiProblem;
  /**
   * The identity the request was made as.
   *
   * Passed in where the surface knows it, because a FORBIDDEN that names the
   * permission but not the IDENTITY leaves the reader one fact short of
   * acting: "Requires permission source.sync" reads like a broken feature
   * until you also know you are the Author. The header shows the identity,
   * but a drawer can cover it — which is exactly how this was reported.
   */
  actingAs?: string;
}) => {
  const title = problem.title === '' ? t('error.heading') : problem.title;
  // The code and the HTTP status stay visible. They are what makes a refusal
  // reportable — the same token appears in the audit row and in the API.
  const code = `${problem.code} · HTTP ${problem.status}`;

  const gates =
    problem.gateFailures !== undefined && problem.gateFailures.length > 0 ? (
      <div className="flex flex-col gap-2">
        <h4 className="text-base font-semibold text-brand-navy-text">{t('error.gateFailures')}</h4>
        <ul className="flex flex-col gap-1.5">
          {problem.gateFailures.map((failure) => (
            <li
              key={`${failure.gate}-${failure.code}`}
              className="rounded-md bg-danger-soft px-3 py-2 text-sm text-ink"
            >
              <span className="font-semibold">
                {failure.gate}. {failure.code}
              </span>
              <span className="mt-0.5 block text-ink-muted">{failure.detail}</span>
            </li>
          ))}
        </ul>
      </div>
    ) : undefined;

  // A permission refusal is almost always the wrong identity rather than a
  // missing capability, so it says so and says what to do.
  const identityHint =
    actingAs === undefined ||
    !(problem.status === 403 || problem.code === 'FORBIDDEN') ? undefined : (
      <p className="text-sm text-ink-muted">{t('error.actingAs', { identity: actingAs })}</p>
    );

  const nextKey = NEXT_STEP[problem.code];
  const nextStep =
    nextKey === undefined ? undefined : (
      <p className="text-sm text-ink">
        <span className="font-semibold">{t('problem.nextLabel')}: </span>
        {t(nextKey)}
      </p>
    );

  const shared = {
    title,
    reason: problem.detail,
    code,
    ...(gates === undefined && identityHint === undefined && nextStep === undefined
      ? {}
      : {
          details: (
            <div className="flex flex-col gap-3">
              {nextStep}
              {identityHint}
              {gates}
            </div>
          ),
        }),
  };

  if (problem.status === 403 || REFUSAL_CODES.has(problem.code) || gates !== undefined) {
    return <RefusalState {...shared} />;
  }
  if (problem.status === 503 || UNAVAILABLE_CODES.has(problem.code)) {
    return (
      <ServiceUnavailableState
        title={title}
        reason={nextKey === undefined ? problem.detail : `${problem.detail} ${t(nextKey)}`}
      />
    );
  }
  return <ErrorState {...shared} />;
};
