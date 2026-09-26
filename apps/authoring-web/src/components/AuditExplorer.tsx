'use client';

// The Audit Explorer's two interactive pieces: the detail drawer and the export.
//
// A client component because both produce a RESULT the reader has to keep on
// screen — a correlated trace, or a file with a stated row count — and a
// navigation would throw it away.
//
// The drawer fetches on open rather than with the page. The list shows 50 rows;
// pre-loading 50 traces to render one would be 50 queries for 49 nobody asked
// for.

import { useActionState, useState } from 'react';
import { Badge, Button, Drawer, KeyValue } from '@knowzy/shared-ui';
import { Download, Eye } from 'lucide-react';
import { t } from '../copy';
import { auditDetailAction, auditExportAction } from '../app/actions';
import { Problem } from './Problem';

interface TraceEntry {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly action: string;
  readonly outcome: string;
  readonly actorDisplayName: string;
}

interface AuditDetail {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly action: string;
  readonly category: string;
  readonly outcome: string;
  readonly severity: string;
  readonly actorType: string;
  readonly actorDisplayName: string;
  readonly actorRoles: readonly string[];
  readonly entityType: string;
  readonly entityId: string | null;
  readonly entityLabel: string | null;
  readonly correlationId: string;
  readonly requestId: string | null;
  readonly ipAddress: string | null;
  readonly policyName: string | null;
  readonly portal: string | null;
  readonly denyReason: string | null;
  readonly detail: Readonly<Record<string, unknown>>;
  readonly previousValue: unknown;
  readonly newValue: unknown;
  readonly trace: readonly TraceEntry[];
}

const stamp = (iso: string): string => new Date(iso).toLocaleString('en-GB');

/** A JSON value, shown as text. Never a stack trace: audit holds neither. */
const asText = (value: unknown): string =>
  value === null || value === undefined ? '—' : JSON.stringify(value, null, 2);

