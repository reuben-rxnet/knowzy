'use client';

// The interactive half of the dashboard: the action bar, the row actions, the
// creation and edit wizard, and the retire dialog.
//
// A client component because every one of these writes can be refused for a
// reason an operator has to read — a path outside the allowed roots, a delete
// blocked by lineage, a cron expression pg-boss would not accept, a source
// already synchronizing — and a redirect-and-rerender would discard it.
//
// Two rules from the specification are enforced here rather than assumed:
//
//   * **Real controls only.** Every toggle is a checkbox, every choice a
//     select, every dialog the shared `Modal` with its focus trap. No static
//     asset is used as a control.
//   * **Disabled capabilities say why.** The destination fields and the
//     two-way / metadata / delete-back options are rendered, disabled, each
//     carrying "Requires Microsoft Graph write integration and tenant
//     approval." Hiding them would make the gap invisible; faking them would
//     be worse.

import { useEffect, useState } from 'react';
import { useActionState } from 'react';
import {
  Badge,
  Button,
  CheckboxRow,
  Field,
  Modal,
  Select,
  TextInput,
  Textarea,
} from '@knowzy/shared-ui';
import { t } from '../copy';
import {
  createWorkflow,
  editWorkflow,
  retireWorkflow,
  setWorkflowActive,
  syncAll,
  syncNow,
  testConnection,
  type ActionState,
} from '../app/actions';
import { Problem } from './Problem';

export interface Capabilities {
  readonly sourceTypes: readonly { readonly sourceType: string; readonly note: string }[];
  readonly allowedLocalRoots: readonly string[];
  readonly scheduleModes: readonly string[];
  readonly unsupported: readonly { readonly capability: string; readonly reason: string }[];
}

export interface WorkflowRow {
  readonly sourceId: string;
  readonly name: string;
  readonly description: string | null;
  readonly sourceType: string;
  readonly isActive: boolean;
  readonly archivedAt: string | null;
  readonly usableForGeneration: boolean;
  readonly status: string;
  readonly schedule: {
    readonly mode: string;
    readonly intervalHours?: number;
    readonly cron?: string;
    readonly timezone: string;
  };
}

const GRAPH_REASON = t('wizard.requiresGraph');

/** A field the approved design shows and this release cannot implement. */
const DisabledCapability = ({
  label,
  kind,
}: {
  readonly label: string;
  readonly kind: 'text' | 'toggle';
}) => (
  <div className="flex flex-col gap-1 rounded-md border border-dashed border-line bg-surface-muted px-3 py-2">
    <span className="flex items-center gap-2 text-2xs font-semibold uppercase tracking-wide text-ink-muted">
      {label}
      <Badge tone="neutral" withIcon={false}>
        {t('state.unsupportedHeading')}
      </Badge>
    </span>
    {kind === 'text' ? (
      <input
        type="text"
        disabled
        aria-disabled="true"
        aria-describedby={`why-${label.replace(/\s+/g, '-')}`}
        placeholder="—"
        className="w-full cursor-not-allowed rounded-md border border-line bg-surface-muted px-3 py-2 text-base text-ink-subtle"
      />
    ) : (
      <label className="flex cursor-not-allowed items-center gap-2 text-base text-ink-subtle">
        <input type="checkbox" disabled aria-disabled="true" className="size-4" />
        {label}
      </label>
    )}
    <span id={`why-${label.replace(/\s+/g, '-')}`} className="text-2xs text-ink-muted">
      {GRAPH_REASON}
    </span>
  </div>
);

