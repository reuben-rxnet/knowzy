'use server';

// Server actions for the Sync Manager.
//
// Same shape as the other two portals, for the same reasons: the browser never
// holds an identity header, every call happens in this server process, and an
// action returns a serializable result rather than throwing — a refused
// synchronization and a partial one are both normal outcomes this console has
// to render with their reasons attached.

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { api, type ApiProblem } from '../lib/api';
import { SUBJECT_COOKIE, subjectByUpn } from '../lib/identity';

export interface ActionState {
  readonly ok: boolean;
  readonly problem?: ApiProblem;
  readonly data?: unknown;
}

const failed = (problem: ApiProblem): ActionState => ({ ok: false, problem });

const refresh = (): void => {
  revalidatePath('/');
};

export const switchSubject = async (formData: FormData): Promise<void> => {
  const subject = subjectByUpn(String(formData.get('subject') ?? ''));
  const store = await cookies();
  store.set(SUBJECT_COOKIE, subject.upn, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 12,
  });
  refresh();
};

/** Refresh is a real action: it re-reads the server state, nothing cached. */
export const refreshOverview = async (): Promise<void> => {
  refresh();
};

export const syncNow = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const sourceId = String(formData.get('sourceId') ?? '');
  const result = await api<unknown>(`/api/v1/authoring/sources/${sourceId}/synchronize`, {
    method: 'POST',
    body: {},
  });
  refresh();
  return result.ok ? { ok: true, data: result.data } : failed(result.problem);
};

export const syncAll = async (
  _previous: ActionState | null,
  _formData: FormData,
): Promise<ActionState> => {
  const result = await api<unknown>('/api/v1/authoring/sync/sync-all', {
    method: 'POST',
    body: { mode: 'FULL' },
  });
  refresh();
  return result.ok ? { ok: true, data: result.data } : failed(result.problem);
};

export const testConnection = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const sourceId = String(formData.get('sourceId') ?? '');
  const result = await api<unknown>(`/api/v1/authoring/sources/${sourceId}/test-connection`, {
    method: 'POST',
    body: {},
  });
  refresh();
  return result.ok ? { ok: true, data: result.data } : failed(result.problem);
};

const checked = (formData: FormData, field: string): boolean => formData.get(field) !== null;

/** The schedule, assembled from the form the wizard rendered. */
const scheduleFrom = (formData: FormData): Record<string, unknown> | undefined => {
  const mode = String(formData.get('scheduleMode') ?? '');
  if (mode.length === 0) return undefined;
  const timezone = String(formData.get('timezone') ?? 'UTC') || 'UTC';
  const intervalRaw = String(formData.get('intervalHours') ?? '');
  const cron = String(formData.get('cron') ?? '').trim();
  return {
    mode,
    timezone,
    // Only the field its mode uses. Sending both is refused by the server, and
    // rightly: two schedules on one source is an ambiguity.
    ...(mode === 'HOURLY' && intervalRaw.length > 0 ? { intervalHours: Number(intervalRaw) } : {}),
    ...(mode === 'CRON' && cron.length > 0 ? { cron } : {}),
  };
};

export const createWorkflow = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const sourceType = String(formData.get('sourceType') ?? 'FILE_REPOSITORY');
  const localRoot = String(formData.get('localRoot') ?? '').trim();

  const created = await api<{ source: { sourceId: string } }>('/api/v1/authoring/sources', {
    method: 'POST',
    body: {
      name: String(formData.get('name') ?? ''),
      description: String(formData.get('description') ?? ''),
      sourceType,
      ...(localRoot.length > 0 ? { localRoot } : {}),
      usableForGeneration: checked(formData, 'usableForGeneration'),
      ...(scheduleFrom(formData) === undefined ? {} : { schedule: scheduleFrom(formData) }),
    },
  });
  if (!created.ok) return failed(created.problem);

  // A source with no path has nothing to scan, so the first path is created
  // with the workflow rather than left as a second step somebody forgets.
  const containerName = String(formData.get('containerName') ?? '').trim();
  if (containerName.length > 0) {
    const path = await api<unknown>(
      `/api/v1/authoring/sources/${created.data.source.sourceId}/paths`,
      {
        method: 'POST',
        body: {
          containerName,
          folderPath: String(formData.get('folderPath') ?? ''),
        },
      },
    );
    if (!path.ok) {
      // The source exists and the path does not. Reported rather than hidden:
      // the operator has a workflow that cannot scan yet, and needs to know.
      return failed(path.problem);
    }
  }

  refresh();
  return { ok: true, data: created.data };
};

export const editWorkflow = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const sourceId = String(formData.get('sourceId') ?? '');
  const schedule = scheduleFrom(formData);
  const result = await api<unknown>(`/api/v1/authoring/sources/${sourceId}`, {
    method: 'PATCH',
    body: {
      name: String(formData.get('name') ?? ''),
      description: String(formData.get('description') ?? ''),
      usableForGeneration: checked(formData, 'usableForGeneration'),
      ...(schedule === undefined ? {} : { schedule }),
    },
  });
  refresh();
  return result.ok ? { ok: true, data: result.data } : failed(result.problem);
};

export const setWorkflowActive = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const sourceId = String(formData.get('sourceId') ?? '');
  const activate = String(formData.get('isActive') ?? 'false') === 'true';
  const result = await api<unknown>(
    `/api/v1/authoring/sources/${sourceId}/${activate ? 'activate' : 'deactivate'}`,
    { method: 'POST', body: {} },
  );
  refresh();
  return result.ok ? { ok: true, data: result.data } : failed(result.problem);
};

export const retireWorkflow = async (
  _previous: ActionState | null,
  formData: FormData,
): Promise<ActionState> => {
  const sourceId = String(formData.get('sourceId') ?? '');
  const intent = String(formData.get('intent') ?? 'ARCHIVE');
  const result = await api<unknown>(`/api/v1/authoring/sources/${sourceId}/retire`, {
    method: 'POST',
    body: { intent },
  });
  refresh();
  return result.ok ? { ok: true, data: result.data } : failed(result.problem);
};
