'use client';

// The two forms on the question page that carry more than a comment.
//
// A duplicate disposition and an explanation edit both write a field and both
// can be refused, so they follow the same pattern as DecisionForm: the action
// runs on the server, the result stays on screen.

import { useActionState } from 'react';
import { t } from '../copy';
import { dispositionDuplicate, editQuestion } from '../app/actions';
import { Problem } from './Problem';

export const DispositionForm = ({ questionId }: { questionId: string }) => {
  const [state, submit, pending] = useActionState(
    dispositionDuplicate,
    null,
    `/review/${questionId}`,
  );

  return (
    <>
      <p className="lede">{t('question.dispositionIntro')}</p>
      <form action={submit}>
        <input type="hidden" name="questionId" value={questionId} />
        <label htmlFor="disposition">{t('question.dispositionLabel')}</label>
        <select id="disposition" name="disposition" defaultValue="DISTINCT">
          <option value="DISTINCT">{t('question.dispositionDistinct')}</option>
          <option value="DUPLICATE">{t('question.dispositionDuplicate')}</option>
        </select>
        <label htmlFor="disposition-note">{t('question.dispositionNoteLabel')}</label>
        <textarea id="disposition-note" name="note" required />
        <button type="submit" disabled={pending}>
          {t('question.dispositionSubmit')}
        </button>
      </form>
      {state?.ok === false && state.problem !== undefined ? (
        <Problem problem={state.problem} />
      ) : null}
      {state?.ok === true ? (
        <p className="pass" role="status">
          {t('ok.heading')}
        </p>
      ) : null}
    </>
  );
};

export const EditExplanationForm = ({
  questionId,
  explanation,
}: {
  questionId: string;
  explanation: string;
}) => {
  const [state, submit, pending] = useActionState(editQuestion, null, `/review/${questionId}`);

  return (
    <>
      <p className="lede">{t('question.editIntro')}</p>
      <form action={submit}>
        <input type="hidden" name="questionId" value={questionId} />
        <label htmlFor="explanation">{t('question.editExplanationLabel')}</label>
        <textarea id="explanation" name="explanation" defaultValue={explanation} required />
        <button type="submit" disabled={pending}>
          {t('question.editSubmit')}
        </button>
      </form>
      {state?.ok === false && state.problem !== undefined ? (
        <Problem problem={state.problem} />
      ) : null}
      {state?.ok === true ? (
        <p className="pass" role="status">
          {t('ok.heading')}
        </p>
      ) : null}
    </>
  );
};
