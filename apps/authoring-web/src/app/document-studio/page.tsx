// AI Document Studio (docs/competencies/AI_DOCUMENT_STUDIO_ARCHITECTURE.md
// §10 Slice 2, §11 M3, §12).
//
// The platform setting documentStudio.mode decides what this address shows.
// SIMPLE (the default since §12) is upload -> quiz settings -> generate, in
// simple-studio.tsx. FULL is everything below, unchanged. An administrator
// switches between them at the foot of either page.
//
// Four views behind link tabs: Add document (the default), My prepared
// documents, History, and Readiness (Slice 2's overview and the approval
// controls). Every figure is read from the API on each visit; the evaluation
// table on Readiness carries DOCUMENTED results only.
//
// The availability banner comes first on every view and is never inferred:
// while no live provider is approved, built and configured it says the brief's
// sentence -- even where the local test preparation can run, because that is
// not AI.

import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  Field,
  PageHero,
  StatusBadge,
  TabNav,
  TBody,
  TextInput,
  THead,
  Td,
  Th,
  Tr,
} from '@knowzy/shared-ui';
import { t, type CopyKey } from '../../copy';
import { api } from '../../lib/api';
import { Problem } from '../../components/Problem';
import { currentSubject } from '../../lib/identity';
import {
  RecordRestructureApprovalButton,
  RemoveRestructureApprovalButton,
} from '../../components/DocumentStudioForms';
import { ChooseDocumentButton, UploadDocumentForm } from '../../components/StudioForms';
import { StudioModeSwitch } from '../../components/QuickQuiz';
import { SimpleStudio } from './simple-studio';
import {
  AvailabilityBanner,
  StudioProgress,
  VERSION_TONE,
  when,
  type StudioStatus,
  type VersionState,
} from './studio-shared';

type View = 'add' | 'documents' | 'history' | 'readiness';

const STATE_TONE: Readonly<Record<string, 'warning' | 'neutral' | 'success'>> = {
  BLOCKED_BY_APPROVAL: 'warning',
  NOT_BUILT: 'neutral',
  READY: 'success',
};

/** Documented EVAL-M1 figures (OPENAI_CODEX_EVALUATION_RESULTS.md §1, §3). Not computed here. */
const EVIDENCE: readonly {
  readonly label: CopyKey;
  readonly original: string;
  readonly prepared: string;
}[] = [
  { label: 'ds.rowTemplateAccepted', original: '4', prepared: '14' },
  { label: 'ds.rowTemplateCoverage', original: '3.4% (4 / 118)', prepared: '18.4% (14 / 76)' },
  { label: 'ds.rowCodexAccepted', original: '56', prepared: '49' },
  { label: 'ds.rowCodexCoverage', original: '44.1% (52 / 118)', prepared: '52.6% (40 / 76)' },
];

interface DocumentRow {
  readonly preparedDocumentId: string;
  readonly title: string;
  readonly originalName: string;
  readonly originalSourceName: string;
  readonly uploaded: boolean;
  readonly latestVersion: { readonly versionNumber: number; readonly state: VersionState } | null;
  readonly readyVersionNumber: number | null;
  readonly needsRevalidation: boolean;
  readonly updatedAt: string;
}

interface Candidate {
  readonly documentId: string;
  readonly name: string;
  readonly sourceName: string;
  readonly preparedDocumentId: string | null;
}

interface HistoryEvent {
  readonly at: string;
  readonly preparedDocumentId: string;
  readonly title: string;
  readonly kind: 'PREPARATION' | 'VERSION';
  readonly label: string;
  readonly status: string;
  readonly live: boolean;
  readonly by: string | null;
  readonly detail: string | null;
}

export const dynamic = 'force-dynamic';

