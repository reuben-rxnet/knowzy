// Reports → Dashboard — Phase 10 R2.
//
// The approved design is
// `design/approved/reporting-and-analytics/KNOWZY-reporting-and-analytics-dashboard.png`
// and `docs/ui/REPORTING_AND_ANALYTICS_UI_SOURCE_OF_TRUTH.md` is the contract.
// Every panel reads a catalogue dataset — the same one its report page, its CSV
// and a snapshot read — so nothing here aggregates, suppresses or computes a
// delta. The page ARRANGES what the API returned.
//
// WHAT CHANGED SINCE R1, and the decision behind each:
//
//   * THE KPI CARDS CARRY A COMPARISON (R-1). Coverage snapshots are recorded
//     daily, so a STATE figure is compared against the snapshot of the day its
//     period began, and a FLOW figure against the previous window of the same
//     dated rows. Until a snapshot old enough exists, the card says "Not Yet
//     Available" — it never shows a delta computed against nothing.
//   * THE LEARNER HEATMAP IS BUILT (D-1). Rows are the department the QUESTIONS
//     were filed under, because a learner has no department, and the panel
//     says so. Suppression runs across rows AND columns, so cells read
//     "Suppressed" — the design accepted that before this was built.
//   * AI USAGE IS SUMMARIZED, NOT RESTATED. The panel reads the same function
//     the governance screen reads and links to it.
//   * RECENT ACTIVITY IS THE AUDIT STORE, actor-less, with learner completions
//     aggregated and withheld below the minimum group size.

