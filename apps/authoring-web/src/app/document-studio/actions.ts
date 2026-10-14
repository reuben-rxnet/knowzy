'use server';

// AI Document Studio M3 -- the server actions behind the Studio's forms
// (docs/competencies/AI_DOCUMENT_STUDIO_ARCHITECTURE.md §11).
//
// Every action calls the API as the selected subject and returns a result, as
// the portal's other actions do; the API decides every refusal. The file of
// an upload reaches the API as base64 inside JSON -- the browser never names a
// server path, and the API inspects the bytes before anything is stored.

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { api, type ApiProblem } from '../../lib/api';
import type { ActionState } from '../actions';

const failed = (problem: ApiProblem): ActionState => ({ ok: false, problem });
const local = (detail: string): ActionState =>
  failed({ status: 400, code: 'VALIDATION_FAILED', title: 'Check the form', detail });

const studioPath = (id: string, versionId?: string): string =>
  `/document-studio/${encodeURIComponent(id)}${versionId === undefined ? '' : `?versionId=${encodeURIComponent(versionId)}`}`;

export const uploadDocumentAction = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return local('Choose a file to add.');
  const contentBase64 = Buffer.from(await file.arrayBuffer()).toString('base64');
  const result = await api<{ preparedDocumentId: string }>(
    '/api/v1/authoring/document-studio/uploads',
    { method: 'POST', body: { fileName: file.name, contentBase64 } },
  );
  if (!result.ok) return failed(result.problem);
  revalidatePath('/document-studio');
  redirect(studioPath(result.data.preparedDocumentId));
};

export const chooseDocumentAction = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const documentId = String(formData.get('documentId') ?? '');
  const result = await api<{ preparedDocumentId: string }>(
    '/api/v1/authoring/document-studio/documents',
    { method: 'POST', body: { documentId } },
  );
  if (!result.ok) return failed(result.problem);
  revalidatePath('/document-studio');
  redirect(studioPath(result.data.preparedDocumentId));
};

export const prepareDocumentAction = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const id = String(formData.get('preparedDocumentId') ?? '');
  const result = await api<{ versionId: string }>(
    `/api/v1/authoring/document-studio/documents/${encodeURIComponent(id)}/preparations`,
    { method: 'POST' },
  );
  revalidatePath(studioPath(id));
  if (!result.ok) return failed(result.problem);
  redirect(studioPath(id, result.data.versionId));
};

export const saveContentAction = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const id = String(formData.get('preparedDocumentId') ?? '');
  const versionId = String(formData.get('versionId') ?? '');
  const content = String(formData.get('content') ?? '');
  const result = await api<{ versionId: string; created: boolean }>(
    `/api/v1/authoring/document-studio/versions/${encodeURIComponent(versionId)}/content`,
    { method: 'PUT', body: { content } },
  );
  if (!result.ok) return failed(result.problem);
  revalidatePath(studioPath(id));
  if (result.data.created) redirect(`${studioPath(id, result.data.versionId)}&view=edit`);
  return { ok: true, data: result.data };
};

const versionAct = async (
  path: 'restore' | 'discard' | 'revalidation-draft',
  formData: FormData,
): Promise<ActionState> => {
  const id = String(formData.get('preparedDocumentId') ?? '');
  const versionId = String(formData.get('versionId') ?? '');
  const result = await api<{ versionId: string }>(
    `/api/v1/authoring/document-studio/versions/${encodeURIComponent(versionId)}/${path}`,
    { method: 'POST' },
  );
  if (!result.ok) return failed(result.problem);
  revalidatePath(studioPath(id));
  if (path === 'revalidation-draft') redirect(studioPath(id, result.data.versionId));
  return { ok: true, data: result.data };
};

// Explicit async exports: a 'use server' module may export only async functions.
export const restoreAiAction = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => versionAct('restore', formData);
export const discardDraftAction = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => versionAct('discard', formData);
export const revalidationDraftAction = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => versionAct('revalidation-draft', formData);

export const addToRepositoryAction = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const id = String(formData.get('preparedDocumentId') ?? '');
  const versionId = String(formData.get('versionId') ?? '');
  const result = await api<{
    versionId: string;
    repositorySourceId: string;
    repositoryDocumentId: string;
  }>(`/api/v1/authoring/document-studio/versions/${encodeURIComponent(versionId)}/repository`, {
    method: 'POST',
    body: { confirmed: true },
  });
  if (!result.ok) return failed(result.problem);
  revalidatePath(studioPath(id));
  revalidatePath('/generate');
  return { ok: true, data: result.data };
};