export const AuditRowActions = ({
  eventId,
  correlationId,
  actingAs,
}: {
  readonly eventId: string;
  readonly correlationId: string;
  readonly actingAs: string;
}) => {
  const [open, setOpen] = useState(false);
  const [state, load, pending] = useActionState(auditDetailAction, null);

  const detail = state?.ok === true ? (state.data as AuditDetail) : null;

  return (
    <>
      <form
        action={(formData) => {
          setOpen(true);
          load(formData);
        }}
      >
        <input type="hidden" name="eventId" value={eventId} />
        <Button tone="secondary" size="sm" disabled={pending}>
          <Eye className="size-4" aria-hidden="true" />
          {t('audit.viewDetails')}
        </Button>
      </form>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={t('audit.detailTitle')}
        description={t('audit.detailIntro')}
        width="wide"
      >
        {state === null || pending ? (
          <p className="text-sm text-ink-muted">{t('audit.loading')}</p>
        ) : state.ok === false ? (
          state.problem === undefined ? (
            <p className="text-sm text-danger">{t('audit.loadFailed')}</p>
          ) : (
            <Problem problem={state.problem} actingAs={actingAs} />
          )
        ) : detail === null ? null : (
          <div className="flex flex-col gap-6">
            <section className="flex flex-col gap-2">
              <h3 className="text-md font-semibold text-brand-navy-text">{detail.action}</h3>
              <KeyValue
                items={[
                  { label: t('audit.when'), value: stamp(detail.occurredAt) },
                  { label: t('audit.outcome'), value: detail.outcome },
                  { label: t('audit.severity'), value: detail.severity },
                  {
                    label: t('audit.actor'),
                    value:
                      detail.actorDisplayName.length > 0
                        ? `${detail.actorDisplayName} (${detail.actorType})`
                        : detail.actorType,
                  },
                  {
                    label: t('audit.roles'),
                    value: detail.actorRoles.length === 0 ? '—' : detail.actorRoles.join(', '),
                  },
                  {
                    label: t('audit.entity'),
                    value: `${detail.entityType}${
                      detail.entityLabel === null ? '' : ` · ${detail.entityLabel}`
                    }`,
                  },
                  { label: t('audit.portal'), value: detail.portal ?? '—' },
                  { label: t('audit.policy'), value: detail.policyName ?? '—' },
                  // Recorded for a denial and for a security event. Shown
                  // because an auditor asking "where did this come from" has no
                  // other source for it.
                  { label: t('audit.ip'), value: detail.ipAddress ?? '—' },
                  { label: t('audit.requestId'), value: detail.requestId ?? '—' },
                ]}
              />
            </section>

            {detail.denyReason === null ? null : (
              <section className="rounded-md border border-warning bg-warning-soft p-3">
                <p className="text-sm text-ink">{detail.denyReason}</p>
              </section>
            )}

            <section className="flex flex-col gap-2">
              <h4 className="text-base font-semibold text-brand-navy-text">
                {t('audit.detailKeys')}
              </h4>
              <pre className="overflow-x-auto rounded-md border border-line bg-surface-muted p-3 text-2xs text-ink">
                {asText(detail.detail)}
              </pre>
            </section>

            {detail.previousValue === null && detail.newValue === null ? null : (
              <section className="grid gap-3 md:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <h4 className="text-base font-semibold text-brand-navy-text">
                    {t('audit.previousValue')}
                  </h4>
                  <pre className="overflow-x-auto rounded-md border border-line bg-surface-muted p-3 text-2xs text-ink">
                    {asText(detail.previousValue)}
                  </pre>
                </div>
                <div className="flex flex-col gap-2">
                  <h4 className="text-base font-semibold text-brand-navy-text">
                    {t('audit.newValue')}
                  </h4>
                  <pre className="overflow-x-auto rounded-md border border-line bg-surface-muted p-3 text-2xs text-ink">
                    {asText(detail.newValue)}
                  </pre>
                </div>
              </section>
            )}

            {/* The correlated trace: §10's requirement, and the thing that makes
                this an explorer rather than a log viewer. One click produced
                every row below. */}
            <section className="flex flex-col gap-2">
              <h4 className="text-base font-semibold text-brand-navy-text">
                {t('audit.traceHeading', { count: String(detail.trace.length) })}
              </h4>
              <p className="text-2xs text-ink-muted">
                {t('audit.traceNote')} <code className="font-mono">{detail.correlationId}</code>
              </p>
              <ol className="flex flex-col">
                {detail.trace.map((entry) => (
                  <li
                    key={entry.eventId}
                    className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line py-2 last:border-b-0 ${
                      entry.eventId === detail.eventId ? 'bg-brand-soft/40' : ''
                    }`}
                  >
                    <span className="font-mono text-2xs text-ink-muted">
                      {stamp(entry.occurredAt)}
                    </span>
                    <span className="flex-1 font-mono text-sm text-ink">{entry.action}</span>
                    <Badge tone={entry.outcome === 'SUCCESS' ? 'success' : 'warning'}>
                      {entry.outcome}
                    </Badge>
                    <span className="text-2xs text-ink-muted">
                      {entry.actorDisplayName.length > 0
                        ? entry.actorDisplayName
                        : t('audit.systemActor')}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        )}
      </Drawer>

      {/* The correlation id is a link as well as a trace: narrowing the LIST to
          it lets somebody page through a long chain rather than a capped 50. */}
      <a
        href={`/governance/audit?correlationId=${encodeURIComponent(correlationId)}`}
        className="mt-1 block font-mono text-2xs text-info hover:underline"
      >
        {t('audit.filterToTrace')}
      </a>
    </>
  );
};

export const AuditExportButton = ({
  query,
  actingAs,
}: {
  readonly query: string;
  readonly actingAs: string;
}) => {
  const [state, submit, pending] = useActionState(auditExportAction, null);

  // The download happens in the browser from a string the server returned, so
  // the API keeps one response shape and the export is still audited
  // server-side before the bytes exist.
  const payload = state?.ok === true ? (state.data as { filename: string; csv: string }) : null;
  if (payload !== null && typeof window !== 'undefined') {
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
        <input type="hidden" name="query" value={query} />
        <Button tone="secondary" size="sm" disabled={pending}>
          <Download className="size-4" aria-hidden="true" />
          {t('audit.export')}
        </Button>
      </form>
      {state?.ok === false ? (
        state.problem === undefined ? (
          <p className="text-2xs text-danger">{t('audit.exportFailed')}</p>
        ) : (
          <Problem problem={state.problem} actingAs={actingAs} />
        )
      ) : null}
      {state?.ok === true ? (
        <p className="text-2xs text-ink-muted">
          {t('audit.exported', {
            rows: String((state.data as { rowCount: number }).rowCount),
            matched: String((state.data as { matchedCount: number }).matchedCount),
          })}
        </p>
      ) : null}
    </div>
  );
};
