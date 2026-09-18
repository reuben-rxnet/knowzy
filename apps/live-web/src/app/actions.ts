'use server';

// Server actions for the learner portal.
//
// Three of these matter to the invariants:
//
//   * Every answer carries an Idempotency-Key. §4.5 makes the key the
//     duplicate-submission control, and the API REQUIRES it — a double-click
//     without one would write twice. The key is derived from the session, the
//     question index, and the chosen option, so a retry of the same answer
//     replays and a changed answer does not.
//   * Answers are written server-side, one at a time. Nothing is held in the
//     browser, which is what makes recovery work at all.
//   * Completion is a server call. The score is never computed here.
//
// Each result-returning action takes (previousState, formData) — the
// useActionState signature — because the result has to render next to the form
// that produced it. That means the quiz needs JavaScript; the identity switch,
// a bare server action, does not.

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { api, type ApiProblem } from '../lib/api';
import { SUBJECT_COOKIE, subjectByUpn } from '../lib/identity';

export interface ActionState {
  readonly ok: boolean;
  readonly problem?: ApiProblem;
  readonly data?: unknown;
}

const failed = (problem: ApiProblem): ActionState => ({ ok: false, problem });

export const switchLearner = async (formData: FormData): Promise<void> => {
  const subject = subjectByUpn(String(formData.get('subject') ?? ''));
  const store = await cookies();
  store.set(SUBJECT_COOKIE, subject.upn, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 12,
  });
  revalidatePath('/', 'layout');
};

/**
 * Starts a session, or resumes the one already open.
 *
 * The API decides which: an IN_PROGRESS session for the same assessment is
 * resumed rather than replaced (§4.4), so this action cannot create a second
 * attempt by accident. Either way it redirects to the session, which is the
 * one URL a learner can come back to.
 */
export const startSession = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const assessmentId = String(formData.get('assessmentId') ?? '');
  const result = await api<{ sessionId: string; resumed: boolean }>('/api/v1/learning/sessions', {
    method: 'POST',
    body: { assessmentId },
    // Per learner and assessment, not per click: a repeated start returns the
    // same session instead of opening another attempt.
    idempotencyKey: `live-web-start-${assessmentId}`,
  });
  if (!result.ok) return failed(result.problem);
  redirect(`/sessions/${result.data.sessionId}`);
};

export const answerQuestion = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const sessionId = String(formData.get('sessionId') ?? '');
  const questionIndex = Number(formData.get('questionIndex') ?? 0);
  const selectedOption = String(formData.get('selectedOption') ?? '');

  if (selectedOption === '') {
    return failed({
      status: 400,
      code: 'VALIDATION_FAILED',
      title: 'No answer selected',
      detail: 'Select an answer before continuing.',
    });
  }

  const result = await api<{ completed: boolean; savedIndex: number; replayed: boolean }>(
    `/api/v1/learning/sessions/${sessionId}/answers`,
    {
      method: 'POST',
      body: { questionIndex, selectedOption },
      // Deterministic: the same answer to the same question replays; a
      // different answer to it is a new write and revises the response.
      idempotencyKey: `live-web-${sessionId}-${questionIndex}-${selectedOption}`,
    },
  );
  revalidatePath(`/sessions/${sessionId}`);
  return result.ok ? { ok: true, data: result.data } : failed(result.problem);
};

export const completeSession = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const sessionId = String(formData.get('sessionId') ?? '');
  const result = await api<{ resultId: string }>(
    `/api/v1/learning/sessions/${sessionId}/complete`,
    { method: 'POST', idempotencyKey: `live-web-complete-${sessionId}-${randomUUID()}` },
  );
  if (!result.ok) return failed(result.problem);
  redirect(`/results/${result.data.resultId}`);
};
