import {
  Badge,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  KpiCard,
  PageHero,
  ProvenanceTimeline,
  type ProvenanceStep,
  StatusBadge,
  TBody,
  THead,
  Td,
  Th,
  TextLink,
  Tr,
  VersionBadge,
} from '@knowzy/shared-ui';
import {
  Archive,
  BookCheck,
  GitBranch,
  Layers,
  PenLine,
  ShieldCheck,
  Sparkles,
  Upload,
} from 'lucide-react';
import { t } from '../../copy';
import { api } from '../../lib/api';
import { Problem } from '../../components/Problem';
import { PublishPanel, type ApprovedQuestion } from '../../components/PublishPanel';
import { AssessmentForm } from '../../components/AssessmentForm';
import { RetireForm } from '../../components/RetireForm';
import type { WizardDomain } from '../../components/GenerateWizard';

interface QueueItem {
  readonly questionId: string;
  readonly questionText: string;
  readonly topic: string;
  readonly version: number;
}

interface InventoryItem {
  readonly bankQuestionId: string;
  readonly questionId: string;
  readonly questionText: string;
  readonly publishedVersion: number;
  readonly status: string;
  readonly isActive: boolean;
  readonly publishedAt: string | null;
  readonly retiredAt: string | null;
  readonly retireComment: string | null;
}

interface AssessmentRow {
  readonly assessmentId: string;
  readonly name: string;
  readonly domain: string;
  readonly status: string;
  readonly versionNumber: number | null;
  readonly versionStatus: string | null;
  readonly questionCount: number | null;
  readonly pinnedPoolSize: number | null;
  readonly sessionCount: number;
}

interface TracedQuestion {
  readonly questionId: string;
  readonly status: string;
  readonly version: number;
  readonly questionText: string;
  readonly domain: { readonly code: string; readonly name: string };
  readonly topic: string;
  readonly source: {
    readonly documentName: string;
    readonly folderPath: string | null;
    readonly sectionKey: string;
    readonly versionAtGeneration: string;
  };
  readonly evidence: {
    readonly span: string;
    readonly startOffset: number;
    readonly endOffset: number;
    readonly mode: string;
  };
  readonly generatedBy: { readonly jobId: string | null; readonly modelId: string | null };
  readonly reviews: readonly {
    readonly reviewId: string;
    readonly kind: string;
    readonly outcome: string;
    readonly questionVersion: number;
    readonly createdAt: string;
  }[];
  readonly approvals: readonly {
    readonly approvalId: string;
    readonly decision: string;
    readonly comment: string | null;
    readonly questionVersion: number;
    readonly decidedAt: string;
  }[];
}

interface TracedVersion {
  readonly version: number;
  readonly changeKind: string;
  readonly changedAt: string;
  readonly changedFields: readonly string[];
  readonly evidenceReverified: boolean;
}

const DASH = '—';

const formatWhen = (value: string | null): string =>
  value === null
    ? DASH
    : new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

/**
 * The provenance of one published question, as steps.
 *
 * Assembled from records that already exist — the question detail, its version
 * history, and the inventory row. A step is emitted ONLY when its record is
 * present: there is no "pending approval" step, because the absence of an
 * approval row is not evidence that one is coming.
 *
 * `traceVersions` supplies the creation time, which the question detail does
 * not carry: version 1's `changedAt` is when the draft came into existence.
 */