import {
  Badge,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  DataTable,
  DonutChart,
  EmptyState,
  Field,
  KpiCard,
  LineChart,
  MatrixHeatmap,
  Meter,
  PageHero,
  Select,
  StackedColumnChart,
  StatusBadge,
  TBody,
  THead,
  TabNav,
  Td,
  TextLink,
  Th,
  Tr,
  type SeriesTone,
} from '@knowzy/shared-ui';
import {
  Activity,
  BookOpen,
  CheckCircle2,
  Coins,
  FileCheck2,
  FileText,
  Layers,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  Target,
  Trophy,
  UploadCloud,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { t, type CopyKey } from '../../copy';
import { api } from '../../lib/api';
import { Problem } from '../../components/Problem';
import { KpiComparison, type KpiComparisonData } from '../../components/KpiComparison';
import { RefreshModelsButton, ReportExportButton } from '../../components/ReportActions';
import { currentSubject } from '../../lib/identity';
import { REPORT_TABS } from './tabs';

// ------------------------------------------------------------------ shapes

type Cell = string | number | null;

interface Dataset<Row = Record<string, Cell>> {
  readonly name: string;
  readonly title: string;
  readonly asOf: string | null;
  readonly rows: readonly Row[];
  readonly rowCount: number;
  readonly totals: Readonly<Record<string, number>>;
  readonly suppressionCount: number;
  readonly suppressionReason: string | null;
  readonly minimumGroupSize: number;
  readonly sourceWindow: { from: string | null; to: string | null; days: number | null };
}

interface Catalogue {
  readonly minimumGroupSize: number;
  readonly canExport: boolean;
  readonly models: readonly {
    readonly model: string;
    readonly status: string;
    readonly refreshedAt: string | null;
    readonly consecutiveFailures: number;
    readonly rowCount: number | null;
    readonly failureDetail: string | null;
  }[];
}

interface KpiRow extends KpiComparisonData {
  readonly kpi: string;
  readonly label: string;
  readonly unit: 'count' | 'percent' | 'currency';
  readonly value: number | null | 'SUPPRESSED';
  readonly valueStatus: string;
  readonly formula: string;
}

interface RecordedNumber {
  readonly recorded: boolean;
  readonly value?: number;
}
interface CostAccount {
  readonly observable: boolean;
  readonly amount: string | null;
  readonly unobservableReason: string | null;
}
interface AiSummary {
  readonly asOf: string;
  readonly sourceWindow: { from: string; to: string; days: number };
  readonly kpis: {
    readonly totalGenerations: RecordedNumber;
    readonly estimatedTokens: RecordedNumber;
    readonly estimatedCost: CostAccount;
    readonly remainingDailyBudget: RecordedNumber;
    readonly budgetUtilizationPercent: RecordedNumber;
  };
  readonly activeProvider: string;
  readonly providers: readonly { providerId: string; state: string; reason: string }[];
  readonly providerUsage: readonly {
    providerId: string;
    generations: number;
    tokens: { totalTokens: number; reported: boolean };
    cost: CostAccount;
    health: string;
    healthReason: string;
  }[];
}

interface CoverageHistory {
  readonly asOf: string | null;
  readonly sourceWindow: { from: string | null; to: string | null; days: number };
}

// ---------------------------------------------------------------- helpers

const DASH = '—';
const PERIODS = ['30', '90', '365'] as const;
const TREND_RANGES = ['30', '90', '365'] as const;
const METRICS = ['averageScore', 'passRatePercent', 'attemptSuccessPercent'] as const;
type HeatMetric = (typeof METRICS)[number];

const METRIC_LABEL: Record<HeatMetric, CopyKey> = {
  averageScore: 'rep.heatAverageScore',
  passRatePercent: 'rep.heatPassRate',
  attemptSuccessPercent: 'rep.heatAttemptSuccess',
};

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;

const stamp = (iso: string | null): string =>
  iso === null ? DASH : `${new Date(iso).toISOString().replace('T', ' ').slice(0, 16)} UTC`;

const day = (iso: string | null): string => (iso === null ? DASH : iso.slice(0, 10));

const money = (value: number): string =>
  `$${value.toLocaleString('en-GB', {
    minimumFractionDigits: value !== 0 && Math.abs(value) < 0.01 ? 6 : 2,
    maximumFractionDigits: value !== 0 && Math.abs(value) < 0.01 ? 6 : 2,
  })}`;

const kpiValue = (row: KpiRow): string => {
  if (row.valueStatus === 'SUPPRESSED' || row.value === 'SUPPRESSED') return t('rep.allWithheld');
  if (row.valueStatus === 'NOT_OBSERVABLE') return t('ai.notObservable');
  if (row.value === null || row.valueStatus === 'NOT_RECORDED') return t('ai.notRecorded');
  if (row.unit === 'percent') return `${row.value.toFixed(1)}%`;
  if (row.unit === 'currency') return money(row.value);
  return row.value.toLocaleString('en-GB');
};

const KPI_ICON: Record<string, { icon: ReactNode; tone: 'info' | 'success' | 'ai' | 'warning' }> = {
  totalQuestions: { icon: <FileText className="size-5" />, tone: 'info' },
  publishedQuestions: { icon: <FileCheck2 className="size-5" />, tone: 'success' },
  assessmentsCompleted: { icon: <CheckCircle2 className="size-5" />, tone: 'ai' },
  passRate: { icon: <Trophy className="size-5" />, tone: 'warning' },
  knowledgeSources: { icon: <BookOpen className="size-5" />, tone: 'info' },
  coverage: { icon: <Target className="size-5" />, tone: 'success' },
  aiGenerations: { icon: <Sparkles className="size-5" />, tone: 'ai' },
  estimatedAiCost: { icon: <Coins className="size-5" />, tone: 'warning' },
};

const STATUS_TONE: Record<string, SeriesTone> = {
  Published: 'info',
  Approved: 'success',
  'In review': 'warning',
  Draft: 'accent',
  Rejected: 'danger',
  'Retired or archived': 'neutral',
};

const STATUS_LABEL: Record<string, CopyKey> = {
  Published: 'rep.statusPublished',
  Approved: 'rep.statusApproved',
  'In review': 'rep.statusInReview',
  Draft: 'rep.statusDraft',
  Rejected: 'rep.statusRejected',
  'Retired or archived': 'rep.statusRetired',
};

/** Six distinct tones for departments; "Not filed" is always neutral. */
const DEPARTMENT_TONES: readonly SeriesTone[] = [
  'brand',
  'success',
  'warning',
  'accent',
  'danger',
  'info',
];

const SOURCE_STATUS_TONE: Record<string, 'success' | 'info' | 'warning' | 'danger' | 'neutral'> = {
  SUCCESS: 'success',
  SCHEDULED: 'success',
  RUNNING: 'info',
  NEVER_RUN: 'neutral',
  PAUSED: 'warning',
  DISABLED: 'neutral',
  FAILED: 'danger',
};

const ACTIVITY: Record<string, { key: CopyKey; icon: ReactNode }> = {
  ASSESSMENT_PUBLISHED: {
    key: 'rep.actAssessmentPublished',
    icon: <FileCheck2 className="size-4" />,
  },
  QUESTION_APPROVED: { key: 'rep.actQuestionApproved', icon: <ShieldCheck className="size-4" /> },
  QUESTION_PUBLISHED: { key: 'rep.actQuestionPublished', icon: <UploadCloud className="size-4" /> },
  SOURCE_SYNCHRONIZED: {
    key: 'rep.actSourceSynchronized',
    icon: <RefreshCcw className="size-4" />,
  },
  PROVIDER_VALIDATED: { key: 'rep.actProviderValidated', icon: <Sparkles className="size-4" /> },
  QUESTIONS_GENERATED: { key: 'rep.actQuestionsGenerated', icon: <Sparkles className="size-4" /> },
  SOURCE_ADDED: { key: 'rep.actSourceAdded', icon: <BookOpen className="size-4" /> },
  ASSESSMENTS_COMPLETED: {
    key: 'rep.actAssessmentsCompleted',
    icon: <CheckCircle2 className="size-4" />,
  },
};

const costText = (cost: CostAccount, generations: number): string =>
  generations === 0
    ? t('ai.notRecorded')
    : !cost.observable || cost.amount === null
      ? t('ai.notObservable')
      : money(Number(cost.amount));

const recorded = (value: RecordedNumber): string =>
  value.recorded && value.value !== undefined
    ? value.value.toLocaleString('en-GB')
    : t('ai.notRecorded');

/** The as-of line every panel carries (rule 5). */
const AsOf = ({ asOf, window }: { asOf: string | null; window?: Dataset['sourceWindow'] }) => (
  <p className="text-2xs text-ink-subtle">
    {asOf === null ? t('rep.neverRefreshed') : t('rep.panelAsOf', { at: stamp(asOf) })}
    {window === undefined || window.from === null
      ? null
      : ` · ${t('rep.panelWindow', { from: day(window.from), to: day(window.to) })}`}
  </p>
);

/** The withheld line, printed only when something was withheld. */
const Withheld = ({
  data,
}: {
  data: Pick<Dataset, 'suppressionCount' | 'suppressionReason' | 'minimumGroupSize'>;
}) =>
  data.suppressionCount === 0 ? null : (
    <p className="text-2xs text-ink-muted">
      <Badge tone="warning" withIcon={false}>
        {t('rep.cellsWithheld', { count: data.suppressionCount })}
      </Badge>{' '}
      {data.suppressionReason ?? t('rep.minGroup', { size: data.minimumGroupSize })}
    </p>
  );

export const dynamic = 'force-dynamic';

export default async function ReportsDashboardPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const period = pick(query['period'], PERIODS, '30');
  const trendRange = pick(query['trend'], TREND_RANGES, '365');
  const metric = pick(query['metric'], METRICS, 'averageScore');
  const link = (next: Record<string, string>) =>
    `/reports?${new URLSearchParams({ period, trend: trendRange, metric, ...next }).toString()}`;

  const base = '/api/v1/authoring/reports';
  const [
    catalogue,
    kpis,
    trend,
    status,
    deptRole,
    learners,
    sources,
    activity,
    ai,
    history,
    subject,
  ] = await Promise.all([
    api<Catalogue>(base),
    api<Dataset<KpiRow>>(`${base}/kpis?windowDays=${period}`),
    api<Dataset>(`${base}/question-trend?windowDays=${trendRange}`),
    api<Dataset>(`${base}/question-status`),
    api<Dataset>(`${base}/department-role`),
    api<Dataset>(`${base}/learner-performance?windowDays=${period === '30' ? '365' : period}`),
    api<Dataset>(`${base}/source-health`),
    api<Dataset>(`${base}/activity?pageSize=8`),
    api<AiSummary>(`${base}/ai-usage-summary?windowDays=${period}`),
    api<CoverageHistory>(`${base}/coverage-history?limit=400`),
    currentSubject(),
  ]);

  const tabs = (
    <TabNav
      items={REPORT_TABS.map((tab) => ({ href: tab.href, label: t(tab.labelKey) }))}
      activeHref="/reports"
      ariaLabel={t('rep.tabsLabel')}
    />
  );

  if (!catalogue.ok) {
    return (
      <div className="flex flex-col gap-6">
        <PageHero title={t('rep.heading')} purpose={t('rep.intro')} />
        {tabs}
        <Problem problem={catalogue.problem} actingAs={subject.label} />
      </div>
    );
  }

  const staleModels = catalogue.data.models.filter((model) => model.status === 'FAILED');
  const windowDays = Number(period);

  return (
    <div className="flex flex-col gap-6">
      <PageHero
        title={t('rep.heading')}
        purpose={t('rep.intro')}
        actions={
          <span className="flex flex-wrap gap-2">
            {catalogue.data.canExport ? (
              <ReportExportButton dataset="kpis" windowDays={period} actingAs={subject.label} />
            ) : null}
            <RefreshModelsButton actingAs={subject.label} />
          </span>
        }
      />
      {tabs}

      {/* ------------------------------------------------------ the period */}
      <form method="get" action="/reports" className="flex flex-wrap items-end gap-3">
        <Field id="period" label={t('rep.periodLabel')} hint={t('rep.periodHint')}>
          <Select id="period" name="period" defaultValue={period}>
            {PERIODS.map((days) => (
              <option key={days} value={days}>
                {t('rep.windowOption', { days })}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="trend" label={t('rep.trendRangeLabel')}>
          <Select id="trend" name="trend" defaultValue={trendRange}>
            <option value="30">{t('rep.trend30')}</option>
            <option value="90">{t('rep.trend90')}</option>
            <option value="365">{t('rep.trend365')}</option>
          </Select>
        </Field>
        <input type="hidden" name="metric" value={metric} />
        <button
          type="submit"
          className="h-10 rounded-md bg-brand-navy px-4 text-sm font-semibold text-white"
        >
          {t('rep.apply')}
        </button>
      </form>

      {/* D4: a failed refresh LABELS the dashboard; it never blanks it. */}
      {staleModels.length === 0 ? null : (
        <Card>
          <CardHeader title={t('rep.staleHeading')} />
          <CardBody>
            <p className="max-w-prose text-base text-ink-muted">
              {t('rep.staleBody', { count: String(staleModels.length) })}
            </p>
            <ul className="mt-3 flex flex-col gap-1">
              {staleModels.map((model) => (
                <li key={model.model} className="flex flex-wrap items-center gap-2 text-2xs">
                  <Badge tone="danger" withIcon={false}>
                    {model.model}
                  </Badge>
                  <span className="text-ink-muted">
                    {t('rep.staleSince', {
                      at: stamp(model.refreshedAt),
                      failures: String(model.consecutiveFailures),
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {/* ========================================================= 1. KPIs */}
      <section aria-labelledby="kpi-heading" className="flex flex-col gap-2">
        <h2 id="kpi-heading" className="knowzy-sr-only">
          {t('rep.kpiHeading')}
        </h2>
        {kpis.ok ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {kpis.data.rows.map((row) => (
                <KpiCard
                  key={row.kpi}
                  label={row.label}
                  value={kpiValue(row)}
                  icon={KPI_ICON[row.kpi]?.icon}
                  tone={KPI_ICON[row.kpi]?.tone ?? 'info'}
                  comparison={<KpiComparison data={row} windowDays={windowDays} />}
                  caption={row.formula}
                />
              ))}
            </div>
            <AsOf asOf={kpis.data.asOf} window={kpis.data.sourceWindow} />
            <Withheld data={kpis.data} />
            <p className="max-w-prose text-2xs text-ink-muted">
              {t('rep.kpiComparisonNote', {
                first: history.ok ? day(history.data.sourceWindow.from) : DASH,
                days: history.ok ? history.data.sourceWindow.days : 0,
              })}
            </p>
          </>
        ) : (
          <Problem problem={kpis.problem} actingAs={subject.label} />
        )}
      </section>

      {/* ============================================ 2 + 3. trend and status */}
      <div className="grid items-start gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title={t('rep.trendHeading')} description={t('rep.trendIntro')} />
          <CardBody>
            {trend.ok ? (
              <div className="flex flex-col gap-2">
                <LineChart
                  title={t('rep.trendChartTitle')}
                  series={[
                    { key: 'generated', label: t('rep.seriesGenerated'), tone: 'info' },
                    { key: 'published', label: t('rep.seriesPublished'), tone: 'success' },
                  ]}
                  points={trend.data.rows.map((row) => ({
                    label: String(row['label'] ?? ''),
                    values: {
                      generated: Number(row['generated'] ?? 0),
                      published: Number(row['published'] ?? 0),
                    },
                    partial: row['partial'] === 'yes',
                  }))}
                  partialLabel={t('rep.partialPeriod')}
                />
                <AsOf asOf={trend.data.asOf} window={trend.data.sourceWindow} />
              </div>
            ) : (
              <Problem problem={trend.problem} actingAs={subject.label} />
            )}
          </CardBody>
          <CardFooter>
            <TextLink href={`/reports/question-trend?windowDays=${trendRange}`}>
              {t('rep.openReport')}
            </TextLink>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader title={t('rep.statusHeading')} description={t('rep.statusIntro')} />
          <CardBody>
            {status.ok ? (
              (status.data.totals['questionCount'] ?? 0) === 0 ? (
                <EmptyState title={t('rep.emptyTitle')} description={t('rep.emptyBody')} />
              ) : (
                <div className="flex flex-col gap-2">
                  <DonutChart
                    title={t('rep.statusChartTitle')}
                    centreValue={(status.data.totals['questionCount'] ?? 0).toLocaleString('en-GB')}
                    centreLabel={t('rep.statusCentre')}
                    slices={status.data.rows.map((row) => {
                      const bucket = String(row['bucket']);
                      return {
                        label:
                          STATUS_LABEL[bucket] === undefined ? bucket : t(STATUS_LABEL[bucket]),
                        value: Number(row['questionCount'] ?? 0),
                        tone: STATUS_TONE[bucket] ?? 'neutral',
                      };
                    })}
                  />
                  <AsOf asOf={status.data.asOf} />
                </div>
              )
            ) : (
              <Problem problem={status.problem} actingAs={subject.label} />
            )}
          </CardBody>
          <CardFooter>
            <TextLink href="/reports/question-status">{t('rep.openReport')}</TextLink>
          </CardFooter>
        </Card>
      </div>

      {/* =============================== 4 + 5 + 8. filing, learners, activity */}
      <div className="grid items-start gap-4 xl:grid-cols-12">
        <Card className="xl:col-span-5">
          <CardHeader title={t('rep.deptHeading')} description={t('rep.deptIntro')} />
          <CardBody>
            {deptRole.ok ? (
              <DepartmentRoleChart data={deptRole.data} />
            ) : (
              <Problem problem={deptRole.problem} actingAs={subject.label} />
            )}
          </CardBody>
          <CardFooter>
            <TextLink href="/reports/department-role">{t('rep.openReport')}</TextLink>
          </CardFooter>
        </Card>

        <Card className="xl:col-span-4">
          <CardHeader title={t('rep.learnerHeading')} description={t('rep.learnerIntro')} />
          <CardBody>
            <nav aria-label={t('rep.heatMetricLabel')} className="mb-3 flex flex-wrap gap-2">
              {METRICS.map((key) => (
                <a
                  key={key}
                  href={link({ metric: key })}
                  aria-current={key === metric ? 'true' : undefined}
                  className={`rounded-pill px-3 py-1 text-2xs font-semibold ring-1 ring-inset ${
                    key === metric
                      ? 'bg-brand-navy text-white ring-brand-navy'
                      : 'text-ink-muted ring-line'
                  }`}
                >
                  {t(METRIC_LABEL[key])}
                </a>
              ))}
            </nav>
            {learners.ok ? (
              <LearnerHeatmap data={learners.data} metric={metric} />
            ) : (
              <Problem problem={learners.problem} actingAs={subject.label} />
            )}
          </CardBody>
          <CardFooter>
            <TextLink href="/reports/learner-performance?windowDays=365">
              {t('rep.openReport')}
            </TextLink>
          </CardFooter>
        </Card>

        <Card className="xl:col-span-3">
          <CardHeader title={t('rep.activityHeading')} description={t('rep.activityIntro')} />
          <CardBody>
            {activity.ok ? (
              <ActivityTimeline data={activity.data} />
            ) : (
              <Problem problem={activity.problem} actingAs={subject.label} />
            )}
          </CardBody>
          <CardFooter>
            <TextLink href="/governance/audit">{t('rep.viewAll')}</TextLink>
          </CardFooter>
        </Card>
      </div>

      {/* ===================================== 6 + 7. sources and AI usage */}
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title={t('rep.sourceHeading')} description={t('rep.sourceIntro')} />
          <CardBody>
            {sources.ok ? (
              <SourceHealthTable data={sources.data} />
            ) : (
              <Problem problem={sources.problem} actingAs={subject.label} />
            )}
          </CardBody>
          <CardFooter>
            <TextLink href="/reports/source-health">{t('rep.openReport')}</TextLink>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader title={t('rep.aiHeading')} description={t('rep.aiIntro')} />
          <CardBody>
            {ai.ok ? (
              <AiUsagePanel data={ai.data} />
            ) : (
              <Problem problem={ai.problem} actingAs={subject.label} />
            )}
          </CardBody>
          <CardFooter>
            <TextLink href="/governance/ai-usage">{t('rep.aiOpen')}</TextLink>
          </CardFooter>
        </Card>
      </div>

      {/* ---------------------------------------- freshness, per model */}
      <Card>
        <CardHeader title={t('rep.freshnessHeading')} description={t('rep.freshnessIntro')} />
        <CardBody>
          <DataTable caption={t('rep.freshnessHeading')} captionHidden>
            <THead>
              <Tr>
                <Th scope="col">{t('rep.colModel')}</Th>
                <Th scope="col">{t('rep.colStatus')}</Th>
                <Th scope="col">{t('rep.colRefreshed')}</Th>
                <Th scope="col" align="end">
                  {t('rep.colRows')}
                </Th>
                <Th scope="col">{t('rep.colDetail')}</Th>
              </Tr>
            </THead>
            <TBody>
              {catalogue.data.models.map((model) => (
                <Tr key={model.model}>
                  <Th scope="row">
                    <span className="font-mono text-2xs">{model.model}</span>
                  </Th>
                  <Td>
                    <StatusBadge status={model.status} />
                  </Td>
                  <Td>
                    <span className="text-2xs">
                      {model.refreshedAt === null
                        ? t('rep.neverRefreshed')
                        : stamp(model.refreshedAt)}
                    </span>
                  </Td>
                  <Td numeric>
                    {model.rowCount === null ? DASH : model.rowCount.toLocaleString('en-GB')}
                  </Td>
                  <Td>
                    <span className="max-w-md text-2xs text-ink-muted">
                      {model.failureDetail !== null
                        ? model.failureDetail.split('\n')[0]
                        : model.model === 'rm_question_pipeline'
                          ? t('rep.onWriteNote')
                          : model.model === 'coverage_snapshot'
                            ? t('rep.snapshotModelNote')
                            : ''}
                    </span>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </DataTable>
        </CardBody>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------- panels

const DepartmentRoleChart = ({ data }: { data: Dataset }) => {
  if (data.rows.length === 0) {
    return <EmptyState title={t('rep.emptyTitle')} description={t('rep.emptyBody')} />;
  }
  // Pivot only: every (department, role) pair is ONE row of the dataset, so
  // this rearranges numbers and sums nothing.
  const departments = [...new Set(data.rows.map((row) => String(row['departmentName'])))];
  const roles = [...new Set(data.rows.map((row) => String(row['jobRoleName'])))];
  const named = departments.filter((name) => name !== 'Not filed');
  const series = [
    ...named.map((name, index) => ({
      key: name,
      label: name,
      tone: DEPARTMENT_TONES[index % DEPARTMENT_TONES.length] ?? 'brand',
    })),
    ...(departments.includes('Not filed')
      ? [{ key: 'Not filed', label: t('rep.notFiled'), tone: 'neutral' as const }]
      : []),
  ];
  const columns = roles.map((role) => ({
    label: role === 'Not filed' ? t('rep.notFiled') : role,
    parts: Object.fromEntries(
      data.rows
        .filter((row) => String(row['jobRoleName']) === role)
        .map((row) => [String(row['departmentName']), Number(row['questions'] ?? 0)]),
    ),
  }));
  return (
    <div className="flex flex-col gap-2">
      <StackedColumnChart
        title={t('rep.deptChartTitle')}
        description={t('rep.deptChartNote')}
        series={series}
        columns={columns}
      />
      <AsOf asOf={data.asOf} />
    </div>
  );
};

const LearnerHeatmap = ({ data, metric }: { data: Dataset; metric: HeatMetric }) => {
  // The attribution rule is printed EVEN WITH NO ROWS: what "department" means
  // on this panel is the first thing a reader needs, and an empty heatmap is
  // exactly when somebody asks why their department is missing.
  if (data.rows.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <EmptyState title={t('rep.learnerEmptyTitle')} description={t('rep.learnerEmptyBody')} />
        <AsOf asOf={data.asOf} window={data.sourceWindow} />
        <p className="text-2xs text-ink-muted">{t('rep.learnerAttribution')}</p>
      </div>
    );
  }
  const rows = [...new Set(data.rows.map((row) => String(row['departmentName'])))];
  const columns = [...new Set(data.rows.map((row) => String(row['topicName'])))];
  return (
    <div className="flex flex-col gap-2">
      <MatrixHeatmap
        caption={t('rep.learnerCaption', { metric: t(METRIC_LABEL[metric]) })}
        rows={rows}
        columns={columns}
        suppressedLabel={t('rep.suppressedCell')}
        emptyLabel={t('rep.heatNoAttempts')}
        cells={data.rows.map((row) => {
          const value = row[metric];
          return {
            row: String(row['departmentName']),
            column: String(row['topicName']),
            value: value === 'SUPPRESSED' ? 'SUPPRESSED' : typeof value === 'number' ? value : null,
            detail:
              row['learners'] === 'SUPPRESSED'
                ? []
                : [
                    [t('rep.heatLearners'), Number(row['learners'] ?? 0)],
                    [t('rep.heatAttempts'), Number(row['topicAttempts'] ?? 0)],
                  ],
          };
        })}
      />
      <AsOf asOf={data.asOf} window={data.sourceWindow} />
      <Withheld data={data} />
      <p className="text-2xs text-ink-muted">{t('rep.learnerAttribution')}</p>
    </div>
  );
};

const ActivityTimeline = ({ data }: { data: Dataset }) => (
  <div className="flex flex-col gap-2">
    {data.rows.length === 0 ? (
      <p className="text-sm text-ink-muted">{t('rep.activityEmpty')}</p>
    ) : (
      <ol className="flex flex-col">
        {data.rows.map((row, index) => {
          const kind = String(row['kind']);
          const meta = ACTIVITY[kind];
          const failed = row['outcome'] === 'FAILURE';
          return (
            <li
              key={`${String(row['eventId'] ?? '')}-${index}`}
              className="flex gap-3 border-b border-line py-2 last:border-b-0"
            >
              <span
                aria-hidden="true"
                className={`grid size-7 shrink-0 place-items-center rounded-full ${
                  failed ? 'bg-danger-soft text-danger' : 'bg-info-soft text-info'
                }`}
              >
                {meta?.icon ?? <Activity className="size-4" />}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-semibold text-ink">
                  {meta === undefined ? kind : t(meta.key)}
                </span>
                {row['subject'] === null ? null : (
                  <span className="truncate text-2xs text-ink-muted">{String(row['subject'])}</span>
                )}
                {row['detail'] === null ? null : (
                  <span className="text-2xs text-ink-subtle">{String(row['detail'])}</span>
                )}
              </span>
              <time
                dateTime={String(row['occurredAt'])}
                className="shrink-0 text-right text-2xs text-ink-subtle"
              >
                {stamp(String(row['occurredAt'])).replace(' UTC', '')}
              </time>
            </li>
          );
        })}
      </ol>
    )}
    <AsOf asOf={data.asOf} window={data.sourceWindow} />
    <Withheld data={data} />
  </div>
);

const SourceHealthTable = ({ data }: { data: Dataset }) =>
  data.rows.length === 0 ? (
    <EmptyState title={t('rep.noRowsTitle')} description={t('rep.noRowsBody')} />
  ) : (
    <div className="flex flex-col gap-2">
      <DataTable caption={t('rep.sourceHeading')} captionHidden>
        <THead>
          <Tr>
            <Th scope="col">{t('rep.srcSource')}</Th>
            <Th scope="col" align="end">
              {t('rep.srcDocuments')}
            </Th>
            <Th scope="col" align="end">
              {t('rep.srcSections')}
            </Th>
            <Th scope="col">{t('rep.srcCoverage')}</Th>
            <Th scope="col" align="end">
              {t('rep.srcQuestions')}
            </Th>
            <Th scope="col">{t('rep.srcLastSync')}</Th>
            <Th scope="col">{t('rep.srcStatus')}</Th>
          </Tr>
        </THead>
        <TBody>
          {data.rows.map((row) => {
            const coverage = row['coverageRatioPercent'];
            const statusWord = String(row['status']);
            return (
              <Tr key={String(row['sourceName'])}>
                <Th scope="row">{String(row['sourceName'])}</Th>
                <Td numeric>{Number(row['documents'] ?? 0).toLocaleString('en-GB')}</Td>
                <Td numeric>{Number(row['sections'] ?? 0).toLocaleString('en-GB')}</Td>
                <Td>
                  {typeof coverage === 'number' ? (
                    <Meter
                      size="sm"
                      label={<span className="knowzy-sr-only">{t('rep.srcCoverage')}</span>}
                      percent={coverage}
                      tone={coverage >= 70 ? 'success' : coverage >= 40 ? 'warning' : 'danger'}
                    />
                  ) : (
                    <span className="text-2xs text-ink-subtle">{t('rep.srcNoAssessable')}</span>
                  )}
                </Td>
                <Td numeric>{Number(row['questions'] ?? 0).toLocaleString('en-GB')}</Td>
                <Td>
                  <span className="text-2xs">
                    {row['lastSyncAt'] === null
                      ? t('rep.srcNeverSynced')
                      : day(String(row['lastSyncAt']))}
                  </span>
                </Td>
                <Td>
                  <Badge tone={SOURCE_STATUS_TONE[statusWord] ?? 'neutral'}>{statusWord}</Badge>
                </Td>
              </Tr>
            );
          })}
        </TBody>
      </DataTable>
      <AsOf asOf={data.asOf} />
      <p className="text-2xs text-ink-muted">{t('rep.sourceStatusNote')}</p>
    </div>
  );

const AiUsagePanel = ({ data }: { data: AiSummary }) => {
  const stateOf = new Map(data.providers.map((p) => [p.providerId, p]));
  const generations = data.kpis.totalGenerations.recorded
    ? (data.kpis.totalGenerations.value ?? 0)
    : 0;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <KpiCard
          label={t('rep.aiGenerations')}
          value={recorded(data.kpis.totalGenerations)}
          icon={<Sparkles className="size-5" />}
          tone="ai"
        />
        <KpiCard
          label={t('rep.aiTokens')}
          value={recorded(data.kpis.estimatedTokens)}
          icon={<Layers className="size-5" />}
          tone="info"
        />
        <KpiCard
          label={t('rep.aiCost')}
          value={costText(data.kpis.estimatedCost, generations)}
          caption={data.kpis.estimatedCost.unobservableReason ?? undefined}
          icon={<Coins className="size-5" />}
          tone="warning"
        />
        <KpiCard
          label={t('rep.aiRemaining')}
          value={recorded(data.kpis.remainingDailyBudget)}
          caption={
            data.kpis.budgetUtilizationPercent.recorded
              ? t('rep.aiUtilization', { percent: data.kpis.budgetUtilizationPercent.value ?? 0 })
              : undefined
          }
          icon={<Target className="size-5" />}
          tone="success"
        />
      </div>

      <DataTable caption={t('rep.aiProviders')} captionHidden>
        <THead>
          <Tr>
            <Th scope="col">{t('rep.aiProvider')}</Th>
            <Th scope="col">{t('rep.aiState')}</Th>
            <Th scope="col" align="end">
              {t('rep.aiTokensCol')}
            </Th>
            <Th scope="col" align="end">
              {t('rep.aiCostCol')}
            </Th>
            <Th scope="col">{t('rep.aiHealth')}</Th>
          </Tr>
        </THead>
        <TBody>
          {data.providerUsage.map((usage) => (
            <Tr key={usage.providerId}>
              <Th scope="row">
                <span className="font-mono text-2xs">{usage.providerId}</span>
                {usage.providerId === data.activeProvider ? (
                  <Badge tone="info" withIcon={false} className="ml-2">
                    {t('ai.activeProvider')}
                  </Badge>
                ) : null}
              </Th>
              <Td>
                <span className="text-2xs" title={stateOf.get(usage.providerId)?.reason}>
                  {stateOf.get(usage.providerId)?.state ?? DASH}
                </span>
              </Td>
              <Td numeric>
                {usage.generations === 0
                  ? t('ai.notRecorded')
                  : usage.tokens.totalTokens.toLocaleString('en-GB')}
              </Td>
              <Td numeric>{costText(usage.cost, usage.generations)}</Td>
              <Td>
                {/* UNKNOWN is not healthy: a provider nobody called has earned nothing. */}
                <span title={usage.healthReason}>
                  <StatusBadge status={usage.health} />
                </span>
              </Td>
            </Tr>
          ))}
        </TBody>
      </DataTable>
      <p className="text-2xs text-ink-subtle">
        {t('rep.panelAsOf', { at: stamp(data.asOf) })} {' · '}
        {t('rep.panelWindow', { from: day(data.sourceWindow.from), to: day(data.sourceWindow.to) })}
      </p>
      <p className="text-2xs text-ink-muted">{t('rep.aiNote')}</p>
    </div>
  );
};
