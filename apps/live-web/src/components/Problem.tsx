// A problem+json response, rendered.
//
// A learner sees far fewer refusals than an author, but the ones they do see
// matter: an attempt limit reached, a session that belongs to somebody else, a
// pool too small to build an attempt from. §3.2 requires the SPECIFIC reason
// rather than a disabled button, so the detail is shown verbatim.
//
// UI-M3 moved it onto the shared states, which fixed a real defect: this still
// depended on `legacy.css` class names, and the learner pages left that
// stylesheet behind in UI-M2b. A refused home page therefore rendered its
// refusal as three lines of loose unstyled text — the reason was all there,
// and it looked like a broken page.
//
// The three states say different things, and for a learner the distinction is
// the whole message:
//
//   refusal      the platform understood and declined — no portal access, an
//                attempt limit reached, an assessment outside its window.
//                Nothing is broken and retrying will not help.
//   unavailable  a dependency could not be reached. Retrying may work.
//   error        anything else.

import { ErrorState, RefusalState, ServiceUnavailableState } from '@knowzy/shared-ui';
import { t } from '../copy';
import type { ApiProblem } from '../lib/api';

/** Refusals: the server understood the request and declined it. */
const REFUSAL_CODES = new Set([
  'FORBIDDEN',
  'PORTAL_ACCESS_DENIED',
  'ELIGIBILITY_REFUSED',
  'ATTEMPT_LIMIT_REACHED',
  'ASSESSMENT_NOT_AVAILABLE',
  'POOL_TOO_SMALL',
  'SESSION_NOT_YOURS',
  'SESSION_EXPIRED',
]);

const UNAVAILABLE_CODES = new Set(['MCP_UNAVAILABLE', 'UPSTREAM_TIMEOUT']);

export const Problem = ({ problem }: { problem: ApiProblem }) => {
  const title = problem.title === '' ? t('error.heading') : problem.title;
  // The code stays visible. It is what makes a refusal reportable — the same
  // token appears in the API and in the audit row.
  const code = `${problem.code} · HTTP ${problem.status}`;

  if (problem.status === 403 || REFUSAL_CODES.has(problem.code)) {
    return <RefusalState title={title} reason={problem.detail} code={code} />;
  }
  if (problem.status === 503 || UNAVAILABLE_CODES.has(problem.code)) {
    return <ServiceUnavailableState title={title} reason={problem.detail} />;
  }
  return <ErrorState title={title} reason={problem.detail} code={code} />;
};
