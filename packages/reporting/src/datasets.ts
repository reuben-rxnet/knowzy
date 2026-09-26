// The report catalogue — reporting.md §4, the five entries Phase 10 R1 builds.
//
// ONE QUERY PATH (B1). A dashboard panel, a CSV export and a snapshot all call
// `runDataset`. There is no second code path that could apply a different
// window, a different scope or a different suppression, which is the entire
// reason the dashboard and its export can never disagree.
//
// EVERY METRIC CARRIES ITS FORMULA (B3), as a string, beside the column it
// describes. Not in a wiki, not in a comment: in the response, so the screen
// can show it and the CSV can print it. A metric nobody can explain is a metric
// nobody trusts, and "acceptance rate" has at least three plausible
// definitions.
//
// `asOf` NEVER COMES FROM `now()` (D2). It is read from
// `reporting.refresh_state`, and a model that has never refreshed reports null
// with its status, which a panel renders as "not yet built" rather than as
// empty data.
//
// SQL IS PARAMETERIZED THROUGHOUT and the identifiers are not interpolated from
// input: the dataset name selects a pre-written query from this file, and only
// values cross the boundary. `@knowzy/reporting` is one of two packages allowed
// raw SQL (repository-structure.md §5) and this is the discipline that permits
// it.

import type { ReadOnlyDb } from './audit-explorer.js';
import {
  applySuppression,
  effectiveMinimumGroupSize,
  visibleTotals,
  SUPPRESSED,
  type DatasetRow,
  type SuppressionPolicy,
} from './suppression.js';

export const DATASETS = [
  'question-pipeline',
  'generation',
  'assessments',
  'filing',
  'sources',
] as const;
export type DatasetName = (typeof DATASETS)[number];

export const isDatasetName = (value: string): value is DatasetName =>
  (DATASETS as readonly string[]).includes(value);

/** One measure, with the sentence that defines it. */
export interface MetricDefinition {
  readonly column: string;
  readonly label: string;
  /** B3. Written as an expression a reader can check against the numbers. */
  readonly formula: string;
  /** True where the figure is modelled rather than counted (B7). */
  readonly estimated?: boolean;
}

export interface DatasetDefinition {
  readonly name: DatasetName;
  readonly title: string;
  readonly grain: string;
  /** The read models this entry reads, for the staleness report. */
  readonly models: readonly string[];
  readonly requiredPermission: string;
  /** §3.2: an aggregate a reader cannot decompose is one they cannot audit. */
  readonly drillThrough: string | null;
  readonly dimensions: readonly { column: string; label: string }[];
  readonly metrics: readonly MetricDefinition[];
  /**
   * Present only where a row could identify a person (S1).
   *
   * Absent on four of the five entries, and that is the point: a question, a
   * document and a section are not people, and suppressing "17 questions in
   * RX_NET" protects nobody while making the report useless.
   */
  readonly suppression?: Omit<SuppressionPolicy, 'minimumGroupSize'>;
  /** Whether the entry supports a day window at all. */
  readonly windowed: boolean;
}

// ---------------------------------------------------------------------------
// 1. Question pipeline
// ---------------------------------------------------------------------------

const QUESTION_PIPELINE: DatasetDefinition = {
  name: 'question-pipeline',
  title: 'Question pipeline',
  grain: 'domain × lifecycle state',
  models: ['rm_question_pipeline', 'rm_question_activity'],
  requiredPermission: 'report.read',
  drillThrough: '/review?queue=all',
  dimensions: [
    { column: 'domainCode', label: 'Domain' },
    { column: 'status', label: 'Lifecycle state' },
  ],
  metrics: [
    {
      column: 'questionCount',
      label: 'Questions',
      formula: 'count(draft_question) grouped by domain and status',
    },
    {
      column: 'needsRevalidationCount',
      label: 'Needs revalidation',
      formula: 'count(draft_question WHERE needs_revalidation) in the same group',
    },
    {
      column: 'importedCount',
      label: 'Imported',
      formula: "count(draft_question WHERE acquisition = 'IMPORTED') in the same group",
    },
  ],
  windowed: false,
};

// ---------------------------------------------------------------------------
// 2. Generation
// ---------------------------------------------------------------------------

