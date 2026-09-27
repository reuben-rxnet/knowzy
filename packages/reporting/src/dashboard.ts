// The Reporting & Analytics dashboard's datasets — Phase 10 R2.
//
// Seven catalogue entries, one per panel of the approved design that R1 drew as
// a table or not at all. They are ordinary catalogue entries: `runDataset`
// calls them, so the dashboard panel, the CSV export, a report snapshot and the
// cache all read the same rows (B1). There is no dashboard-only query.
//
//   kpis                 the eight headline figures, each with a comparison
//   question-trend       generated vs published, bucketed by day/week/month
//   question-status      the lifecycle in the design's five buckets, plus the
//                        two it must not hide
//   department-role      the bank by department × job role (decision D-1)
//   learner-performance  department × topic, suppressed on BOTH axes
//   source-health        per source: content, coverage, questions, last sync
//   activity             recent platform events from the audit store
//
// TWO DECISIONS FROM 2026-09-27 GOVERN THIS FILE
//
//   D-1  Department + Job Role is the reporting hierarchy. No team model is
//        read, because none is maintained. Learner performance is grouped by
//        the department the QUESTIONS were filed under — a learner has no
//        department — and the panel says so.
//   R-1  `coverage_snapshot` is the authoritative history of point-in-time
//        state. A KPI that is a STATE is compared against the snapshot taken
//        on the day its period began; a KPI that is a FLOW is compared against
//        the previous window of the same dated rows. See comparison.ts.

import { sourceWorkflowStatus } from '@knowzy/shared-types';
import type { ReadOnlyDb } from './audit-explorer.js';
import type { RefreshDb } from './refresh.js';
import type { DatasetDefinition } from './catalogue-types.js';
import {
  applyGridSuppression,
  effectiveMinimumGroupSize,
  suppressionReasonOf,
  SUPPRESSED,
  type DatasetRow,
} from './suppression.js';
import {
  SNAPSHOT_BASE_TOLERANCE_DAYS,
  addDays,
  compareValues,
  noComparison,
  previousWindow,
  utcDate,
  type ChangeUnit,
  type Comparison,
} from './comparison.js';

export { DASHBOARD_DATASETS, type DashboardDatasetName } from './catalogue-types.js';
import { DASHBOARD_DATASETS, type DashboardDatasetName } from './catalogue-types.js';

export const isDashboardDataset = (value: string): value is DashboardDatasetName =>
  (DASHBOARD_DATASETS as readonly string[]).includes(value);

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

export const DASHBOARD_DEFINITIONS: Readonly<Record<DashboardDatasetName, DatasetDefinition>> = {
  kpis: {
    name: 'kpis',
    title: 'Headline figures',
    grain: 'one row per headline figure',
    models: [
      'rm_question_pipeline',
      'rm_source_coverage',
      'rm_platform_inventory',
      'rm_assessment_attempt',
      'rm_generation_yield',
      // NOT coverage_snapshot. The snapshot is the comparison BASE, dated in
      // each row's note; counting its once-a-day capture here would report
      // every current figure as up to a day stale when it is fifteen minutes.
    ],
    requiredPermission: 'report.read',
    drillThrough: null,
    dimensions: [
      { column: 'label', label: 'Figure' },
      { column: 'valueStatus', label: 'Value status' },
      { column: 'comparisonStatus', label: 'Comparison' },
      { column: 'basis', label: 'Compared against' },
      { column: 'comparisonNote', label: 'Comparison note' },
    ],
    metrics: [
      {
        column: 'value',
        label: 'Current value',
        formula: 'per figure — the row’s own formula column states it',
      },
      {
        column: 'previousValue',
        label: 'Previous value',
        formula:
          'STATE figures: the coverage snapshot recorded on the day the period began. FLOW figures: the same count over the window immediately before this one',
      },
      { column: 'change', label: 'Change', formula: 'current − previous, in the figure’s unit' },
      {
        column: 'changePercent',
        label: 'Change %',
        formula:
          '(current − previous) ÷ previous × 100; null for a ratio (reported in points) and for a zero base',
      },
    ],
    suppressesPeople: true,
    summable: false,
    windowed: true,
    defaultWindowDays: 30,
  },

  'question-trend': {
    name: 'question-trend',
    title: 'Question generation trend',
    grain: 'day, week or month, from the window length',
    models: ['rm_generation_yield', 'rm_question_activity'],
    requiredPermission: 'report.read',
    drillThrough: '/reports/generation',
    dimensions: [
      { column: 'bucket', label: 'Period starting' },
      { column: 'label', label: 'Period' },
      { column: 'partial', label: 'Partial period' },
    ],
    metrics: [
      {
        column: 'generated',
        label: 'Generated questions',
        formula:
          'sum(accepted_question_count) over generation jobs created in the period — drafts a generator produced and the platform kept',
      },
      {
        column: 'published',
        label: 'Published questions',
        formula: 'count(published_question_reference) with published_at in the period',
      },
    ],
    windowed: true,
    defaultWindowDays: 365,
  },

  'question-status': {
    name: 'question-status',
    title: 'Questions by status',
    grain: 'lifecycle bucket',
    models: ['rm_question_pipeline'],
    requiredPermission: 'report.read',
    drillThrough: '/reports/question-pipeline',
    dimensions: [
      { column: 'bucket', label: 'Status' },
      { column: 'states', label: 'Lifecycle states counted' },
    ],
    metrics: [
      {
        column: 'questionCount',
        label: 'Questions',
        formula: 'count(draft_question) whose status is one of the bucket’s states',
      },
      {
        column: 'sharePercent',
        label: 'Share',
        formula: 'bucket ÷ every question in every state × 100 — the buckets sum to the total',
      },
    ],
    windowed: false,
  },

  'department-role': {
    name: 'department-role',
    title: 'Questions by department and job role',
    grain: 'department × job role',
    models: ['rm_filing_coverage'],
    requiredPermission: 'report.read',
    drillThrough: '/reports/filing',
    dimensions: [
      { column: 'departmentName', label: 'Department' },
      { column: 'jobRoleName', label: 'Job role' },
    ],
    metrics: [
      {
        column: 'questions',
        label: 'Questions',
        formula: 'count(draft_question) filed under the department and role, every state',
      },
      {
        column: 'published',
        label: 'Published',
        formula: "count(WHERE status = 'PUBLISHED') in the same group",
      },
    ],
    windowed: false,
  },

  'learner-performance': {
    name: 'learner-performance',
    title: 'Learner performance',
    grain: 'department (of the questions asked) × topic',
    models: ['rm_topic_attempt'],
    requiredPermission: 'report.read',
    drillThrough: '/reports/assessments',
    dimensions: [
      { column: 'departmentName', label: 'Department (questions filed under)' },
      { column: 'topicName', label: 'Topic' },
      { column: 'domainCode', label: 'Domain' },
    ],
    metrics: [
      {
        column: 'learners',
        label: 'Learners',
        formula: 'count(DISTINCT learner) with a scored topic result in the window',
      },
      {
        column: 'topicAttempts',
        label: 'Topic attempts',
        formula: 'count(topic_result) of SCORED results completed in the window',
      },
      {
        column: 'averageScore',
        label: 'Average score',
        formula: 'avg(topic_accuracy) — the share of the topic’s questions answered correctly',
      },
      {
        column: 'passRatePercent',
        label: 'Pass rate',
        formula:
          'topic attempts whose ASSESSMENT was passed ÷ topic attempts × 100 — a pass is decided per assessment, not per topic',
      },
      {
        column: 'attemptSuccessPercent',
        label: 'Attempt success',
        formula: 'topic attempts not flagged as a knowledge gap ÷ topic attempts × 100',
      },
    ],
    suppressesPeople: true,
    windowed: true,
    defaultWindowDays: 365,
  },

  'source-health': {
    name: 'source-health',
    title: 'Knowledge source health',
    grain: 'knowledge source',
    models: ['rm_source_coverage'],
    requiredPermission: 'report.read',
    drillThrough: '/sources',
    dimensions: [
      { column: 'sourceName', label: 'Source' },
      { column: 'status', label: 'Status' },
      { column: 'lastSyncAt', label: 'Last sync' },
      { column: 'lastSyncOutcome', label: 'Last sync outcome' },
    ],
    metrics: [
      {
        column: 'documents',
        label: 'Documents',
        formula: 'count(knowledge_document WHERE status = ACTIVE)',
      },
      { column: 'sections', label: 'Sections', formula: 'count(document_section)' },
      {
        column: 'assessableSections',
        label: 'Assessable',
        formula: 'count(document_section WHERE is_assessable)',
      },
      {
        column: 'coverageRatioPercent',
        label: 'Coverage',
        formula: 'covered ÷ assessable × 100, null when assessable = 0',
      },
      {
        column: 'questions',
        label: 'Questions',
        formula: 'count(draft_question) traced to the source’s documents',
      },
    ],
    windowed: false,
  },

  activity: {
    name: 'activity',
    title: 'Recent activity',
    grain: 'audit event, or learner completions per assessment per day',
    // The audit store itself: append-only and live, so there is no refresh
    // ledger to read. `asOf` is the time of the newest event read, which is
    // the moment up to which the feed is complete.
    models: [],
    requiredPermission: 'report.read',
    drillThrough: '/governance/audit',
    dimensions: [
      { column: 'occurredAt', label: 'When' },
      { column: 'kind', label: 'Event' },
      { column: 'subject', label: 'Subject' },
      { column: 'detail', label: 'Detail' },
      { column: 'outcome', label: 'Outcome' },
    ],
    metrics: [
      {
        column: 'learners',
        label: 'Learners',
        formula:
          'completions only: count(DISTINCT learner) scored on the assessment that day; the row is withheld below the minimum group size',
      },
    ],
    suppressesPeople: true,
    summable: false,
    windowed: true,
    defaultWindowDays: 30,
    defaultPageSize: 20,
  },
};

