// AI Document Studio M3 -- one prepared document
// (docs/competencies/AI_DOCUMENT_STUDIO_ARCHITECTURE.md §11.5-§11.8).
//
// Original on the left, prepared document on the right. Reworded sentences are
// highlighted and added headings tagged, by the API's one rule; warnings and
// missing-information findings are listed beside the text. The provider is
// named honestly on every version: "Test preparation — not AI" for the local
// test preparer, never "AI".

import {
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  PageHero,
  StatusBadge,
  TabNav,
} from '@knowzy/shared-ui';
import { AlertTriangle, Download } from 'lucide-react';
import { t, type CopyKey } from '../../../copy';
import { api } from '../../../lib/api';
import { Problem } from '../../../components/Problem';
import { currentSubject } from '../../../lib/identity';
import {
  AddToRepositoryButton,
  DiscardDraftButton,
  EditPreparedForm,
  PrepareButton,
  RestoreAiButton,
  ReviewUpdatedOriginalButton,
} from '../../../components/StudioForms';
import {
  AvailabilityBanner,
  StudioProgress,
  VERSION_TONE,
  when,
  type StudioStatus,
  type VersionState,
} from '../studio-shared';

interface Segment {
  readonly text: string;
  readonly fromOriginal: boolean;
}

type Marked =
  | {
      readonly type: 'heading';
      readonly level: number;
      readonly text: string;
      readonly added: boolean;
    }
  | { readonly type: 'paragraph' | 'warning'; readonly segments: readonly Segment[] }
  | {
      readonly type: 'list';
      readonly ordered: boolean;
      readonly items: readonly (readonly Segment[])[];
    }
  | {
      readonly type: 'table';
      readonly header: readonly string[];
      readonly rows: readonly (readonly string[])[];
    }
  | { readonly type: 'marker'; readonly marker: string; readonly text: string };

interface VersionSummary {
  readonly versionId: string;
  readonly versionNumber: number;
  readonly state: VersionState;
  readonly providerId: string;
  readonly modelId: string;
  readonly live: boolean;
  readonly promptVersion: string;
  readonly preparedAt: string;
  readonly preparedBy: string | null;
  readonly editedAt: string | null;
  readonly editedBy: string | null;
  readonly addedAt: string | null;
  readonly addedBy: string | null;
  readonly originalVersionCounter: number;
  readonly originalContentHash: string;
  readonly contentSha256: string;
  readonly repositoryDocumentId: string | null;
  readonly revalidationReason: string | null;
}

interface Detail {
  readonly preparedDocumentId: string;
  readonly title: string;
  readonly original: {
    readonly documentId: string;
    readonly name: string;
    readonly sourceName: string;
    readonly versionCounter: number;
    readonly status: string;
    readonly uploaded: boolean;
    readonly scanStatus: string | null;
    readonly sections: readonly { readonly heading: string | null; readonly text: string }[];
  };
  readonly versions: readonly VersionSummary[];
  readonly current:
    | (VersionSummary & {
        readonly content: string;
        readonly marked: readonly Marked[];
        readonly warnings: readonly {
          readonly kind: string;
          readonly text: string;
          readonly originalText: string | null;
          readonly message: string;
        }[];
        readonly aiContentAvailable: boolean;
      })
    | null;
  readonly repositorySourceId: string | null;
  readonly runs: readonly {
    readonly runId: string;
    readonly providerId: string;
    readonly live: boolean;
    readonly status: string;
    readonly outcomeReason: string | null;
    readonly startedAt: string;
    readonly inputTokens: number | null;
    readonly outputTokens: number | null;
    readonly requestedBy: string | null;
  }[];
}

const Segments = ({ segments }: { readonly segments: readonly Segment[] }) => (
  <>
    {segments.map((segment, index) => (
      <span key={index}>
        {index > 0 ? ' ' : ''}
        {segment.fromOriginal ? (
          segment.text
        ) : (
          <mark
            className="rounded-sm bg-warning-soft px-0.5 text-ink"
            title={t('ds.reworded')}
            data-change="reworded"
          >
            {segment.text}
          </mark>
        )}
      </span>
    ))}
  </>
);