const Dialog = ({
  open,
  onClose,
  title,
  description,
  action,
  submitLabel,
  children,
  actingAs,
  tone = 'default',
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly description?: string;
  readonly action: (previous: ActionState | null, formData: FormData) => Promise<ActionState>;
  readonly submitLabel: string;
  readonly children: React.ReactNode;
  readonly actingAs: string;
  readonly tone?: 'default' | 'danger';
}) => {
  const [state, submit, pending] = useActionState(action, null, '/');

  useEffect(() => {
    if (state?.ok === true) onClose();
  }, [state, onClose]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      tone={tone}
      {...(description === undefined ? {} : { description })}
    >
      <form action={submit} className="flex flex-col gap-4">
        {children}
        {state?.ok === false && state.problem !== undefined ? (
          <Problem problem={state.problem} actingAs={actingAs} />
        ) : null}
        <div className="flex gap-3">
          <Button
            tone={tone === 'danger' ? 'danger' : 'primary'}
            disabled={pending}
            {...(pending ? { disabledReason: t('action.working') } : {})}
          >
            {submitLabel}
          </Button>
          <Button type="button" tone="secondary" onClick={onClose}>
            {t('action.cancel')}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

/** The schedule controls, shared by create and edit. */
const ScheduleFields = ({
  capabilities,
  schedule,
}: {
  readonly capabilities: Capabilities;
  readonly schedule?: WorkflowRow['schedule'];
}) => {
  const [mode, setMode] = useState(schedule?.mode ?? 'MANUAL');
  return (
    <>
      <Field id="scheduleMode" label={t('wizard.scheduleMode')}>
        <Select
          id="scheduleMode"
          name="scheduleMode"
          defaultValue={mode}
          onChange={(event) => setMode(event.target.value)}
        >
          {capabilities.scheduleModes.map((option) => (
            <option key={option} value={option}>
              {t(`schedule.mode${option}` as never)}
            </option>
          ))}
        </Select>
      </Field>
      {mode === 'HOURLY' ? (
        <Field id="intervalHours" label={t('wizard.intervalHours')}>
          <TextInput
            id="intervalHours"
            name="intervalHours"
            type="number"
            min={1}
            max={24}
            defaultValue={schedule?.intervalHours ?? 1}
          />
        </Field>
      ) : null}
      {mode === 'CRON' ? (
        <Field id="cron" label={t('wizard.cron')} hint={t('wizard.cronHint')}>
          <TextInput id="cron" name="cron" defaultValue={schedule?.cron ?? '0 3 * * *'} />
        </Field>
      ) : null}
      {mode === 'MANUAL' ? null : (
        <Field id="timezone" label={t('wizard.timezone')} hint={t('wizard.timezoneHint')}>
          <TextInput id="timezone" name="timezone" defaultValue={schedule?.timezone ?? 'UTC'} />
        </Field>
      )}
    </>
  );
};

export const ActionBar = ({
  capabilities,
  actingAs,
}: {
  readonly capabilities: Capabilities;
  readonly actingAs: string;
}) => {
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [allState, runAll, allPending] = useActionState(syncAll, null, '/');
  const canCreate = capabilities.allowedLocalRoots.length > 0;
  const result = allState?.ok === true ? (allState.data as SyncAllResult) : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={() => setCreating(true)}
          disabled={!canCreate}
          {...(canCreate ? {} : { disabledReason: t('wizard.noAllowedRoots') })}
        >
          {t('action.newWorkflow')}
        </Button>
        <Button
          tone="secondary"
          onClick={() => setConfirming(true)}
          disabled={allPending}
          {...(allPending ? { disabledReason: t('action.working') } : {})}
        >
          {t('action.syncAll')}
        </Button>
        {/* Refresh is a real navigation to the same route, so the server
            re-reads. A button that only re-rendered a cache would be a lie. */}
        <a
          href="/"
          className="inline-flex min-h-target items-center rounded-md border border-line bg-brand-surface px-4 py-2 text-base font-semibold text-brand-navy-text hover:bg-surface-hover"
        >
          {t('action.refresh')}
        </a>
      </div>

      {allState?.ok === false && allState.problem !== undefined ? (
        <Problem problem={allState.problem} actingAs={actingAs} />
      ) : null}
      {result === null ? null : <SyncAllSummary result={result} />}

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t('action.syncAllConfirm')}
        description={t('action.syncAllBody')}
      >
        <form
          action={(formData) => {
            setConfirming(false);
            runAll(formData);
          }}
          className="flex gap-3"
        >
          <Button>{t('action.confirm')}</Button>
          <Button type="button" tone="secondary" onClick={() => setConfirming(false)}>
            {t('action.cancel')}
          </Button>
        </form>
      </Modal>

      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        title={t('wizard.createTitle')}
        description={t('app.subtitle')}
        action={createWorkflow}
        submitLabel={t('wizard.save')}
        actingAs={actingAs}
      >
        <Field id="name" label={t('wizard.name')}>
          <TextInput id="name" name="name" required />
        </Field>
        <Field id="description" label={t('wizard.description')}>
          <Textarea id="description" name="description" rows={2} />
        </Field>

        <Field id="sourceType" label={t('wizard.adapter')} hint={t('wizard.adapterHint')}>
          <Select id="sourceType" name="sourceType">
            {capabilities.sourceTypes.map((option) => (
              <option key={option.sourceType} value={option.sourceType}>
                {option.sourceType}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          id="localRoot"
          label={t('wizard.localRoot')}
          hint={`${t('wizard.localRootHint')} ${t('wizard.allowedRoots', {
            roots: capabilities.allowedLocalRoots.join(', '),
          })}`}
        >
          <TextInput id="localRoot" name="localRoot" />
        </Field>
        <Field id="containerName" label={t('wizard.container')} hint={t('wizard.containerHint')}>
          <TextInput id="containerName" name="containerName" />
        </Field>
        <Field id="folderPath" label={t('wizard.folder')} hint={t('wizard.folderHint')}>
          <TextInput id="folderPath" name="folderPath" />
        </Field>

        {/* Destination: shown because the approved design shows it, disabled
            because there is no destination model and no Graph write. */}
        <fieldset className="flex flex-col gap-2">
          <legend className="text-base font-semibold text-brand-navy-text">
            {t('wizard.destinationConfig')}
          </legend>
          <DisabledCapability label={t('wizard.destinationSite')} kind="text" />
          <DisabledCapability label={t('wizard.destinationLibrary')} kind="text" />
          <DisabledCapability label={t('wizard.destinationFolder')} kind="text" />
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-base font-semibold text-brand-navy-text">
            {t('wizard.options')}
          </legend>
          {/* One-way is the only implemented mode, so it is checked and
              disabled rather than presented as a choice between two. */}
          <label className="flex items-center gap-2 text-base text-ink">
            <input type="checkbox" checked disabled aria-disabled="true" className="size-4" />
            {t('wizard.oneWay')}
            <span className="text-2xs text-ink-muted">({t('wizard.oneWayNote')})</span>
          </label>
          <label className="flex items-center gap-2 text-base text-ink">
            <input type="checkbox" checked disabled aria-disabled="true" className="size-4" />
            {t('wizard.includeSubfolders')}
            <span className="text-2xs text-ink-muted">({t('wizard.includeSubfoldersNote')})</span>
          </label>
          <DisabledCapability label={t('wizard.twoWay')} kind="toggle" />
          <DisabledCapability label={t('wizard.syncDeletes')} kind="toggle" />
          <DisabledCapability label={t('wizard.syncMetadata')} kind="toggle" />
          <CheckboxRow name="usableForGeneration" value="true" defaultChecked>
            {t('wizard.usableForGeneration')}
          </CheckboxRow>
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="text-base font-semibold text-brand-navy-text">
            {t('wizard.scheduling')}
          </legend>
          <ScheduleFields capabilities={capabilities} />
        </fieldset>
      </Dialog>
    </div>
  );
};

interface SyncAllResult {
  readonly requested: number;
  readonly succeeded: number;
  readonly partial: number;
  readonly failed: number;
  readonly alreadyRunning: number;
  readonly results: readonly {
    readonly sourceName: string;
    readonly outcome: string;
    readonly detail: string;
  }[];
  readonly skipped: readonly { readonly sourceName: string; readonly reason: string }[];
}

const SyncAllSummary = ({ result }: { readonly result: SyncAllResult }) => (
  <div className="sync-card flex flex-col gap-3 p-4">
    <h3 className="text-md font-semibold text-brand-navy-text">{t('result.syncAllHeading')}</h3>
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {(
        [
          ['result.requested', result.requested],
          ['result.succeeded', result.succeeded],
          ['result.partial', result.partial],
          ['result.failed', result.failed],
          ['result.alreadyRunning', result.alreadyRunning],
        ] as const
      ).map(([key, value]) => (
        <div key={key} className="flex flex-col">
          <dt className="text-2xs uppercase tracking-wide text-ink-muted">{t(key)}</dt>
          <dd className="text-lg font-semibold text-brand-navy-text">{value}</dd>
        </div>
      ))}
    </dl>
    <ul className="flex flex-col gap-1">
      {result.results.map((entry) => (
        <li key={entry.sourceName} className="text-sm text-ink">
          <span className="font-semibold">{entry.sourceName}</span> · {entry.outcome} ·{' '}
          <span className="text-ink-muted">{entry.detail}</span>
        </li>
      ))}
    </ul>
    {result.skipped.length === 0 ? null : (
      <div className="flex flex-col gap-1">
        <h4 className="text-base font-semibold text-brand-navy-text">
          {t('result.skippedHeading')}
        </h4>
        {result.skipped.map((entry) => (
          <p key={entry.sourceName} className="text-2xs text-ink-muted">
            <span className="font-semibold">{entry.sourceName}</span> — {entry.reason}
          </p>
        ))}
      </div>
    )}
  </div>
);

/** One row's actions: sync, test, edit, pause/resume, retire. */
export const RowActions = ({
  workflow,
  capabilities,
  actingAs,
  lineageBlocked,
}: {
  readonly workflow: WorkflowRow;
  readonly capabilities: Capabilities;
  readonly actingAs: string;
  readonly lineageBlocked: boolean;
}) => {
  const [editing, setEditing] = useState(false);
  const [retiring, setRetiring] = useState(false);
  const [syncState, runSync, syncPending] = useActionState(syncNow, null, '/');
  const [testState, runTest, testPending] = useActionState(testConnection, null, '/');
  const [activeState, runActive, activePending] = useActionState(setWorkflowActive, null, '/');

  const running = workflow.status === 'RUNNING';
  const archived = workflow.archivedAt !== null;
  const problem =
    syncState?.ok === false
      ? syncState.problem
      : testState?.ok === false
        ? testState.problem
        : activeState?.ok === false
          ? activeState.problem
          : undefined;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <form action={runSync}>
          <input type="hidden" name="sourceId" value={workflow.sourceId} />
          <Button
            size="sm"
            disabled={syncPending || running || archived}
            {...(running
              ? { disabledReason: t('row.syncNowBlocked') }
              : archived
                ? { disabledReason: t('row.pauseBlocked') }
                : syncPending
                  ? { disabledReason: t('action.working') }
                  : {})}
          >
            {t('row.syncNow')}
          </Button>
        </form>

        <form action={runTest}>
          <input type="hidden" name="sourceId" value={workflow.sourceId} />
          <Button
            size="sm"
            tone="secondary"
            disabled={testPending}
            {...(testPending ? { disabledReason: t('action.working') } : {})}
          >
            {t('header.connection')}
          </Button>
        </form>

        <Button
          size="sm"
          tone="secondary"
          onClick={() => setEditing(true)}
          disabled={archived}
          {...(archived ? { disabledReason: t('row.pauseBlocked') } : {})}
        >
          {t('row.edit')}
        </Button>

        <form action={runActive}>
          <input type="hidden" name="sourceId" value={workflow.sourceId} />
          <input type="hidden" name="isActive" value={workflow.isActive ? 'false' : 'true'} />
          <Button
            size="sm"
            tone="secondary"
            disabled={activePending || archived}
            {...(archived
              ? { disabledReason: t('row.pauseBlocked') }
              : activePending
                ? { disabledReason: t('action.working') }
                : {})}
          >
            {workflow.isActive ? t('row.pause') : t('row.resume')}
          </Button>
        </form>

        <Button
          size="sm"
          tone="danger"
          onClick={() => setRetiring(true)}
          disabled={archived}
          {...(archived ? { disabledReason: t('row.pauseBlocked') } : {})}
        >
          {lineageBlocked ? t('row.archive') : t('row.delete')}
        </Button>
      </div>

      {problem === undefined ? null : <Problem problem={problem} actingAs={actingAs} />}

      <Dialog
        open={editing}
        onClose={() => setEditing(false)}
        title={`${t('wizard.editTitle')} — ${workflow.name}`}
        action={editWorkflow}
        submitLabel={t('wizard.saveEdit')}
        actingAs={actingAs}
      >
        <input type="hidden" name="sourceId" value={workflow.sourceId} />
        <Field id={`name-${workflow.sourceId}`} label={t('wizard.name')}>
          <TextInput id={`name-${workflow.sourceId}`} name="name" defaultValue={workflow.name} />
        </Field>
        <Field id={`description-${workflow.sourceId}`} label={t('wizard.description')}>
          <Textarea
            id={`description-${workflow.sourceId}`}
            name="description"
            rows={2}
            defaultValue={workflow.description ?? ''}
          />
        </Field>
        <CheckboxRow
          name="usableForGeneration"
          value="true"
          defaultChecked={workflow.usableForGeneration}
        >
          {t('wizard.usableForGeneration')}
        </CheckboxRow>
        <fieldset className="flex flex-col gap-3">
          <legend className="text-base font-semibold text-brand-navy-text">
            {t('wizard.scheduling')}
          </legend>
          <ScheduleFields capabilities={capabilities} schedule={workflow.schedule} />
        </fieldset>
      </Dialog>

      <Dialog
        open={retiring}
        onClose={() => setRetiring(false)}
        title={`${t('retire.title')} — ${workflow.name}`}
        description={lineageBlocked ? t('retire.archiveBody') : t('retire.deleteBody')}
        action={retireWorkflow}
        submitLabel={lineageBlocked ? t('retire.archive') : t('retire.delete')}
        actingAs={actingAs}
        tone="danger"
      >
        <input type="hidden" name="sourceId" value={workflow.sourceId} />
        {/* The intent is explicit. A delete that silently became an archive
            would leave an operator believing data was gone. */}
        <input type="hidden" name="intent" value={lineageBlocked ? 'ARCHIVE' : 'DELETE'} />
      </Dialog>
    </div>
  );
};
