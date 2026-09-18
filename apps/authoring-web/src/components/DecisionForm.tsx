'use client';

// A single transition, with its refusal.
//
// Every one of these buttons can be refused for a reason the person needs to
// read: a gate that failed, a separation-of-duties conflict, a duplicate that
// has not been dispositioned. The server re-evaluates on every transition
// (§5.7), so the refusal arrives as a problem+json body with `gateFailures`
// attached — and this component's only job is to keep that on screen instead of
// swallowing it in a redirect.

import { useActionState } from 'react';
import { t, type CopyKey } from '../copy';
import type { ActionState } from '../app/actions';
import { Problem } from './Problem';

type Action = (previous: ActionState | null, formData: FormData) => Promise<ActionState>;

export const DecisionForm = ({
  questionId,
  action,
  labelKey,
  commentKey,
  commentRequired = false,
  variant,
}: {
  questionId: string;
  action: Action;
  labelKey: CopyKey;
  /** Omitted when the transition takes no comment (claim, submit). */
  commentKey?: CopyKey;
  commentRequired?: boolean;
  variant?: 'secondary' | 'danger';
}) => {
  const [state, submit, pending] = useActionState(action, null, `/review/${questionId}`);

  const fieldId = `comment-${labelKey.replace(/\./g, '-')}`;

  return (
    <div>
      <form action={submit}>
        <input type="hidden" name="questionId" value={questionId} />
        {commentKey === undefined ? null : (
          <>
            <label htmlFor={fieldId}>
              {t(commentKey)}{' '}
              {commentRequired ? null : <span className="hint">({t('form.optional')})</span>}
            </label>
            <textarea id={fieldId} name="comment" required={commentRequired} />
          </>
        )}
        <button
          type="submit"
          disabled={pending}
          {...(variant === undefined ? {} : { className: variant })}
        >
          {t(labelKey)}
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
    </div>
  );
};