const buildTraceSteps = (
  question: TracedQuestion,
  versions: readonly TracedVersion[],
  published:
    | {
        readonly bankQuestionId: string;
        readonly publishedVersion: number;
        readonly publishedAt: string | null;
        readonly retiredAt: string | null;
        readonly retireComment: string | null;
      }
    | undefined,
): readonly ProvenanceStep[] => {
  const steps: ProvenanceStep[] = [];
  const first = [...versions].sort((a, b) => a.version - b.version)[0];

  steps.push({
    title: t('publish.traceGenerated'),
    icon: <Sparkles className="size-3.5" />,
    ...(first === undefined ? {} : { when: formatWhen(first.changedAt) }),
    detail: t('publish.traceGeneratedDetail', {
      document:
        question.source.folderPath === null || question.source.folderPath === ''
          ? question.source.documentName
          : `${question.source.folderPath}/${question.source.documentName}`,
    }),
    tone: 'ai',
    facts: [
      { label: t('question.generatedBy'), value: question.generatedBy.modelId ?? DASH },
      { label: t('question.jobId'), value: question.generatedBy.jobId ?? DASH },
      { label: t('question.sourceSection'), value: question.source.sectionKey },
      { label: t('question.sourceVersion'), value: question.source.versionAtGeneration },
      {
        label: t('question.evidenceOffsets'),
        value: `${question.evidence.startOffset}–${question.evidence.endOffset} (${question.evidence.mode})`,
      },
    ],
  });

  for (const review of [...question.reviews].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  )) {
    steps.push({
      title: `${review.kind} · ${review.outcome}`,
      icon: <PenLine className="size-3.5" />,
      when: formatWhen(review.createdAt),
      detail: t('publish.traceAgainstVersion', { version: review.questionVersion }),
      tone: 'info',
    });
  }

  for (const approval of [...question.approvals].sort((a, b) =>
    a.decidedAt.localeCompare(b.decidedAt),
  )) {
    steps.push({
      title: t('publish.traceApproval', { decision: approval.decision }),
      icon: <ShieldCheck className="size-3.5" />,
      when: formatWhen(approval.decidedAt),
      // Gate 13 means this was a different person from the author; who it was
      // is in the audit trail rather than in this payload, so it is not
      // claimed here.
      detail:
        approval.comment ?? t('publish.traceAgainstVersion', { version: approval.questionVersion }),
      tone: 'success',
    });
  }

  if (published !== undefined) {
    steps.push({
      title: t('publish.tracePublished'),
      icon: <Upload className="size-3.5" />,
      ...(published.publishedAt === null ? {} : { when: formatWhen(published.publishedAt) }),
      tone: 'success',
      facts: [
        { label: t('publish.bankQuestionId'), value: published.bankQuestionId },
        { label: t('publish.version'), value: `v${published.publishedVersion}` },
        // The draft's own version history, so "v1 published" is readable as
        // either "never revised" or "revised twice before publication".
        {
          label: t('publish.traceRevisions'),
          value: t('publish.traceRevisionCount', {
            count: versions.length,
            current: question.version,
          }),
        },
      ],
    });

    if (published.retiredAt !== null) {
      steps.push({
        title: t('publish.traceRetired'),
        icon: <Archive className="size-3.5" />,
        when: formatWhen(published.retiredAt),
        detail: published.retireComment ?? undefined,
        tone: 'warning',
      });
    }
  }

  return steps;
};

/**
 * Publish, and the Question Bank.
 *
 * Three things, in the order the workflow needs them: publish the approved
 * questions, see the inventory that resulted, and make an assessment out of it
 * so the Live Learning Portal has something to serve.
 *
 * The inventory is the LOCAL PROJECTION and the API labels it as such. §8
 * reconciles it against the bank; until then a reader has to know which of the
 * two they are looking at, so the source is printed next to the count rather
 * than left implicit.
 *
 * UI-M2 converted the screen. Two §16 rules it keeps: a published version is
 * never edited in place — the row links to the same read-only detail an
 * approver used — and a question leaves the bank by RETIREMENT, which takes a
 * reason, never by deletion.
 */
