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
      // Omitted entirely when unspecified rather than sent as an empty string:
      // "" is not an id, and the server would have to guess what it meant.
      ...(String(formData.get('departmentId') ?? '').length === 0
        ? {}
        : { departmentId: String(formData.get('departmentId')) }),
      ...(String(formData.get('jobRoleId') ?? '').length === 0
        ? {}
        : { jobRoleId: String(formData.get('jobRoleId')) }),
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

/**
 * Re-files a question under a department and role.
 *
 * An empty select sends `null`, which CLEARS the axis. That is not the same as
 * omitting the field, which would mean "leave it alone" -- and the form always
 * submits both, because it always shows both.
 */
export const setQuestionFilingAction = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const questionId = String(formData.get('questionId') ?? '');
  const value = (field: string): string | null => {
    const raw = String(formData.get(field) ?? '');
    return raw.length === 0 ? null : raw;
  };
  const result = await api<unknown>(`/api/v1/authoring/questions/${questionId}/filing`, {
    method: 'PUT',
    body: { departmentId: value('departmentId'), jobRoleId: value('jobRoleId') },
  });
  revalidatePath('/review');
  revalidatePath(`/review/${questionId}`);
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
    // Batch-level, and omitted when unspecified for the same reason the
    // generation action omits them: "" is not an id.
    ...(String(formData.get('departmentId') ?? '').length === 0
      ? {}
      : { departmentId: String(formData.get('departmentId')) }),
    ...(String(formData.get('jobRoleId') ?? '').length === 0
      ? {}
      : { jobRoleId: String(formData.get('jobRoleId')) }),
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

// --------------------------- Administration -> AI Providers (2026-09-26)

/**
 * Sets a provider's settings.
 *
 * Empty fields are OMITTED, never sent as empty strings. Omitting every field
 * removes the provider's entry and returns it to its declared defaults --
 * which is a different act from `enabled: false`, an administrator saying
 * "off". The API refuses an empty string for a url or a model anyway; sending
 * one would turn a blank box into a validation error the person did not cause.
 *
 * `apiKeyRef` is a REFERENCE -- localstore:// or keyvault://. The server
 * validates it as one, so a key pasted into that box is refused rather than
 * stored. An EMPTY box keeps the recorded reference (P-5); removing it is the
 * separate `removeApiKeyRef` checkbox, sent beside the settings.
 */
/**
 * `name: value`, one per line, into the settings' `extraHeaders`.
 *
 * Parsing only. Every rule -- printable, no protocol or credential-shaped
 * name, no duplicate, a small maximum -- is the server's, so a line this does
 * not understand is passed through for the server to refuse by name rather
 * than silently dropped.
 */
const extraHeadersOf = (raw: string): { extraHeaders?: Record<string, string> } => {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return {};
  const headers: Record<string, string> = {};
  for (const line of lines) {
    const colon = line.indexOf(':');
    const name = (colon < 0 ? line : line.slice(0, colon)).trim();
    const value = colon < 0 ? '' : line.slice(colon + 1).trim();
    headers[name in headers ? `${name} ` : name] = value;
  }
  return { extraHeaders: headers };
};

export const setProviderSettingsAction = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const providerId = String(formData.get('providerId') ?? '');
  const text = (field: string): Record<string, string> => {
    const raw = String(formData.get(field) ?? '').trim();
    return raw.length === 0 ? {} : { [field]: raw };
  };
  const numeric = (field: string): Record<string, number> => {
    const raw = String(formData.get(field) ?? '').trim();
    if (raw.length === 0) return {};
    const value = Number(raw);
    return Number.isFinite(value) ? { [field]: value } : {};
  };

  const body = {
    // A checkbox is ABSENT when unchecked, so "off" is the absence of the
    // field rather than a value -- and it must still be SENT as false, or
    // unchecking the box would read as "leave it as it was".
    enabled: formData.get('enabled') !== null,
    ...text('displayName'),
    ...text('baseUrl'),
    ...text('modelId'),
    ...text('apiKeyRef'),
    ...numeric('temperature'),
    ...numeric('maxOutputTokens'),
    ...text('apiStyle'),
    ...text('authHeaderName'),
    // GATEWAY-M1. HEADER is the default and is not sent, so a provider that
    // never chose a location keeps no setting for it.
    ...(String(formData.get('authLocation') ?? '') === 'QUERY_PARAMETER'
      ? { authLocation: 'QUERY_PARAMETER' }
      : {}),
    ...text('authQueryParameterName'),
    ...extraHeadersOf(String(formData.get('extraHeaders') ?? '')),
    ...(formData.get('removeApiKeyRef') === null ? {} : { removeApiKeyRef: true }),
  };

  const result = await api<unknown>(
    `/api/v1/authoring/administration/providers/${providerId}/settings`,
    { method: 'PUT', body },
  );
  revalidatePath('/administration/providers');
  revalidatePath('/governance/ai-usage');
  return result.ok ? { ok: true, data: result.data } : failed(result.problem);
};

