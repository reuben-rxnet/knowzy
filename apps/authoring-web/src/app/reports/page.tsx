// Reports → Dashboard.
//
// The approved design is
// `design/approved/reporting-and-analytics/KNOWZY-reporting-and-analytics-dashboard.png`
// and `docs/ui/REPORTING_AND_ANALYTICS_UI_SOURCE_OF_TRUTH.md` is the contract.
// Three things that document says this screen must not do, all of which the
// mockup does:
//
//   * NO "VS PREVIOUS PERIOD" DELTA. Nothing here stores a prior figure to
//     compare against. The mockup shows one on all eight cards; two of those
//     eight (Coverage, Knowledge Sources) could never have one, because
//     `coverage_status` is current state with no history. Rather than show six
//     deltas and omit two — which invites the question "why not those" and gets
//     the answer "they were made up" — none is shown, and the screen says so.
//   * NO PROVIDER SPEND FOR A PROVIDER THAT HAS NEVER RUN. The AI figures live
//     on Governance → AI Usage & Budgets, which already reports them honestly;
//     this screen LINKS there rather than restating them through a second read
//     path.
//   * NO LEARNER HEATMAP. It needs two read models that do not exist and a
//     person-grouping model with no rows. The card that would hold it says that
//     instead of being empty.
//
// What it does show is every figure the five R1 read models actually hold, each
// with the moment it was true.

import {
  Badge,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  DataTable,
  EmptyState,
  KpiCard,
  PageHero,
  PlannedState,
  StatusBadge,
  TBody,
  THead,
  TabNav,
  Td,
  TextLink,
  Th,
  Tr,
} from '@knowzy/shared-ui';
import { Activity, Database, FileText, Gauge, Layers, Percent } from 'lucide-react';
import { t } from '../../copy';
import { api } from '../../lib/api';
import { Problem } from '../../components/Problem';
import { RefreshModelsButton } from '../../components/ReportActions';
import { currentSubject } from '../../lib/identity';
import { REPORT_TABS } from './tabs';

interface ModelFreshness {
  readonly model: string;
  readonly status: string;
  readonly refreshedAt: string | null;
  readonly rowCount: number | null;
  readonly consecutiveFailures: number;
  readonly failureDetail: string | null;
}

interface Catalogue {
  readonly minimumGroupSize: number;
  readonly canExport: boolean;
  readonly canSnapshot: boolean;
  readonly reports: readonly {
    readonly name: string;
    readonly title: string;
    readonly grain: string;
    readonly windowed: boolean;
    readonly suppressed: boolean;
    readonly metrics: readonly { readonly column: string; readonly label: string }[];
  }[];
  readonly models: readonly ModelFreshness[];
}

interface Dataset {
  readonly name: string;
  readonly title: string;
  readonly asOf: string | null;
  readonly rows: readonly Record<string, string | number | null>[];
  readonly rowCount: number;
  readonly totals: Readonly<Record<string, number>>;
  readonly totalsPartial: Readonly<Record<string, boolean>>;
  readonly suppressedCellCount: number;
}

const DASH = '—';

const stamp = (iso: string | null): string =>
  iso === null ? DASH : new Date(iso).toISOString().replace('T', ' ').slice(0, 16);

const count = (value: number | undefined): string =>
  value === undefined ? DASH : value.toLocaleString('en-GB');

/**
 * A total that suppression has taken rows out of.
 *
 * Where EVERY contributing row was withheld the visible total is 0, and
 * printing that 0 would say "none" about data that exists and cannot be shown.
 * Where some rows survive it is understated, and the caption says so.
 */
const partialCount = (value: number | undefined, partial: boolean | undefined): string => {
  if (value === undefined) return DASH;
  if (partial === true && value === 0) return t('rep.allWithheld');
  return partial === true
    ? `\u2265 ${value.toLocaleString('en-GB')}`
    : value.toLocaleString('en-GB');
};

/** A ratio over two totals, or the honest dash when the denominator is zero. */
const percent = (numerator: number | undefined, denominator: number | undefined): string =>
  numerator === undefined || denominator === undefined || denominator === 0
    ? DASH
    : `${Math.round((numerator / denominator) * 1000) / 10}%`;

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  READY: 'success',
  REFRESHING: 'info' as 'success',
  PENDING: 'neutral',
  FAILED: 'danger',
};

