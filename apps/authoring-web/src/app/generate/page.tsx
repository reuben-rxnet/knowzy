import { EmptyState, KeyValue, PageHero } from '@knowzy/shared-ui';
import { t } from '../../copy';
import { api } from '../../lib/api';
import { Problem } from '../../components/Problem';
import {
  GenerateWizard,
  type GenerationProviderChoice,
  type WizardDocument,
  type WizardDomain,
} from '../../components/GenerateWizard';

interface SourceRow {
  readonly sourceId: string;
  readonly name: string;
  readonly usableForGeneration: boolean;
}

interface Container {
  readonly containerId: string;
  readonly containerName: string;
}

interface Item {
  readonly name: string;
  readonly folderPath?: string;
  readonly documentId: string | null;
  readonly sectionCount: number | null;
  readonly isSelectable: boolean;
}

/**
 * Generate Questions.
 *
 * The server assembles the two lists the wizard needs — the selectable
 * documents and the domain/topic catalogue — and the wizard runs the three
 * steps. Only EXTRACTED documents are offered: a document with no sections has
 * nothing to ground a question in, and offering it would only produce a
 * refusal at preflight.
 *
 * UI-M2 converted the screen. The three §15 zones, the preflight, the recorded
 * decision, and the refusals are unchanged — and still no Publish button and
 * no difficulty control, both of which §15 forbids here.
 */
export default async function GeneratePage() {
  const sources = await api<{ sources: readonly SourceRow[] }>('/api/v1/authoring/sources');
  if (!sources.ok) {
    return (
      <div className="flex flex-col gap-6">
        <PageHero title={t('generate.heading')} purpose={t('generate.intro')} />
        <Problem problem={sources.problem} />
      </div>
    );
  }

  const source = sources.data.sources.find((candidate) => candidate.usableForGeneration);
  if (source === undefined) {
    return (
      <div className="flex flex-col gap-6">
        <PageHero title={t('generate.heading')} purpose={t('generate.intro')} />
        <EmptyState
          title={t('sources.empty')}
          description={t('generate.noUsableSource')}
          illustration="idea"
        />
      </div>
    );
  }

  const [containers, taxonomy] = await Promise.all([
    api<{ containers: readonly Container[] }>(
      `/api/v1/authoring/sources/${source.sourceId}/containers`,
    ),
    api<{
      domains: readonly WizardDomain[];
      departments: readonly { departmentId: string; code: string; name: string }[];
      jobRoles: readonly { jobRoleId: string; code: string; name: string }[];
    }>('/api/v1/authoring/taxonomy'),
  ]);

  const documents: WizardDocument[] = [];
  if (containers.ok) {
    for (const container of containers.data.containers) {
      // Recursive: documents live in folders inside a container, and a
      // selection list that stopped at the first level would silently omit
      // most of the library.
      const items = await api<{ items: readonly Item[] }>(
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
          containerName:
            item.folderPath === '' || item.folderPath === undefined
              ? container.containerName
              : `${container.containerName}/${item.folderPath}`,
          sectionCount: item.sectionCount ?? 0,
        });
      }
    }
  }

  // GEN-PROVIDER-M1: the providers an author may choose. If the read fails the
  // wizard falls back to the deterministic generator alone, which is always
  // available -- never to a list it cannot vouch for.
  const providers = await api<{ providers: readonly GenerationProviderChoice[] }>(
    '/api/v1/authoring/generation/providers',
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHero
        title={t('generate.heading')}
        purpose={t('generate.intro')}
        secondaryText={
          <KeyValue items={[{ label: t('generate.sourceLabel'), value: source.name }]} />
        }
      />

      {!containers.ok ? <Problem problem={containers.problem} /> : null}
      {!taxonomy.ok ? <Problem problem={taxonomy.problem} /> : null}

      {taxonomy.ok ? (
        <GenerateWizard
          sourceId={source.sourceId}
          documents={documents}
          domains={taxonomy.data.domains}
          departments={taxonomy.data.departments.map((row) => ({
            id: row.departmentId,
            code: row.code,
            name: row.name,
          }))}
          jobRoles={taxonomy.data.jobRoles.map((row) => ({
            id: row.jobRoleId,
            code: row.code,
            name: row.name,
          }))}
          {...(providers.ok ? { providers: providers.data.providers } : {})}
        />
      ) : null}
    </div>
  );
}