export default async function DocumentStudioPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    q?: string;
    document?: string;
    source?: string;
    name?: string;
    job?: string;
    quiz?: string;
  }>;
}) {
  const query = await searchParams;
  const view: View =
    query.view === 'documents' || query.view === 'history' || query.view === 'readiness'
      ? query.view
      : 'add';
  const subject = await currentSubject();
  const status = await api<StudioStatus>('/api/v1/authoring/document-studio/status');

  const hero = <PageHero title={t('ds.heading')} purpose={t('ds.intro')} />;
  if (!status.ok) {
    return (
      <div className="flex flex-col gap-6">
        {hero}
        <Problem problem={status.problem} actingAs={subject.label} />
      </div>
    );
  }
  const data = status.data;
  const modeSwitch = data.canManage ? (
    <div className="border-t border-line pt-4">
      <StudioModeSwitch mode={data.mode} actingAs={subject.label} />
    </div>
  ) : null;
  if (data.mode === 'SIMPLE') {
    return (
      <div className="flex flex-col gap-6">
        <SimpleStudio
          query={query}
          actingAs={subject.label}
          storageConfigured={data.preparation.storageConfigured}
        />
        {modeSwitch}
      </div>
    );
  }
  const tabs = [
    { label: t('ds.tabAdd'), href: '/document-studio' },
    { label: t('ds.tabDocuments'), href: '/document-studio?view=documents' },
    { label: t('ds.tabHistory'), href: '/document-studio?view=history' },
    { label: t('ds.tabReadiness'), href: '/document-studio?view=readiness' },
  ];
  const activeHref = tabs[['add', 'documents', 'history', 'readiness'].indexOf(view)]?.href ?? '';

  return (
    <div className="flex flex-col gap-6">
      {hero}
      <StudioProgress active={t('ds.progressAdd')} added={false} prepared={false} ready={false} />
      <AvailabilityBanner status={data} />
      <TabNav items={tabs} activeHref={activeHref} ariaLabel={t('ds.tabsLabel')} />
      {view === 'add' ? (
        <AddView status={data} actingAs={subject.label} search={query.q ?? ''} />
      ) : view === 'documents' ? (
        <DocumentsView actingAs={subject.label} />
      ) : view === 'history' ? (
        <HistoryView actingAs={subject.label} />
      ) : (
        <ReadinessView status={data} actingAs={subject.label} />
      )}
      {modeSwitch}
    </div>
  );
}