/**
 * Records or withdraws a data-processing approval.
 *
 * Separate from the settings form on purpose. `BLOCKED_BY_APPROVAL` is what
 * makes T-29 a control rather than a promise, and an approval that was a
 * checkbox beside "enabled" would be one nobody stopped at. Granting requires
 * a reference to where the approval is held; withdrawing does not, because
 * withdrawal must never be the harder action.
 */
export const setProviderApprovalAction = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const providerId = String(formData.get('providerId') ?? '');
  const approved = String(formData.get('approved') ?? '') === 'true';
  const reference = String(formData.get('approvalReference') ?? '').trim();
  const result = await api<unknown>(
    `/api/v1/authoring/administration/providers/${providerId}/approval`,
    {
      method: 'PUT',
      body: { approved, ...(reference.length === 0 ? {} : { approvalReference: reference }) },
    },
  );
  revalidatePath('/administration/providers');
  revalidatePath('/governance/ai-usage');
  return result.ok ? { ok: true, data: result.data } : failed(result.problem);
};

/** Switches the provider generation uses. Refused unless it is AVAILABLE. */
/**
 * GEN-PROVIDER-M1: enable a provider and make it the active one, in one step.
 *
 * Two ordinary, audited writes -- the settings write with `enabled: true`,
 * then the active-provider write -- each refused by the server with its own
 * reason if the gate would refuse it. The settings are re-sent as recorded
 * (the settings write replaces the whole entry), read back from the same
 * administration read the page shows, so nothing else changes.
 */
export const enableAndActivateProviderAction = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const providerId = String(formData.get('providerId') ?? '');
  const read = await api<{ providers: readonly Record<string, unknown>[] }>(
    '/api/v1/authoring/administration/providers',
  );
  if (!read.ok) return failed(read.problem);
  const row = read.data.providers.find((entry) => entry['providerId'] === providerId);
  if (row === undefined) {
    return failed({
      status: 404,
      code: 'NOT_FOUND',
      title: 'Not a declared provider',
      detail: `${providerId} is not a declared provider.`,
    });
  }

  const settings: Record<string, unknown> = { enabled: true };
  const copy = (from: string, to = from) => {
    const value = row[from];
    if (value !== null && value !== undefined) settings[to] = value;
  };
  copy('displayName');
  copy('baseUrl');
  copy('modelId');
  copy('temperature');
  copy('maxOutputTokens');
  copy('apiStyle');
  if (row['authLocation'] === 'QUERY_PARAMETER') {
    settings['authLocation'] = 'QUERY_PARAMETER';
    copy('authQueryParameterName');
  } else {
    copy('authHeaderName');
  }
  const headers = row['extraHeaders'] as Record<string, string> | undefined;
  if (headers !== undefined && Object.keys(headers).length > 0) settings['extraHeaders'] = headers;
  // The credential reference is NOT re-sent: an absent reference keeps the
  // recorded one (P-5), so this write never touches it.

  const enabled = await api<unknown>(
    `/api/v1/authoring/administration/providers/${providerId}/settings`,
    { method: 'PUT', body: settings },
  );
  if (!enabled.ok) return failed(enabled.problem);

  const active = await api<unknown>('/api/v1/authoring/administration/active-provider', {
    method: 'PUT',
    body: { providerId },
  });
  revalidatePath('/administration/providers');
  revalidatePath('/governance/ai-usage');
  revalidatePath('/generate');
  return active.ok ? { ok: true, data: active.data } : failed(active.problem);
};

export const setActiveProviderAction = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const result = await api<unknown>('/api/v1/authoring/administration/active-provider', {
    method: 'PUT',
    body: { providerId: String(formData.get('providerId') ?? '') },
  });
  revalidatePath('/administration/providers');
  revalidatePath('/governance/ai-usage');
  revalidatePath('/generate');
  return result.ok ? { ok: true, data: result.data } : failed(result.problem);
};

/**
 * Records a readiness validation.
 *
 * Test connection. Since P-5 and OPENAI-CODEX-00 it resolves the secret and,
 * for OpenAI, makes two metadata requests; the response is the chain with
 * each check PASSED, FAILED or NOT_ATTEMPTED and what it observed, plus the
 * readiness it produced. It never carries a key: the API builds it from
 * steps that hold none and refuses to send one that does.
 */
export const validateProviderAction = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const providerId = String(formData.get('providerId') ?? '');
  const result = await api<unknown>(
    `/api/v1/authoring/administration/providers/${providerId}/validate`,
    { method: 'POST' },
  );
  revalidatePath('/administration/providers');
  revalidatePath('/governance/ai-usage');
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

// --------------------------------------- Governance -> Audit Explorer (2026-09-26)

/** One event with its correlated trace, fetched when the drawer opens. */
export const auditDetailAction = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const eventId = String(formData.get('eventId') ?? '');
  const result = await api<unknown>(`/api/v1/authoring/governance/audit/${eventId}`);
  return result.ok ? { ok: true, data: result.data } : failed(result.problem);
};