// ---------------------------------------------------------------------------
// Running one
// ---------------------------------------------------------------------------

export interface DashboardQueryContext {
  readonly db: ReadOnlyDb;
  readonly scopeAll: boolean;
  readonly scopeList: readonly string[];
  readonly sourceAll: boolean;
  readonly sourceList: readonly string[];
  readonly from: Date | null;
  readonly to: Date;
  readonly windowDays: number | null;
  readonly pageSize: number;
  readonly minimumGroupSize: number;
}

export interface DashboardQueryResult {
  readonly rows: readonly DatasetRow[];
  /** Suppression the query applied itself, because its shape is not a flat list. */
  readonly suppression?: { readonly suppressedCellCount: number; readonly reason: string | null };
  /** Set where `asOf` is not the ledger's (the live audit feed). */
  readonly asOf?: string | null;
  /** Set where the resolved window starts elsewhere than `to − days` (bucketed trends). */
  readonly windowFrom?: Date;
}

const num = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const ratio = (numerator: number | null, denominator: number | null): number | null =>
  numerator === null || denominator === null || denominator === 0
    ? null
    : Math.round((numerator / denominator) * 10_000) / 100;

export const runDashboardQuery = async (
  name: DashboardDatasetName,
  ctx: DashboardQueryContext,
): Promise<DashboardQueryResult> => {
  switch (name) {
    case 'kpis':
      return kpis(ctx);
    case 'question-trend':
      return questionTrend(ctx);
    case 'question-status':
      return questionStatus(ctx);
    case 'department-role':
      return departmentRole(ctx);
    case 'learner-performance':
      return learnerPerformance(ctx);
    case 'source-health':
      return sourceHealth(ctx);
    case 'activity':
      return activity(ctx);
  }
};

// ======================================================================= KPIs

export type KpiKey =
  | 'totalQuestions'
  | 'publishedQuestions'
  | 'assessmentsCompleted'
  | 'passRate'
  | 'knowledgeSources'
  | 'coverage'
  | 'aiGenerations'
  | 'estimatedAiCost';

/**
 * `MEASURED` — a figure. `NOT_RECORDED` — nothing has happened that could
 * produce one (a pass rate with no attempts). `NOT_OBSERVABLE` — a
 * contributor's cost cannot be known. `SUPPRESSED` — withheld (S1).
 */
export type KpiValueStatus = 'MEASURED' | 'NOT_RECORDED' | 'NOT_OBSERVABLE' | 'SUPPRESSED';

interface SnapshotBase {
  readonly snapshot_date: Date;
  readonly total_questions: number;
  readonly published_questions: number;
  readonly source_count: number;
  readonly coverage_percent: string | null;
}

