'use server';

// Server actions.
//
// Every mutation is a form POST handled here, in the server process: the form
// submits, the action calls the API as the selected subject, and the page
// re-renders. Plain forms and real buttons, so the portal is keyboard-operable
// (K1) by construction rather than by effort.
//
// These forms DO need JavaScript. The identity switch is a bare server action
// and submits without it; every other form goes through useActionState so the
// result — a failed gate, a per-item publish outcome, a preflight — stays on
// screen instead of being discarded by a navigation, and React does not
// progressively enhance those. A no-script authoring portal is not something
// this build claims.
//
// Actions return a serializable result rather than throwing. A refused
// approval, an insufficient pool, and a failed gate are all normal outcomes
// this UI has to render with their reasons attached.
//
// Every action that returns a result takes (previousState, formData) — the
// useActionState signature — and is passed to that hook DIRECTLY rather than
// through a client wrapper. That is what lets React emit the hidden action
// field for a no-JavaScript submit, so each form still works with scripting
// off; the hook only adds the rendered result on top. The previous state is
// unused: each submission is judged on its own, by the server.

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
  /**
   * True when a write REMOVED something rather than setting it — today, a
   * provider's limit override. The screen has to say which happened: "saved"
   * for an override that now applies and "cleared" for one that no longer
   * does are different outcomes, and a single "done" hides the difference.
   */
  readonly removed?: boolean;
}

const failed = (problem: ApiProblem): ActionState => ({ ok: false, problem });

// ---------------------------------------------------------------- identity

export const switchSubject = async (formData: FormData): Promise<void> => {
  const upn = String(formData.get('subject') ?? '');
  const subject = subjectByUpn(upn);
  const store = await cookies();
  // httpOnly: the browser cannot read it back, and no page script can forge a
  // different one. It is still only a demo affordance — see lib/identity.ts.
  store.set(SUBJECT_COOKIE, subject.upn, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 12,
  });
  revalidatePath('/', 'layout');
};

// ----------------------------------------------------------------- sources

export const testConnection = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const sourceId = String(formData.get('sourceId') ?? '');
  const result = await api<unknown>(`/api/v1/authoring/sources/${sourceId}/test-connection`, {
    method: 'POST',
  });
  revalidatePath('/sources');
  return result.ok ? { ok: true, data: result.data } : failed(result.problem);
};

export const synchronizeSource = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const sourceId = String(formData.get('sourceId') ?? '');
  const result = await api<unknown>(`/api/v1/authoring/sources/${sourceId}/synchronize`, {
    method: 'POST',
    body: { mode: 'FULL' },
  });
  revalidatePath('/sources');
  revalidatePath('/generate');
  return result.ok ? { ok: true, data: result.data } : failed(result.problem);
};

// -------------------------------------------------------------- generation

export const runPreflight = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const sourceId = String(formData.get('sourceId') ?? '');
  const documentIds = formData
    .getAll('documentIds')
    .map(String)
    .filter((id) => id.length > 0);

  if (documentIds.length === 0) {
    return failed({
      status: 422,
      code: 'GENERATION_SELECTION_REQUIRED',
      title: 'Selection required',
      detail:
        'Generation requires an explicit selection of one to ten documents. There is no "all documents" option.',
    });
  }

  const result = await api<unknown>('/api/v1/authoring/generation/preflight', {
    method: 'POST',
    body: { sourceId, documentIds },
  });
  return result.ok ? { ok: true, data: result.data } : failed(result.problem);
};

export const recordDecision = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const preflightId = String(formData.get('preflightId') ?? '');
  const chosenAction = String(formData.get('chosenAction') ?? '');
  const result = await api<unknown>(
    `/api/v1/authoring/generation/preflight/${preflightId}/decide`,
    { method: 'POST', body: { chosenAction } },
  );
  return result.ok ? { ok: true, data: result.data } : failed(result.problem);
};