const GENERATION: DatasetDefinition = {
  name: 'generation',
  title: 'Generation yield',
  grain: 'provider × model × prompt version × day',
  models: ['rm_generation_yield'],
  requiredPermission: 'report.read',
  drillThrough: '/governance/ai-usage',
  dimensions: [
    { column: 'providerId', label: 'Provider' },
    { column: 'modelId', label: 'Model' },
    { column: 'domainCode', label: 'Domain' },
  ],
  metrics: [
    { column: 'jobs', label: 'Jobs', formula: 'count(generation_job) in the window' },
    {
      column: 'requested',
      label: 'Requested',
      formula: 'sum(requested_question_count)',
    },
    { column: 'accepted', label: 'Accepted', formula: 'sum(accepted_question_count)' },
    {
      column: 'yieldPercent',
      label: 'Yield',
      // Guarded, and it matters: a window with jobs but zero requested
      // questions would otherwise be a division by zero rendered as Infinity.
      formula: 'accepted ÷ requested × 100, null when requested = 0',
    },
    {
      column: 'jobsRefused',
      label: 'Refused',
      formula: "count(generation_job WHERE status = 'REFUSED') — a control decision, not a failure",
    },
    {
      column: 'jobsFailed',
      label: 'Failed',
      formula: "count(generation_job WHERE status = 'FAILED')",
    },
    {
      column: 'attempts',
      label: 'Provider attempts',
      formula: 'sum(attempt_count) — retries included, which is why it can exceed jobs',
    },
    {
      column: 'totalTokens',
      label: 'Tokens',
      formula: 'sum(input_tokens + output_tokens)',
    },
    {
      column: 'observableCost',
      label: 'Observable cost',
      formula:
        'sum(estimated_cost) over jobs where cost_observable — null where any contributor is unobservable',
      estimated: true,
    },
  ],
  windowed: true,
};

// ---------------------------------------------------------------------------
// 3. Assessments — the one entry with person-level exposure
// ---------------------------------------------------------------------------

const ASSESSMENTS: DatasetDefinition = {
  name: 'assessments',
  title: 'Assessment performance',
  grain: 'assessment version',
  models: ['rm_assessment_performance'],
  requiredPermission: 'report.read',
  drillThrough: null,
  dimensions: [
    { column: 'assessmentName', label: 'Assessment' },
    { column: 'versionNumber', label: 'Version' },
    { column: 'domainCode', label: 'Domain' },
  ],
  metrics: [
    {
      column: 'attempts',
      label: 'Attempts',
      formula: "count(assessment_result WHERE result_state = 'SCORED')",
    },
    {
      column: 'uniqueLearners',
      label: 'Learners',
      formula: 'count(DISTINCT learner_user_id)',
    },
    {
      column: 'passRatePercent',
      label: 'Pass rate',
      formula: 'attempts passed ÷ attempts × 100, null when attempts = 0',
    },
    { column: 'meanScore', label: 'Mean score', formula: 'avg(percentage_score), 2 dp' },
    {
      column: 'medianScore',
      label: 'Median score',
      formula: 'percentile_cont(0.5) over percentage_score',
    },
    {
      column: 'bandExpert',
      label: 'Expert',
      formula: "count(WHERE proficiency_band = 'EXPERT')",
    },
    {
      column: 'bandProficient',
      label: 'Proficient',
      formula: "count(WHERE proficiency_band = 'PROFICIENT')",
    },
    {
      column: 'bandDeveloping',
      label: 'Developing',
      formula: "count(WHERE proficiency_band = 'DEVELOPING')",
    },
    {
      column: 'bandNeedsImprovement',
      label: 'Needs improvement',
      formula: "count(WHERE proficiency_band = 'NEEDS_IMPROVEMENT')",
    },
    {
      column: 'bandCritical',
      label: 'Critical gap',
      formula: "count(WHERE proficiency_band = 'CRITICAL_KNOWLEDGE_GAP')",
    },
  ],
  // An assessment taken by three people is an aggregate that identifies them,
  // and every measure here is derived from those three: the pass rate and the
  // band distribution name them as surely as the head count does.
  suppression: {
    groupSizeColumn: 'uniqueLearners',
    dependentColumns: [
      'attempts',
      'passRatePercent',
      'meanScore',
      'medianScore',
      'bandExpert',
      'bandProficient',
      'bandDeveloping',
      'bandNeedsImprovement',
      'bandCritical',
    ],
    partitionBy: ['domainCode'],
  },
  windowed: false,
};

