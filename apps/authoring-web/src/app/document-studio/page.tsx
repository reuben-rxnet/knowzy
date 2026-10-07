// AI Document Studio -- the overview (Slice 2,
// docs/competencies/AI_DOCUMENT_STUDIO_ARCHITECTURE.md §10).
//
// A governance and readiness screen. It explains assessment preparation, shows
// the measured reason for it (documented evaluation results ONLY), the
// workflow, and the platform's REAL state, read from the status endpoint on
// every visit. It has no control that runs, transforms, rewrites or prepares a
// document, because nothing in the build can: the restructuring-client
// registry is empty, and the banner says so before anything else.

import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  PageHero,
  StatusBadge,
  TBody,
  THead,
  Td,
  Th,
  Tr,
} from '@knowzy/shared-ui';
import { AlertTriangle, ArrowDown } from 'lucide-react';
import { t, type CopyKey } from '../../copy';
import { api } from '../../lib/api';
import { Problem } from '../../components/Problem';
import { currentSubject } from '../../lib/identity';
import {
  RecordRestructureApprovalButton,
  RemoveRestructureApprovalButton,
} from '../../components/DocumentStudioForms';

type State = 'BLOCKED_BY_APPROVAL' | 'NOT_BUILT' | 'READY';

interface Status {
  readonly purpose: 'DOCUMENT_RESTRUCTURE';
  readonly state: State;
  readonly stateReason: string;
  readonly transformationImplemented: boolean;
  readonly evaluatedAt: string;
  readonly canManage: boolean;
  readonly providers: readonly {
    readonly providerId: string;
    readonly capable: boolean;
    readonly capabilityReason: string;
    readonly approval: {
      readonly reference: string;
      readonly approvedByDisplayName: string;
      readonly approvedAt: string;
    } | null;
    readonly clientImplemented: boolean;
    readonly configured: boolean;
    readonly state: State | null;
    readonly reason: string;
  }[];
}

const STATE_TONE: Readonly<Record<State, 'warning' | 'neutral' | 'success'>> = {
  BLOCKED_BY_APPROVAL: 'warning',
  NOT_BUILT: 'neutral',
  READY: 'success',
};

const when = (iso: string): string => iso.slice(0, 16).replace('T', ' ');

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

const STEPS: readonly {
  readonly title: CopyKey;
  readonly note: CopyKey;
  readonly built: boolean;
}[] = [
  { title: 'ds.step1', note: 'ds.step1Note', built: true },
  { title: 'ds.step2', note: 'ds.step2Note', built: false },
  { title: 'ds.step3', note: 'ds.step3Note', built: false },
  { title: 'ds.step4', note: 'ds.step4Note', built: false },
  { title: 'ds.step5', note: 'ds.step5Note', built: true },
];

const IMPLEMENTATION: readonly { readonly label: CopyKey; readonly built: boolean }[] = [
  { label: 'ds.impl.purpose', built: true },
  { label: 'ds.impl.approval', built: true },
  { label: 'ds.impl.status', built: true },
  { label: 'ds.impl.proposal', built: false },
  { label: 'ds.impl.verification', built: false },
  { label: 'ds.impl.review', built: false },
  { label: 'ds.impl.derivative', built: false },
  { label: 'ds.impl.upload', built: false },
];

export const dynamic = 'force-dynamic';

export default async function DocumentStudioPage() {
  const subject = await currentSubject();
  const status = await api<Status>('/api/v1/authoring/document-studio/status');

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

  return (
    <div className="flex flex-col gap-6">
      {hero}

      {/* First, and never conditional on the state: nothing here transforms. */}
      <div
        role="status"
        className="flex items-start gap-3 rounded-lg border border-line bg-warning-soft px-4 py-3"
      >
        <AlertTriangle aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-warning" />
        <div className="flex flex-col gap-1">
          <span className="font-semibold text-ink">{t('ds.notBuiltTitle')}</span>
          <span className="max-w-prose text-sm text-ink-muted">{t('ds.notBuiltBody')}</span>
        </div>
      </div>

      <Card>
        <CardHeader title={t('ds.stateHeading')} />
        <CardBody>
          <div className="flex flex-col gap-2" data-studio-state={data.state}>
            <span>
              <StatusBadge
                status={t(`ds.state.${data.state}` as CopyKey)}
                tone={STATE_TONE[data.state]}
              />
            </span>
            <span className="max-w-prose text-sm text-ink">{data.stateReason}</span>
            <span className="text-2xs text-ink-muted">
              {t('ds.evaluatedAt', { at: when(data.evaluatedAt) })}
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
        <CardHeader title={t('ds.workflowHeading')} description={t('ds.workflowNote')} />
        <CardBody>
          <ol className="flex flex-col items-stretch gap-1" aria-label={t('ds.workflowHeading')}>
            {STEPS.map((step, index) => (
              <li key={step.title} className="flex flex-col items-center gap-1">
                <div className="flex w-full max-w-xl items-center justify-between gap-3 rounded-md border border-line bg-surface px-4 py-3">
                  <span className="flex flex-col">
                    <span className="font-semibold text-ink">{t(step.title)}</span>
                    <span className="text-2xs text-ink-muted">{t(step.note)}</span>
                  </span>
                  <Badge tone={step.built ? 'success' : 'neutral'} withIcon={false}>
                    {step.built ? t('ds.stepBuilt') : t('ds.stepNotBuilt')}
                  </Badge>
                </div>
                {index < STEPS.length - 1 ? (
                  <ArrowDown aria-hidden="true" className="size-4 text-ink-subtle" />
                ) : null}
              </li>
            ))}
          </ol>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t('ds.approvalHeading')} description={t('ds.approvalNote')} />
        <CardBody>
          {data.canManage ? null : (
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
                {data.canManage ? <Th scope="col">{t('ds.colActions')}</Th> : null}
              </Tr>
            </THead>
            <TBody>
              {data.providers.map((row) => (
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
                            tone={STATE_TONE[row.state]}
                          />
                        )}
                      </span>
                      {row.state === null ? null : (
                        <span className="max-w-xs text-2xs text-ink-muted">{row.reason}</span>
                      )}
                    </span>
                  </Td>
                  {data.canManage ? (
                    <Td>
                      {row.capable ? (
                        <span className="flex flex-wrap items-start gap-2">
                          <RecordRestructureApprovalButton
                            providerId={row.providerId}
                            providerName={row.providerId}
                            replacing={row.approval !== null}
                            actingAs={subject.label}
                          />
                          {row.approval === null ? null : (
                            <RemoveRestructureApprovalButton
                              providerId={row.providerId}
                              actingAs={subject.label}
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

      <Card>
        <CardHeader title={t('ds.implementationHeading')} />
        <CardBody>
          <ul className="flex flex-col gap-2">
            {IMPLEMENTATION.map((item) => (
              <li
                key={item.label}
                className="flex flex-wrap items-center justify-between gap-2 text-sm"
              >
                <span className="text-ink">{t(item.label)}</span>
                <Badge tone={item.built ? 'success' : 'neutral'} withIcon={false}>
                  {item.built ? t('ds.implBuilt') : t('ds.implNotBuilt')}
                </Badge>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
