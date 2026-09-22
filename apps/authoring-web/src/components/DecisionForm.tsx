'use client';

// A single transition, with its refusal.
//
// Every one of these buttons can be refused for a reason the person needs to
// read: a gate that failed, a separation-of-duties conflict, a duplicate that
// has not been dispositioned. The server re-evaluates on every transition
// (§5.7), so the refusal arrives as a problem+json body with `gateFailures`
// attached — and this component's only job is to keep that on screen instead of
// swallowing it in a redirect.
//
// UI-M2 converted the markup. Same action, same refusal, same comment rules.
//
// It also takes a `blockedReason`. A decision the state machine cannot reach
// from here is disabled and SAYS WHY, because offering all five decisions on
// every question taught people to read a 409 as a missing permission. The
// server still re-evaluates every transition; this only stops the screen from
// inviting a press it already knows the answer to.

import { useActionState } from 'react';
import { Button, Field, Textarea, type ButtonTone } from '@knowzy/shared-ui';
import { CheckCircle2 } from 'lucide-react';
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
  tone = 'primary',
  blockedReason,
}: {
  questionId: string;
  action: Action;
  labelKey: CopyKey;
  /** Omitted when the transition takes no comment (claim, submit). */
  commentKey?: CopyKey;
  commentRequired?: boolean;
  tone?: ButtonTone;
  /**
   * Why this decision cannot be taken right now, ALREADY RESOLVED TO PROSE by
   * the caller. Undefined means it is available as far as the screen knows.
   */
  blockedReason?: string;
}) => {
  const [state, submit, pending] = useActionState(action, null, `/review/${questionId}`);

  const fieldId = `comment-${labelKey.replace(/\./g, '-')}`;
  const blocked = blockedReason !== undefined;

  return (
    <div className="flex flex-col gap-3 rounded-md border border-line p-4">
      <form action={submit} className="flex flex-col gap-3">
        <input type="hidden" name="questionId" value={questionId} />
        {commentKey === undefined || blocked ? null : (
          <Field
            id={fieldId}
            label={t(commentKey)}
            {...(commentRequired ? {} : { hint: t('form.optional') })}
          >
            <Textarea id={fieldId} name="comment" required={commentRequired} rows={3} />
          </Field>
        )}
        <div>
          <Button
            tone={tone}
            disabled={pending || blocked}
            {...(blocked
              ? { disabledReason: blockedReason }
              : pending
                ? { disabledReason: t('sources.working') }
                : {})}
          >
            {t(labelKey)}
          </Button>
        </div>
      </form>
      {state?.ok === false && state.problem !== undefined ? (
        <Problem problem={state.problem} />
      ) : null}
      {state?.ok === true ? (
        <p
          className="flex items-center gap-2 rounded-md bg-success-soft px-3 py-2 text-base font-semibold text-success"
          role="status"
        >
          <CheckCircle2 aria-hidden="true" className="size-4" />
          {t('ok.heading')}
        </p>
      ) : null}
    </div>
  );
};
