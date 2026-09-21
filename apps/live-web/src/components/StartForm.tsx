'use client';

// The Start button.
//
// A client component only so a refusal can stay on screen: an attempt limit
// reached or a pool too small to build an attempt from is a designed outcome
// with a reason attached, and redirecting to an error page would lose it.
//
// On success the action redirects to the session, so there is no success state
// to render here.

import { useActionState } from 'react';
import { Button } from '@knowzy/shared-ui';
import { ArrowRight } from 'lucide-react';
import { t } from '../copy';
import { startSession } from '../app/actions';
import { Problem } from './Problem';

export const StartForm = ({ assessmentId, resume }: { assessmentId: string; resume: boolean }) => {
  // The permalink. The action redirects to the session on success, so this
  // only matters when it refuses.
  const [state, submit, pending] = useActionState(
    startSession,
    null,
    `/assessments/${assessmentId}`,
  );

  return (
    <div className="flex flex-col gap-3">
      <form action={submit}>
        <input type="hidden" name="assessmentId" value={assessmentId} />
        <Button
          tone="success"
          disabled={pending}
          {...(pending ? { disabledReason: t('start.working') } : {})}
        >
          {resume ? t('start.resume') : t('start.begin')}
          <ArrowRight aria-hidden="true" className="size-4" />
        </Button>
      </form>
      {state?.ok === false && state.problem !== undefined ? (
        <Problem problem={state.problem} />
      ) : null}
    </div>
  );
};
