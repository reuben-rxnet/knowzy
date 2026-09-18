'use client';

// Retire a published question.
//
// Separate from DecisionForm because retirement takes a comment of at least ten
// characters — the CHECK constraint on `published_question_reference` enforces
// the same floor, so a shorter one is refused by the database as well as by the
// route. Someone will eventually ask why a question left the bank.

import { useActionState } from 'react';
import { t } from '../copy';
import { retireQuestion } from '../app/actions';
import { Problem } from './Problem';

export const RetireForm = ({ questionId }: { questionId: string }) => {
  const [state, submit, pending] = useActionState(retireQuestion, null, '/publish');

  const fieldId = `retire-${questionId}`;

  return (
    <>
      <form action={submit}>
        <input type="hidden" name="questionId" value={questionId} />
        <label htmlFor={fieldId} className="hint">
          {t('publish.retireCommentLabel')}
        </label>
        <textarea id={fieldId} name="comment" required minLength={10} />
        <button type="submit" className="danger" disabled={pending}>
          {t('publish.retire')}
        </button>
      </form>
      {state?.ok === false && state.problem !== undefined ? (
        <Problem problem={state.problem} />
      ) : null}
    </>
  );
};
