import { Button, EmptyState, Field, PageHero, Select } from '@knowzy/shared-ui';
import { t } from '../../copy';
import { api, type ApiResult } from '../../lib/api';
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
export default async function GeneratePage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; document?: string }>;
}) {
  const query = await searchParams;
  const sources = await api<{ sources: readonly SourceRow[] }>('/api/v1/authoring/sources');
  if (!sources.ok) {
    return (
      <div className="flex flex-col gap-6">
        <PageHero title={t('generate.heading')} purpose={t('generate.intro')} />
        <Problem problem={sources.problem} />
      </div>
    );
  }

  // EVAL-M1: the source is CHOSEN, not implied. Until 2026-09-28 the wizard
  // always took the first usable source, and with a network provider active
  // that silently decided which company documents were sent to it. The choice
  // is a plain GET form (`?source=`), so it needs no client state and a link
  // to a source's Generate page is shareable. An unknown or unusable id falls
  // back to the first usable source rather than to an error page.
  const usable = sources.data.sources.filter((candidate) => candidate.usableForGeneration);
  const source = usable.find((candidate) => candidate.sourceId === query.source) ?? usable[0];
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
      // Every PAGE, too: the listing is paged, and a source past one page
      // (the Assessment-prepared documents source grows with every version)
      // would otherwise drop documents from the list without a word.
      const all: Item[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 50; page += 1) {
        const items: ApiResult<{ items: readonly Item[]; nextCursor?: string | null }> = await api<{
          items: readonly Item[];
          nextCursor?: string | null;
        }>(
          `/api/v1/authoring/sources/${source.sourceId}/items?containerId=${encodeURIComponent(
            container.containerId,
          )}&recursive=true&pageSize=200${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`,
        );
        if (!items.ok) break;
        all.push(...items.data.items);
        cursor = items.data.nextCursor ?? null;
        if (cursor === null) break;
      }
      for (const item of all) {
        if (item.documentId === null || !item.isSelectable) continue;
        documents.push({
          documentId: item.documentId,
          name: item.name,
          containerName:
            item.folderPath === '' || item.folderPath === undefined
              ? container.containerName
              : `${container.containerName}/${item.folderPath}`,
          sectionCount: item.sectionCount ?? 0,
          // AI Document Studio M3: "Generate questions now" names the document.
          preselected: item.documentId === query.document,
          prepared: / - Assessment-prepared v\d+ \([0-9a-f]{8}\)\.md$/.test(item.name),
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
      <PageHero title={t('generate.heading')} purpose={t('generate.intro')} />

      {/* The source, stated once (UX-M2). It was in the hero AND in a
          free-standing selector below it; now one control says which source
          the documents come from, and is a selector only when there is a
          choice to make. */}
      {usable.length <= 1 ? (
        <p className="text-base text-ink">
          <span className="font-semibold">{t('generate.sourceFixed')}:</span> {source.name}
        </p>
      ) : (
        <form method="get" className="flex flex-wrap items-end gap-3">
          <Field
            id="source"
            label={t('generate.sourceChoiceLabel')}
            hint={t('generate.sourceChoiceHint')}
          >
            <Select id="source" name="source" defaultValue={source.sourceId}>
              {usable.map((candidate) => (
                <option key={candidate.sourceId} value={candidate.sourceId}>
                  {candidate.name}
                </option>
              ))}
            </Select>
          </Field>
          <Button tone="secondary" size="sm">
            {t('generate.sourceChoiceApply')}
          </Button>
        </form>
      )}

      {!containers.ok ? <Problem problem={containers.problem} /> : null}
      {!taxonomy.ok ? <Problem problem={taxonomy.problem} /> : null}

      {taxonomy.ok ? (
        <GenerateWizard
          // A different source is a different wizard: no preflight or
          // selection carries over from the last one.
          key={source.sourceId}
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