export const runGeneration = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const result = await api<unknown>('/api/v1/authoring/generation-jobs', {
    method: 'POST',
    body: {
      preflightId: String(formData.get('preflightId') ?? ''),
      scope: String(formData.get('scope') ?? 'ENTIRE_DOCUMENT'),
      domainId: String(formData.get('domainId') ?? ''),
      topicId: String(formData.get('topicId') ?? ''),
      reasonCode: String(formData.get('reasonCode') ?? 'NEW_KNOWLEDGE'),
      requestedQuestionCount: Number(formData.get('requestedQuestionCount') ?? 5),
      providerId: String(formData.get('providerId') ?? 'DETERMINISTIC_LOCAL'),
      executionMode: String(formData.get('executionMode') ?? 'PLATFORM_MANAGED'),
    },
  });
  revalidatePath('/review');
  return result.ok ? { ok: true, data: result.data } : failed(result.problem);
};

// ------------------------------------------------------------------ review

const transition = async (
  questionId: string,
  path: string,
  body?: unknown,
): Promise<ActionState> => {
  const result = await api<unknown>(`/api/v1/authoring/questions/${questionId}/${path}`, {
    method: 'POST',
    ...(body === undefined ? {} : { body }),
  });
  revalidatePath('/review');
  revalidatePath(`/review/${questionId}`);
  revalidatePath('/publish');
  return result.ok ? { ok: true, data: result.data } : failed(result.problem);
};

export const claimQuestion = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => transition(String(formData.get('questionId') ?? ''), 'claim');

export const submitQuestion = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => transition(String(formData.get('questionId') ?? ''), 'submit');

export const approveQuestion = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const comment = String(formData.get('comment') ?? '').trim();
  return transition(
    String(formData.get('questionId') ?? ''),
    'approve',
    comment.length > 0 ? { comment } : {},
  );
};

export const requestChanges = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const comment = String(formData.get('comment') ?? '').trim();
  if (comment.length === 0) return commentRequired();
  return transition(String(formData.get('questionId') ?? ''), 'request-changes', { comment });
};

export const rejectQuestion = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const comment = String(formData.get('comment') ?? '').trim();
  if (comment.length === 0) return commentRequired();
  return transition(String(formData.get('questionId') ?? ''), 'reject', { comment });
};

/**
 * Refused client-side too.
 *
 * The API refuses it as well, and that refusal is the one that counts. This
 * exists so the author sees the requirement without a round trip, which is the
 * same reasoning as the advisory gate panel.
 */
const commentRequired = (): ActionState =>
  failed({
    status: 400,
    code: 'VALIDATION_FAILED',
    title: 'Comment required',
    detail:
      'A written comment is required for this decision. The person whose work it is has to be able to read why.',
  });

export const dispositionDuplicate = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const questionId = String(formData.get('questionId') ?? '');
  const result = await api<unknown>(
    `/api/v1/authoring/questions/${questionId}/duplicate-disposition`,
    {
      method: 'POST',
      body: {
        disposition: String(formData.get('disposition') ?? 'DISTINCT'),
        note: String(formData.get('note') ?? ''),
      },
    },
  );
  revalidatePath(`/review/${questionId}`);
  return result.ok ? { ok: true, data: result.data } : failed(result.problem);
};

export const editQuestion = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const questionId = String(formData.get('questionId') ?? '');
  const result = await api<unknown>(`/api/v1/authoring/questions/${questionId}`, {
    method: 'PATCH',
    body: { explanation: String(formData.get('explanation') ?? '') },
  });
  revalidatePath(`/review/${questionId}`);
  return result.ok ? { ok: true, data: result.data } : failed(result.problem);
};

// ----------------------------------------------------------------- publish

export const publishQuestions = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const questionIds = formData
    .getAll('questionIds')
    .map(String)
    .filter((id) => id.length > 0);
  if (questionIds.length === 0) {
    return failed({
      status: 400,
      code: 'VALIDATION_FAILED',
      title: 'Selection required',
      detail: 'Select at least one approved question to publish.',
    });
  }

  const result = await api<unknown>('/api/v1/authoring/question-bank/publish', {
    method: 'POST',
    body: { questionIds },
    // A fresh key per submission. A replayed batch returns the original result
    // rather than publishing twice (§4.2).
    idempotencyKey: `authoring-web-${randomUUID()}`,
  });
  revalidatePath('/publish');
  revalidatePath('/review');
  return result.ok ? { ok: true, data: result.data } : failed(result.problem);
};