const kpiRow = (args: {
  readonly kpi: KpiKey;
  readonly label: string;
  readonly unit: 'count' | 'percent' | 'currency';
  readonly value: number | null | typeof SUPPRESSED;
  readonly valueStatus: KpiValueStatus;
  readonly comparison: Comparison;
  readonly formula: string;
}): DatasetRow => ({
  kpi: args.kpi,
  label: args.label,
  unit: args.unit,
  value: args.value,
  valueStatus: args.valueStatus,
  previousValue: args.comparison.status === 'SUPPRESSED' ? SUPPRESSED : args.comparison.previous,
  change: args.comparison.change,
  changePercent: args.comparison.changePercent,
  direction: args.comparison.direction,
  changeUnit: args.comparison.unit,
  comparisonStatus: args.comparison.status,
  basis: args.comparison.basis,
  baseFrom: args.comparison.baseFrom,
  baseTo: args.comparison.baseTo,
  comparisonNote: args.comparison.note,
  formula: args.formula,
});

const kpis = async (ctx: DashboardQueryContext): Promise<DashboardQueryResult> => {
  const { db } = ctx;
  const days = ctx.windowDays ?? 30;
  const from = ctx.from ?? new Date(ctx.to.getTime() - days * 86_400_000);
  const prev = previousWindow(from, days);
  const threshold = effectiveMinimumGroupSize(ctx.minimumGroupSize);
  const restricted = !ctx.scopeAll || !ctx.sourceAll;
  let suppressed = 0;

  // ----------------------------------------------------------- current state
  const [pipeline] = await db.$queryRawUnsafe<{ total: number; published: number }[]>(
    `SELECT COALESCE(sum(question_count), 0)::int AS total,
            COALESCE(sum(question_count) FILTER (WHERE status = 'PUBLISHED'), 0)::int AS published
       FROM reporting.rm_question_pipeline
      WHERE ($1::boolean OR domain_id = ANY($2::uuid[]))`,
    ctx.scopeAll,
    [...ctx.scopeList],
  );
  const [coverage] = await db.$queryRawUnsafe<{ assessable: number; covered: number }[]>(
    `SELECT COALESCE(sum(sections_assessable), 0)::int AS assessable,
            COALESCE(sum(sections_covered), 0)::int    AS covered
       FROM reporting.rm_source_coverage
      WHERE ($1::boolean OR source_id = ANY($2::uuid[]))`,
    ctx.sourceAll,
    [...ctx.sourceList],
  );
  const sourceCount = ctx.sourceAll
    ? num(
        (
          await db.$queryRawUnsafe<{ n: number }[]>(
            `SELECT source_count::int AS n FROM reporting.rm_platform_inventory`,
          )
        )[0]?.n,
      )
    : num(
        (
          await db.$queryRawUnsafe<{ n: number }[]>(
            `SELECT count(*)::int AS n FROM knowledge_source
              WHERE archived_at IS NULL AND id = ANY($1::uuid[])`,
            [...ctx.sourceList],
          )
        )[0]?.n,
      );

  // --------------------------------------------------------------- flows
  const attemptsIn = async (a: Date, b: Date) =>
    (
      await db.$queryRawUnsafe<{ attempts: number; passed: number; learners: number }[]>(
        `SELECT count(*)::int                          AS attempts,
                count(*) FILTER (WHERE passed)::int    AS passed,
                count(DISTINCT learner_user_id)::int   AS learners
           FROM reporting.rm_assessment_attempt
          WHERE ($1::boolean OR domain_id = ANY($2::uuid[]))
            AND completed_at >= $3::timestamptz AND completed_at < $4::timestamptz`,
        ctx.scopeAll,
        [...ctx.scopeList],
        a,
        b,
      )
    )[0] ?? { attempts: 0, passed: 0, learners: 0 };

  const generationIn = async (a: Date, b: Date) =>
    (
      await db.$queryRawUnsafe<{ jobs: number; observable_jobs: number; cost: string | null }[]>(
        `SELECT COALESCE(sum(jobs), 0)::int                 AS jobs,
                COALESCE(sum(cost_observable_jobs), 0)::int AS observable_jobs,
                sum(observable_cost)                        AS cost
           FROM reporting.rm_generation_yield
          WHERE ($1::boolean OR domain_id = ANY($2::uuid[]))
            AND day >= $3::timestamptz AND day < $4::timestamptz`,
        ctx.scopeAll,
        [...ctx.scopeList],
        a,
        b,
      )
    )[0] ?? { jobs: 0, observable_jobs: 0, cost: null };

  const [curAttempts, prevAttempts, curGen, prevGen] = await Promise.all([
    attemptsIn(from, ctx.to),
    attemptsIn(prev.from, prev.to),
    generationIn(from, ctx.to),
    generationIn(prev.from, prev.to),
  ]);

  // ---------------------------------------------------------- snapshot base
  const baseDate = utcDate(from);
  const [base] = await db.$queryRawUnsafe<SnapshotBase[]>(
    `SELECT snapshot_date, total_questions, published_questions, source_count, coverage_percent
       FROM reporting.coverage_snapshot
      WHERE snapshot_date <= $1::date AND snapshot_date >= $2::date
      ORDER BY snapshot_date DESC
      LIMIT 1`,
    baseDate,
    addDays(baseDate, -SNAPSHOT_BASE_TOLERANCE_DAYS),
  );
  const [first] = await db.$queryRawUnsafe<{ first: Date | null }[]>(
    `SELECT min(snapshot_date) AS first FROM reporting.coverage_snapshot`,
  );
  const firstSnapshot =
    first?.first === null || first?.first === undefined ? null : utcDate(first.first);

  const againstSnapshot = (
    current: number | null,
    pick: (row: SnapshotBase) => number | null,
    unit: ChangeUnit,
  ): Comparison => {
    if (restricted) {
      return noComparison({
        status: 'SCOPE_RESTRICTED',
        unit,
        basis: 'SNAPSHOT',
        note: 'Coverage snapshots are platform-wide and your view is restricted, so there is no base for your scope.',
      });
    }
    if (base === undefined) {
      return noComparison({
        status: 'NOT_YET_AVAILABLE',
        unit,
        basis: 'SNAPSHOT',
        note:
          firstSnapshot === null
            ? 'No coverage snapshot has been recorded yet.'
            : `A ${days}-day comparison needs the snapshot of ${baseDate}. The first was recorded on ${firstSnapshot}, so this becomes available on ${addDays(firstSnapshot, days)}.`,
      });
    }
    const previous = pick(base);
    if (current === null || previous === null) {
      return noComparison({
        status: 'NOT_YET_AVAILABLE',
        unit,
        basis: 'SNAPSHOT',
        note: 'One of the two values has no denominator, so there is nothing to compare.',
      });
    }
    const on = utcDate(base.snapshot_date);
    return compareValues({
      current,
      previous,
      unit,
      basis: 'SNAPSHOT',
      baseFrom: on,
      baseTo: null,
      note: `Against the coverage snapshot of ${on}.`,
    });
  };

  const windowNote = `Against ${utcDate(prev.from)} → ${utcDate(prev.to)}, the ${days} days before this window.`;

  // ------------------------------------------------ learner-derived figures
  const personBearing = (learners: number) => learners > 0 && learners < threshold;
  const curHidden = personBearing(curAttempts.learners);
  const prevHidden = personBearing(prevAttempts.learners);
  const learnerComparison = (current: number | null, previous: number | null, unit: ChangeUnit) => {
    if (curHidden || prevHidden) {
      suppressed += 1;
      return noComparison({
        status: 'SUPPRESSED',
        unit,
        basis: 'DATED_ROWS',
        note: `Withheld: one of the two windows has fewer than ${threshold} distinct learners.`,
      });
    }
    if (current === null || previous === null) {
      return noComparison({
        status: 'NOT_YET_AVAILABLE',
        unit,
        basis: 'DATED_ROWS',
        note: 'No scored attempt in one of the two windows, so there is no rate to compare.',
      });
    }
    return compareValues({
      current,
      previous,
      unit,
      basis: 'DATED_ROWS',
      baseFrom: prev.from.toISOString(),
      baseTo: prev.to.toISOString(),
      note: windowNote,
    });
  };
  if (curHidden) suppressed += 2;

  const curPass = ratio(curAttempts.passed, curAttempts.attempts);
  const prevPass = ratio(prevAttempts.passed, prevAttempts.attempts);

  // ------------------------------------------------------------------ cost
  const costOf = (g: { jobs: number; observable_jobs: number; cost: string | null }) =>
    g.jobs === 0
      ? { status: 'NOT_RECORDED' as const, value: null }
      : g.observable_jobs < g.jobs
        ? { status: 'NOT_OBSERVABLE' as const, value: null }
        : { status: 'MEASURED' as const, value: Math.round((num(g.cost) ?? 0) * 1e6) / 1e6 };
  const curCost = costOf(curGen);
  const prevCost = costOf(prevGen);
  const costComparison =
    curCost.status === 'NOT_OBSERVABLE' || prevCost.status === 'NOT_OBSERVABLE'
      ? noComparison({
          status: 'NOT_OBSERVABLE',
          unit: 'currency',
          basis: 'DATED_ROWS',
          note: 'A job in one of the two windows has no observable cost, so neither total exists to compare.',
        })
      : curCost.value === null || prevCost.value === null
        ? noComparison({
            status: 'NOT_YET_AVAILABLE',
            unit: 'currency',
            basis: 'DATED_ROWS',
            note: 'No generation in one of the two windows, so there is no cost to compare.',
          })
        : compareValues({
            current: curCost.value,
            previous: prevCost.value,
            unit: 'currency',
            basis: 'DATED_ROWS',
            baseFrom: prev.from.toISOString(),
            baseTo: prev.to.toISOString(),
            note: windowNote,
          });

  const coveragePercent = ratio(coverage?.covered ?? 0, coverage?.assessable ?? 0);

  const rows: DatasetRow[] = [
    kpiRow({
      kpi: 'totalQuestions',
      label: 'Total questions',
      unit: 'count',
      value: pipeline?.total ?? 0,
      valueStatus: 'MEASURED',
      comparison: againstSnapshot(pipeline?.total ?? 0, (b) => b.total_questions, 'count'),
      formula: 'count(draft_question), every lifecycle state',
    }),
    kpiRow({
      kpi: 'publishedQuestions',
      label: 'Published questions',
      unit: 'count',
      value: pipeline?.published ?? 0,
      valueStatus: 'MEASURED',
      comparison: againstSnapshot(pipeline?.published ?? 0, (b) => b.published_questions, 'count'),
      formula: "count(draft_question WHERE status = 'PUBLISHED')",
    }),
    kpiRow({
      kpi: 'assessmentsCompleted',
      label: 'Assessments completed',
      unit: 'count',
      value: curHidden ? SUPPRESSED : curAttempts.attempts,
      valueStatus: curHidden ? 'SUPPRESSED' : 'MEASURED',
      comparison: learnerComparison(curAttempts.attempts, prevAttempts.attempts, 'count'),
      formula: "count(assessment_result WHERE result_state = 'SCORED') completed in the window",
    }),
    kpiRow({
      kpi: 'passRate',
      label: 'Pass rate',
      unit: 'percent',
      value: curHidden ? SUPPRESSED : curPass,
      valueStatus: curHidden ? 'SUPPRESSED' : curPass === null ? 'NOT_RECORDED' : 'MEASURED',
      comparison: learnerComparison(curPass, prevPass, 'points'),
      formula:
        'scored attempts passed ÷ scored attempts × 100, in the window; null with no attempts',
    }),
    kpiRow({
      kpi: 'knowledgeSources',
      label: 'Knowledge sources',
      unit: 'count',
      value: sourceCount,
      valueStatus: sourceCount === null ? 'NOT_RECORDED' : 'MEASURED',
      comparison: againstSnapshot(sourceCount, (b) => b.source_count, 'count'),
      formula: 'count(knowledge_source WHERE archived_at IS NULL)',
    }),
    kpiRow({
      kpi: 'coverage',
      label: 'Coverage',
      unit: 'percent',
      value: coveragePercent,
      valueStatus: coveragePercent === null ? 'NOT_RECORDED' : 'MEASURED',
      comparison: againstSnapshot(coveragePercent, (b) => num(b.coverage_percent), 'points'),
      formula:
        "sections with coverage_status = 'COVERED' ÷ assessable sections × 100, over active documents; a generator's refusal is not coverage",
    }),
    kpiRow({
      kpi: 'aiGenerations',
      label: 'AI generations',
      unit: 'count',
      value: curGen.jobs,
      valueStatus: 'MEASURED',
      comparison: compareValues({
        current: curGen.jobs,
        previous: prevGen.jobs,
        unit: 'count',
        basis: 'DATED_ROWS',
        baseFrom: prev.from.toISOString(),
        baseTo: prev.to.toISOString(),
        note: windowNote,
      }),
      formula: 'count(generation_job) created in the window, every provider and outcome',
    }),
    kpiRow({
      kpi: 'estimatedAiCost',
      label: 'Estimated AI cost',
      unit: 'currency',
      value: curCost.value,
      valueStatus: curCost.status,
      comparison: costComparison,
      formula:
        'sum(estimated_cost) over the window’s jobs; not observable when any job’s cost could not be observed',
    }),
  ];

  return {
    rows,
    suppression: {
      suppressedCellCount: suppressed,
      reason:
        suppressed === 0
          ? null
          : `Figures derived from fewer than ${threshold} distinct learners are withheld (S1).`,
    },
  };
};

