import Link from 'next/link';
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

const statusClass = (status: string): string =>
  status === 'HEALTHY' ? 'pass' : status === 'UNKNOWN' ? 'warn' : 'fail';

/**
 * Knowledge Sources.
 *
 * Read on the server, as the selected subject. A caller without
 * `source.read` gets the API's own refusal rendered here rather than an empty
 * table, because an empty table would read as "no sources exist".
 */
export default async function SourcesPage() {
  const result = await api<{ sources: readonly SourceRow[] }>('/api/v1/authoring/sources');

  return (
    <article>
      <h1>{t('sources.heading')}</h1>
      <p className="lede">{t('sources.intro')}</p>

      {!result.ok ? <Problem problem={result.problem} /> : null}

      {result.ok && result.data.sources.length === 0 ? <p>{t('sources.empty')}</p> : null}

      {result.ok
        ? result.data.sources.map((source) => (
            <section key={source.sourceId}>
              <h2>{source.name}</h2>
              {source.description === null ? null : <p className="lede">{source.description}</p>}
              <dl className="kv">
                <dt>{t('sources.type')}</dt>
                <dd>{source.sourceType}</dd>
                <dt>{t('sources.status')}</dt>
                <dd className={statusClass(source.connectionStatus)}>{source.connectionStatus}</dd>
                <dt>{t('sources.statusAt')}</dt>
                <dd>
                  {source.connectionStatusAt === null
                    ? t('sources.never')
                    : new Date(source.connectionStatusAt).toISOString()}
                </dd>
                <dt>{t('sources.paths')}</dt>
                <dd>{source.pathCount}</dd>
                <dt>{t('sources.documents')}</dt>
                <dd>{source.documentCount}</dd>
                <dt>{t('sources.usableForGeneration')}</dt>
                <dd className={source.usableForGeneration ? 'pass' : 'fail'}>
                  {source.usableForGeneration ? t('browser.yes') : t('browser.no')}
                </dd>
              </dl>

              <SourceActions sourceId={source.sourceId} />

              <p>
                <Link href={`/sources/${source.sourceId}`}>{t('sources.browse')}</Link>
              </p>
            </section>
          ))
        : null}
    </article>
  );
}