export const retireQuestion = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const questionId = String(formData.get('questionId') ?? '');
  const comment = String(formData.get('comment') ?? '').trim();
  if (comment.length < 10) {
    return failed({
      status: 400,
      code: 'VALIDATION_FAILED',
      title: 'Comment required',
      detail:
        'Retirement requires a written reason of at least 10 characters. Someone will ask why this question left the bank.',
    });
  }
  const result = await api<unknown>(`/api/v1/authoring/questions/${questionId}/retire`, {
    method: 'POST',
    body: { comment },
  });
  revalidatePath('/publish');
  return result.ok ? { ok: true, data: result.data } : failed(result.problem);
};

// -------------------------------------------------------------- assessment

export const createAndPublishAssessment = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const name = String(formData.get('name') ?? '').trim();
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);

  const created = await api<{ assessmentVersionId: string }>('/api/v1/authoring/assessments', {
    method: 'POST',
    body: {
      name,
      slug: `${slug}-${Date.now().toString(36)}`,
      domainId: String(formData.get('domainId') ?? ''),
      topicIds: [String(formData.get('topicId') ?? '')],
      questionCount: Number(formData.get('questionCount') ?? 3),
      selectionStrategy: 'RANDOM_POOL',
      passPercentage: Number(formData.get('passPercentage') ?? 70),
      ...(Number(formData.get('timeLimitMinutes') ?? 0) > 0
        ? { timeLimitMinutes: Number(formData.get('timeLimitMinutes')) }
        : {}),
    },
  });
  if (!created.ok) return failed(created.problem);

  const versionId = created.data.assessmentVersionId;

  // Submit → approve → publish, in order. Each is its own audited transition,
  // and publication is what pins the eligibility snapshot — so a failure here
  // must surface rather than leave a half-made assessment looking ready.
  for (const step of ['submit', 'approve', 'publish'] as const) {
    const stepResult = await api<unknown>(`/api/v1/authoring/assessments/${versionId}/${step}`, {
      method: 'POST',
    });
    if (!stepResult.ok) {
      revalidatePath('/publish');
      return failed(stepResult.problem);
    }
    if (step === 'publish') {
      revalidatePath('/publish');
      return { ok: true, data: stepResult.data };
    }
  }

  revalidatePath('/publish');
  return { ok: true };
};

export const goToQuestion = async (formData: FormData): Promise<void> => {
  redirect(`/review/${String(formData.get('questionId') ?? '')}`);
};

// ------------------------------------------------------------------ import

/**
 * Preview or import, chosen by the submit button.
 *
 * One action rather than two because a form binds one action, and the two
 * calls take identical input. The INTENT decides which: `preview` writes
 * nothing, `import` creates drafts. Defaulting to preview is deliberate — a
 * missing intent must never import.
 */
export const importQuestions = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const intent = String(formData.get('intent') ?? 'preview');
  const body = {
    documentId: String(formData.get('documentId') ?? ''),
    domainId: String(formData.get('domainId') ?? ''),
    topicId: String(formData.get('topicId') ?? ''),
  };
  const path =
    intent === 'import'
      ? '/api/v1/authoring/question-import'
      : '/api/v1/authoring/question-import/preview';
  const result = await api<unknown>(path, { method: 'POST', body });
  if (intent === 'import') revalidatePath('/review');
  return result.ok
    ? { ok: true, data: { ...(result.data as object), intent } }
    : failed(result.problem);
};

// ---------------------------------------------------------------- taxonomy

/**
 * Domains and topics.
 *
 * A checkbox is absent from the form data when it is unchecked, so `isActive`
 * is read as "the field is present" rather than compared to a string. A form
 * that posts no checkbox and a form that posts `false` mean the same thing
 * here, and both mean deactivated.
 */
const checked = (formData: FormData, field: string): boolean => formData.get(field) !== null;

export const createDomainAction = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const result = await api<unknown>('/api/v1/authoring/taxonomy/domains', {
    method: 'POST',
    body: {
      code: String(formData.get('code') ?? ''),
      name: String(formData.get('name') ?? ''),
      description: String(formData.get('description') ?? ''),
      requireSmeSignoff: checked(formData, 'requireSmeSignoff'),
      isActive: checked(formData, 'isActive'),
    },
  });
  revalidatePath('/administration/taxonomy');
  return result.ok ? { ok: true, data: result.data } : failed(result.problem);
};