// ============================================================ question trend

export type TrendUnit = 'day' | 'week' | 'month';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The periods a trend of `windowDays` is drawn over, oldest first.
 *
 * Pure and exported for a table test. Up to 31 days is daily, up to 120 is
 * ISO-weekly (Monday start, as PostgreSQL's `date_trunc('week')`), anything
 * longer is monthly and ALWAYS ends in the current, partial month — which the
 * chart labels, because a partial month drawn level with complete ones reads
 * as a decline.
 */
export const trendBuckets = (
  to: Date,
  windowDays: number,
): { readonly unit: TrendUnit; readonly starts: readonly string[] } => {
  const dayStart = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  if (windowDays <= 31) {
    const starts = Array.from({ length: windowDays }, (_, i) =>
      utcDate(new Date(dayStart - (windowDays - 1 - i) * 86_400_000)),
    );
    return { unit: 'day', starts };
  }
  if (windowDays <= 120) {
    const weekday = (new Date(dayStart).getUTCDay() + 6) % 7; // Monday = 0
    const thisWeek = dayStart - weekday * 86_400_000;
    const weeks = Math.ceil(windowDays / 7);
    const starts = Array.from({ length: weeks }, (_, i) =>
      utcDate(new Date(thisWeek - (weeks - 1 - i) * 7 * 86_400_000)),
    );
    return { unit: 'week', starts };
  }
  const months = Math.max(2, Math.round(windowDays / 30.4));
  const starts = Array.from({ length: months }, (_, i) => {
    const d = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - (months - 1 - i), 1));
    return utcDate(d);
  });
  return { unit: 'month', starts };
};