const AddView = async ({
  status,
  actingAs,
  search,
}: {
  readonly status: StudioStatus;
  readonly actingAs: string;
  readonly search: string;
}) => {
  const candidates = await api<{ documents: readonly Candidate[] }>(
    `/api/v1/authoring/document-studio/candidates${search.length > 0 ? `?q=${encodeURIComponent(search)}` : ''}`,
  );
  return (
    <div className="grid items-start gap-4 xl:grid-cols-2 [&>*]:min-w-0">
      <Card>
        <CardHeader title={t('ds.uploadHeading')} />
        <CardBody>
          {status.preparation.storageConfigured ? (
            <UploadDocumentForm actingAs={actingAs} />
          ) : (
            <p className="text-sm text-ink-muted">{t('ds.noStorage')}</p>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t('ds.chooseHeading')} description={t('ds.chooseHint')} />
        <CardBody>
          <form method="get" className="mb-3 flex flex-wrap items-end gap-3">
            <Field id="ds-q" label={t('ds.searchLabel')}>
              <TextInput id="ds-q" name="q" defaultValue={search} />
            </Field>
            <Button tone="secondary" size="sm">
              {t('ds.searchButton')}
            </Button>
          </form>
          {!candidates.ok ? (
            <Problem problem={candidates.problem} actingAs={actingAs} />
          ) : candidates.data.documents.length === 0 ? (
            <p className="text-sm text-ink-muted">{t('ds.noCandidates')}</p>
          ) : (
            <div className="max-h-[32rem] overflow-y-auto">
              <DataTable caption={t('ds.chooseHeading')} captionHidden>
                <THead>
                  <Tr>
                    <Th scope="col">{t('ds.colDocument')}</Th>
                    <Th scope="col">{t('ds.colSource')}</Th>
                    <Th scope="col">{t('ds.colOpen')}</Th>
                  </Tr>
                </THead>
                <TBody>
                  {candidates.data.documents.map((row) => (
                    <Tr key={row.documentId}>
                      <Th scope="row">
                        <span className="break-words text-sm">{row.name}</span>
                      </Th>
                      <Td>{row.sourceName}</Td>
                      <Td>
                        {row.preparedDocumentId === null ? (
                          <ChooseDocumentButton documentId={row.documentId} actingAs={actingAs} />
                        ) : (
                          <a
                            className="text-sm font-medium text-brand-navy-text underline"
                            href={`/document-studio/${row.preparedDocumentId}`}
                          >
                            {t('ds.openPrepared')}
                          </a>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </DataTable>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
};

const DocumentsView = async ({ actingAs }: { readonly actingAs: string }) => {
  const list = await api<{ documents: readonly DocumentRow[] }>(
    '/api/v1/authoring/document-studio/documents',
  );
  if (!list.ok) return <Problem problem={list.problem} actingAs={actingAs} />;
  if (list.data.documents.length === 0) {
    return <EmptyState title={t('ds.noDocuments')} description={t('ds.noDocumentsBody')} />;
  }
  return (
    <Card>
      <CardBody>
        <DataTable caption={t('ds.tabDocuments')} captionHidden>
          <THead>
            <Tr>
              <Th scope="col">{t('ds.colTitle')}</Th>
              <Th scope="col">{t('ds.colOriginalDoc')}</Th>
              <Th scope="col">{t('ds.colStatus')}</Th>
              <Th scope="col">{t('ds.colReady')}</Th>
              <Th scope="col">{t('ds.colUpdated')}</Th>
            </Tr>
          </THead>
          <TBody>
            {list.data.documents.map((row) => (
              <Tr key={row.preparedDocumentId}>
                <Th scope="row">
                  <a
                    className="font-medium text-brand-navy-text underline"
                    href={`/document-studio/${row.preparedDocumentId}`}
                  >
                    {row.title}
                  </a>
                </Th>
                <Td>
                  <span className="flex flex-col">
                    <span className="break-words text-sm">{row.originalName}</span>
                    <span className="text-2xs text-ink-muted">
                      {row.uploaded ? t('ds.uploadedLabel') : row.originalSourceName}
                    </span>
                  </span>
                </Td>
                <Td>
                  {row.latestVersion === null ? (
                    <span className="text-sm text-ink-muted">{t('ds.noVersion')}</span>
                  ) : (
                    <StatusBadge
                      status={`${t('ds.versionLabel', { n: row.latestVersion.versionNumber })} · ${t(`ds.vstate.${row.latestVersion.state}` as CopyKey)}`}
                      tone={VERSION_TONE[row.latestVersion.state]}
                    />
                  )}
                </Td>
                <Td>
                  {row.readyVersionNumber === null
                    ? t('ds.notInRepository')
                    : t('ds.readyVersion', { n: row.readyVersionNumber })}
                </Td>
                <Td>{when(row.updatedAt)}</Td>
              </Tr>
            ))}
          </TBody>
        </DataTable>
      </CardBody>
    </Card>
  );
};

const HistoryView = async ({ actingAs }: { readonly actingAs: string }) => {
  const history = await api<{ events: readonly HistoryEvent[] }>(
    '/api/v1/authoring/document-studio/history',
  );
  if (!history.ok) return <Problem problem={history.problem} actingAs={actingAs} />;
  if (history.data.events.length === 0) {
    return <EmptyState title={t('ds.noHistory')} />;
  }
  return (
    <Card>
      <CardBody>
        <DataTable caption={t('ds.tabHistory')} captionHidden>
          <THead>
            <Tr>
              <Th scope="col">{t('ds.colWhen')}</Th>
              <Th scope="col">{t('ds.colTitle')}</Th>
              <Th scope="col">{t('ds.colWhat')}</Th>
              <Th scope="col">{t('ds.colOutcome')}</Th>
              <Th scope="col">{t('ds.colBy')}</Th>
            </Tr>
          </THead>
          <TBody>
            {history.data.events.map((event, index) => (
              <Tr key={`${event.at}-${index}`}>
                <Td>{when(event.at)}</Td>
                <Th scope="row">
                  <a
                    className="text-brand-navy-text underline"
                    href={`/document-studio/${event.preparedDocumentId}`}
                  >
                    {event.title}
                  </a>
                </Th>
                <Td>
                  <span className="flex flex-col">
                    <span>{event.label}</span>
                    {event.live ? null : (
                      <span className="text-2xs text-ink-muted">{t('ds.testLabel')}</span>
                    )}
                  </span>
                </Td>
                <Td>
                  <span className="flex flex-col">
                    <span>
                      {t(
                        (event.kind === 'PREPARATION'
                          ? `ds.run.${event.status}`
                          : `ds.vstate.${event.status}`) as CopyKey,
                      )}
                    </span>
                    {event.detail === null ? null : (
                      <span className="max-w-xs text-2xs text-ink-muted">{event.detail}</span>
                    )}
                  </span>
                </Td>
                <Td>{event.by ?? '—'}</Td>
              </Tr>
            ))}
          </TBody>
        </DataTable>
      </CardBody>
    </Card>
  );
};

const ReadinessView = ({
  status,
  actingAs,
}: {
  readonly status: StudioStatus;
  readonly actingAs: string;
}) => (
  <div className="flex flex-col gap-6">
    <Card>
      <CardHeader title={t('ds.stateHeading')} />
      <CardBody>
        <div className="flex flex-col gap-2" data-studio-state={status.state}>
          <span>
            <StatusBadge
              status={t(`ds.state.${status.state}` as CopyKey)}
              tone={STATE_TONE[status.state] ?? 'neutral'}
            />
          </span>
          <span className="max-w-prose text-sm text-ink">{status.stateReason}</span>
          <span className="text-2xs text-ink-muted">
            {t('ds.evaluatedAt', { at: when(status.evaluatedAt) })}
          </span>
        </div>
      </CardBody>
    </Card>

    <div className="grid items-start gap-4 xl:grid-cols-2 [&>*]:min-w-0">
      <Card>
        <CardHeader title={t('ds.whatHeading')} />
        <CardBody>
          <p className="max-w-prose text-sm text-ink">{t('ds.whatBody')}</p>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t('ds.whyHeading')} />
        <CardBody>
          <p className="max-w-prose text-sm text-ink">{t('ds.whyBody')}</p>
        </CardBody>
      </Card>
    </div>

    <Card>
      <CardHeader title={t('ds.evidenceHeading')} description={t('ds.evidenceIntro')} />
      <CardBody>
        <DataTable caption={t('ds.evidenceHeading')} captionHidden>
          <THead>
            <Tr>
              <Th scope="col">{t('ds.colMeasure')}</Th>
              <Th scope="col" align="end">
                {t('ds.colOriginal')}
              </Th>
              <Th scope="col" align="end">
                {t('ds.colPrepared')}
              </Th>
            </Tr>
          </THead>
          <TBody>
            {EVIDENCE.map((row) => (
              <Tr key={row.label}>
                <Th scope="row">{t(row.label)}</Th>
                <Td numeric>{row.original}</Td>
                <Td numeric>{row.prepared}</Td>
              </Tr>
            ))}
          </TBody>
        </DataTable>
        <p className="mt-3 max-w-prose text-sm text-ink">{t('ds.evidenceWhy')}</p>
        <p className="mt-2 max-w-prose text-sm text-ink-muted">{t('ds.evidenceCaveats')}</p>
        <p className="mt-2 text-2xs text-ink-muted">{t('ds.evidenceSource')}</p>
      </CardBody>
    </Card>

    <Card>
      <CardHeader title={t('ds.approvalHeading')} description={t('ds.approvalNote')} />
      <CardBody>
        {status.canManage ? null : (
          <p className="mb-3 text-sm text-ink-muted">{t('ds.readOnly')}</p>
        )}
        <DataTable caption={t('ds.approvalHeading')} captionHidden>
          <THead>
            <Tr>
              <Th scope="col">{t('ds.colProvider')}</Th>
              <Th scope="col">{t('ds.colCapability')}</Th>
              <Th scope="col">{t('ds.colApproval')}</Th>
              <Th scope="col">{t('ds.colClient')}</Th>
              <Th scope="col">{t('ds.colState')}</Th>
              {status.canManage ? <Th scope="col">{t('ds.colActions')}</Th> : null}
            </Tr>
          </THead>
          <TBody>
            {status.providers.map((row) => (
              <Tr key={row.providerId}>
                <Th scope="row">
                  <span className="font-mono text-sm">{row.providerId}</span>
                </Th>
                <Td>
                  <span className="flex flex-col gap-0.5">
                    <span>{row.capable ? t('ds.capable') : t('ds.notCapable')}</span>
                    {row.capable ? null : (
                      <span className="max-w-xs text-2xs text-ink-muted">
                        {row.capabilityReason}
                      </span>
                    )}
                  </span>
                </Td>
                <Td>
                  {row.approval === null ? (
                    <span className="text-sm text-ink-muted">
                      {row.capable ? t('ds.noApproval') : '—'}
                    </span>
                  ) : (
                    <span className="flex flex-col gap-0.5 text-sm">
                      <span>
                        {t('ds.approvedBy', {
                          name: row.approval.approvedByDisplayName,
                          at: when(row.approval.approvedAt),
                        })}
                      </span>
                      <span className="text-2xs text-ink-muted">
                        {t('ds.approvalRef', { reference: row.approval.reference })}
                      </span>
                    </span>
                  )}
                </Td>
                <Td>{row.clientImplemented ? t('ds.clientBuilt') : t('ds.clientNotBuilt')}</Td>
                <Td>
                  <span
                    className="flex flex-col gap-1"
                    data-provider-state={row.state ?? 'INELIGIBLE'}
                  >
                    <span>
                      {row.state === null ? (
                        <Badge tone="neutral" withIcon={false}>
                          {t('ds.ineligible')}
                        </Badge>
                      ) : (
                        <StatusBadge
                          status={t(`ds.state.${row.state}` as CopyKey)}
                          tone={STATE_TONE[row.state] ?? 'neutral'}
                        />
                      )}
                    </span>
                    {row.state === null ? null : (
                      <span className="max-w-xs text-2xs text-ink-muted">{row.reason}</span>
                    )}
                  </span>
                </Td>
                {status.canManage ? (
                  <Td>
                    {row.capable ? (
                      <span className="flex flex-wrap items-start gap-2">
                        <RecordRestructureApprovalButton
                          providerId={row.providerId}
                          providerName={row.providerId}
                          replacing={row.approval !== null}
                          actingAs={actingAs}
                        />
                        {row.approval === null ? null : (
                          <RemoveRestructureApprovalButton
                            providerId={row.providerId}
                            actingAs={actingAs}
                          />
                        )}
                      </span>
                    ) : null}
                  </Td>
                ) : null}
              </Tr>
            ))}
          </TBody>
        </DataTable>
      </CardBody>
    </Card>
  </div>
);