const PreparedView = ({ nodes }: { readonly nodes: readonly Marked[] }) => (
  <div className="flex flex-col gap-3 text-sm text-ink" data-prepared-document>
    {nodes.map((node, index) => {
      switch (node.type) {
        case 'heading': {
          const className =
            node.level <= 1
              ? 'text-lg font-bold'
              : node.level === 2
                ? 'text-base font-bold'
                : 'font-semibold';
          return (
            <div key={index} className="flex flex-wrap items-center gap-2 pt-2">
              <span className={className} role="heading" aria-level={Math.min(6, node.level + 2)}>
                {node.text}
              </span>
              {node.added ? (
                <span
                  className="rounded-pill bg-info-soft px-2 py-0.5 text-2xs font-semibold text-info"
                  data-change="added-heading"
                >
                  {t('ds.addedHeading')}
                </span>
              ) : null}
            </div>
          );
        }
        case 'paragraph':
          return (
            <p key={index}>
              <Segments segments={node.segments} />
            </p>
          );
        case 'warning':
          return (
            <div
              key={index}
              className="rounded-md border-l-4 border-warning bg-warning-soft px-3 py-2"
              data-block="warning"
            >
              <span className="block text-2xs font-bold uppercase text-ink">
                {t('ds.warningBlock')}
              </span>
              <Segments segments={node.segments} />
            </div>
          );
        case 'list': {
          const Tag = node.ordered ? 'ol' : 'ul';
          return (
            <Tag
              key={index}
              className={`ml-5 flex flex-col gap-1 ${node.ordered ? 'list-decimal' : 'list-disc'}`}
            >
              {node.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <Segments segments={item} />
                </li>
              ))}
            </Tag>
          );
        }
        case 'table':
          return (
            <div key={index} className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    {node.header.map((cell, cellIndex) => (
                      <th
                        key={cellIndex}
                        scope="col"
                        className="border border-line bg-surface-sunken px-2 py-1 text-left"
                      >
                        {cell}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {node.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {node.header.map((_, cellIndex) => (
                        <td key={cellIndex} className="border border-line px-2 py-1">
                          {row[cellIndex] ?? ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        case 'marker':
          return (
            <div
              key={index}
              className="rounded-md border-l-4 border-info bg-info-soft px-3 py-2"
              data-block="marker"
            >
              <span className="block text-2xs font-bold uppercase text-ink">
                {t(`ds.marker.${node.marker}` as CopyKey)}
              </span>
              <em>{node.text}</em>
            </div>
          );
      }
    })}
  </div>
);

export const dynamic = 'force-dynamic';

export default async function PreparedDocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ versionId?: string; view?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const subject = await currentSubject();
  const [status, detail] = await Promise.all([
    api<StudioStatus>('/api/v1/authoring/document-studio/status'),
    api<Detail>(
      `/api/v1/authoring/document-studio/documents/${encodeURIComponent(id)}${
        query.versionId === undefined ? '' : `?versionId=${encodeURIComponent(query.versionId)}`
      }`,
    ),
  ]);
  if (!detail.ok || !status.ok) {
    const problem = !detail.ok ? detail.problem : !status.ok ? status.problem : null;
    return (
      <div className="flex flex-col gap-6">
        <PageHero title={t('ds.heading')} purpose={t('ds.intro')} />
        {problem === null ? null : <Problem problem={problem} actingAs={subject.label} />}
      </div>
    );
  }
  const data = detail.data;
  const current = data.current;
  const ready = data.versions.find((version) => version.state === 'READY_FOR_QUESTION_GENERATION');
  const openDraft = data.versions.find((version) => version.state === 'DRAFT');
  const preparation = status.data.preparation;
  const blockedReason =
    preparation.liveProviderId === null && !preparation.testPreparationAvailable
      ? t('ds.notEnabled')
      : null;
  const editing = query.view === 'edit';
  const versionHref = (versionId: string, view?: string): string =>
    `/document-studio/${data.preparedDocumentId}?versionId=${versionId}${view === undefined ? '' : `&view=${view}`}`;
  const generateHref =
    ready !== undefined && ready.repositoryDocumentId !== null && data.repositorySourceId !== null
      ? `/generate?source=${encodeURIComponent(data.repositorySourceId)}&document=${encodeURIComponent(ready.repositoryDocumentId)}`
      : null;
  const findings = (current?.marked ?? []).filter(
    (node): node is Extract<Marked, { type: 'marker' }> => node.type === 'marker',
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHero title={data.title} purpose={t('ds.originalUnchanged')} />
      <StudioProgress
        active={
          current === null
            ? t('ds.progressPrepare')
            : ready === undefined
              ? t('ds.progressReview')
              : t('ds.progressGenerate')
        }
        added
        prepared={data.versions.length > 0}
        ready={ready !== undefined}
      />
      <AvailabilityBanner status={status.data} />

      <div className="flex flex-wrap items-start gap-4">
        {status.data.canPrepare ? (
          <PrepareButton
            preparedDocumentId={data.preparedDocumentId}
            again={data.versions.length > 0}
            blockedReason={blockedReason}
            actingAs={subject.label}
          />
        ) : null}
        {generateHref === null ? null : (
          <ButtonLink tone="primary" href={generateHref}>
            {t('ds.generateNow')}
          </ButtonLink>
        )}
      </div>
      <p className="max-w-prose text-sm text-ink-muted">{t('ds.prepareHint')}</p>

      {data.versions.length > 0 ? (
        <nav aria-label={t('ds.versionsHeading')} className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-ink">{t('ds.versionsHeading')}:</span>
          {data.versions.map((version) => (
            <a
              key={version.versionId}
              href={versionHref(version.versionId)}
              {...(current?.versionId === version.versionId
                ? { 'aria-current': 'page' as const }
                : {})}
              className={`rounded-pill border px-3 py-1 text-sm ${
                current?.versionId === version.versionId
                  ? 'border-brand-navy bg-brand-surface font-semibold'
                  : 'border-line'
              }`}
            >
              {t('ds.versionLabel', { n: version.versionNumber })} ·{' '}
              {t(`ds.vstate.${version.state}` as CopyKey)}
            </a>
          ))}
        </nav>
      ) : null}

      {current === null ? (
        <Card>
          <CardBody>
            <p className="text-sm text-ink">{t('ds.noVersion')}</p>
          </CardBody>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3" data-version-state={current.state}>
            <StatusBadge
              status={`${t('ds.versionLabel', { n: current.versionNumber })} · ${t(`ds.vstate.${current.state}` as CopyKey)}`}
              tone={VERSION_TONE[current.state]}
            />
            <span
              className="text-sm text-ink-muted"
              data-provider-live={current.live ? 'true' : 'false'}
            >
              {current.live
                ? t('ds.liveLabel', { provider: current.providerId, model: current.modelId })
                : t('ds.testLabel')}
            </span>
          </div>

          {current.state === 'REVALIDATION_REQUIRED' ? (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-lg border border-line bg-warning-soft px-4 py-3"
            >
              <AlertTriangle aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-warning" />
              <div className="flex flex-col gap-2">
                <span className="font-semibold text-ink">{t('ds.revalidationTitle')}</span>
                <span className="max-w-prose text-sm text-ink">
                  {t('ds.revalidationBody', { reason: current.revalidationReason ?? '' })}
                </span>
                {status.data.canPrepare ? (
                  <ReviewUpdatedOriginalButton
                    preparedDocumentId={data.preparedDocumentId}
                    versionId={current.versionId}
                    actingAs={subject.label}
                  />
                ) : null}
              </div>
            </div>
          ) : null}
          {current.state === 'READY_FOR_QUESTION_GENERATION' ? (
            <p role="status" className="text-sm text-success">
              {t('ds.inRepository', { at: when(current.addedAt), name: current.addedBy ?? '—' })}
            </p>
          ) : null}
          {current.state === 'SUPERSEDED' ? (
            <p className="text-sm text-ink-muted">{t('ds.supersededNote')}</p>
          ) : null}
          {current.state === 'REJECTED' ? (
            <p className="text-sm text-ink-muted">{t('ds.discardedNote')}</p>
          ) : null}

          <div className="flex flex-wrap items-start gap-3">
            <ButtonLink href={`/document-studio/download/${current.versionId}?format=docx`}>
              <Download aria-hidden="true" className="size-4" />
              {t('ds.downloadWord')}
            </ButtonLink>
            <ButtonLink href={`/document-studio/download/${current.versionId}?format=pdf`}>
              <Download aria-hidden="true" className="size-4" />
              {t('ds.downloadPdf')}
            </ButtonLink>
            {current.state === 'DRAFT' && status.data.canPrepare ? (
              <AddToRepositoryButton
                preparedDocumentId={data.preparedDocumentId}
                versionId={current.versionId}
                versionNumber={current.versionNumber}
                actingAs={subject.label}
              />
            ) : null}
          </div>

          <TabNav
            ariaLabel={t('ds.viewsLabel')}
            activeHref={
              editing ? versionHref(current.versionId, 'edit') : versionHref(current.versionId)
            }
            items={[
              { label: t('ds.viewReview'), href: versionHref(current.versionId) },
              { label: t('ds.viewEdit'), href: versionHref(current.versionId, 'edit') },
            ]}
          />

          {editing ? (
            <Card>
              <CardBody>
                {current.state !== 'DRAFT' && openDraft !== undefined ? (
                  <p className="mb-3 text-sm text-ink">
                    <a className="underline" href={versionHref(openDraft.versionId, 'edit')}>
                      {t('ds.openDraftNote', { n: openDraft.versionNumber })}
                    </a>
                  </p>
                ) : status.data.canPrepare && current.state !== 'REJECTED' ? (
                  <EditPreparedForm
                    preparedDocumentId={data.preparedDocumentId}
                    versionId={current.versionId}
                    content={current.content}
                    isDraft={current.state === 'DRAFT'}
                    actingAs={subject.label}
                  />
                ) : (
                  <pre className="whitespace-pre-wrap text-sm">{current.content}</pre>
                )}
                {current.state === 'DRAFT' && status.data.canPrepare ? (
                  <div className="mt-4 flex flex-wrap items-start gap-3">
                    {current.aiContentAvailable ? (
                      <RestoreAiButton
                        preparedDocumentId={data.preparedDocumentId}
                        versionId={current.versionId}
                        live={current.live}
                        actingAs={subject.label}
                      />
                    ) : null}
                    <DiscardDraftButton
                      preparedDocumentId={data.preparedDocumentId}
                      versionId={current.versionId}
                      actingAs={subject.label}
                    />
                  </div>
                ) : null}
              </CardBody>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader title={t('ds.legendTitle')} />
                <CardBody>
                  <ul className="flex flex-col gap-1 text-sm text-ink-muted">
                    <li>
                      <mark className="rounded-sm bg-warning-soft px-0.5 text-ink">
                        {t('ds.reworded')}
                      </mark>{' '}
                      {t('ds.legendReworded')}
                    </li>
                    <li>{t('ds.legendHeading')}</li>
                  </ul>
                </CardBody>
              </Card>
              <div className="grid items-start gap-4 xl:grid-cols-2 [&>*]:min-w-0">
                <Card>
                  <CardHeader
                    title={t('ds.originalHeading')}
                    description={`${data.original.name} — ${t('ds.originalMeta', {
                      source: data.original.uploaded
                        ? t('ds.uploadedLabel')
                        : data.original.sourceName,
                      version: data.original.versionCounter,
                    })}`}
                  />
                  <CardBody>
                    {data.original.uploaded && data.original.scanStatus === 'NOT_SCANNED' ? (
                      <p className="mb-2 text-2xs text-ink-muted">{t('ds.notScanned')}</p>
                    ) : null}
                    <div
                      className="flex max-h-[48rem] flex-col gap-3 overflow-y-auto text-sm text-ink"
                      data-original-document
                    >
                      {data.original.sections.map((section, index) => (
                        <div key={index} className="flex flex-col gap-1">
                          {section.heading === null ? null : (
                            <span className="pt-2 font-bold">{section.heading}</span>
                          )}
                          <span className="whitespace-pre-wrap">{section.text}</span>
                        </div>
                      ))}
                    </div>
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader title={t('ds.preparedHeading')} />
                  <CardBody>
                    <div className="max-h-[48rem] overflow-y-auto">
                      <PreparedView nodes={current.marked} />
                    </div>
                  </CardBody>
                </Card>
              </div>
              <div className="grid items-start gap-4 xl:grid-cols-2 [&>*]:min-w-0">
                <Card>
                  <CardHeader title={t('ds.warningsHeading')} />
                  <CardBody>
                    {current.warnings.length === 0 ? (
                      <p className="text-sm text-ink-muted">{t('ds.noWarnings')}</p>
                    ) : (
                      <ul className="flex flex-col gap-3" data-warnings>
                        {current.warnings.map((warning, index) => (
                          <li key={index} className="flex flex-col gap-0.5 text-sm">
                            <span className="font-semibold text-ink">
                              {t(`ds.warn.${warning.kind}` as CopyKey)}
                            </span>
                            <span className="text-ink">{warning.message}</span>
                            <span className="text-ink-muted">“{warning.text}”</span>
                            {warning.originalText !== null &&
                            warning.originalText !== warning.text ? (
                              <span className="text-2xs text-ink-muted">
                                {t('ds.warnOriginal', { text: warning.originalText })}
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader title={t('ds.findingsHeading')} />
                  <CardBody>
                    {findings.length === 0 ? (
                      <p className="text-sm text-ink-muted">{t('ds.noFindings')}</p>
                    ) : (
                      <ul className="flex flex-col gap-2" data-findings>
                        {findings.map((finding, index) => (
                          <li key={index} className="text-sm">
                            <span className="font-semibold text-ink">
                              {t(`ds.marker.${finding.marker}` as CopyKey)}:
                            </span>{' '}
                            {finding.text}
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardBody>
                </Card>
              </div>
            </>
          )}

          <details className="rounded-lg border border-line bg-surface px-4 py-3">
            <summary className="cursor-pointer text-sm font-semibold text-ink">
              {t('ds.detailsSummary')}
            </summary>
            <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
              <dt className="text-ink-muted">{t('ds.detailProvider')}</dt>
              <dd className="font-mono">{current.providerId}</dd>
              <dt className="text-ink-muted">{t('ds.detailModel')}</dt>
              <dd className="font-mono">{current.modelId}</dd>
              <dt className="text-ink-muted">{t('ds.detailPrompt')}</dt>
              <dd className="font-mono">{current.promptVersion}</dd>
              <dt className="text-ink-muted">{t('ds.detailPreparedAt')}</dt>
              <dd>{when(current.preparedAt)}</dd>
              <dt className="text-ink-muted">{t('ds.detailPreparedBy')}</dt>
              <dd>{current.preparedBy ?? '—'}</dd>
              <dt className="text-ink-muted">{t('ds.detailEditedBy')}</dt>
              <dd>
                {current.editedBy === null ? '—' : `${current.editedBy}, ${when(current.editedAt)}`}
              </dd>
              <dt className="text-ink-muted">{t('ds.detailAddedBy')}</dt>
              <dd>
                {current.addedBy === null ? '—' : `${current.addedBy}, ${when(current.addedAt)}`}
              </dd>
              <dt className="text-ink-muted">{t('ds.detailOriginalVersion')}</dt>
              <dd>{current.originalVersionCounter}</dd>
              <dt className="text-ink-muted">{t('ds.detailOriginalHash')}</dt>
              <dd className="break-all font-mono text-2xs">{current.originalContentHash}</dd>
              <dt className="text-ink-muted">{t('ds.detailContentHash')}</dt>
              <dd className="break-all font-mono text-2xs">{current.contentSha256}</dd>
            </dl>
            <h3 className="mt-4 text-sm font-semibold text-ink">{t('ds.detailRuns')}</h3>
            <ul className="mt-1 flex flex-col gap-1 text-sm">
              {data.runs.map((run) => (
                <li key={run.runId}>
                  {when(run.startedAt)} · {t(`ds.run.${run.status}` as CopyKey)} ·{' '}
                  {run.live ? run.providerId : t('ds.testLabel')} ·{' '}
                  {run.inputTokens === null || run.outputTokens === null
                    ? t('ds.noTokens')
                    : t('ds.tokens', { input: run.inputTokens, output: run.outputTokens })}
                  {run.outcomeReason === null ? null : (
                    <span className="block text-2xs text-ink-muted">{run.outcomeReason}</span>
                  )}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </div>
  );
}