export const updateDomainAction = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const domainId = String(formData.get('domainId') ?? '');
  // The code is sent ONLY when the form offered it, which it does only while
  // nothing references the domain. Sending an unchanged code would be
  // harmless, but sending one the screen did not show would not be.
  const code = formData.get('code');
  const result = await api<unknown>(`/api/v1/authoring/taxonomy/domains/${domainId}`, {
    method: 'PATCH',
    body: {
      name: String(formData.get('name') ?? ''),
      description: String(formData.get('description') ?? ''),
      requireSmeSignoff: checked(formData, 'requireSmeSignoff'),
      isActive: checked(formData, 'isActive'),
      ...(code === null ? {} : { code: String(code) }),
    },
  });
  revalidatePath('/administration/taxonomy');
  return result.ok ? { ok: true, data: result.data } : failed(result.problem);
};

export const setDomainActiveAction = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const domainId = String(formData.get('domainId') ?? '');
  const result = await api<unknown>(`/api/v1/authoring/taxonomy/domains/${domainId}`, {
    method: 'PATCH',
    body: { isActive: String(formData.get('isActive') ?? 'false') === 'true' },
  });
  revalidatePath('/administration/taxonomy');
  return result.ok ? { ok: true, data: result.data } : failed(result.problem);
};

export const createTopicAction = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const result = await api<unknown>('/api/v1/authoring/taxonomy/topics', {
    method: 'POST',
    body: {
      domainId: String(formData.get('domainId') ?? ''),
      name: String(formData.get('name') ?? ''),
      description: String(formData.get('description') ?? ''),
      isActive: checked(formData, 'isActive'),
    },
  });
  revalidatePath('/administration/taxonomy');
  return result.ok ? { ok: true, data: result.data } : failed(result.problem);
};

export const updateTopicAction = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const topicId = String(formData.get('topicId') ?? '');
  const result = await api<unknown>(`/api/v1/authoring/taxonomy/topics/${topicId}`, {
    method: 'PATCH',
    body: {
      name: String(formData.get('name') ?? ''),
      description: String(formData.get('description') ?? ''),
      isActive: checked(formData, 'isActive'),
    },
  });
  revalidatePath('/administration/taxonomy');
  return result.ok ? { ok: true, data: result.data } : failed(result.problem);
};

export const setTopicActiveAction = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const topicId = String(formData.get('topicId') ?? '');
  const result = await api<unknown>(`/api/v1/authoring/taxonomy/topics/${topicId}`, {
    method: 'PATCH',
    body: { isActive: String(formData.get('isActive') ?? 'false') === 'true' },
  });
  revalidatePath('/administration/taxonomy');
  return result.ok ? { ok: true, data: result.data } : failed(result.problem);
};

// ------------------------------- Governance -> AI Usage & Budgets (2026-09-24)

/**
 * Sets, or clears, a provider's token ceilings.
 *
 * An EMPTY field is omitted rather than sent as 0. That distinction is the
 * whole interface: omitting a field leaves the platform ceiling in place, and
 * sending 0 forbids generation for that provider. A form that coerced blanks to
 * zero would silently switch a provider off.
 */
export const setProviderLimitsAction = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const providerId = String(formData.get('providerId') ?? '');
  const numeric = (field: string): Record<string, number> => {
    const raw = String(formData.get(field) ?? '').trim();
    if (raw.length === 0) return {};
    const value = Number(raw);
    return Number.isFinite(value) ? { [field]: value } : {};
  };

  const body = {
    ...numeric('perJobTokenBudget'),
    ...numeric('dailyTokenBudget'),
    ...numeric('weeklyTokenBudget'),
    ...numeric('monthlyTokenBudget'),
    ...numeric('concurrency'),
  };

  const result = await api<{ removed: boolean }>(
    `/api/v1/authoring/governance/ai-usage/providers/${providerId}/limits`,
    { method: 'PUT', body },
  );
  revalidatePath('/governance/ai-usage');
  return result.ok
    ? { ok: true, data: result.data, removed: result.data.removed }
    : failed(result.problem);
};