// ---------------------------------------------------------------------------
// 4. Filing — the four axes
// ---------------------------------------------------------------------------

const FILING: DatasetDefinition = {
  name: 'filing',
  title: 'Filing coverage',
  grain: 'domain × topic × department × role',
  models: ['rm_filing_coverage'],
  requiredPermission: 'report.read',
  drillThrough: '/review?queue=all',
  dimensions: [
    { column: 'domainCode', label: 'Domain' },
    { column: 'topicName', label: 'Topic' },
    { column: 'departmentName', label: 'Department' },
    { column: 'jobRoleName', label: 'Role' },
  ],
  metrics: [
    { column: 'questions', label: 'Questions', formula: 'count(draft_question) in the group' },
    { column: 'published', label: 'Published', formula: "count(WHERE status = 'PUBLISHED')" },
    { column: 'approved', label: 'Approved', formula: "count(WHERE status = 'APPROVED')" },
    {
      column: 'inProgress',
      label: 'In progress',
      formula: 'count(WHERE status is any pre-approval state)',
    },
    { column: 'imported', label: 'Imported', formula: "count(WHERE acquisition = 'IMPORTED')" },
    {
      column: 'partiallyUnfiled',
      label: 'Missing an axis',
      formula: 'count(WHERE department_id IS NULL OR job_role_id IS NULL)',
    },
  ],
  windowed: false,
};

// ---------------------------------------------------------------------------
// 5. Sources
// ---------------------------------------------------------------------------

const SOURCES: DatasetDefinition = {
  name: 'sources',
  title: 'Source coverage',
  grain: 'source × document',
  models: ['rm_source_coverage'],
  requiredPermission: 'report.read',
  drillThrough: '/sources',
  dimensions: [
    { column: 'sourceName', label: 'Source' },
    { column: 'documentName', label: 'Document' },
    { column: 'generationStatus', label: 'Generation status' },
  ],
  metrics: [
    { column: 'sectionsTotal', label: 'Sections', formula: 'count(document_section)' },
    {
      column: 'sectionsAssessable',
      label: 'Assessable',
      formula: 'count(document_section WHERE is_assessable)',
    },
    {
      column: 'sectionsCovered',
      label: 'Covered',
      formula: "count(WHERE coverage_status = 'COVERED') — cites at least one question",
    },
    {
      column: 'sectionsRefused',
      label: 'Refused',
      formula:
        "count(WHERE last_generation_outcome = 'REFUSED') — a generator's refusal, NOT a coverage state",
    },
    {
      column: 'coverageRatioPercent',
      label: 'Coverage',
      formula: 'covered ÷ assessable × 100, null when assessable = 0',
    },
    { column: 'questions', label: 'Questions', formula: 'count(draft_question) for the document' },
    {
      column: 'approvedQuestions',
      label: 'Approved',
      formula: "count(draft_question WHERE status = 'APPROVED')",
    },
    {
      column: 'publishedQuestions',
      label: 'Published',
      formula: "count(draft_question WHERE status = 'PUBLISHED')",
    },
    {
      column: 'generationSuccessPercent',
      label: 'Generation success',
      formula: 'questions ÷ assessable sections × 100, null when assessable = 0',
    },
  ],
  windowed: false,
};

export const DATASET_DEFINITIONS: Readonly<Record<DatasetName, DatasetDefinition>> = {
  'question-pipeline': QUESTION_PIPELINE,
  generation: GENERATION,
  assessments: ASSESSMENTS,
  filing: FILING,
  sources: SOURCES,
};

// ---------------------------------------------------------------------------
// Running one
// ---------------------------------------------------------------------------

export interface DatasetScope {
  /**
   * The domains the caller may see, or `null` for "all of them".
   *
   * D5: applied as a SQL predicate, not a post-filter, so a row outside scope
   * is never in memory and can never be counted into a total.
   */
  readonly domainIds: readonly string[] | null;
  readonly sourceIds?: readonly string[] | null;
}

