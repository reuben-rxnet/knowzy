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
    <>
      <form action={submit}>
        <input type="hidden" name="assessmentId" value={assessmentId} />
        <button type="submit" disabled={pending}>
          {resume ? t('start.resume') : t('start.begin')}
        </button>
      </form>
      {state?.ok === false && state.problem !== undefined ? (
        <Problem problem={state.problem} />
      ) : null}
    </>
  );
};
