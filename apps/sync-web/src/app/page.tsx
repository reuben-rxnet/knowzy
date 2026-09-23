// The operational dashboard — the whole application, on one page.
//
// The approved design is explicit: a single-page console with no left
// navigation, everything visible at once — KPI summary, action bar, workflow
// table, recent activity. So this is one route, and there is no second page to
// navigate to.
//
// Every figure comes from `GET /authoring/sync/overview`, which counts rows.
// There are no trends and no comparisons, because nothing in this platform
// stores KPI history — the caption under the KPIs says so rather than leaving
// a reader to assume a flat number means "no change".

import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  KpiCard,
  StatusBadge,
  TBody,
  THead,
  Td,
  Th,
  Tr,
  statusTone,
} from '@knowzy/shared-ui';
import { t } from '../copy';
import { api } from '../lib/api';
import { currentSubject, DEMO_SUBJECTS } from '../lib/identity';
import { Problem } from '../components/Problem';
import {
  ActionBar,
  RowActions,
  type Capabilities,
  type WorkflowRow,
} from '../components/WorkflowActions';
import { switchSubject } from './actions';

export const dynamic = 'force-dynamic';

interface Run {
  readonly syncId: string;
  readonly outcome: string;
  readonly mode: string;
  readonly trigger: string;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly durationMs: number | null;
  readonly scanned: number;
  readonly added: number;
  readonly modified: number;
  readonly unchanged: number;
  readonly failed: number;
  readonly skipped: number;
  readonly extractedChars: number;
}

interface Workflow extends WorkflowRow {
  readonly connectionStatus: string;
  readonly connectionStatusAt: string | null;
  readonly documentCount: number;
  readonly paths: readonly {
    readonly pathId: string;
    readonly containerName: string;
    readonly folderPath: string;
    readonly isActive: boolean;
  }[];
  readonly schedule: WorkflowRow['schedule'] & { readonly nextRunAt: string | null };
  readonly lastRun: Run | null;
  readonly lastSuccessfulRun: Run | null;
}

interface Overview {
  readonly asOf: string;
  readonly windowDays: number;
  readonly workflows: readonly Workflow[];
  readonly kpis: {
    readonly configuredSources: number;
    readonly activeSources: number;
    readonly successfulRuns: number;
    readonly partialRuns: number;
    readonly failedRuns: number;
    readonly runningRuns: number;
    readonly pendingScheduled: number;
    readonly documentsIndexed: number;
  };
  readonly connection: {
    readonly healthyConnections: number;
    readonly degradedConnections: number;
    readonly failedConnections: number;
    readonly lastCheckedAt: string | null;
  };
  readonly activity: readonly (Run & {
    readonly sourceId: string;
    readonly sourceName: string;
  })[];
}

const when = (value: string | null): string =>
  value === null
    ? t('table.never')
    : new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

/** A next run, with "overdue" said out loud when it is in the past. */
const nextRunLabel = (workflow: Workflow, asOf: string): string => {
  if (workflow.schedule.mode === 'MANUAL') return t('table.nextRunManual');
  if (workflow.schedule.mode === 'CRON') return t('table.nextRunCron');
  if (workflow.schedule.nextRunAt === null) return t('table.nextRunManual');
  const next = new Date(workflow.schedule.nextRunAt).getTime();
  const label = when(workflow.schedule.nextRunAt);
  return next < new Date(asOf).getTime() ? `${label} (${t('table.overdue')})` : label;
};

const scheduleLabel = (workflow: Workflow): string => {
  switch (workflow.schedule.mode) {
    case 'MANUAL':
      return t('schedule.modeMANUAL');
    case 'HOURLY':
      return workflow.schedule.intervalHours === undefined || workflow.schedule.intervalHours === 1
        ? t('schedule.modeHOURLY')
        : `${t('schedule.modeHOURLY')} (${workflow.schedule.intervalHours}h)`;
    case 'CRON':
      return `${t('schedule.modeCRON')}: ${workflow.schedule.cron ?? ''}`;
    default:
      return t(`schedule.mode${workflow.schedule.mode}` as never);
  }
};

const activityMessage = (outcome: string): string => {
  switch (outcome) {
    case 'SUCCEEDED':
      return t('activity.completed');
    case 'PARTIAL':
      return t('activity.partial');
    case 'FAILED':
      return t('activity.failed');
    case 'RUNNING':
      return t('activity.running');
    default:
      return t('activity.cancelled');
  }
};

