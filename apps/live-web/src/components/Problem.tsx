// A problem+json response, rendered.
//
// A learner sees far fewer refusals than an author, but the ones they do see
// matter: an attempt limit reached, a session that belongs to somebody else, a
// pool too small to build an attempt from. §3.2 requires the SPECIFIC reason
// rather than a disabled button, so the detail is shown verbatim.

import { t } from '../copy';
import type { ApiProblem } from '../lib/api';

export const Problem = ({ problem }: { problem: ApiProblem }) => (
  <div className="panel problem" role="alert">
    <h3>{problem.title === '' ? t('error.heading') : problem.title}</h3>
    <p>{problem.detail}</p>
    <p className="muted">
      {t('error.code')}: <code>{problem.code}</code> · HTTP {problem.status}
    </p>
  </div>
);
