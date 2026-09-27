// One report.
//
// The same dataset the dashboard's totals came from and the same one the CSV
// will contain, because all three call `runDataset` (B1). Nothing on this page
// aggregates, filters or suppresses — it renders what the API returned.
//
// FOUR THINGS THIS SCREEN SHOWS THAT A REPORT USUALLY HIDES:
//
//   1. `asOf` — the moment the data was true, from the read model's own ledger
//      and never from the clock. A panel whose model has never refreshed says
//      so instead of drawing zeros.
//   2. EVERY METRIC'S FORMULA (B3), on the page, under the table. A number
//      nobody can explain is a number somebody will redefine.
//   3. THE RESOLVED WINDOW (D9) as absolute dates, even when the filter said
//      "last 30 days".
//   4. THE SUPPRESSION STATE — how many cells were withheld and the threshold
//      that withheld them. A `SUPPRESSED` cell with no explanation beside it
//      reads as a bug.

import {
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  DataTable,
  EmptyState,
  Field,
  KpiCard,
  PageHero,
  Select,
  TBody,
  THead,
  TabNav,
  Td,
  TextLink,
  Th,
  Tr,
} from '@knowzy/shared-ui';
import { notFound } from 'next/navigation';
import { t } from '../../../copy';
import { api } from '../../../lib/api';
import { Problem } from '../../../components/Problem';
import { ReportExportButton, SnapshotButton } from '../../../components/ReportActions';
import { currentSubject } from '../../../lib/identity';
import { REPORT_TABS } from '../tabs';

// The catalogue's names, as the API declares them. R2 added the dashboard's
// seven panels, each of which opens here as a full table with its export and
// snapshot — the drill-through from every dashboard panel.
const DATASETS = [
  'question-pipeline',
  'generation',
  'assessments',
  'filing',
  'sources',
  'kpis',
  'question-trend',
  'question-status',
  'department-role',
  'learner-performance',
  'source-health',
  'activity',
] as const;
type DatasetName = (typeof DATASETS)[number];

const isDataset = (value: string): value is DatasetName =>
  (DATASETS as readonly string[]).includes(value);

interface Metric {
  readonly column: string;
  readonly label: string;
  readonly formula: string;
  readonly estimated?: boolean;
}

interface Dataset {
  readonly name: string;
  readonly title: string;
  readonly grain: string;
  readonly asOf: string | null;
  readonly freshness: readonly {
    readonly model: string;
    readonly refreshedAt: string | null;
    readonly status: string;
    readonly consecutiveFailures: number;
    readonly failureDetail: string | null;
  }[];
  readonly dimensions: readonly { readonly column: string; readonly label: string }[];
  readonly metrics: readonly Metric[];
  readonly rows: readonly Record<string, string | number | null>[];
  readonly rowCount: number;
  readonly totals: Readonly<Record<string, number>>;
  readonly totalsPartial: Readonly<Record<string, boolean>>;
  readonly suppressedCellCount: number;
  readonly suppressionReason: string | null;
  readonly minimumGroupSize: number;
  readonly drillThrough: string | null;
  readonly windowDays: number | null;
  readonly windowFrom: string | null;
  readonly windowTo: string | null;
  readonly cached: boolean;
}

// A dashboard panel's report has no tab of its own; it opens under Dashboard,
// which is where its panel lives.
const TAB_HREF: Record<DatasetName, (typeof REPORT_TABS)[number]['href']> = {
  'question-pipeline': '/reports/question-pipeline',
  generation: '/reports/generation',
  assessments: '/reports/assessments',
  filing: '/reports/filing',
  sources: '/reports/sources',
  kpis: '/reports',
  'question-trend': '/reports',
  'question-status': '/reports/question-pipeline',
  'department-role': '/reports/filing',
  'learner-performance': '/reports/assessments',
  'source-health': '/reports/sources',
  activity: '/reports',
};

/**
 * Whether a metric's column total means anything.
 *
 * A sum of counts is a total; a sum of percentages or averages is a number
 * nobody should read — five 80% coverage figures do not make 400%. The API
 * omits totals entirely for an entry that declares itself not summable.
 */
const isTotalMeaningful = (column: string, totals: Readonly<Record<string, number>>): boolean =>
  column in totals && !/(Percent|Score)$/.test(column);

const WINDOWS = ['7', '30', '90', '365'] as const;

const DASH = '—';

const stamp = (iso: string | null): string =>
  iso === null ? DASH : new Date(iso).toISOString().replace('T', ' ').slice(0, 16);

/**
 * One cell.
 *
 * `SUPPRESSED` is rendered as a badge rather than as text, so it cannot be
 * mistaken for a value; `null` is a dash, which means "not computed" and is a
 * different fact from zero; and a number is localized.
 */