export default async function PublishPage({
  searchParams,
}: {
  searchParams: Promise<{ trace?: string }>;
}) {
  const traceId = (await searchParams).trace;

  const [approved, inventory, assessments, taxonomy] = await Promise.all([
    api<{ items: readonly QueueItem[] }>('/api/v1/authoring/questions/review?queue=publish'),
    api<{ count: number; source: string; items: readonly InventoryItem[] }>(
      '/api/v1/authoring/question-bank',
    ),
    api<{ assessments: readonly AssessmentRow[] }>('/api/v1/authoring/assessments'),
    api<{ domains: readonly WizardDomain[] }>('/api/v1/authoring/taxonomy'),
  ]);

  const approvedQuestions: readonly ApprovedQuestion[] = approved.ok
    ? approved.data.items.map((item) => ({
        questionId: item.questionId,
        questionText: item.questionText,
        topic: item.topic,
        version: item.version,
      }))
    : [];

  const items = inventory.ok ? inventory.data.items : [];
  const active = items.filter((item) => item.isActive).length;

  // Traceability reads the SAME endpoints the approval screen uses. No new
  // route, no new projection: the provenance of a published question is
  // already recorded, it was just never assembled in one place.
  const traced = items.find((item) => item.questionId === traceId);
  const [traceDetail, traceVersions] = await Promise.all([
    traceId === undefined
      ? Promise.resolve(null)
      : api<TracedQuestion>(`/api/v1/authoring/questions/${traceId}`),
    traceId === undefined
      ? Promise.resolve(null)
      : api<{ versions: readonly TracedVersion[] }>(
          `/api/v1/authoring/questions/${traceId}/versions`,
        ),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHero title={t('publish.heading')} purpose={t('publish.intro')} />

      {/* ------------------------------------------------ traceability panel */}
      {traceId === undefined ? null : (
        <Card elevation="raised">
          <CardHeader
            title={t('publish.traceHeading')}
            description={t('publish.traceIntro')}
            icon={<GitBranch aria-hidden="true" className="size-5" />}
            actions={
              <ButtonLink href="/publish" tone="secondary" size="sm">
                {t('publish.traceClose')}
              </ButtonLink>
            }
          />
          <CardBody>
            {traceDetail === null || !traceDetail.ok ? (
              traceDetail === null ? null : (
                <Problem problem={traceDetail.problem} />
              )
            ) : (
              <div className="flex flex-col gap-5">
                <p className="text-md font-semibold text-brand-navy-text">
                  {traceDetail.data.questionText}
                </p>
                <ProvenanceTimeline
                  steps={buildTraceSteps(
                    traceDetail.data,
                    traceVersions !== null && traceVersions.ok ? traceVersions.data.versions : [],
                    traced,
                  )}
                />
                <p className="text-sm text-ink-subtle">{t('publish.traceLimits')}</p>
                <TextLink href={`/review/${traceDetail.data.questionId}`}>
                  {t('publish.traceOpenDetail')}
                </TextLink>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {inventory.ok ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <KpiCard
            label={t('publish.kpiPublished')}
            value={inventory.data.count}
            icon={<BookCheck aria-hidden="true" className="size-5" />}
            caption={t('publish.kpiSource', { source: inventory.data.source })}
          />
          <KpiCard
            label={t('publish.kpiActive')}
            value={active}
            icon={<Layers aria-hidden="true" className="size-5" />}
            tone="success"
          />
          <KpiCard
            label={t('publish.kpiRetired')}
            value={items.length - active}
            icon={<Archive aria-hidden="true" className="size-5" />}
            tone="neutral"
          />
        </div>
      ) : null}

      {!approved.ok ? <Problem problem={approved.problem} /> : null}
      <PublishPanel approved={approvedQuestions} />

      <Card>
        <CardHeader
          title={t('publish.inventoryHeading')}
          description={t('publish.inventoryIntro')}
          actions={
            inventory.ok ? (
              <Badge tone="info" withIcon={false}>
                {inventory.data.source}
              </Badge>
            ) : undefined
          }
        />
        <CardBody>
          {!inventory.ok ? <Problem problem={inventory.problem} /> : null}
          {inventory.ok && items.length === 0 ? (
            <EmptyState
              title={t('publish.noInventory')}
              description={t('publish.noInventoryBody')}
            />
          ) : null}
          {inventory.ok && items.length > 0 ? (
            <DataTable caption={t('publish.inventoryCaption')} captionHidden>
              <THead>
                <Tr>
                  <Th scope="col">{t('publish.bankQuestionId')}</Th>
                  <Th scope="col">{t('publish.question')}</Th>
                  <Th scope="col">{t('publish.version')}</Th>
                  <Th scope="col">{t('publish.status')}</Th>
                  <Th scope="col">{t('publish.publishedAt')}</Th>
                  <Th scope="col">{t('sources.actions')}</Th>
                </Tr>
              </THead>
              <TBody>
                {items.map((item) => (
                  <Tr key={item.bankQuestionId}>
                    <Th scope="row">
                      <span className="font-mono text-sm">{item.bankQuestionId}</span>
                    </Th>
                    <Td className="max-w-md">
                      {/* A published question is still a question someone needs
                          to read: its evidence, its gates, and its version
                          history are on the same page an approver used. */}
                      <TextLink href={`/review/${item.questionId}`}>{item.questionText}</TextLink>
                    </Td>
                    <Td>
                      <VersionBadge version={item.publishedVersion} />
                    </Td>
                    <Td>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge status={item.status} />
                        {item.isActive ? null : (
                          <StatusBadge status={t('publish.retired')} tone="neutral" />
                        )}
                      </span>
                    </Td>
                    <Td>{formatWhen(item.publishedAt)}</Td>
                    <Td>
                      <span className="flex flex-wrap items-center gap-2">
                        <ButtonLink
                          href={`/publish?trace=${item.questionId}`}
                          tone="secondary"
                          size="sm"
                        >
                          {t('publish.trace')}
                        </ButtonLink>
                        {item.retiredAt === null ? (
                          <RetireForm
                            questionId={item.questionId}
                            questionText={item.questionText}
                          />
                        ) : (
                          <span className="text-sm text-ink-subtle">
                            {item.retireComment ?? DASH}
                          </span>
                        )}
                      </span>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </DataTable>
          ) : null}
        </CardBody>
      </Card>

      {!taxonomy.ok ? <Problem problem={taxonomy.problem} /> : null}
      {taxonomy.ok ? <AssessmentForm domains={taxonomy.data.domains} /> : null}

      <Card>
        <CardHeader
          title={t('publish.assessmentsCaption')}
          description={t('publish.assessmentsIntro')}
        />
        <CardBody>
          {!assessments.ok ? <Problem problem={assessments.problem} /> : null}
          {assessments.ok && assessments.data.assessments.length === 0 ? (
            <EmptyState
              title={t('publish.noAssessments')}
              description={t('publish.noAssessmentsBody')}
            />
          ) : null}
          {assessments.ok && assessments.data.assessments.length > 0 ? (
            <DataTable caption={t('publish.assessmentsCaption')} captionHidden>
              <THead>
                <Tr>
                  <Th scope="col">{t('publish.assessmentName')}</Th>
                  <Th scope="col">{t('publish.assessmentStatus')}</Th>
                  <Th scope="col" align="end">
                    {t('publish.assessmentQuestions')}
                  </Th>
                  <Th scope="col" align="end">
                    {t('publish.assessmentPool')}
                  </Th>
                  <Th scope="col" align="end">
                    {t('publish.assessmentSessions')}
                  </Th>
                </Tr>
              </THead>
              <TBody>
                {assessments.data.assessments.map((assessment) => (
                  <Tr key={assessment.assessmentId}>
                    <Th scope="row">{assessment.name}</Th>
                    <Td>
                      {/* §16: a published release must look different from a
                          mutable draft, so both statuses are shown rather than
                          collapsed into one word. */}
                      <span className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge status={assessment.status} />
                        {assessment.versionStatus === null ? null : (
                          <>
                            <VersionBadge version={assessment.versionNumber ?? DASH} />
                            <StatusBadge status={assessment.versionStatus} />
                          </>
                        )}
                      </span>
                    </Td>
                    <Td numeric>{assessment.questionCount ?? DASH}</Td>
                    {/* The pinned pool is what makes an attempt reproducible. */}
                    <Td numeric>{assessment.pinnedPoolSize ?? DASH}</Td>
                    <Td numeric>{assessment.sessionCount}</Td>
                  </Tr>
                ))}
              </TBody>
            </DataTable>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
