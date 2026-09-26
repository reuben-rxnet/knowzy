import {
  Badge,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  EmptyState,
  KpiCard,
  PageHero,
  StatusBadge,
  TextLink,
  VersionBadge,
} from '@knowzy/shared-ui';
import {
  Activity,
  AlertCircle,
  ArrowRight,
  BookCheck,
  CheckCircle2,
  Database,
  FileText,
  Layers,
  PenLine,
  EyeOff,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { publicEnvironmentName } from '@knowzy/configuration';
import { t } from '../copy';
import { api } from '../lib/api';

const DASH = '—';

interface SourceRow {
  readonly name: string;
  readonly isActive: boolean;
  readonly usableForGeneration: boolean;
  readonly connectionStatus: string;
  readonly documentCount: number;
}

interface QueueRow {
  readonly questionId: string;
  readonly questionText: string;
  readonly status: string;
  readonly version: number;
  readonly topic: string;
  readonly confidence: { readonly score: number };
}

interface AssessmentRow {
  readonly assessmentId: string;
  readonly name: string;
  readonly status: string;
  readonly versionStatus: string | null;
  readonly questionCount: number | null;
  readonly pinnedPoolSize: number | null;
  readonly sessionCount: number;
}

/**
 * The authoring dashboard.
 *
 * Every number here is counted from a read this build already serves —
 * `GET /authoring/sources`, the four review queues, the question bank, and the
 * assessment list. Nothing is aggregated by a read model, because no reporting
 * read model exists (capability matrix §5.1).
 *
 * Three consequences, all deliberate:
 *
 *   * **No comparisons.** No "vs last month" anywhere. The platform stores no
 *     KPI history, so a delta could only be invented.
 *   * **No coverage percentage, no content-health score, no activity feed.**
 *     Those need aggregates or a redacted audit projection that do not exist.
 *     They are absent rather than mocked.
 *   * **A number the caller may not read is absent, not zero.** Each panel
 *     renders its own refusal, so "0 awaiting approval" always means zero and
 *     never "you cannot see this".
 *
 * The identity picker stays. The role catalogue separates authoring from
 * approval, so the workflow cannot be walked by one person, and this is where
 * you change hands.
 */
export default async function Page() {
  // The public subset, never process.env (C3). It cannot return a server-only
  // variable, which is what keeps the browser bundle inside B1.
  const environment = publicEnvironmentName();

  const queue = (name: string) =>
    api<{ count: number; items: readonly QueueRow[] }>(
      `/api/v1/authoring/questions/review?queue=${name}`,
    );

  const [sources, authorQueue, approvalQueue, publishQueue, bank, assessments] = await Promise.all([
    api<{ sources: readonly SourceRow[] }>('/api/v1/authoring/sources'),
    queue('author'),
    queue('approval'),
    queue('publish'),
    api<{ count: number; source: string }>('/api/v1/authoring/question-bank'),
    api<{ assessments: readonly AssessmentRow[] }>('/api/v1/authoring/assessments'),
  ]);

  const documentCount = sources.ok
    ? sources.data.sources.reduce((total, source) => total + source.documentCount, 0)
    : 0;
  const publishedAssessments = assessments.ok
    ? assessments.data.assessments.filter((row) => row.versionStatus === 'PUBLISHED')
    : [];

  const refusals = (
    [
      [t('dash.readSources'), sources],
      [t('dash.readAuthorQueue'), authorQueue],
      [t('dash.readApprovalQueue'), approvalQueue],
      [t('dash.readPublishQueue'), publishQueue],
      [t('dash.readBank'), bank],
      [t('dash.readAssessments'), assessments],
    ] as const
  ).flatMap(([label, result]) => (result.ok ? [] : [{ label, problem: result.problem }]));

  /**
   * Pipeline health, as a list of real conditions.
   *
   * Deliberately NOT a composite score. Every line is one field or one count
   * the platform already reports, with the action it implies; a single
   * "health: 87%" would be a number nobody could trace back to anything.
   *
   * A condition appears only when it is true, so an empty list means every
   * checked condition is fine — which is itself worth saying.
   */
  const health: readonly {
    readonly label: string;
    readonly tone: 'warning' | 'info';
    readonly href?: string;
  }[] = [
    ...(sources.ok
      ? sources.data.sources
          .filter((source) => source.connectionStatus !== 'HEALTHY')
          .map((source) => ({
            label: t('dash.healthSourceUntested', {
              source: source.name,
              status: source.connectionStatus,
            }),
            tone: 'warning' as const,
            href: '/sources',
          }))
      : []),
    ...(sources.ok && sources.data.sources.some((source) => !source.usableForGeneration)
      ? [
          {
            label: t('dash.healthNotUsable'),
            tone: 'warning' as const,
            href: '/sources',
          },
        ]
      : []),
    ...(authorQueue.ok && authorQueue.data.count > 0
      ? [
          {
            label: t('dash.healthDraftsWaiting', { count: authorQueue.data.count }),
            tone: 'info' as const,
            href: '/review?queue=author',
          },
        ]
      : []),
    ...(approvalQueue.ok && approvalQueue.data.count > 0
      ? [
          {
            label: t('dash.healthApprovalsWaiting', { count: approvalQueue.data.count }),
            tone: 'info' as const,
            href: '/review?queue=approval',
          },
        ]
      : []),
    ...(publishQueue.ok && publishQueue.data.count > 0
      ? [
          {
            label: t('dash.healthPublishWaiting', { count: publishQueue.data.count }),
            tone: 'info' as const,
            href: '/review?queue=publish',
          },
        ]
      : []),
    ...(bank.ok && bank.data.count === 0
      ? [{ label: t('dash.healthBankEmpty'), tone: 'warning' as const, href: '/publish' }]
      : []),
  ];

  // The ribbon's stages, with the count each one actually holds. A stage with
  // no countable backing is simply not listed here.
  const pipeline: readonly { label: string; href: string; count: number | null }[] = [
    {
      label: t('dash.stageSources'),
      href: '/sources',
      count: sources.ok ? sources.data.sources.length : null,
    },
    {
      label: t('dash.stageDrafts'),
      href: '/review?queue=author',
      count: authorQueue.ok ? authorQueue.data.count : null,
    },
    {
      label: t('dash.stageApproval'),
      href: '/review?queue=approval',
      count: approvalQueue.ok ? approvalQueue.data.count : null,
    },
    {
      label: t('dash.stagePublish'),
      href: '/review?queue=publish',
      count: publishQueue.ok ? publishQueue.data.count : null,
    },
    {
      label: t('dash.stageBank'),
      href: '/publish',
      count: bank.ok ? bank.data.count : null,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHero
        title={t('home.heading')}
        purpose={t('home.intro')}
        backdrop="wave"
        actions={
          <Badge tone="neutral" withIcon={false}>
            {t('shell.environment')}: {environment}
          </Badge>
        }
      />

      {/* ------------------------------------------------------------ figures */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {sources.ok ? (
          <KpiCard
            label={t('dash.kpiSources')}
            value={sources.data.sources.length}
            icon={<Database aria-hidden="true" className="size-5" />}
            caption={t('dash.kpiSourcesCaption', {
              usable: sources.data.sources.filter((source) => source.usableForGeneration).length,
              active: sources.data.sources.filter((source) => source.isActive).length,
            })}
          />
        ) : null}
        {sources.ok ? (
          <KpiCard
            label={t('dash.kpiDocuments')}
            value={documentCount}
            icon={<FileText aria-hidden="true" className="size-5" />}
            caption={t('dash.kpiDocumentsCaption')}
          />
        ) : null}
        {bank.ok ? (
          <KpiCard
            label={t('dash.kpiBank')}
            value={bank.data.count}
            icon={<BookCheck aria-hidden="true" className="size-5" />}
            tone="success"
            caption={t('publish.kpiSource', { source: bank.data.source })}
          />
        ) : null}
        {assessments.ok ? (
          <KpiCard
            label={t('dash.kpiAssessments')}
            value={publishedAssessments.length}
            icon={<Layers aria-hidden="true" className="size-5" />}
            caption={t('dash.kpiAssessmentsCaption', {
              total: assessments.data.assessments.length,
            })}
          />
        ) : null}
      </div>

      {/* A refused read is stated, so an absent figure is never read as zero.
          Compact on purpose: an identity without `assessment.read` sees this
          on every visit, and a full-page refusal panel would dominate a
          dashboard over something that is working exactly as intended. */}
      {refusals.length === 0 ? null : (
        <Card>
          <CardHeader
            title={t('dash.hiddenHeading')}
            description={t('dash.hiddenIntro')}
            icon={<EyeOff aria-hidden="true" className="size-5" />}
          />
          <CardBody>
            <ul className="flex flex-col gap-1.5">
              {refusals.map((refusal) => (
                <li
                  key={refusal.label}
                  className="flex flex-wrap items-baseline gap-x-2 text-base text-ink"
                >
                  <span className="font-semibold">{refusal.label}</span>
                  <span className="text-ink-muted">{refusal.problem.detail}</span>
                  <span className="font-mono text-2xs text-ink-subtle">
                    {refusal.problem.code} · HTTP {refusal.problem.status}
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {/* ----------------------------------------------------------- pipeline */}
      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader title={t('dash.pipelineHeading')} description={t('dash.pipelineIntro')} />
          <CardBody>
            <ol className="flex flex-wrap items-stretch gap-2">
              {pipeline.map((stage, index) => (
                <li key={stage.label} className="flex flex-1 items-center gap-2">
                  <a
                    href={stage.href}
                    className="group flex min-w-28 flex-1 flex-col gap-1 rounded-lg border border-line px-3 py-2.5 transition-colors duration-(--duration-fast) hover:border-brand-blue hover:bg-surface-hover"
                  >
                    <span className="text-2xs font-semibold uppercase tracking-wide text-ink-subtle">
                      {stage.label}
                    </span>
                    <span className="flex items-baseline gap-1.5">
                      {/* A dash, never a 0, when the count could not be read. */}
                      <span className="font-mono text-2xl font-bold tabular-nums text-brand-navy-text">
                        {stage.count ?? DASH}
                      </span>
                      {stage.count === null ? (
                        <span className="text-2xs text-ink-subtle">{t('dash.unreadable')}</span>
                      ) : null}
                    </span>
                  </a>
                  {index < pipeline.length - 1 ? (
                    <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-ink-subtle" />
                  ) : null}
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={t('dash.healthHeading')}
            description={t('dash.healthIntro')}
            icon={<Activity aria-hidden="true" className="size-5" />}
          />
          <CardBody>
            {health.length === 0 ? (
              <p className="flex items-center gap-2 rounded-md bg-success-soft px-3 py-2 text-base font-semibold text-success">
                <CheckCircle2 aria-hidden="true" className="size-4" />
                {t('dash.healthAllClear')}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {health.map((item) => (
                  <li
                    key={item.label}
                    className={`flex items-start gap-2 rounded-md px-3 py-2 text-base ${
                      item.tone === 'warning' ? 'bg-warning-soft text-ink' : 'bg-info-soft text-ink'
                    }`}
                  >
                    <AlertCircle
                      aria-hidden="true"
                      className={`mt-0.5 size-4 shrink-0 ${
                        item.tone === 'warning' ? 'text-warning' : 'text-info'
                      }`}
                    />
                    {item.href === undefined ? (
                      <span>{item.label}</span>
                    ) : (
                      <TextLink href={item.href}>{item.label}</TextLink>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      {/* ------------------------------------------------- what needs a human */}
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader
            title={t('dash.authorQueueHeading')}
            description={t('dash.authorQueueIntro')}
            icon={<PenLine aria-hidden="true" className="size-5" />}
            actions={
              authorQueue.ok ? (
                <Badge tone="neutral" withIcon={false}>
                  {authorQueue.data.count}
                </Badge>
              ) : undefined
            }
          />
          <CardBody>
            {!authorQueue.ok ? null : authorQueue.data.items.length === 0 ? (
              <EmptyState title={t('dash.authorQueueEmpty')} />
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {authorQueue.data.items.slice(0, 5).map((item) => (
                  <li key={item.questionId} className="flex flex-col gap-1 py-2.5 first:pt-0">
                    <TextLink href={`/review/${item.questionId}`}>{item.questionText}</TextLink>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={item.status} />
                      <VersionBadge version={item.version} />
                      <span className="text-sm text-ink-subtle">
                        {item.topic} · {t('review.confidence').toLowerCase()}{' '}
                        <span className="font-mono tabular-nums">
                          {Number(item.confidence.score).toFixed(3)}
                        </span>
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
          <CardFooter>
            <TextLink href="/review?queue=author">{t('dash.openQueue')}</TextLink>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader
            title={t('dash.approvalQueueHeading')}
            description={t('dash.approvalQueueIntro')}
            icon={<ShieldCheck aria-hidden="true" className="size-5" />}
            actions={
              approvalQueue.ok ? (
                <Badge tone="neutral" withIcon={false}>
                  {approvalQueue.data.count}
                </Badge>
              ) : undefined
            }
          />
          <CardBody>
            {!approvalQueue.ok ? null : approvalQueue.data.items.length === 0 ? (
              <EmptyState title={t('dash.approvalQueueEmpty')} />
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {approvalQueue.data.items.slice(0, 5).map((item) => (
                  <li key={item.questionId} className="flex flex-col gap-1 py-2.5 first:pt-0">
                    <TextLink href={`/review/${item.questionId}`}>{item.questionText}</TextLink>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={item.status} />
                      <VersionBadge version={item.version} />
                      <span className="text-sm text-ink-subtle">{item.topic}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
          <CardFooter>
            <TextLink href="/review?queue=approval">{t('dash.openQueue')}</TextLink>
          </CardFooter>
        </Card>
      </div>

      {/* -------------------------------------------------------- assessments */}
      {assessments.ok && assessments.data.assessments.length > 0 ? (
        <Card>
          <CardHeader
            title={t('dash.assessmentsHeading')}
            description={t('dash.assessmentsIntro')}
            icon={<Upload aria-hidden="true" className="size-5" />}
          />
          <CardBody>
            <ul className="flex flex-col divide-y divide-line">
              {assessments.data.assessments.slice(0, 5).map((row) => (
                <li
                  key={row.assessmentId}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0"
                >
                  <span className="font-semibold text-brand-navy-text">{row.name}</span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={row.status} />
                    {row.versionStatus === null ? null : <StatusBadge status={row.versionStatus} />}
                    <span className="text-sm text-ink-subtle">
                      {t('dash.poolSummary', {
                        questions: row.questionCount ?? 0,
                        pool: row.pinnedPoolSize ?? 0,
                        attempts: row.sessionCount,
                      })}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
          <CardFooter>
            <TextLink href="/publish">{t('dash.openPublish')}</TextLink>
          </CardFooter>
        </Card>
      ) : null}

      {/* The identity picker MOVED to the header's profile menu (2026-09-26),
          so it is reachable from every screen rather than only from here. This
          card is not replaced by a link to itself: the control is two clicks
          away in the header on this page too. */}

      <Card>
        <CardHeader title={t('home.liveHeading')} description={t('home.liveBody')} />
      </Card>
    </div>
  );
}
