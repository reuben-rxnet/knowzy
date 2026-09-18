// A problem+json response, rendered.
//
// Every refusal in this system carries a code, a human-readable detail, and
// sometimes a list of failed gates. ux-design.md §9.1 requires the reason to be
// shown rather than a generic failure, so this component exists once and every
// surface uses it — an approval blocked by gate 7 reads as gate 7, not as
// "something went wrong".

import { t } from '../copy';
import type { ApiProblem } from '../lib/api';

export const Problem = ({ problem }: { problem: ApiProblem }) => (
  <div className="panel problem" role="alert">
    <h3>{problem.title === '' ? t('error.heading') : problem.title}</h3>
    <p>{problem.detail}</p>
    <p className="muted">
      {t('error.code')}: <code>{problem.code}</code> · HTTP {problem.status}
    </p>
    {problem.gateFailures !== undefined && problem.gateFailures.length > 0 ? (
      <>
        <h4>{t('error.gateFailures')}</h4>
        <ul>
          {problem.gateFailures.map((failure) => (
            <li key={`${failure.gate}-${failure.code}`}>
              <strong>
                {failure.gate}. {failure.code}
              </strong>{' '}
              — {failure.detail}
            </li>
          ))}
        </ul>
      </>
    ) : null}
  </div>
);
