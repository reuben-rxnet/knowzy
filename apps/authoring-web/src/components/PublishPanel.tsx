'use client';

// Publish a batch of approved questions, and show what happened to each one.
//
// The batch result is per-item on purpose (§4.2): one question can publish
// while another is refused by a gate, and a single "published" message would
// hide that. A dry run is also an outcome, not a failure — it means the bank
// adapter is not writable in this environment and says so.

import { useActionState } from 'react';
import { t } from '../copy';
import { publishQuestions } from '../app/actions';
import { Problem } from './Problem';

export interface ApprovedQuestion {
  readonly questionId: string;
  readonly questionText: string;
  readonly topic: string;
  readonly version: number;
}

interface ItemOutcome {
  readonly questionId: string;
  readonly outcome: string;
  readonly bankItemId: string | null;
  readonly publishedVersion: number | null;
  readonly detail: string;
  readonly gateFailures?: readonly { code: string; detail: string }[];
}

interface BatchResult {
  readonly batchId: string;
  readonly dryRun: boolean;
  readonly items: readonly ItemOutcome[];
  readonly publishedCount: number;
  readonly failedCount: number;
  readonly target?: { readonly writesEnabled?: boolean; readonly dryRunReason?: string | null };
}

const outcomeClass = (outcome: string): string =>
  outcome === 'PUBLISHED' || outcome === 'UPDATED' || outcome === 'ALREADY_PUBLISHED'
    ? 'pass'
    : outcome === 'DRY_RUN'
      ? 'warn'
      : 'fail';

export const PublishPanel = ({ approved }: { approved: readonly ApprovedQuestion[] }) => {
  const [state, submit, pending] = useActionState(publishQuestions, null, '/publish');

  const batch = state?.ok === true ? (state.data as BatchResult) : null;
  const byId = new Map(approved.map((question) => [question.questionId, question]));

  return (
    <>
      {approved.length === 0 ? (
        <p>{t('publish.noApproved')}</p>
      ) : (
        <form action={submit}>
          <fieldset>
            <legend>{t('publish.approvedCaption')}</legend>
            {approved.map((question) => (
              <label key={question.questionId} style={{ fontWeight: 400 }}>
                <input
                  type="checkbox"
                  name="questionIds"
                  value={question.questionId}
                  defaultChecked
                />{' '}
                {question.questionText}{' '}
                <span className="muted">
                  {question.topic} · v{question.version}
                </span>
              </label>
            ))}
            <button type="submit" disabled={pending}>
              {t('publish.publishSelected')}
            </button>
          </fieldset>
        </form>
      )}

      {state?.ok === false && state.problem !== undefined ? (
        <Problem problem={state.problem} />
      ) : null}

      {batch === null ? null : (
        <div className="panel okpanel">
          <h3>{t('publish.resultHeading')}</h3>
          {batch.dryRun ? (
            <p className="warn">
              {t('publish.dryRun')}
              {batch.target?.dryRunReason === null || batch.target?.dryRunReason === undefined
                ? null
                : ` — ${batch.target.dryRunReason}`}
            </p>
          ) : null}
          <table>
            <thead>
              <tr>
                <th scope="col">{t('publish.question')}</th>
                <th scope="col">{t('publish.outcome')}</th>
                <th scope="col">{t('publish.bankItem')}</th>
                <th scope="col">{t('publish.detail')}</th>
              </tr>
            </thead>
            <tbody>
              {batch.items.map((item) => (
                <tr key={item.questionId}>
                  <th scope="row">{byId.get(item.questionId)?.questionText ?? item.questionId}</th>
                  <td className={outcomeClass(item.outcome)}>{item.outcome}</td>
                  <td className="mono">
                    {item.bankItemId ?? '—'}
                    {item.publishedVersion === null ? null : ` · v${item.publishedVersion}`}
                  </td>
                  <td>
                    {item.detail}
                    {item.gateFailures === undefined || item.gateFailures.length === 0 ? null : (
                      <ul>
                        {item.gateFailures.map((failure) => (
                          <li key={failure.code}>
                            <strong>{failure.code}</strong> — {failure.detail}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
};
