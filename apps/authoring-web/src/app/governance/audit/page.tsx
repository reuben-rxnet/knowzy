// Governance → Audit Explorer — authoring-portal.md §10.
//
// The store holds every state change this platform has ever made: 64,479 events
// on this machine, written by every milestone since M1. Until now nothing could
// read them, which made the append-only audit trail a promise rather than a
// control — an audit nobody can query is an audit nobody has.
//
// Four things §10 asks for and this screen does:
//
//   * filter by actor, action, family, entity, outcome, correlation id and date
//     range — as a GET form, so a filtered view is a URL somebody can send;
//   * the CORRELATED TRACE: every event sharing a correlation id, in order,
//     across API, MCP and the job runner, in the detail drawer;
//   * drill from an entity to its own chain;
//   * export the filtered set as CSV, with the export itself audited.
//
// Nothing is redacted here, and that is deliberate: audit-model.md §7 says
// auditors read unscoped, and it is safe because redaction happened at WRITE
// time. No secret, token or document body was ever written, so there is nothing
// on this screen to hide.

import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  FilterBar,
  KpiCard,
  PageHero,
  StatusBadge,
  TBody,
  THead,
  TabNav,
  Td,
  Th,
  Tr,
  type FilterDefinition,
} from '@knowzy/shared-ui';
import { CircleSlash, ScrollText, ShieldAlert, ShieldCheck } from 'lucide-react';
import { t } from '../../../copy';
import { api } from '../../../lib/api';
import { Problem } from '../../../components/Problem';
import { AuditRowActions, AuditExportButton } from '../../../components/AuditExplorer';
import { currentSubject } from '../../../lib/identity';
import { GOVERNANCE_TABS } from '../tabs';

interface AuditRow {
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
  readonly entityLabel: string | null;
  readonly correlationId: string;
  readonly portal: string | null;
  readonly denyReason: string | null;
}

interface AuditPage {
  readonly rows: readonly AuditRow[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly windowFrom: string;
  readonly windowTo: string;
  readonly outcomeCounts: Readonly<Record<string, number>>;
  readonly topActions: readonly { readonly action: string; readonly count: number }[];
  readonly truncated: boolean;
  readonly facets: {
    readonly actions: readonly string[];
    readonly families: readonly string[];
    readonly entityTypes: readonly string[];
    readonly actors: readonly { readonly userId: string; readonly displayName: string }[];
  };
}

const QUERY_KEYS = [
  'from',
  'to',
  'actorUserId',
  'action',
  'family',
  'category',
  'entityType',
  'entityId',
  'outcome',
  'correlationId',
  'page',
  'pageSize',
] as const;

const first = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? (value[0] ?? '') : (value ?? '');

const stamp = (iso: string): string => new Date(iso).toLocaleString('en-GB');

export const dynamic = 'force-dynamic';

export default async function AuditExplorerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const subject = await currentSubject();

  const query = new URLSearchParams();
  for (const key of QUERY_KEYS) {
    const value = first(params[key]);
    if (value.length > 0) query.set(key, value);
  }
  const suffix = query.size === 0 ? '' : `?${query.toString()}`;

  const result = await api<AuditPage>(`/api/v1/authoring/governance/audit${suffix}`);

  if (!result.ok) {
    return (
      <div className="flex flex-col gap-6">
        <PageHero title={t('audit.heading')} purpose={t('audit.intro')} />
        <TabNav
          items={GOVERNANCE_TABS.map((tab) => ({ href: tab.href, label: t(tab.labelKey) }))}
          activeHref="/governance/audit"
          ariaLabel={t('audit.tabsLabel')}
        />
        <Problem problem={result.problem} actingAs={subject.label} />
      </div>
    );
  }

  const data = result.data;
  const currentPage = data.page;
  const lastPage = Math.max(1, Math.ceil(data.total / data.pageSize));

  const pageHref = (target: number): string => {
    const next = new URLSearchParams(query);
    next.set('page', String(target));
    return `/governance/audit?${next.toString()}`;
  };

