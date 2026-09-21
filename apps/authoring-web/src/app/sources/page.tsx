import {
  ButtonLink,
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
  PageHero,
} from '@knowzy/shared-ui';
import { Database, FileText, PlugZap } from 'lucide-react';
import { t } from '../../copy';
import { api } from '../../lib/api';
import { Problem } from '../../components/Problem';
import { SourceActions } from '../../components/SourceActions';

interface SourceRow {
  readonly sourceId: string;
  readonly name: string;
  readonly description: string | null;
  readonly sourceType: string;
  readonly isActive: boolean;
  readonly usableForGeneration: boolean;
  readonly connectionStatus: string;
  readonly connectionStatusAt: string | null;
  readonly pathCount: number;
  readonly documentCount: number;
}

/** Shown as a date, not an ISO string: this is a page, not a log line. */
const formatTested = (value: string | null): string =>
  value === null
    ? t('sources.never')
    : new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

/**
 * How long ago, from the timestamp the payload already carries.
 *
 * An administrator's real question about a connection check is not "when" but
 * "how stale", and the answer is derived from the field rather than stored.
 */
const relativeTo = (value: string | null): string | null => {
  if (value === null) return null;
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (!Number.isFinite(minutes) || minutes < 0) return null;
  if (minutes < 1) return t('sources.justNow');
  if (minutes < 60) return t('sources.minutesAgo', { minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('sources.hoursAgo', { hours });
  return t('sources.daysAgo', { days: Math.floor(hours / 24) });
};

/**
 * Knowledge Sources.
 *
 * Read on the server, as the selected subject. A caller without `source.read`
 * gets the API's own refusal rendered here rather than an empty table, because
 * an empty table would read as "no sources exist".
 *
 * UI-M2 converted this screen to the design system. The reads, the two server
 * actions, and every refusal are unchanged.
 *
 * The three figures at the top are counted from the list this page already
 * holds — capability matrix row "KPI: Total / Active sources, Last sync",
 * IMPLEMENTED (derive in page). There is no "vs last month" anywhere on them,
 * because no history is stored to compare against. The specification's Owner
 * and Scope columns are absent for the same reason: `KnowledgeSource` has no
 * owner field, and an invented one would be a name presented as fact.
 */
export default async function SourcesPage() {
  const result = await api<{ sources: readonly SourceRow[] }>('/api/v1/authoring/sources');
  const sources = result.ok ? result.data.sources : [];

  return (
    <div className="flex flex-col gap-6">
      <PageHero title={t('sources.heading')} purpose={t('sources.intro')} />

      {!result.ok ? <Problem problem={result.problem} /> : null}

      {result.ok && sources.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <KpiCard
            label={t('sources.kpiTotal')}
            value={sources.length}
            icon={<Database aria-hidden="true" className="size-5" />}
          />
          <KpiCard
            label={t('sources.kpiUsable')}
            value={sources.filter((source) => source.usableForGeneration).length}
            icon={<PlugZap aria-hidden="true" className="size-5" />}
            caption={t('sources.kpiUsableNote')}
          />
          <KpiCard
            label={t('sources.kpiDocuments')}
            value={sources.reduce((total, source) => total + source.documentCount, 0)}
            icon={<FileText aria-hidden="true" className="size-5" />}
          />
        </div>
      ) : null}

      {result.ok && sources.length === 0 ? (
        <EmptyState title={t('sources.empty')} description={t('sources.emptyBody')} />
      ) : null}

      {result.ok && sources.length > 0 ? (
        <DataTable caption={t('sources.tableCaption')}>
          <THead>
            <Tr>
              <Th scope="col">{t('sources.name')}</Th>
              <Th scope="col">{t('sources.health')}</Th>
              <Th scope="col">{t('sources.scope')}</Th>
              <Th scope="col">{t('sources.usableForGeneration')}</Th>
              <Th scope="col">{t('sources.actions')}</Th>
            </Tr>
          </THead>
          <TBody>
            {sources.map((source) => (
              <Tr key={source.sourceId}>
                <Th scope="row">
                  {source.name}
                  {source.description === null ? null : (
                    <span className="mt-0.5 block text-sm font-normal text-ink-subtle">
                      {source.description}
                    </span>
                  )}
                </Th>
                <Td>
                  {/* Health in one cell: what the connection is, whether the
                      source is active at all, and how stale the check is. */}
                  <span className="flex flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={source.connectionStatus} />
                      <StatusBadge
                        status={source.isActive ? t('sources.activeYes') : t('sources.activeNo')}
                        tone={source.isActive ? 'success' : 'neutral'}
                      />
                    </span>
                    <span className="text-sm text-ink-subtle">
                      {t('sources.statusAt')}: {formatTested(source.connectionStatusAt)}
                      {relativeTo(source.connectionStatusAt) === null
                        ? ''
                        : ` · ${relativeTo(source.connectionStatusAt)}`}
                    </span>
                  </span>
                </Td>
                <Td>
                  <span className="flex flex-col gap-0.5">
                    <span className="text-base">
                      {t('sources.scopeSummary', {
                        paths: source.pathCount,
                        documents: source.documentCount,
                      })}
                    </span>
                    <span className="text-sm text-ink-subtle">{source.sourceType}</span>
                  </span>
                </Td>
                <Td>
                  {/* The gate on generation, so it is stated rather than
                      implied: a source that cannot be generated from would
                      otherwise make the Generate page refuse for no visible
                      reason. */}
                  <StatusBadge
                    status={source.usableForGeneration ? t('browser.yes') : t('browser.no')}
                    tone={source.usableForGeneration ? 'success' : 'warning'}
                  />
                </Td>
                <Td>
                  <ButtonLink href={`/sources/${source.sourceId}`} size="sm">
                    {t('sources.browse')}
                  </ButtonLink>
                </Td>
              </Tr>
            ))}
          </TBody>
        </DataTable>
      ) : null}

      {sources.map((source) => (
        <Card key={source.sourceId}>
          <CardHeader title={source.name} description={t('sources.operationsSubtitle')} />
          <CardBody>
            <SourceActions sourceId={source.sourceId} sourceName={source.name} />
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