/**
 * The filtered set as CSV.
 *
 * The filters travel as the SCREEN'S OWN query string, so the export is exactly
 * what the reader is looking at. Sending the filters again by hand is how an
 * export quietly stops matching the view above it.
 */
export const auditExportAction = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const query = String(formData.get('query') ?? '');
  const body = Object.fromEntries(new URLSearchParams(query).entries());
  const result = await api<unknown>('/api/v1/authoring/governance/audit/export', {
    method: 'POST',
    body,
  });
  return result.ok ? { ok: true, data: result.data } : failed(result.problem);
};

// ------------------------------------- Reports (Phase 10 R1, 2026-09-26)

/**
 * Exports one report dataset as CSV.
 *
 * The API returns the file as a string and the button turns it into a download,
 * so the export is audited server-side before any bytes exist. The window is
 * whatever the screen is currently showing -- an export that silently used a
 * different window from the table above it would be the first thing to erode
 * trust in both.
 */
export const reportExportAction = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const dataset = String(formData.get('dataset') ?? '');
  const windowDays = String(formData.get('windowDays') ?? '').trim();
  const result = await api<unknown>(`/api/v1/authoring/reports/${dataset}/export`, {
    method: 'POST',
    body: windowDays.length === 0 ? {} : { windowDays: Number(windowDays) },
  });
  return result.ok ? { ok: true, data: result.data } : failed(result.problem);
};

/**
 * Refreshes the read models now.
 *
 * A RECOMPUTE, gated on `platform.configure` rather than the read permission,
 * because it is work with a cost. The screen's Refresh control means this and
 * not "re-read what is already there" -- which is what a browser reload does.
 */
export const reportRefreshAction = async (
  _previous: ActionState | null,
  _formData: FormData,
): Promise<ActionState> => {
  const result = await api<unknown>('/api/v1/authoring/reports/refresh', { method: 'POST' });
  revalidatePath('/reports');
  return result.ok ? { ok: true, data: result.data } : failed(result.problem);
};

/**
 * Captures a snapshot.
 *
 * A label is required and the server refuses a short one: a snapshot nobody can
 * identify in a list of thirty is a snapshot nobody will ever open.
 */
export const reportSnapshotAction = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const dataset = String(formData.get('dataset') ?? '');
  const label = String(formData.get('label') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();
  const windowDays = String(formData.get('windowDays') ?? '').trim();
  const result = await api<unknown>(`/api/v1/authoring/reports/${dataset}/snapshots`, {
    method: 'POST',
    body: {
      label,
      ...(reason.length === 0 ? {} : { reason }),
      ...(windowDays.length === 0 ? {} : { windowDays: Number(windowDays) }),
    },
  });
  revalidatePath(`/reports/${dataset}`);
  return result.ok ? { ok: true, data: result.data } : failed(result.problem);
};

// ------------------------- the organizational axes (2026-09-26)
//
// Departments and roles. One pair of actions for both catalogues: the only
// difference is the path segment, and two copies would drift the first time one
// gained a field.

const orgSegment = (kind: string): string => (kind === 'department' ? 'departments' : 'roles');

export const createOrgEntryAction = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const kind = String(formData.get('kind') ?? 'department');
  const result = await api<unknown>(`/api/v1/authoring/taxonomy/${orgSegment(kind)}`, {
    method: 'POST',
    body: {
      code: String(formData.get('code') ?? ''),
      name: String(formData.get('name') ?? ''),
      description: String(formData.get('description') ?? ''),
      isActive: checked(formData, 'isActive'),
    },
  });
  revalidatePath('/administration/taxonomy');
  return result.ok ? { ok: true, data: result.data } : failed(result.problem);
};

export const updateOrgEntryAction = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const kind = String(formData.get('kind') ?? 'department');
  const id = String(formData.get('entryId') ?? '');
  // The code is sent ONLY when the form offered it, which it does only while
  // nothing references the entry. Sending a code the screen did not show would
  // be the screen claiming an authority it does not have.
  const code = formData.get('code');
  const result = await api<unknown>(`/api/v1/authoring/taxonomy/${orgSegment(kind)}/${id}`, {
    method: 'PATCH',
    body: {
      name: String(formData.get('name') ?? ''),
      description: String(formData.get('description') ?? ''),
      isActive: checked(formData, 'isActive'),
      ...(code === null ? {} : { code: String(code) }),
    },
  });
  revalidatePath('/administration/taxonomy');
  return result.ok ? { ok: true, data: result.data } : failed(result.problem);
};

/** Activation is its own action, so a toggle posts one field and not a form. */
export const setOrgEntryActiveAction = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const kind = String(formData.get('kind') ?? 'department');
  const id = String(formData.get('entryId') ?? '');
  const isActive = String(formData.get('isActive') ?? 'false') === 'true';
  const result = await api<unknown>(`/api/v1/authoring/taxonomy/${orgSegment(kind)}/${id}`, {
    method: 'PATCH',
    body: { isActive },
  });
  revalidatePath('/administration/taxonomy');
  return result.ok ? { ok: true, data: result.data } : failed(result.problem);
};