export const dynamic = 'force-dynamic';

export default async function ReportsDashboardPage() {
  const [catalogue, pipeline, generation, assessments, filing, sources, subject] =
    await Promise.all([
      api<Catalogue>('/api/v1/authoring/reports'),
      api<Dataset>('/api/v1/authoring/reports/question-pipeline'),
      api<Dataset>('/api/v1/authoring/reports/generation'),
      api<Dataset>('/api/v1/authoring/reports/assessments'),
      api<Dataset>('/api/v1/authoring/reports/filing'),
      api<Dataset>('/api/v1/authoring/reports/sources'),
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

  // Every figure below is a TOTAL from a dataset the API already scoped and
  // suppressed. This page does no arithmetic the read model has not done, which
  // is rule 4 of Charts.tsx applied to a dashboard: a screen that computed its
  // own totals would be a second, untested version of the read model.
  const pipelineTotals = pipeline.ok ? pipeline.data.totals : {};
  const generationTotals = generation.ok ? generation.data.totals : {};
  const assessmentTotals = assessments.ok ? assessments.data.totals : {};
  const filingTotals = filing.ok ? filing.data.totals : {};
  const sourceTotals = sources.ok ? sources.data.totals : {};

  const publishedRow = pipeline.ok
    ? pipeline.data.rows.filter((row) => row['status'] === 'PUBLISHED')
    : [];
  const published = publishedRow.reduce(
    (sum, row) => sum + (typeof row['questionCount'] === 'number' ? row['questionCount'] : 0),
    0,
  );

  const staleModels = catalogue.data.models.filter((model) => model.status === 'FAILED');
  const unbuilt = catalogue.data.models.filter((model) => model.refreshedAt === null);

  return (
    <div className="flex flex-col gap-6">
      <PageHero
        title={t('rep.heading')}
        purpose={t('rep.intro')}
        actions={<RefreshModelsButton actingAs={subject.label} />}
      />
      {tabs}

      {/* D4: a failed refresh LABELS the dashboard and leaves the previous data
          in place. It never blanks it, and it never goes unmentioned. */}
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

      {/* ---------------------------------------------------------- the KPIs */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label={t('rep.kpiQuestions')}
          value={count(pipelineTotals['questionCount'])}
          caption={t('rep.kpiQuestionsNote')}
          icon={<FileText aria-hidden="true" className="size-5" />}
        />
        <KpiCard
          label={t('rep.kpiPublished')}
          value={count(published)}
          caption={percent(published, pipelineTotals['questionCount'])}
          icon={<FileText aria-hidden="true" className="size-5" />}
        />
        <KpiCard
          label={t('rep.kpiAttempts')}
          value={partialCount(
            assessmentTotals['attempts'],
            assessments.ok ? assessments.data.totalsPartial['attempts'] : false,
          )}
          caption={
            assessments.ok && assessments.data.suppressedCellCount > 0
              ? t('rep.kpiSuppressedNote', {
                  count: String(assessments.data.suppressedCellCount),
                })
              : t('rep.kpiAttemptsNote')
          }
          icon={<Activity aria-hidden="true" className="size-5" />}
        />
        <KpiCard
          label={t('rep.kpiGenerationJobs')}
          value={count(generationTotals['jobs'])}
          caption={t('rep.kpiGenerationJobsNote')}
          icon={<Gauge aria-hidden="true" className="size-5" />}
          tone="ai"
        />
        <KpiCard
          label={t('rep.kpiAccepted')}
          value={count(generationTotals['accepted'])}
          caption={percent(generationTotals['accepted'], generationTotals['requested'])}
          icon={<Percent aria-hidden="true" className="size-5" />}
        />
        <KpiCard
          label={t('rep.kpiDocuments')}
          value={count(sources.ok ? sources.data.rowCount : undefined)}
          caption={t('rep.kpiDocumentsNote')}
          icon={<Database aria-hidden="true" className="size-5" />}
        />
        <KpiCard
          label={t('rep.kpiCovered')}
          value={percent(sourceTotals['sectionsCovered'], sourceTotals['sectionsAssessable'])}
          caption={t('rep.kpiCoveredNote', {
            covered: count(sourceTotals['sectionsCovered']),
            assessable: count(sourceTotals['sectionsAssessable']),
          })}
          icon={<Layers aria-hidden="true" className="size-5" />}
        />
        <KpiCard
          label={t('rep.kpiUnfiled')}
          value={count(filingTotals['partiallyUnfiled'])}
          caption={t('rep.kpiUnfiledNote')}
          icon={<Layers aria-hidden="true" className="size-5" />}
        />
      </div>

      {/* NO DELTAS, said out loud rather than left as an absence a reader
          assumes is an oversight. */}
      <Card>
        <CardBody>
          <p className="max-w-prose text-2xs text-ink-muted">{t('rep.noDeltaNote')}</p>
        </CardBody>
      </Card>

      {/* ------------------------------------------------ freshness, per model */}
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
                    <StatusBadge
                      status={model.status}
                      tone={STATUS_TONE[model.status] ?? 'neutral'}
                    />
                  </Td>
                  <Td>
                    <span className="text-2xs">
                      {model.refreshedAt === null
                        ? t('rep.neverRefreshed')
                        : stamp(model.refreshedAt)}
                    </span>
                  </Td>
                  <Td numeric>{model.rowCount === null ? DASH : count(model.rowCount)}</Td>
                  <Td>
                    <span className="max-w-md text-2xs text-ink-muted">
                      {model.failureDetail === null
                        ? model.model === 'rm_question_pipeline'
                          ? t('rep.onWriteNote')
                          : ''
                        : model.failureDetail.split('\n')[0]}
                    </span>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </DataTable>
          {unbuilt.length === 0 ? null : (
            <p className="mt-3 text-2xs text-ink-muted">
              {t('rep.unbuiltNote', { count: String(unbuilt.length) })}
            </p>
          )}
        </CardBody>
      </Card>

      {/* ------------------------------------------------------- the reports */}
      <Card>
        <CardHeader title={t('rep.catalogueHeading')} description={t('rep.catalogueIntro')} />
        <CardBody>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {catalogue.data.reports.map((report) => (
              <Card key={report.name} elevation="flat">
                <CardHeader title={report.title} description={report.grain} />
                <CardBody>
                  <span className="flex flex-wrap gap-2">
                    <Badge tone="neutral" withIcon={false}>
                      {t('rep.metricCount', { count: String(report.metrics.length) })}
                    </Badge>
                    {report.windowed ? (
                      <Badge tone="info" withIcon={false}>
                        {t('rep.windowed')}
                      </Badge>
                    ) : null}
                    {/* Said on the card, not discovered in the data: a reader
                        who does not know a report suppresses cells will read a
                        SUPPRESSED marker as a fault. */}
                    {report.suppressed ? (
                      <Badge tone="warning" withIcon={false}>
                        {t('rep.suppressedBadge', {
                          size: String(catalogue.data.minimumGroupSize),
                        })}
                      </Badge>
                    ) : null}
                  </span>
                </CardBody>
                <CardFooter>
                  <TextLink href={`/reports/${report.name}`}>{t('rep.openReport')}</TextLink>
                </CardFooter>
              </Card>
            ))}
          </div>
        </CardBody>
      </Card>

      {/* --------------------------------- what the mockup shows and this does not */}
      <Card>
        <CardHeader title={t('rep.elsewhereHeading')} description={t('rep.elsewhereIntro')} />
        <CardBody>
          <ul className="flex flex-col gap-3">
            <li className="flex flex-col gap-1">
              <TextLink href="/governance/ai-usage">{t('rep.linkAiUsage')}</TextLink>
              <span className="text-2xs text-ink-muted">{t('rep.linkAiUsageNote')}</span>
            </li>
            <li className="flex flex-col gap-1">
              <TextLink href="/governance/audit">{t('rep.linkAudit')}</TextLink>
              <span className="text-2xs text-ink-muted">{t('rep.linkAuditNote')}</span>
            </li>
          </ul>
        </CardBody>
      </Card>

      {/* A declared absence with its reason, not an empty panel. */}
      <Card>
        <CardHeader title={t('rep.learnerHeading')} />
        <CardBody>
          <PlannedState title={t('rep.learnerPlanned')} description={t('rep.learnerBody')} />
        </CardBody>
      </Card>

      {pipeline.ok && pipeline.data.rowCount === 0 ? (
        <EmptyState title={t('rep.emptyTitle')} description={t('rep.emptyBody')} />
      ) : null}
    </div>
  );
}
