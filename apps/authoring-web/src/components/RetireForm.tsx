'use client';

// Retire a published question.
//
// Separate from DecisionForm because retirement takes a comment of at least ten
// characters — the CHECK constraint on `published_question_reference` enforces
// the same floor, so a shorter one is refused by the database as well as by the
// route. Someone will eventually ask why a question left the bank.
//
// UI-M2 put it in a modal. In a table cell the textarea and its button made
// every row three lines tall, and §30 asks for confirmation in a dialog. The
// modal is the shared one, so Escape, the focus trap, and focus restoration
// come with it — which matters more here than elsewhere: this is the one
// destructive-looking action on the page, and it must be cancellable.

import { useState } from 'react';
import { useActionState } from 'react';
import { Button, Field, Modal, Textarea } from '@knowzy/shared-ui';
import { t } from '../copy';
import { retireQuestion } from '../app/actions';
import { Problem } from './Problem';

export const RetireForm = ({
  questionId,
  questionText,
}: {
  questionId: string;
  questionText: string;
}) => {
  const [state, submit, pending] = useActionState(retireQuestion, null, '/publish');
  const [open, setOpen] = useState(false);

  const fieldId = `retire-${questionId}`;

  return (
    <>
      <Button tone="danger" size="sm" type="button" onClick={() => setOpen(true)}>
        {t('publish.retire')}
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('publish.retire')}
        description={questionText}
        tone="danger"
      >
        <form action={submit} className="flex flex-col gap-4">
          <input type="hidden" name="questionId" value={questionId} />
          {/* Retirement, never deletion: G7 gives the bank adapter no delete
              method at all. The question stays readable, with its evidence and
              its history, and stops being served. */}
          <p className="text-base text-ink">{t('publish.retireExplanation')}</p>
          <Field
            id={fieldId}
            label={t('publish.retireCommentLabel')}
            hint={t('publish.retireHint')}
          >
            <Textarea id={fieldId} name="comment" required rows={3} />
          </Field>
          <div className="flex gap-3">
            <Button
              tone="danger"
              disabled={pending}
              {...(pending ? { disabledReason: t('sources.working') } : {})}
            >
              {t('publish.retire')}
            </Button>
            <Button tone="secondary" type="button" onClick={() => setOpen(false)}>
              {t('form.cancel')}
            </Button>
          </div>
        </form>
        {state?.ok === false && state.problem !== undefined ? (
          <div className="mt-4">
            <Problem problem={state.problem} />
          </div>
        ) : null}
      </Modal>
    </>
  );
};