export const trendLabel = (unit: TrendUnit, start: string): string => {
  const [y, m, d] = start.split('-').map(Number) as [number, number, number];
  const month = MONTHS[m - 1] ?? '';
  if (unit === 'month') return `${month} ${y}`;
  if (unit === 'week') return `w/c ${d} ${month}`;
  return `${d} ${month}`;
};

const questionTrend = async (ctx: DashboardQueryContext): Promise<DashboardQueryResult> => {
  const { unit, starts } = trendBuckets(ctx.to, ctx.windowDays ?? 365);
  const first = new Date(`${starts[0]}T00:00:00Z`);

  const generated = await ctx.db.$queryRawUnsafe<{ bucket: string; n: number }[]>(
    `SELECT to_char(date_trunc($1, y.day AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS bucket,
            COALESCE(sum(y.accepted), 0)::int AS n
       FROM reporting.rm_generation_yield y
      WHERE ($2::boolean OR y.domain_id = ANY($3::uuid[]))
        AND y.day >= $4::timestamptz AND y.day < $5::timestamptz
      GROUP BY 1`,
    unit,
    ctx.scopeAll,
    [...ctx.scopeList],
    first,
    ctx.to,
  );
  const published = await ctx.db.$queryRawUnsafe<{ bucket: string; n: number }[]>(
    `SELECT to_char(date_trunc($1, a.day AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS bucket,
            COALESCE(sum(a.publications), 0)::int AS n
       FROM reporting.rm_question_activity a
      WHERE ($2::boolean OR a.domain_id = ANY($3::uuid[]))
        AND a.day >= $4::timestamptz AND a.day < $5::timestamptz
      GROUP BY 1`,
    unit,
    ctx.scopeAll,
    [...ctx.scopeList],
    first,
    ctx.to,
  );

  const byBucket = (rows: readonly { bucket: string; n: number }[]) =>
    new Map(rows.map((row) => [row.bucket, num(row.n) ?? 0]));
  const gen = byBucket(generated);
  const pub = byBucket(published);

  return {
    // A period with nothing in it is drawn as 0. Here, and only here, that is
    // right: zero generations in a month is a measurement of dated rows, not
    // the absence of a record.
    rows: starts.map((start, index) => ({
      bucket: start,
      label: trendLabel(unit, start),
      unit,
      partial: index === starts.length - 1 ? 'yes' : 'no',
      generated: gen.get(start) ?? 0,
      published: pub.get(start) ?? 0,
    })),
    windowFrom: first,
  };
};

// =========================================================== question status

/** The design's five buckets plus the two it must not hide. Declared, not improvised. */
export const STATUS_BUCKETS: readonly {
  readonly bucket: string;
  readonly states: readonly string[];
}[] = [
  { bucket: 'Published', states: ['PUBLISHED'] },
  { bucket: 'Approved', states: ['APPROVED'] },
  { bucket: 'In review', states: ['AUTHOR_REVIEW', 'SUBMITTED_FOR_APPROVAL', 'CHANGES_REQUESTED'] },
  { bucket: 'Draft', states: ['GENERATED', 'DRAFT'] },
  { bucket: 'Rejected', states: ['REJECTED'] },
  { bucket: 'Retired or archived', states: ['RETIRED', 'ARCHIVED'] },
];

