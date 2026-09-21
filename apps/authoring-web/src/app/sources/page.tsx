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
              <Th scope="col">{t('sources.type')}</Th>
              <Th scope="col">{t('sources.status')}</Th>
              <Th scope="col">{t('sources.statusAt')}</Th>
              <Th scope="col" align="end">
                {t('sources.paths')}
              </Th>
              <Th scope="col" align="end">
                {t('sources.documents')}
              </Th>
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
                <Td>{source.sourceType}</Td>
                <Td>
                  <StatusBadge status={source.connectionStatus} />
                </Td>
                <Td>{formatTested(source.connectionStatusAt)}</Td>
                <Td numeric>{source.pathCount}</Td>
                <Td numeric>{source.documentCount}</Td>
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