  const option = (value: string) => ({ value, label: value });
  const filters: readonly FilterDefinition[] = [
    {
      id: 'audit-family',
      name: 'family',
      label: t('audit.filterFamily'),
      value: first(params['family']),
      // Facets come from the STORE, not the 159-action registry: offering a
      // filter that can only return nothing wastes the reader's time and makes
      // the screen look broken.
      options: [{ value: '', label: t('audit.filterAll') }, ...data.facets.families.map(option)],
    },
    {
      id: 'audit-action',
      name: 'action',
      label: t('audit.filterAction'),
      value: first(params['action']),
      options: [{ value: '', label: t('audit.filterAll') }, ...data.facets.actions.map(option)],
    },
    {
      id: 'audit-actor',
      name: 'actorUserId',
      label: t('audit.filterActor'),
      value: first(params['actorUserId']),
      options: [
        { value: '', label: t('audit.filterAll') },
        ...data.facets.actors.map((actor) => ({
          value: actor.userId,
          label: actor.displayName,
        })),
      ],
    },
    {
      id: 'audit-entity',
      name: 'entityType',
      label: t('audit.filterEntity'),
      value: first(params['entityType']),
      options: [{ value: '', label: t('audit.filterAll') }, ...data.facets.entityTypes.map(option)],
    },
    {
      id: 'audit-outcome',
      name: 'outcome',
      label: t('audit.filterOutcome'),
      value: first(params['outcome']),
      options: [
        { value: '', label: t('audit.filterAll') },
        { value: 'SUCCESS', label: t('audit.outcomeSuccess') },
        { value: 'FAILURE', label: t('audit.outcomeFailure') },
        { value: 'DENIED', label: t('audit.outcomeDenied') },
      ],
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHero title={t('audit.heading')} purpose={t('audit.intro')} />

      <TabNav
        items={GOVERNANCE_TABS.map((tab) => ({ href: tab.href, label: t(tab.labelKey) }))}
        activeHref="/governance/audit"
        ariaLabel={t('audit.tabsLabel')}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label={t('audit.kpiTotal')}
          value={data.total.toLocaleString('en-GB')}
          caption={t('audit.window', {
            from: stamp(data.windowFrom),
            to: stamp(data.windowTo),
          })}
          icon={<ScrollText className="size-5" />}
        />
        <KpiCard
          label={t('audit.kpiSuccess')}
          value={(data.outcomeCounts['SUCCESS'] ?? 0).toLocaleString('en-GB')}
          icon={<ShieldCheck className="size-5" />}
          tone="success"
        />
        <KpiCard
          label={t('audit.kpiFailure')}
          value={(data.outcomeCounts['FAILURE'] ?? 0).toLocaleString('en-GB')}
          icon={<ShieldAlert className="size-5" />}
          tone="warning"
        />
        <KpiCard
          label={t('audit.kpiDenied')}
          value={(data.outcomeCounts['DENIED'] ?? 0).toLocaleString('en-GB')}
          caption={t('audit.kpiDeniedNote')}
          icon={<CircleSlash className="size-5" />}
          tone="warning"
        />
      </div>

      <Card>
        <CardHeader
          title={t('audit.filtersHeading')}
          description={t('audit.filtersNote')}
          actions={<AuditExportButton query={query.toString()} actingAs={subject.label} />}
        />
        <CardBody>
          <div className="flex flex-col gap-4">
            <FilterBar
              filters={filters}
              applyLabel={t('audit.apply')}
              resetLabel={t('audit.reset')}
              resetHref="/governance/audit"
            >
              <div className="min-w-44 flex-1">
                <label
                  htmlFor="audit-from"
                  className="mb-1 block text-2xs font-semibold uppercase tracking-wide text-ink-muted"
                >
                  {t('audit.filterFrom')}
                </label>
                <input
                  id="audit-from"
                  name="from"
                  type="date"
                  defaultValue={first(params['from'])}
                  className="min-h-target w-full rounded-md border border-line bg-brand-surface px-3 py-2 text-base text-ink"
                />
              </div>
              <div className="min-w-44 flex-1">
                <label
                  htmlFor="audit-to"
                  className="mb-1 block text-2xs font-semibold uppercase tracking-wide text-ink-muted"
                >
                  {t('audit.filterTo')}
                </label>
                <input
                  id="audit-to"
                  name="to"
                  type="date"
                  defaultValue={first(params['to'])}
                  className="min-h-target w-full rounded-md border border-line bg-brand-surface px-3 py-2 text-base text-ink"
                />
              </div>
              <div className="min-w-56 flex-1">
                <label
                  htmlFor="audit-correlation"
                  className="mb-1 block text-2xs font-semibold uppercase tracking-wide text-ink-muted"
                >
                  {t('audit.filterCorrelation')}
                </label>
                <input
                  id="audit-correlation"
                  name="correlationId"
                  defaultValue={first(params['correlationId'])}
                  placeholder={t('audit.filterCorrelationHint')}
                  className="min-h-target w-full rounded-md border border-line bg-brand-surface px-3 py-2 font-mono text-sm text-ink"
                />
              </div>
            </FilterBar>

            {/* The busiest actions in the filtered window, each a link that
                narrows to itself: the fastest way to answer "what is all this?" */}
            {data.topActions.length === 0 ? null : (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-2xs uppercase tracking-wide text-ink-muted">
                  {t('audit.topActions')}
                </span>
                {data.topActions.map((entry) => {
                  const next = new URLSearchParams(query);
                  next.set('action', entry.action);
                  next.delete('page');
                  return (
                    <a
                      key={entry.action}
                      href={`/governance/audit?${next.toString()}`}
                      className="rounded-full border border-line px-2.5 py-1 font-mono text-2xs text-ink-muted hover:border-brand-blue hover:text-brand-navy-text"
                    >
                      {entry.action}
                      <span className="ml-1.5 font-sans font-semibold text-ink">
                        {entry.count.toLocaleString('en-GB')}
                      </span>
                    </a>
                  );
                })}
              </div>
            )}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={t('audit.eventsHeading')}
          description={t('audit.pageOf', {
            page: String(currentPage),
            last: String(lastPage),
            total: data.total.toLocaleString('en-GB'),
          })}
        />
        <CardBody>
          {data.rows.length === 0 ? (
            <EmptyState title={t('audit.noEvents')} description={t('audit.noEventsNote')} />
          ) : (
            <div className="flex flex-col gap-4">
              <DataTable caption={t('audit.eventsHeading')} captionHidden>
                <THead>
                  <Tr>
                    <Th scope="col">{t('audit.when')}</Th>
                    <Th scope="col">{t('audit.action')}</Th>
                    <Th scope="col">{t('audit.actor')}</Th>
                    <Th scope="col">{t('audit.entity')}</Th>
                    <Th scope="col">{t('audit.outcome')}</Th>
                    <Th scope="col">{t('audit.actions')}</Th>
                  </Tr>
                </THead>
                <TBody>
                  {data.rows.map((row) => (
                    <Tr key={row.eventId}>
                      <Th scope="row">
                        <span className="whitespace-nowrap font-mono text-sm">
                          {stamp(row.occurredAt)}
                        </span>
                      </Th>
                      <Td>
                        <span className="flex flex-col gap-1">
                          <span className="font-mono text-sm text-ink">{row.action}</span>
                          <span className="flex gap-1.5">
                            <Badge tone="neutral">{row.category}</Badge>
                            {row.severity === 'INFO' ? null : (
                              <Badge tone={row.severity === 'HIGH' ? 'danger' : 'warning'}>
                                {row.severity}
                              </Badge>
                            )}
                          </span>
                        </span>
                      </Td>
                      <Td>
                        <span className="flex flex-col gap-0.5">
                          {/* A SYSTEM actor has no display name, and inventing
                              one ("System user") would put a person where the
                              job runner was. */}
                          <span className="text-ink">
                            {row.actorDisplayName.length > 0
                              ? row.actorDisplayName
                              : t('audit.systemActor')}
                          </span>
                          <span className="text-2xs text-ink-muted">
                            {row.actorType}
                            {row.actorRoles.length === 0
                              ? ''
                              : ` · ${row.actorRoles.slice(0, 2).join(', ')}`}
                          </span>
                        </span>
                      </Td>
                      <Td>
                        <span className="flex flex-col gap-0.5">
                          <span className="text-ink">{row.entityType}</span>
                          {row.entityLabel === null ? null : (
                            <span className="max-w-64 truncate text-2xs text-ink-muted">
                              {row.entityLabel}
                            </span>
                          )}
                        </span>
                      </Td>
                      <Td>
                        <span className="flex flex-col gap-1">
                          <StatusBadge status={row.outcome} />
                          {row.denyReason === null ? null : (
                            <span className="max-w-64 text-2xs text-ink-muted">
                              {row.denyReason}
                            </span>
                          )}
                        </span>
                      </Td>
                      <Td>
                        <AuditRowActions
                          eventId={row.eventId}
                          correlationId={row.correlationId}
                          actingAs={subject.label}
                        />
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </DataTable>

              <nav
                className="flex items-center justify-between gap-3"
                aria-label={t('audit.pager')}
              >
                <a
                  href={pageHref(Math.max(1, currentPage - 1))}
                  aria-disabled={currentPage === 1}
                  className={`min-h-target rounded-md border border-line px-4 py-2 text-base ${
                    currentPage === 1 ? 'pointer-events-none text-ink-subtle' : 'text-ink'
                  }`}
                >
                  {t('audit.previous')}
                </a>
                <span className="text-sm text-ink-muted">
                  {t('audit.pageOf', {
                    page: String(currentPage),
                    last: String(lastPage),
                    total: data.total.toLocaleString('en-GB'),
                  })}
                </span>
                <a
                  href={pageHref(Math.min(lastPage, currentPage + 1))}
                  aria-disabled={currentPage >= lastPage}
                  className={`min-h-target rounded-md border border-line px-4 py-2 text-base ${
                    currentPage >= lastPage ? 'pointer-events-none text-ink-subtle' : 'text-ink'
                  }`}
                >
                  {t('audit.next')}
                </a>
              </nav>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