const questionStatus = async (ctx: DashboardQueryContext): Promise<DashboardQueryResult> => {
  const rows = await ctx.db.$queryRawUnsafe<{ status: string; n: number }[]>(
    `SELECT status, sum(question_count)::int AS n
       FROM reporting.rm_question_pipeline
      WHERE ($1::boolean OR domain_id = ANY($2::uuid[]))
      GROUP BY status`,
    ctx.scopeAll,
    [...ctx.scopeList],
  );
  const counts = new Map(rows.map((row) => [row.status, num(row.n) ?? 0]));
  const total = [...counts.values()].reduce((sum, n) => sum + n, 0);

  return {
    rows: STATUS_BUCKETS.map(({ bucket, states }) => {
      const n = states.reduce((sum, state) => sum + (counts.get(state) ?? 0), 0);
      return {
        bucket,
        states: states.join(', '),
        questionCount: n,
        sharePercent: ratio(n, total),
      };
    }),
  };
};

// =========================================================== department-role

const departmentRole = async (ctx: DashboardQueryContext): Promise<DashboardQueryResult> => {
  const rows = await ctx.db.$queryRawUnsafe<
    {
      department_name: string | null;
      job_role_name: string | null;
      questions: number;
      published: number;
    }[]
  >(
    `SELECT f.department_name,
            f.job_role_name,
            sum(f.questions)::int AS questions,
            sum(f.published)::int AS published
       FROM reporting.rm_filing_coverage f
      WHERE ($1::boolean OR f.domain_id = ANY($2::uuid[]))
      GROUP BY f.department_key, f.department_name, f.job_role_key, f.job_role_name
      ORDER BY questions DESC, f.department_name NULLS LAST, f.job_role_name NULLS LAST
      LIMIT $3`,
    ctx.scopeAll,
    [...ctx.scopeList],
    ctx.pageSize,
  );
  return {
    rows: rows.map((row) => ({
      // "Not filed", never "Other": it is an instruction, not a residual.
      departmentName: row.department_name ?? 'Not filed',
      jobRoleName: row.job_role_name ?? 'Not filed',
      questions: num(row.questions),
      published: num(row.published),
    })),
  };
};

// ======================================================= learner performance

export const ATTRIBUTION_LABEL: Readonly<Record<string, string>> = {
  NOT_FILED: 'Not filed',
  MIXED: 'Filed under several departments',
};

const learnerPerformance = async (ctx: DashboardQueryContext): Promise<DashboardQueryResult> => {
  const rows = await ctx.db.$queryRawUnsafe<
    {
      attribution: string;
      department_name: string | null;
      topic_name: string;
      domain_code: string;
      learners: number;
      topic_attempts: number;
      average_score: string | null;
      passed: number;
      successful: number;
    }[]
  >(
    `SELECT t.attribution,
            t.department_name,
            t.topic_name,
            t.domain_code,
            count(DISTINCT t.learner_user_id)::int              AS learners,
            count(*)::int                                       AS topic_attempts,
            round(avg(t.topic_accuracy), 2)                     AS average_score,
            count(*) FILTER (WHERE t.passed)::int               AS passed,
            count(*) FILTER (WHERE NOT t.is_knowledge_gap)::int AS successful
       FROM reporting.rm_topic_attempt t
      WHERE ($1::boolean OR t.domain_id = ANY($2::uuid[]))
        AND t.completed_at >= $3::timestamptz AND t.completed_at < $4::timestamptz
      GROUP BY t.attribution, t.department_key, t.department_name, t.topic_id, t.topic_name,
               t.domain_code
      ORDER BY t.department_name NULLS LAST, t.topic_name
      LIMIT $5`,
    ctx.scopeAll,
    [...ctx.scopeList],
    ctx.from,
    ctx.to,
    ctx.pageSize,
  );

  const raw: DatasetRow[] = rows.map((row) => {
    const attempts = num(row.topic_attempts);
    return {
      departmentName:
        row.attribution === 'FILED'
          ? (row.department_name ?? 'Not filed')
          : (ATTRIBUTION_LABEL[row.attribution] ?? 'Not filed'),
      topicName: row.topic_name,
      domainCode: row.domain_code,
      learners: num(row.learners),
      topicAttempts: attempts,
      averageScore: num(row.average_score),
      passRatePercent: ratio(num(row.passed), attempts),
      attemptSuccessPercent: ratio(num(row.successful), attempts),
    };
  });

  // BOTH AXES. A heatmap has a total per row and per column; hiding one cell
  // while its column total stays derivable is not suppression (S3).
  const result = applyGridSuppression(raw, {
    groupSizeColumn: 'learners',
    dependentColumns: ['topicAttempts', 'averageScore', 'passRatePercent', 'attemptSuccessPercent'],
    rowBy: ['departmentName'],
    columnBy: ['topicName'],
    minimumGroupSize: ctx.minimumGroupSize,
  });

  return {
    rows: result.rows,
    suppression: {
      suppressedCellCount: result.suppressedCellCount,
      reason: suppressionReasonOf(result),
    },
  };
};

// ============================================================= source health