export interface DatasetRequest {
  readonly name: DatasetName;
  readonly scope: DatasetScope;
  readonly windowDays?: number;
  readonly minimumGroupSize?: number;
  readonly pageSize?: number;
}

export interface DatasetFreshness {
  readonly model: string;
  readonly refreshedAt: string | null;
  readonly status: string;
  readonly ageSeconds: number | null;
  readonly consecutiveFailures: number;
  readonly failureDetail: string | null;
}

export interface DatasetResult {
  readonly name: DatasetName;
  readonly title: string;
  readonly grain: string;
  /** D2: the OLDEST contributing model's refresh time. A panel is as stale as its stalest input. */
  readonly asOf: string | null;
  readonly freshness: readonly DatasetFreshness[];
  readonly dimensions: readonly { column: string; label: string }[];
  readonly metrics: readonly MetricDefinition[];
  readonly rows: readonly DatasetRow[];
  readonly rowCount: number;
  readonly totals: Readonly<Record<string, number>>;
  /**
   * Per metric: did suppression remove at least one row from this total?
   *
   * S4 keeps a withheld row out of every visible total, which is correct and
   * also means a total can be understated -- or, where every contributing row
   * was withheld, ZERO. A screen that printed that zero would report "no
   * attempts" for an assessment that simply has too few learners to show. So
   * the flag travels, and every surface renders a partial total as partial.
   */
  readonly totalsPartial: Readonly<Record<string, boolean>>;
  readonly suppressedCellCount: number;
  readonly minimumGroupSize: number;
  readonly drillThrough: string | null;
  readonly windowDays: number | null;
  /** D9: the resolved half-open interval, displayed with the report. */
  readonly windowFrom: string | null;
  readonly windowTo: string | null;
  readonly durationMs: number;
}

export const MAX_DATASET_ROWS = 2_000;

const num = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'bigint' ? Number(value) : Number(value);
  return Number.isFinite(n) ? n : null;
};

/** A ratio, or null where the denominator is zero — never Infinity, never 0. */
const ratio = (numerator: number | null, denominator: number | null): number | null =>
  numerator === null || denominator === null || denominator === 0
    ? null
    : Math.round((numerator / denominator) * 10_000) / 100;

/**
 * The freshness of a set of models, and the `asOf` derived from it.
 *
 * Exported because the API needs the same `asOf` the dataset will carry: it is
 * part of the cache key, so computing it a second way would let a cached
 * response be looked up under a key the writer never used. It lives here
 * rather than in the route for a harder reason too -- raw SQL is permitted in
 * this package and forbidden in the API (content rule C4), and the first
 * version of the route broke that rule.
 */
/**
 * The WHOLE ledger, for the dashboard's freshness table.
 *
 * Distinct from `readFreshness`, which answers "how fresh is this dataset".
 * This one answers "what is the state of every model", including the row count
 * and the failure detail a panel needs to say "failing since" rather than
 * "failed".
 */
export const readAllFreshness = async (
  db: ReadOnlyDb,
): Promise<readonly (DatasetFreshness & { rowCount: number | null })[]> => {
  const rows = await db.$queryRawUnsafe<
    {
      model: string;
      refreshed_at: Date | null;
      status: string;
      row_count: number | null;
      consecutive_failures: number;
      failure_detail: string | null;
    }[]
  >(
    `SELECT model, refreshed_at, status, row_count, consecutive_failures, failure_detail
       FROM reporting.refresh_state
      ORDER BY model`,
  );

  const now = Date.now();
  return rows.map((row) => ({
    model: row.model,
    refreshedAt: row.refreshed_at?.toISOString() ?? null,
    status: row.status,
    ageSeconds:
      row.refreshed_at === null ? null : Math.floor((now - row.refreshed_at.getTime()) / 1000),
    consecutiveFailures: row.consecutive_failures,
    failureDetail: row.failure_detail,
    rowCount: row.row_count,
  }));
};

