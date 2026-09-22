import { PageHero } from '@knowzy/shared-ui';
import { t } from '../../copy';
import { api, type ApiProblem } from '../../lib/api';
import { Problem } from '../../components/Problem';
import { ImportPanel, type ImportDocument, type ImportDomain } from '../../components/ImportPanel';

interface SourceRow {
  readonly sourceId: string;
  readonly name: string;
}

interface ItemRow {
  readonly documentId: string | null;
  readonly name: string;
  readonly isSelectable: boolean;
}

/**
 * Every synchronized, extracted document, from every source.
 *
 * Not filtered to a designated "imports" source: a question bank can arrive
 * anywhere, and hiding documents would make the screen refuse work it can
 * actually do. What it cannot do is import from a document with no extracted
 * text, and those are excluded because `isSelectable` already says so.
 */
const loadDocuments = async (): Promise<{
  documents: ImportDocument[];
  problem: ApiProblem | null;
}> => {
  const sources = await api<{ sources: readonly SourceRow[] }>('/api/v1/authoring/sources');
  if (!sources.ok) return { documents: [], problem: sources.problem };

  const documents: ImportDocument[] = [];
  for (const source of sources.data.sources) {
    const containers = await api<{ containers: readonly { containerId: string }[] }>(
      `/api/v1/authoring/sources/${source.sourceId}/containers`,
    );
    if (!containers.ok) continue;
    for (const container of containers.data.containers) {
      const items = await api<{ items: readonly ItemRow[] }>(
        `/api/v1/authoring/sources/${source.sourceId}/items?containerId=${encodeURIComponent(
          container.containerId,
        )}&recursive=true`,
      );
      if (!items.ok) continue;
      for (const item of items.data.items) {
        if (item.documentId === null || !item.isSelectable) continue;
        documents.push({
          documentId: item.documentId,
          name: item.name,
          sourceName: source.name,
        });
      }
    }
  }
  return { documents, problem: null };
};

const Page = async (): Promise<React.JSX.Element> => {
  const [{ documents, problem }, taxonomy] = await Promise.all([
    loadDocuments(),
    api<{ domains: readonly ImportDomain[] }>('/api/v1/authoring/taxonomy'),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHero title={t('import.title')} purpose={t('import.lead')} />
      {problem === null ? null : <Problem problem={problem} />}
      {taxonomy.ok ? (
        <ImportPanel documents={documents} domains={taxonomy.data.domains} />
      ) : (
        <Problem problem={taxonomy.problem} />
      )}
    </div>
  );
};

export default Page;