export default async function SyncManagerDashboard() {
  const subject = await currentSubject();
  const [overview, capabilities] = await Promise.all([
    api<Overview>('/api/v1/authoring/sync/overview'),
    api<Capabilities>('/api/v1/authoring/sync/capabilities'),
  ]);

  if (!overview.ok) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold text-brand-navy-text">{t('table.heading')}</h1>
        <Problem problem={overview.problem} actingAs={subject.label} />
      </div>
    );
  }

  const data = overview.data;
  const caps: Capabilities = capabilities.ok
    ? capabilities.data
    : { sourceTypes: [], allowedLocalRoots: [], scheduleModes: [], unsupported: [] };

  const health =
    data.connection.failedConnections > 0
      ? { label: t('header.disconnected'), tone: 'danger' as const }
      : data.connection.degradedConnections > 0
        ? { label: t('header.warning'), tone: 'warning' as const }
        : { label: t('header.connected'), tone: 'success' as const };

  return (
    <div className="flex flex-col gap-6">
      {/* Service health, with the time it was last actually checked — not a
          live probe dressed up as one. */}
      <section className="sync-card flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="flex items-center gap-3">
          <StatusBadge status={health.label} tone={health.tone} />
          <span className="text-2xs text-ink-muted">
            {t('header.lastChecked')}:{' '}
            <span className="font-semibold text-brand-navy-text">
              {data.connection.lastCheckedAt === null
                ? t('header.never')
                : when(data.connection.lastCheckedAt)}
            </span>
          </span>
        </div>
        {/* The identity picker. This portal authorizes as the AUTHORING
            context, so the same seeded identities apply and a refusal can be
            reproduced by switching here. */}
        <form action={switchSubject} className="flex items-center gap-2">
          <label htmlFor="subject" className="text-2xs text-ink-muted">
            {t('header.identity')}
          </label>
          <select
            id="subject"
            name="subject"
            defaultValue={subject.upn}
            className="min-h-target rounded-md border border-line bg-brand-surface px-2 py-1 text-sm"
          >
            {DEMO_SUBJECTS.map((option) => (
              <option key={option.upn} value={option.upn}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="min-h-target rounded-md bg-brand-blue px-3 py-1 text-sm font-semibold text-white"
          >
            {t('header.identity')}
          </button>
        </form>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard
          label={t('kpi.workflows')}
          value={data.kpis.configuredSources}
          caption={t('kpi.workflowsCaption', {
            active: data.kpis.activeSources,
            total: data.kpis.configuredSources,
          })}
        />
        <KpiCard
          label={t('kpi.successful')}
          value={data.kpis.successfulRuns}
          caption={t('kpi.windowCaption', { days: data.windowDays })}
        />
        <KpiCard
          label={t('kpi.failed')}
          value={data.kpis.failedRuns}
          caption={t('kpi.windowCaption', { days: data.windowDays })}
        />
        <KpiCard
          label={t('kpi.pending')}
          value={data.kpis.pendingScheduled}
          caption={t('kpi.pendingCaption')}
        />
        <KpiCard
          label={t('kpi.documents')}
          value={data.kpis.documentsIndexed}
          caption={t('kpi.documentsCaption')}
        />
      </div>
      <p className="text-2xs text-ink-muted">{t('kpi.asOf', { time: when(data.asOf) })}</p>

      <ActionBar capabilities={caps} actingAs={subject.label} />

      <Card>
        <CardHeader title={t('table.heading')} description={t('table.destinationNote')} />
        <CardBody>
          {data.workflows.length === 0 ? (
            <EmptyState title={t('table.empty')} />
          ) : (
            <DataTable caption={t('table.caption')} captionHidden>
              <THead>
                <Tr>
                  <Th scope="col">{t('table.name')}</Th>
                  <Th scope="col">{t('table.scope')}</Th>
                  <Th scope="col">{t('table.destination')}</Th>
                  <Th scope="col">{t('table.schedule')}</Th>
                  <Th scope="col">{t('table.lastRun')}</Th>
                  <Th scope="col">{t('table.nextRun')}</Th>
                  <Th scope="col">{t('table.status')}</Th>
                  <Th scope="col" align="end">
                    {t('table.documents')}
                  </Th>
                  <Th scope="col">{t('table.actions')}</Th>
                </Tr>
              </THead>
              <TBody>
                {data.workflows.map((workflow) => (
                  <Tr key={workflow.sourceId}>
                    <Th scope="row">
                      <span className="flex flex-col gap-1">
                        <span className="font-semibold text-ink">{workflow.name}</span>
                        <span className="font-mono text-2xs text-ink-muted">
                          {workflow.sourceType}
                        </span>
                      </span>
                    </Th>
                    <Td>
                      {workflow.paths.length === 0 ? (
                        <span className="text-2xs text-warning">{t('table.noPaths')}</span>
                      ) : (
                        <span className="flex flex-col gap-0.5">
                          {workflow.paths.slice(0, 3).map((path) => (
                            <span key={path.pathId} className="text-2xs text-ink-muted">
                              {path.containerName}
                              {path.folderPath.length > 0 ? ` / ${path.folderPath}` : ''}
                            </span>
                          ))}
                          {workflow.paths.length > 3 ? (
                            <span className="text-2xs text-ink-subtle">
                              {t('table.pathCount', { count: workflow.paths.length })}
                            </span>
                          ) : null}
                        </span>
                      )}
                    </Td>
                    <Td>
                      {/* The destination column the approved design asks for.
                          It states where content actually goes rather than
                          showing an empty SharePoint destination. */}
                      <Badge tone="neutral" withIcon={false}>
                        {t('table.destinationValue')}
                      </Badge>
                    </Td>
                    <Td>
                      <span className="flex flex-col gap-0.5">
                        <span className="text-sm text-ink">{scheduleLabel(workflow)}</span>
                        {workflow.schedule.mode === 'MANUAL' ? null : (
                          <span className="text-2xs text-ink-muted">
                            {workflow.schedule.timezone}
                          </span>
                        )}
                      </span>
                    </Td>
                    <Td>
                      <span className="flex flex-col gap-0.5">
                        <span className="text-sm text-ink">
                          {when(workflow.lastRun?.startedAt ?? null)}
                        </span>
                        {workflow.lastRun === null ? null : (
                          <span className="text-2xs text-ink-muted">
                            {t('activity.counts', {
                              scanned: workflow.lastRun.scanned,
                              added: workflow.lastRun.added,
                              modified: workflow.lastRun.modified,
                              failed: workflow.lastRun.failed,
                              skipped: workflow.lastRun.skipped,
                            })}
                          </span>
                        )}
                      </span>
                    </Td>
                    <Td>
                      <span className="text-sm text-ink">{nextRunLabel(workflow, data.asOf)}</span>
                    </Td>
                    <Td>
                      {/* Text AND an icon, per the accessibility requirement:
                          colour alone never carries the status. */}
                      <StatusBadge status={workflow.status} tone={statusTone(workflow.status)} />
                    </Td>
                    <Td numeric>{workflow.documentCount}</Td>
                    <Td>
                      <RowActions
                        workflow={workflow}
                        capabilities={caps}
                        actingAs={subject.label}
                        lineageBlocked={workflow.documentCount > 0 || workflow.lastRun !== null}
                      />
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </DataTable>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t('activity.heading')} description={t('activity.intro')} />
        <CardBody>
          {data.activity.length === 0 ? (
            <EmptyState title={t('activity.empty')} />
          ) : (
            <ol className="flex flex-col divide-y divide-line">
              {data.activity.map((event) => (
                <li key={event.syncId} className="flex flex-wrap items-center gap-3 py-2">
                  <StatusBadge status={event.outcome} tone={statusTone(event.outcome)} />
                  <span className="font-semibold text-ink">{event.sourceName}</span>
                  <span className="text-sm text-ink">{activityMessage(event.outcome)}</span>
                  <span className="text-2xs text-ink-muted">
                    {t('activity.counts', {
                      scanned: event.scanned,
                      added: event.added,
                      modified: event.modified,
                      failed: event.failed,
                      skipped: event.skipped,
                    })}
                  </span>
                  <span className="text-2xs text-ink-muted">
                    {t('activity.trigger', {
                      trigger:
                        event.trigger === 'SCHEDULE'
                          ? t('activity.scheduled')
                          : t('activity.manual'),
                    })}
                  </span>
                  <span className="ml-auto text-2xs text-ink-subtle">{when(event.startedAt)}</span>
                </li>
              ))}
            </ol>
          )}
        </CardBody>
      </Card>

      {/* What this release cannot do, listed by the API rather than by this
          screen, so the reason travels with the refusal. */}
      {caps.unsupported.length === 0 ? null : (
        <Card>
          <CardHeader
            title={t('state.unsupportedHeading')}
            description={t('state.unsupportedIntro')}
          />
          <CardBody>
            <ul className="flex flex-col gap-1">
              {caps.unsupported.map((entry) => (
                <li key={entry.capability} className="text-sm text-ink-muted">
                  <span className="font-mono text-2xs text-ink">{entry.capability}</span> —{' '}
                  {entry.reason}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