export const readFreshness = async (
  db: ReadOnlyDb,
  models: readonly string[],
): Promise<{ asOf: string | null; freshness: readonly DatasetFreshness[] }> => {
  const freshness = await freshnessFor(db, models);
  const times = freshness.map((entry) => entry.refreshedAt).filter((v): v is string => v !== null);
  // Null if ANY contributing model has never refreshed, and otherwise the
  // OLDEST: a panel is as stale as its stalest input, and overstating freshness
  // is the only direction that misleads.
  const asOf =
    times.length === models.length
      ? times.reduce((oldest, value) => (value < oldest ? value : oldest))
      : null;
  return { asOf, freshness };
};

const freshnessFor = async (
  db: ReadOnlyDb,
  models: readonly string[],
): Promise<readonly DatasetFreshness[]> => {
  const rows = await db.$queryRawUnsafe<
    {
      model: string;
      refreshed_at: Date | null;
      status: string;
      consecutive_failures: number;
      failure_detail: string | null;
    }[]
  >(
    `SELECT model, refreshed_at, status, consecutive_failures, failure_detail
       FROM reporting.refresh_state
      WHERE model = ANY($1::text[])`,
    models,
  );

  const now = Date.now();
  return models.map((model) => {
    const row = rows.find((candidate) => candidate.model === model);
    const refreshedAt = row?.refreshed_at ?? null;
    return {
      model,
      refreshedAt: refreshedAt === null ? null : refreshedAt.toISOString(),
      // A model with no ledger row at all is PENDING rather than missing: the
      // migration seeds one per model precisely so "never refreshed" and "not
      // a model" cannot look the same.
      status: row?.status ?? 'PENDING',
      ageSeconds: refreshedAt === null ? null : Math.floor((now - refreshedAt.getTime()) / 1000),
      consecutiveFailures: row?.consecutive_failures ?? 0,
      failureDetail: row?.failure_detail ?? null,
    };
  });
};

/**
 * Runs one catalogue entry.
 *
 * Scope, suppression and the window are all applied here (B2/S6), which is what
 * makes a forgotten export surface impossible rather than merely unlikely.
 */
