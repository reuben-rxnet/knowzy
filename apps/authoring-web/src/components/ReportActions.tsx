'use client';

// The two report actions that write something: an export and a snapshot.
//
// Both are client components for the same reason every other write on this
// platform is: each can be refused for a reason the person has to read —
// `report.export` not held, a label too short, a model that has never
// refreshed — and a redirect-and-rerender throws the reason away.
//
// THE EXPORT DOWNLOADS FROM A STRING THE SERVER RETURNED. The API answers with
// the CSV as text, and the browser turns it into a file. That keeps one
// response shape across the API and, more importantly, means the export is
// audited server-side BEFORE any bytes exist — a download that produced a file
// and no audit row would be exactly the unaccountable copy §8.1 exists to stop.
//
// The window is passed through from the screen, so an export can never cover a
// different period from the table above it.

import { useActionState, useRef } from 'react';
import { Button, Field, Modal, TextInput, Textarea } from '@knowzy/shared-ui';
import { Camera, Download, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { t } from '../copy';
import { reportExportAction, reportRefreshAction, reportSnapshotAction } from '../app/actions';
import { Problem } from './Problem';

export const ReportExportButton = ({
  dataset,
  windowDays,
  actingAs,
}: {
  readonly dataset: string;
  readonly windowDays: string;
  readonly actingAs: string;
}): React.JSX.Element => {
  const [state, submit, pending] = useActionState(reportExportAction, null);
  // A ref, so one response produces one download. Without it, any re-render
  // while this state is current downloads the file again — which is the sort of
  // thing that only shows up as "why do I have four copies".
  const delivered = useRef<string | null>(null);

  const payload =
    state?.ok === true ? (state.data as { filename: string; csv: string } | undefined) : undefined;

  if (
    payload !== undefined &&
    typeof window !== 'undefined' &&
    delivered.current !== payload.filename
  ) {
    delivered.current = payload.filename;
    const blob = new Blob([payload.csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = payload.filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <form action={submit}>
        <input type="hidden" name="dataset" value={dataset} />
        <input type="hidden" name="windowDays" value={windowDays} />
        <Button tone="secondary" size="sm" disabled={pending}>
          <Download className="size-4" aria-hidden="true" />
          {pending ? t('rep.exporting') : t('rep.export')}
        </Button>
      </form>
      {state === null || state.ok || state.problem === undefined ? null : (
        <Problem problem={state.problem} actingAs={actingAs} />
      )}
      {payload === undefined ? null : (
        <span className="text-2xs text-ink-muted">{t('rep.exported')}</span>
      )}
    </div>
  );
};

/**
 * Recomputes the read models now.
 *
 * The approved design puts a Refresh control in the header. This is what it
 * means: a RECOMPUTE of the materialized views, gated on `platform.configure`,
 * and audited -- not a page reload, which is what a browser already does and
 * which would return the same cached numbers.
 *
 * It reports how many models refreshed and how many failed, because a partial
 * failure is the normal shape of this operation and hiding it would make the
 * button feel unreliable for the wrong reason.
 */
export const RefreshModelsButton = ({
  actingAs,
}: {
  readonly actingAs: string;
}): React.JSX.Element => {
  const [state, submit, pending] = useActionState(reportRefreshAction, null);
  const result =
    state?.ok === true
      ? (state.data as { refreshed: number; failed: number } | undefined)
      : undefined;

  return (
    <div className="flex flex-col items-start gap-1">
      <form action={submit}>
        <Button tone="secondary" size="sm" disabled={pending}>
          <RefreshCw className="size-4" aria-hidden="true" />
          {pending ? t('rep.refreshing') : t('rep.refresh')}
        </Button>
      </form>
      {state === null || state.ok || state.problem === undefined ? null : (
        <Problem problem={state.problem} actingAs={actingAs} />
      )}
      {result === undefined ? null : (
        <span className="text-2xs text-ink-muted">
          {result.failed === 0
            ? t('rep.refreshed', { count: String(result.refreshed) })
            : t('rep.refreshedPartly', {
                count: String(result.refreshed),
                failed: String(result.failed),
              })}
        </span>
      )}
    </div>
  );
};

export const SnapshotButton = ({
  dataset,
  windowDays,
  actingAs,
}: {
  readonly dataset: string;
  readonly windowDays: string;
  readonly actingAs: string;
}): React.JSX.Element => {
  const [open, setOpen] = useState(false);
  const [state, submit, pending] = useActionState(reportSnapshotAction, null);

  return (
    <>
      <Button tone="secondary" size="sm" onClick={() => setOpen(true)}>
        <Camera className="size-4" aria-hidden="true" />
        {t('rep.snapshot')}
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('rep.snapshotTitle')}
        description={t('rep.snapshotIntro')}
      >
        <form action={submit} className="flex flex-col gap-4">
          <input type="hidden" name="dataset" value={dataset} />
          <input type="hidden" name="windowDays" value={windowDays} />

          <Field
            id={`label-${dataset}`}
            label={t('rep.snapshotLabel')}
            hint={t('rep.snapshotLabelHint')}
          >
            <TextInput id={`label-${dataset}`} name="label" maxLength={200} required />
          </Field>

          <Field
            id={`reason-${dataset}`}
            label={t('rep.snapshotReason')}
            hint={t('rep.snapshotReasonHint')}
          >
            <Textarea id={`reason-${dataset}`} name="reason" rows={3} />
          </Field>

          <p className="text-2xs text-ink-muted">{t('rep.snapshotNote')}</p>

          {state === null || state.ok || state.problem === undefined ? null : (
            <Problem problem={state.problem} actingAs={actingAs} />
          )}
          {state?.ok === true ? (
            <p className="text-sm font-semibold text-success">{t('rep.snapshotSaved')}</p>
          ) : null}

          <div>
            <Button disabled={pending}>{pending ? t('rep.capturing') : t('rep.capture')}</Button>
          </div>
        </form>
      </Modal>
    </>
  );
};
