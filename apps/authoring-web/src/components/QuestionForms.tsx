'use client';

// The two forms on the question page that carry more than a comment.
//
// A duplicate disposition and an explanation edit both write a field and both
// can be refused, so they follow the same pattern as DecisionForm: the action
// runs on the server, the result stays on screen.
//
// UI-M2 converted the markup only. Note what is still absent: there is no form
// here for the question stem, the options, or the proposed answer. §5.4 allows
// an author to edit a draft's explanation; editing the answer key on an
// approval surface is a different thing entirely, and K2 is why it is not here.

import { useActionState } from 'react';
import { Button, Field, Select, Textarea } from '@knowzy/shared-ui';
import { CheckCircle2 } from 'lucide-react';
import { t } from '../copy';
import { dispositionDuplicate, editQuestion } from '../app/actions';
import { Problem } from './Problem';

const Saved = () => (
  <p
    className="flex items-center gap-2 rounded-md bg-success-soft px-3 py-2 text-base font-semibold text-success"
    role="status"
  >
    <CheckCircle2 aria-hidden="true" className="size-4" />
    {t('ok.heading')}
  </p>
);

export const DispositionForm = ({ questionId }: { questionId: string }) => {
  const [state, submit, pending] = useActionState(
    dispositionDuplicate,
    null,
    `/review/${questionId}`,
  );

  return (
    <div className="flex flex-col gap-3">
      <p className="text-base text-ink-muted">{t('question.dispositionIntro')}</p>
      <form action={submit} className="flex max-w-xl flex-col gap-3">
        <input type="hidden" name="questionId" value={questionId} />
        <Field id="disposition" label={t('question.dispositionLabel')}>
          <Select id="disposition" name="disposition" defaultValue="DISTINCT">
            <option value="DISTINCT">{t('question.dispositionDistinct')}</option>
            <option value="DUPLICATE">{t('question.dispositionDuplicate')}</option>
          </Select>
        </Field>
        <Field id="disposition-note" label={t('question.dispositionNoteLabel')}>
          <Textarea id="disposition-note" name="note" required rows={3} />
        </Field>
        <div>
          <Button disabled={pending} {...(pending ? { disabledReason: t('sources.working') } : {})}>
            {t('question.dispositionSubmit')}
          </Button>
        </div>
      </form>
      {state?.ok === false && state.problem !== undefined ? (
        <Problem problem={state.problem} />
      ) : null}
      {state?.ok === true ? <Saved /> : null}
    </div>
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
    <div className="flex flex-col gap-3">
      <p className="text-base text-ink-muted">{t('question.editIntro')}</p>
      <form action={submit} className="flex flex-col gap-3">
        <input type="hidden" name="questionId" value={questionId} />
        <Field id="explanation" label={t('question.editExplanationLabel')}>
          <Textarea
            id="explanation"
            name="explanation"
            defaultValue={explanation}
            required
            rows={4}
          />
        </Field>
        <div>
          <Button
            tone="secondary"
            disabled={pending}
            {...(pending ? { disabledReason: t('sources.working') } : {})}
          >
            {t('question.editSubmit')}
          </Button>
        </div>
      </form>
      {state?.ok === false && state.problem !== undefined ? (
        <Problem problem={state.problem} />
      ) : null}
      {state?.ok === true ? <Saved /> : null}
    </div>
  );
};