export const runDataset = async (
  db: ReadOnlyDb,
  request: DatasetRequest,
): Promise<DatasetResult> => {
  const started = Date.now();
  const definition = DATASET_DEFINITIONS[request.name];
  const pageSize = Math.min(request.pageSize ?? MAX_DATASET_ROWS, MAX_DATASET_ROWS);
  const windowDays = definition.windowed ? (request.windowDays ?? 30) : null;

  // D9: half-open [from, to) in UTC, resolved once and reported with the data.
  const to = new Date();
  const from = windowDays === null ? null : new Date(to.getTime() - windowDays * 86_400_000);

  const domainIds = request.scope.domainIds;
  const scopeAll = domainIds === null;
  const scopeList = domainIds === null ? [] : [...domainIds];

  let raw: DatasetRow[];

  switch (request.name) {
    case 'question-pipeline': {
      const rows = await db.$queryRawUnsafe<
        {
          domain_code: string;
          status: string;
          question_count: number;
          needs_revalidation_count: number;
          imported_count: number;
        }[]
      >(
        `SELECT d.code AS domain_code,
                p.status,
                p.question_count,
                p.needs_revalidation_count,
                p.imported_count
           FROM reporting.rm_question_pipeline p
           JOIN domain d ON d.id = p.domain_id
          WHERE ($1::boolean OR p.domain_id = ANY($2::uuid[]))
            AND p.question_count > 0
          ORDER BY d.code, p.status
          LIMIT $3`,
        scopeAll,
        scopeList,
        pageSize,
      );
      raw = rows.map((row) => ({
        domainCode: row.domain_code,
        status: row.status,
        questionCount: num(row.question_count),
        needsRevalidationCount: num(row.needs_revalidation_count),
        importedCount: num(row.imported_count),
      }));
      break;
    }

    case 'generation': {
      const rows = await db.$queryRawUnsafe<
        {
          provider_id: string;
          model_id: string;
          domain_code: string;
          jobs: number;
          requested: number;
          accepted: number;
          jobs_refused: number;
          jobs_failed: number;
          attempts: number;
          input_tokens: number;
          output_tokens: number;
          observable_cost: string | null;
          cost_observable_jobs: number;
        }[]
      >(
        `SELECT y.provider_id,
                y.model_id,
                d.code AS domain_code,
                sum(y.jobs)::int                 AS jobs,
                sum(y.requested)::int            AS requested,
                sum(y.accepted)::int             AS accepted,
                sum(y.jobs_refused)::int         AS jobs_refused,
                sum(y.jobs_failed)::int          AS jobs_failed,
                sum(y.attempts)::int             AS attempts,
                sum(y.input_tokens)::bigint      AS input_tokens,
                sum(y.output_tokens)::bigint     AS output_tokens,
                sum(y.observable_cost)           AS observable_cost,
                sum(y.cost_observable_jobs)::int AS cost_observable_jobs
           FROM reporting.rm_generation_yield y
           JOIN domain d ON d.id = y.domain_id
          WHERE ($1::boolean OR y.domain_id = ANY($2::uuid[]))
            AND y.day >= $3::timestamptz
            AND y.day <  $4::timestamptz
          GROUP BY y.provider_id, y.model_id, d.code
          ORDER BY jobs DESC, y.provider_id
          LIMIT $5`,
        scopeAll,
        scopeList,
        from,
        to,
        pageSize,
      );
      raw = rows.map((row) => {
        const jobs = num(row.jobs);
        const requested = num(row.requested);
        const accepted = num(row.accepted);
        return {
          providerId: row.provider_id,
          modelId: row.model_id,
          domainCode: row.domain_code,
          jobs,
          requested,
          accepted,
          yieldPercent: ratio(accepted, requested),
          jobsRefused: num(row.jobs_refused),
          jobsFailed: num(row.jobs_failed),
          attempts: num(row.attempts),
          totalTokens: (num(row.input_tokens) ?? 0) + (num(row.output_tokens) ?? 0),
          // An unobservable cost stays null. Reporting 0 for a window whose
          // jobs reported no cost would present an undercount as a total.
          observableCost: num(row.cost_observable_jobs) === 0 ? null : num(row.observable_cost),
        };
      });
      break;
    }

    case 'assessments': {
      const rows = await db.$queryRawUnsafe<
        {
          assessment_name: string;
          version_number: number;
          domain_code: string;
          attempts: number;
          unique_learners: number;
          passed_attempts: number;
          mean_score: string | null;
          median_score: string | null;
          band_expert: number;
          band_proficient: number;
          band_developing: number;
          band_needs_improvement: number;
          band_critical: number;
        }[]
      >(
        `SELECT a.assessment_name,
                a.version_number,
                d.code AS domain_code,
                a.attempts,
                a.unique_learners,
                a.passed_attempts,
                a.mean_score,
                a.median_score,
                a.band_expert,
                a.band_proficient,
                a.band_developing,
                a.band_needs_improvement,
                a.band_critical
           FROM reporting.rm_assessment_performance a
           JOIN domain d ON d.id = a.domain_id
          WHERE ($1::boolean OR a.domain_id = ANY($2::uuid[]))
          ORDER BY a.attempts DESC, a.assessment_name
          LIMIT $3`,
        scopeAll,
        scopeList,
        pageSize,
      );
      raw = rows.map((row) => ({
        assessmentName: row.assessment_name,
        versionNumber: num(row.version_number),
        domainCode: row.domain_code,
        attempts: num(row.attempts),
        uniqueLearners: num(row.unique_learners),
        passRatePercent: ratio(num(row.passed_attempts), num(row.attempts)),
        meanScore: num(row.mean_score),
        medianScore: num(row.median_score),
        bandExpert: num(row.band_expert),
        bandProficient: num(row.band_proficient),
        bandDeveloping: num(row.band_developing),
        bandNeedsImprovement: num(row.band_needs_improvement),
        bandCritical: num(row.band_critical),
      }));
      break;
    }

    case 'filing': {
      const rows = await db.$queryRawUnsafe<
        {
          domain_code: string;
          topic_name: string;
          department_name: string | null;
          job_role_name: string | null;
          questions: number;
          published: number;
          approved: number;
          in_progress: number;
          imported: number;
          partially_unfiled: number;
        }[]
      >(
        `SELECT f.domain_code,
                f.topic_name,
                f.department_name,
                f.job_role_name,
                f.questions,
                f.published,
                f.approved,
                f.in_progress,
                f.imported,
                f.partially_unfiled
           FROM reporting.rm_filing_coverage f
          WHERE ($1::boolean OR f.domain_id = ANY($2::uuid[]))
          ORDER BY f.domain_code, f.topic_name, f.department_name NULLS FIRST
          LIMIT $3`,
        scopeAll,
        scopeList,
        pageSize,
      );
      raw = rows.map((row) => ({
        domainCode: row.domain_code,
        topicName: row.topic_name,
        // Null becomes the WORD, not a blank cell: "not filed" is the answer
        // this report exists to give, and an empty cell reads as a bug.
        departmentName: row.department_name ?? 'Not filed',
        jobRoleName: row.job_role_name ?? 'Not filed',
        questions: num(row.questions),
        published: num(row.published),
        approved: num(row.approved),
        inProgress: num(row.in_progress),
        imported: num(row.imported),
        partiallyUnfiled: num(row.partially_unfiled),
      }));
      break;
    }

    case 'sources': {
      const rows = await db.$queryRawUnsafe<
        {
          source_name: string;
          document_name: string;
          generation_status: string | null;
          sections_total: number;
          sections_assessable: number;
          sections_covered: number;
          sections_refused: number;
          questions: number;
          approved_questions: number;
          published_questions: number;
        }[]
      >(
        `SELECT s.source_name,
                s.document_name,
                s.generation_status,
                s.sections_total,
                s.sections_assessable,
                s.sections_covered,
                s.sections_refused,
                s.questions,
                s.approved_questions,
                s.published_questions
           FROM reporting.rm_source_coverage s
          WHERE ($1::boolean OR s.source_id = ANY($2::uuid[]))
          ORDER BY s.source_name, s.document_name
          LIMIT $3`,
        // Source coverage is scoped by SOURCE, not by domain: a document has no
        // domain until a question is generated from it, so a domain predicate
        // would silently hide every unprocessed document -- which is exactly
        // the population this report exists to surface.
        request.scope.sourceIds === null || request.scope.sourceIds === undefined,
        request.scope.sourceIds === null || request.scope.sourceIds === undefined
          ? []
          : [...request.scope.sourceIds],
        pageSize,
      );
      raw = rows.map((row) => {
        const assessable = num(row.sections_assessable);
        const covered = num(row.sections_covered);
        const questions = num(row.questions);
        return {
          sourceName: row.source_name,
          documentName: row.document_name,
          generationStatus: row.generation_status ?? 'NOT_PROCESSED',
          sectionsTotal: num(row.sections_total),
          sectionsAssessable: assessable,
          sectionsCovered: covered,
          sectionsRefused: num(row.sections_refused),
          coverageRatioPercent: ratio(covered, assessable),
          questions,
          approvedQuestions: num(row.approved_questions),
          publishedQuestions: num(row.published_questions),
          generationSuccessPercent: ratio(questions, assessable),
        };
      });
      break;
    }
  }

  // ------------------------------------------------------- suppression (S6)
  const threshold = effectiveMinimumGroupSize(request.minimumGroupSize);
  const suppression =
    definition.suppression === undefined
      ? null
      : applySuppression(raw, { ...definition.suppression, minimumGroupSize: threshold });

  const rows = suppression?.rows ?? raw;
  const { asOf, freshness } = await readFreshness(db, definition.models);

  return {
    name: definition.name,
    title: definition.title,
    grain: definition.grain,
    asOf,
    freshness,
    dimensions: definition.dimensions,
    metrics: definition.metrics,
    rows,
    rowCount: rows.length,
    // S4: totals are of VISIBLE rows, so a suppressed row never contributes to
    // a figure a reader could subtract it back out of.
    totals: visibleTotals(
      rows,
      definition.metrics.map((metric) => metric.column),
    ),
    totalsPartial: Object.fromEntries(
      definition.metrics.map((metric) => [
        metric.column,
        rows.some((row) => row[metric.column] === SUPPRESSED),
      ]),
    ),
    suppressedCellCount: suppression?.suppressedCellCount ?? 0,
    minimumGroupSize: threshold,
    drillThrough: definition.drillThrough,
    windowDays,
    windowFrom: from?.toISOString() ?? null,
    windowTo: windowDays === null ? null : to.toISOString(),
    durationMs: Date.now() - started,
  };
};