const sourceHealth = async (ctx: DashboardQueryContext): Promise<DashboardQueryResult> => {
  const rows = await ctx.db.$queryRawUnsafe<
    {
      source_name: string;
      is_active: boolean;
      archived_at: Date | null;
      schedule_mode: string | null;
      documents: number | null;
      sections: number | null;
      assessable: number | null;
      covered: number | null;
      questions: number | null;
      last_started_at: Date | null;
      last_outcome: string | null;
      running: number;
    }[]
  >(
    `SELECT ks.name                                  AS source_name,
            ks.is_active,
            ks.archived_at,
            ks."syncSchedule"->>'mode'              AS schedule_mode,
            c.documents, c.sections, c.assessable, c.covered, c.questions,
            ls.started_at                            AS last_started_at,
            ls.outcome                               AS last_outcome,
            COALESCE(rn.n, 0)::int                   AS running
       FROM knowledge_source ks
       LEFT JOIN (
         SELECT source_id,
                count(*)::int                  AS documents,
                sum(sections_total)::int       AS sections,
                sum(sections_assessable)::int  AS assessable,
                sum(sections_covered)::int     AS covered,
                sum(questions)::int            AS questions
           FROM reporting.rm_source_coverage
          GROUP BY source_id
       ) c ON c.source_id = ks.id
       LEFT JOIN LATERAL (
         SELECT s.started_at, s.outcome::text AS outcome
           FROM knowledge_source_sync s
          WHERE s.source_id = ks.id AND s.outcome <> 'RUNNING'
          ORDER BY s.started_at DESC
          LIMIT 1
       ) ls ON true
       LEFT JOIN LATERAL (
         SELECT count(*) AS n FROM knowledge_source_sync s
          WHERE s.source_id = ks.id AND s.outcome = 'RUNNING'
       ) rn ON true
      WHERE ks.archived_at IS NULL
        AND ($1::boolean OR ks.id = ANY($2::uuid[]))
      ORDER BY ks.name
      LIMIT $3`,
    ctx.sourceAll,
    [...ctx.sourceList],
    ctx.pageSize,
  );

  return {
    rows: rows.map((row) => ({
      sourceName: row.source_name,
      // The SYNC MANAGER'S derivation, imported rather than re-implemented, so
      // the two applications cannot disagree about a source.
      status: sourceWorkflowStatus({
        isActive: row.is_active,
        archivedAt: row.archived_at,
        runningCount: num(row.running) ?? 0,
        lastOutcome: row.last_outcome,
        scheduleMode: row.schedule_mode ?? 'MANUAL',
      }),
      lastSyncAt: row.last_started_at?.toISOString() ?? null,
      lastSyncOutcome: row.last_outcome,
      documents: num(row.documents) ?? 0,
      sections: num(row.sections) ?? 0,
      assessableSections: num(row.assessable) ?? 0,
      coverageRatioPercent: ratio(num(row.covered), num(row.assessable)),
      questions: num(row.questions) ?? 0,
    })),
  };
};

// ================================================================== activity

/**
 * The audit actions the feed shows, and the name each is shown under.
 *
 * A CLOSED list, checked against the registry by a contract test. The
 * reporting specification names `LEARNING.SESSION.COMPLETED` for a completed
 * assessment; the platform records a completion as `LEARNING.RESULT.SCORED`,
 * so that is what is read — a feed built from the specification's name would
 * be empty forever.
 */
export const ACTIVITY_ACTIONS: Readonly<Record<string, string>> = {
  'AUTHORING.ASSESSMENT.PUBLISHED': 'ASSESSMENT_PUBLISHED',
  'AUTHORING.QUESTION.APPROVED': 'QUESTION_APPROVED',
  'AUTHORING.QUESTION.PUBLISHED': 'QUESTION_PUBLISHED',
  'ADMIN.SOURCE.SYNC_COMPLETED': 'SOURCE_SYNCHRONIZED',
  'ADMIN.CONFIGURATION.PROVIDER_VALIDATED': 'PROVIDER_VALIDATED',
  'AUTHORING.GENERATION.JOB_COMPLETED': 'QUESTIONS_GENERATED',
  'ADMIN.SOURCE.CREATED': 'SOURCE_ADDED',
};
export const ACTIVITY_COMPLETION_ACTION = 'LEARNING.RESULT.SCORED';

const detailOf = (kind: string, detail: Record<string, unknown>): string | null => {
  const n = (key: string) => (typeof detail[key] === 'number' ? (detail[key] as number) : null);
  const s = (key: string) => (typeof detail[key] === 'string' ? (detail[key] as string) : null);
  switch (kind) {
    case 'QUESTIONS_GENERATED': {
      const accepted = n('acceptedQuestionCount');
      const requested = n('requestedQuestionCount');
      return accepted === null || requested === null
        ? s('jobStatus')
        : `${accepted} of ${requested} accepted · ${s('jobStatus') ?? ''}`.trim();
    }
    case 'SOURCE_SYNCHRONIZED': {
      const parts = [
        n('added') === null ? null : `${n('added')} added`,
        n('modified') === null ? null : `${n('modified')} modified`,
        n('failed') === null ? null : `${n('failed')} failed`,
      ].filter((part): part is string => part !== null);
      return parts.length === 0 ? null : parts.join(' · ');
    }
    // THE RECORDED OUTCOME, never "verified". A validation checks the
    // configuration chain and marks the live call NOT_ATTEMPTED (H3).
    case 'PROVIDER_VALIDATED':
      return s('validationOutcome') === null ? null : `Recorded outcome: ${s('validationOutcome')}`;
    case 'ASSESSMENT_PUBLISHED':
      return n('versionNumber') === null ? null : `Version ${n('versionNumber')}`;
    case 'QUESTION_APPROVED':
      return n('version') === null ? null : `Version ${n('version')}`;
    default:
      return null;
  }
};

/**
 * What the feed may name. A DraftQuestion's label is sometimes its uuid and
 * never its text; only a bank identifier is worth printing. Question text is
 * not in the audit store at all (D8), and this keeps it that way on screen.
 */
const subjectOf = (entityType: string, label: string | null): string | null => {
  if (label === null) return null;
  if (entityType === 'DraftQuestion') return /^KNZ-/.test(label) ? label : null;
  if (entityType === 'GenerationJob') return null;
  return label;
};