const cell = (value: string | number | null | undefined): React.JSX.Element => {
  if (value === 'SUPPRESSED') {
    return (
      <Badge tone="warning" withIcon={false}>
        {t('rep.suppressedCell')}
      </Badge>
    );
  }
  if (value === null || value === undefined) return <span className="text-ink-subtle">{DASH}</span>;
  if (typeof value === 'number') return <>{value.toLocaleString('en-GB')}</>;
  return <>{value}</>;
};

export const dynamic = 'force-dynamic';

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ dataset: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { dataset } = await params;
  if (!isDataset(dataset)) notFound();

  const query = await searchParams;
  const requested = typeof query['windowDays'] === 'string' ? query['windowDays'] : '';
  const windowDays = (WINDOWS as readonly string[]).includes(requested) ? requested : '';
  const suffix = windowDays === '' ? '' : `?windowDays=${windowDays}`;

  const [result, subject] = await Promise.all([
    api<Dataset>(`/api/v1/authoring/reports/${dataset}${suffix}`),
    currentSubject(),
  ]);

  const tabs = (
    <TabNav
      items={REPORT_TABS.map((tab) => ({ href: tab.href, label: t(tab.labelKey) }))}
      activeHref={TAB_HREF[dataset]}
      ariaLabel={t('rep.tabsLabel')}
    />
  );

  if (!result.ok) {
    return (
      <div className="flex flex-col gap-6">
        <PageHero title={t('rep.heading')} purpose={t('rep.intro')} />
        {tabs}
        <Problem problem={result.problem} actingAs={subject.label} />
      </div>
    );
  }

  const data = result.data;
  const columns = [...data.dimensions, ...data.metrics];
  const failing = data.freshness.filter((entry) => entry.status === 'FAILED');

  return (
    <div className="flex flex-col gap-6">
      <PageHero title={data.title} purpose={data.grain} />
      {tabs}

      {/* --------------------------------------------- the header block, on screen
          The same facts the CSV's header block carries. A reader should not have
          to export a file to find out what they are looking at. */}
      <Card>
        <CardBody>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                label: t('rep.asOf'),
                value: data.asOf === null ? t('rep.neverRefreshed') : stamp(data.asOf),
                note: data.cached ? t('rep.fromCache') : t('rep.computedNow'),
              },
              {
                label: t('rep.window'),
                value:
                  data.windowFrom === null
                    ? t('rep.notWindowed')
                    : `${stamp(data.windowFrom)} → ${stamp(data.windowTo)}`,
                note: data.windowDays === null ? t('rep.currentState') : t('rep.halfOpenUtc'),
              },
              {
                label: t('rep.rows'),
                value: data.rowCount.toLocaleString('en-GB'),
                note: t('rep.rowsNote'),
              },
              {
                label: t('rep.suppression'),
                value:
                  data.suppressedCellCount === 0
                    ? t('rep.nothingWithheld')
                    : t('rep.cellsWithheld', { count: String(data.suppressedCellCount) }),
                note:
                  // The threshold always, and the reason beside it when
                  // something was withheld: two facts, not one or the other.
                  data.suppressionReason === null
                    ? t('rep.minGroup', { size: String(data.minimumGroupSize) })
                    : `${t('rep.minGroup', { size: String(data.minimumGroupSize) })} — ${data.suppressionReason}`,
              },
            ].map((entry) => (
              <div key={entry.label} className="flex flex-col gap-1">
                <dt className="text-2xs font-bold uppercase tracking-wider text-ink-subtle">
                  {entry.label}
                </dt>
                <dd className="text-md font-semibold text-brand-navy-text">{entry.value}</dd>
                <dd className="text-2xs text-ink-muted">{entry.note}</dd>
              </div>
            ))}
          </dl>

          {/* D4 again, per report: the panel is labelled and the data stays. */}
          {failing.length === 0 ? null : (
            <p className="mt-4 max-w-prose text-2xs text-danger-ink">
              {t('rep.datasetStale', {
                models: failing.map((entry) => entry.model).join(', '),
                failures: String(failing[0]?.consecutiveFailures ?? 0),
              })}
            </p>
          )}
        </CardBody>
      </Card>

      {/* ------------------------------------------------------------ filters */}
      <Card>
        <CardHeader title={t('rep.filtersHeading')} description={t('rep.filtersIntro')} />
        {/* A GET form, so a filtered report is a URL somebody can send to a
            colleague — and so the back button works. */}
        <form method="get" className="contents">
          <CardBody>
            <div className="grid gap-4 md:grid-cols-3">
              <Field
                id="windowDays"
                label={t('rep.windowLabel')}
                hint={data.windowDays === null ? t('rep.windowIgnored') : t('rep.windowHint')}
              >
                <Select id="windowDays" name="windowDays" defaultValue={windowDays}>
                  <option value="">{t('rep.windowDefault')}</option>
                  {WINDOWS.map((days) => (
                    <option key={days} value={days}>
                      {t('rep.windowOption', { days })}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </CardBody>
          <CardFooter>
            <span className="flex flex-wrap items-center gap-3">
              <Button type="submit">{t('rep.apply')}</Button>
              {/* Reset as a LINK, not a button: it navigates, and a button that
                  navigates is a button a keyboard user cannot open in a new tab. */}
              <TextLink href={`/reports/${dataset}`}>{t('rep.reset')}</TextLink>
            </span>
          </CardFooter>
        </form>
      </Card>

      {/* -------------------------------------------------------------- totals */}
      {data.rowCount === 0 ? null : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {data.metrics
            .filter((metric) => isTotalMeaningful(metric.column, data.totals))
            .slice(0, 4)
            .map((metric) => (
              <KpiCard
                key={metric.column}
                label={metric.label}
                value={
                  data.totalsPartial[metric.column] === true
                    ? (data.totals[metric.column] ?? 0) === 0
                      ? t('rep.allWithheld')
                      : `\u2265 ${(data.totals[metric.column] ?? 0).toLocaleString('en-GB')}`
                    : (data.totals[metric.column] ?? 0).toLocaleString('en-GB')
                }
                // S4, said on the card: a suppressed row contributes to no total,
                // so a total beside suppressed rows is deliberately understated.
                caption={
                  data.suppressedCellCount > 0 ? t('rep.totalVisibleOnly') : t('rep.totalAllRows')
                }
              />
            ))}
        </div>
      )}

      {/* --------------------------------------------------------- the table */}
      <Card>
        <CardHeader
          title={t('rep.tableHeading')}
          description={data.grain}
          actions={
            <span className="flex flex-wrap items-center gap-2">
              <SnapshotButton dataset={dataset} windowDays={windowDays} actingAs={subject.label} />
              <ReportExportButton
                dataset={dataset}
                windowDays={windowDays}
                actingAs={subject.label}
              />
            </span>
          }
        />
        <CardBody>
          {data.rowCount === 0 ? (
            <EmptyState
              title={data.asOf === null ? t('rep.notBuiltTitle') : t('rep.noRowsTitle')}
              description={data.asOf === null ? t('rep.notBuiltBody') : t('rep.noRowsBody')}
            />
          ) : (
            <DataTable caption={data.title} captionHidden>
              <THead>
                <Tr>
                  {columns.map((column, index) => (
                    <Th
                      key={column.column}
                      scope="col"
                      {...(index >= data.dimensions.length ? { align: 'end' as const } : {})}
                    >
                      {column.label}
                    </Th>
                  ))}
                </Tr>
              </THead>
              <TBody>
                {data.rows.map((row, rowIndex) => (
                  <Tr key={`${rowIndex}-${String(row[columns[0]?.column ?? ''] ?? '')}`}>
                    {columns.map((column, index) =>
                      index === 0 ? (
                        <Th key={column.column} scope="row">
                          {cell(row[column.column])}
                        </Th>
                      ) : (
                        <Td
                          key={column.column}
                          {...(index >= data.dimensions.length ? { align: 'end' as const } : {})}
                        >
                          {cell(row[column.column])}
                        </Td>
                      ),
                    )}
                  </Tr>
                ))}
              </TBody>
            </DataTable>
          )}
        </CardBody>
        {data.drillThrough === null ? null : (
          <CardFooter>
            {/* §3.2: an aggregate a reader cannot decompose is one they cannot
                audit, so every entry declares where its rows live. */}
            <TextLink href={data.drillThrough}>{t('rep.drillThrough')}</TextLink>
          </CardFooter>
        )}
      </Card>

      {/* ------------------------------------------------------- the formulas */}
      <Card>
        <CardHeader title={t('rep.formulaHeading')} description={t('rep.formulaIntro')} />
        <CardBody>
          <dl className="flex flex-col divide-y divide-line rounded-md border border-line">
            {data.metrics.map((metric) => (
              <div key={metric.column} className="flex flex-col gap-1 px-3 py-2.5">
                <dt className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                  {metric.label}
                  {metric.estimated === true ? (
                    <Badge tone="neutral" withIcon={false}>
                      {t('rep.estimated')}
                    </Badge>
                  ) : null}
                </dt>
                <dd className="font-mono text-2xs text-ink-muted">{metric.formula}</dd>
              </div>
            ))}
          </dl>
        </CardBody>
      </Card>
    </div>
  );
}
