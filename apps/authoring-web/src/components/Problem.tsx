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
import { t } from '../copy';
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
]);

const UNAVAILABLE_CODES = new Set(['MCP_UNAVAILABLE', 'SOURCE_UNAVAILABLE', 'UPSTREAM_TIMEOUT']);

export const Problem = ({ problem }: { problem: ApiProblem }) => {
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

  const shared = {
    title,
    reason: problem.detail,
    code,
    ...(gates === undefined ? {} : { details: gates }),
  };

  if (problem.status === 403 || REFUSAL_CODES.has(problem.code) || gates !== undefined) {
    return <RefusalState {...shared} />;
  }
  if (problem.status === 503 || UNAVAILABLE_CODES.has(problem.code)) {
    return <ServiceUnavailableState title={title} reason={problem.detail} />;
  }
  return <ErrorState {...shared} />;
};