const activity = async (ctx: DashboardQueryContext): Promise<DashboardQueryResult> => {
  const threshold = effectiveMinimumGroupSize(ctx.minimumGroupSize);
  const from = ctx.from ?? new Date(ctx.to.getTime() - 30 * 86_400_000);

  // Scoped: an event tied to a domain or source outside the caller's scope is
  // not shown. Platform events (no domain, no source) are.
  const events = await ctx.db.$queryRawUnsafe<
    {
      id: string;
      occurred_at: Date;
      action: string;
      outcome: string;
      entity_type: string;
      entity_label: string | null;
      detail: Record<string, unknown> | null;
    }[]
  >(
    `SELECT id::text, occurred_at, action, outcome::text AS outcome, entity_type, entity_label, detail
       FROM audit_event
      WHERE occurred_at >= $1::timestamptz AND occurred_at < $2::timestamptz
        AND action = ANY($3::text[])
        AND (domain_id IS NULL OR $4::boolean OR domain_id = ANY($5::uuid[]))
        AND (source_id IS NULL OR $6::boolean OR source_id = ANY($7::uuid[]))
      ORDER BY occurred_at DESC
      LIMIT $8`,
    from,
    ctx.to,
    Object.keys(ACTIVITY_ACTIONS),
    ctx.scopeAll,
    [...ctx.scopeList],
    ctx.sourceAll,
    [...ctx.sourceList],
    ctx.pageSize,
  );

  // Completions are about PEOPLE, so they are never listed one by one: one row
  // per assessment per day, with a distinct-learner count, and withheld below
  // the threshold. A single "Assessment completed" line at 15:10 names the one
  // person who took it.
  const completions = await ctx.db.$queryRawUnsafe<
    { day: Date; assessment_name: string; learners: number; completions: number; last_at: Date }[]
  >(
    `SELECT date_trunc('day', e.occurred_at)      AS day,
            a.name                                AS assessment_name,
            count(DISTINCT r.learner_user_id)::int AS learners,
            count(*)::int                         AS completions,
            max(e.occurred_at)                    AS last_at
       FROM audit_event e
       JOIN assessment_result r ON r.id::text = e.entity_id
       JOIN assessment a ON a.id = r.assessment_id
      WHERE e.action = $1
        AND e.occurred_at >= $2::timestamptz AND e.occurred_at < $3::timestamptz
        AND ($4::boolean OR a.domain_id = ANY($5::uuid[]))
      GROUP BY 1, 2`,
    ACTIVITY_COMPLETION_ACTION,
    from,
    ctx.to,
    ctx.scopeAll,
    [...ctx.scopeList],
  );

  const visibleCompletions = completions.filter((row) => (num(row.learners) ?? 0) >= threshold);
  const withheld = completions.length - visibleCompletions.length;

  const rows = [
    ...events.map((event) => {
      const kind = ACTIVITY_ACTIONS[event.action] ?? event.action;
      return {
        occurredAt: event.occurred_at.toISOString(),
        kind,
        subject: subjectOf(event.entity_type, event.entity_label),
        detail: detailOf(kind, event.detail ?? {}),
        outcome: event.outcome,
        learners: null,
        eventId: event.id,
      } satisfies DatasetRow;
    }),
    ...visibleCompletions.map(
      (row) =>
        ({
          occurredAt: row.last_at.toISOString(),
          kind: 'ASSESSMENTS_COMPLETED',
          subject: row.assessment_name,
          detail: `${num(row.learners)} learners · ${num(row.completions)} completions`,
          outcome: 'SUCCESS',
          learners: num(row.learners),
          eventId: null,
        }) satisfies DatasetRow,
    ),
  ]
    .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0))
    .slice(0, ctx.pageSize);

  const newest = [...events.map((e) => e.occurred_at), ...completions.map((c) => c.last_at)]
    .map((d) => d.toISOString())
    .sort()
    .at(-1);

  return {
    rows,
    asOf: newest ?? null,
    suppression: {
      suppressedCellCount: withheld,
      reason:
        withheld === 0
          ? null
          : `${withheld} day(s) of assessment completions withheld: fewer than ${threshold} distinct learners (S1).`,
    },
  };
};

// ========================================================= coverage history

export interface CoverageSnapshotRow {
  readonly snapshotDate: string;
  readonly capturedAt: string;
  readonly captureTrigger: string;
  readonly modelsAsOf: string | null;
  readonly sourceCount: number;
  readonly activeSourceCount: number;
  readonly documentCount: number;
  readonly sectionCount: number;
  readonly assessableSections: number;
  readonly coveredSections: number;
  readonly coveragePercent: number | null;
  readonly totalQuestions: number;
  readonly publishedQuestions: number;
  readonly approvedQuestions: number;
  readonly inReviewQuestions: number;
  readonly draftQuestions: number;
  readonly rejectedQuestions: number;
  readonly retiredOrArchivedQuestions: number;
  readonly approvalsGranted: number;
  readonly approvalsRefused: number;
  readonly assessmentsTotal: number;
  readonly assessmentsPublished: number;
  readonly assessmentAttempts: number;
}

/** The recorded days, newest first. Platform-wide: a snapshot has no scope. */
export const listCoverageSnapshots = async (
  db: ReadOnlyDb,
  limit = 400,
): Promise<readonly CoverageSnapshotRow[]> => {
  const rows = await db.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT * FROM reporting.coverage_snapshot ORDER BY snapshot_date DESC LIMIT $1`,
    Math.min(Math.max(1, limit), 2_000),
  );
  const int = (value: unknown) => num(value) ?? 0;
  return rows.map((row) => ({
    snapshotDate: utcDate(row['snapshot_date'] as Date),
    capturedAt: (row['captured_at'] as Date).toISOString(),
    captureTrigger: String(row['capture_trigger']),
    modelsAsOf: row['models_as_of'] === null ? null : (row['models_as_of'] as Date).toISOString(),
    sourceCount: int(row['source_count']),
    activeSourceCount: int(row['active_source_count']),
    documentCount: int(row['document_count']),
    sectionCount: int(row['section_count']),
    assessableSections: int(row['assessable_sections']),
    coveredSections: int(row['covered_sections']),
    coveragePercent: num(row['coverage_percent']),
    totalQuestions: int(row['total_questions']),
    publishedQuestions: int(row['published_questions']),
    approvedQuestions: int(row['approved_questions']),
    inReviewQuestions: int(row['in_review_questions']),
    draftQuestions: int(row['draft_questions']),
    rejectedQuestions: int(row['rejected_questions']),
    retiredOrArchivedQuestions: int(row['retired_or_archived_questions']),
    approvalsGranted: int(row['approvals_granted']),
    approvalsRefused: int(row['approvals_refused']),
    assessmentsTotal: int(row['assessments_total']),
    assessmentsPublished: int(row['assessments_published']),
    assessmentAttempts: int(row['assessment_attempts']),
  }));
};

export type SnapshotTrigger = 'SCHEDULE' | 'MANUAL' | 'MIGRATION';

/**
 * Captures today's snapshot through the database function — the only code
 * path that writes one. Returns false when today already has a row: the first
 * capture of a day stands and is never overwritten.
 */
export const captureCoverageSnapshot = async (
  db: RefreshDb,
  trigger: SnapshotTrigger,
  correlationId: string | null,
): Promise<boolean> => {
  const rows = await db.$queryRawUnsafe<{ written: boolean }[]>(
    `SELECT reporting.capture_coverage_snapshot($1, $2) AS written`,
    trigger,
    correlationId,
  );
  return rows[0]?.written === true;
};
