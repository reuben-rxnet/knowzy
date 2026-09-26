// The read model behind Governance → AI Usage & Budgets.
//
// Every figure it returns is a count or a sum of rows that exist. Where nothing
// has been recorded it returns `notRecorded` rather than 0, and the screen says
// "Not Yet Recorded" — because a confident zero for a metric nothing has ever
// written is the most misleading thing an executive dashboard can do, and this
// page will be read by people deciding whether to enable a paid provider.
//
// TWO SOURCES, AND THE DIFFERENCE IS DELIBERATE:
//
//   * ACTIVITY (the KPIs, the timeline, the history, per-provider usage) reads
//     `generation_job`. Those rows go back to the first generation this
//     platform ever ran.
//   * BUDGET WINDOWS read `generation_provider_call`, which is the control
//     layer's own accounting unit and starts at this milestone. It counts
//     ATTEMPTS, so retries count against the budget.
//
// So a job generated before 2026-09-24 appears in the activity totals and not
// in the budget windows. That is stated on the page and in
// docs/governance/AI_USAGE_AND_BUDGETS.md rather than smoothed over by
// back-filling rows nobody measured.
//
// No raw SQL: repository-structure.md reserves that for the reporting package
// and the similarity module. The windows here are small enough (30 days of
// jobs) that grouping in memory is honest rather than clever.

import {
  aggregateCost,
  assessProviderHealth,
  computeCost,
  observableCost,
  tokenAccount,
  unobservableCost,
  PROVIDER_CATALOGUE,
  type GeneratorRegistry,
  type HealthSample,
} from '@knowzy/claude-services';
import type { DbClient } from '@knowzy/database';
import type { Clock } from '@knowzy/observability';
import {
  GENERATION_PROVIDER,
  notRecorded,
  recorded,
  type AiUsageSummary,
  type BudgetWindow,
  type BudgetWindowStatus,
  type CallErrorClass,
  type CostAccount,
  type GenerationHistoryRow,
  type GenerationProviderId,
  type GenerationRefusalReason,
  type ProviderStateAssessment,
  type ProviderUsage,
  type RecordedNumber,
  type UsageBucket,
} from '@knowzy/shared-types';
import { budgetStatus, limitFor, perJobLimitFor, type BudgetSettings } from './budget.js';
import { concurrencyLimitFor, type ConcurrencySettings } from './concurrency.js';

export interface UsageSettings extends BudgetSettings, ConcurrencySettings {
  readonly prices: Readonly<Record<string, { inputPerMillion: number; outputPerMillion: number }>>;
  readonly health: { readonly failureThreshold: number; readonly windowMinutes: number };
  readonly maxAttempts: number;
}

export interface ReadAiUsageArgs {
  readonly db: DbClient;
  readonly clock: Clock;
  readonly registry: GeneratorRegistry;
  readonly settings: UsageSettings;
  /** Activity window. 30 days, matching the sync console's stated window. */
  readonly windowDays?: number;
  readonly historyLimit?: number;
}

/** A job row, as much of it as this read model needs. */
interface JobRow {
  readonly id: string;
  readonly providerId: GenerationProviderId;
  readonly executionMode: 'PLATFORM_MANAGED' | 'USER_MANAGED';
  readonly modelId: string;
  readonly status: string;
  readonly acceptedQuestionCount: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly tokenUsageReported: boolean;
  readonly estimatedCost: unknown;
  readonly costObservable: boolean;
  readonly attemptCount: number;
  readonly refusalReason: GenerationRefusalReason | null;
  readonly createdAt: Date;
  readonly createdByUserId: string | null;
}

/**
 * The cost of one historical job.
 *
 * A job recorded before the control layer existed has `costObservable = false`
 * and no amount, which is exactly right: nobody computed a cost for it, so
 * there is none to report. It is not zero.
 */
const costOfJob = (job: JobRow, settings: UsageSettings): CostAccount => {
  if (job.costObservable && job.estimatedCost !== null && job.estimatedCost !== undefined) {
    return observableCost(String(job.estimatedCost));
  }
  // Recompute for the deterministic provider, whose zero is a fact rather than
  // a missing measurement, so historical local runs read 0 instead of blank.
  if (job.providerId === 'DETERMINISTIC_LOCAL') {
    return computeCost({
      providerId: job.providerId,
      modelId: job.modelId,
      executionMode: job.executionMode,
      reportsCost: PROVIDER_CATALOGUE.DETERMINISTIC_LOCAL.reportsCost,
      tokens: tokenAccount(job.inputTokens, job.outputTokens, job.tokenUsageReported),
      prices: settings.prices,
    });
  }
  return unobservableCost('No cost was recorded for this run.');
};

const bucketKey = (date: Date, grain: 'day' | 'week' | 'month'): string => {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${date.getUTCDate()}`.padStart(2, '0');
  if (grain === 'day') return `${year}-${month}-${day}`;
  if (grain === 'month') return `${year}-${month}`;
  // ISO-ish week bucket: the Monday of the date's week, named by that date.
  const monday = new Date(Date.UTC(year, date.getUTCMonth(), date.getUTCDate()));
  const weekday = (monday.getUTCDay() + 6) % 7;
  monday.setUTCDate(monday.getUTCDate() - weekday);
  return `${monday.getUTCFullYear()}-${`${monday.getUTCMonth() + 1}`.padStart(2, '0')}-${`${monday.getUTCDate()}`.padStart(2, '0')}`;
};

const bucketize = (
  jobs: readonly JobRow[],
  grain: 'day' | 'week' | 'month',
  settings: UsageSettings,
): readonly UsageBucket[] => {
  const groups = new Map<string, JobRow[]>();
  for (const job of jobs) {
    const key = bucketKey(job.createdAt, grain);
    const list = groups.get(key);
    if (list) list.push(job);
    else groups.set(key, [job]);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => (left < right ? 1 : -1))
    .map(([key, rows]) => {
      const startedAt = rows
        .map((row) => row.createdAt)
        .sort((a, b) => a.getTime() - b.getTime())[0];
      return {
        bucket: key,
        startedAt: (startedAt ?? new Date(0)).toISOString(),
        requests: rows.length,
        questionsGenerated: rows.reduce((sum, row) => sum + row.acceptedQuestionCount, 0),
        tokens: rows.reduce((sum, row) => sum + row.inputTokens + row.outputTokens, 0),
        cost: aggregateCost(rows.map((row) => costOfJob(row, settings))),
      };
    });
};

/** Only count as "recorded" what something actually wrote. */
const countOrNotRecorded = (value: number, hasAnyActivity: boolean): RecordedNumber =>
  hasAnyActivity ? recorded(value) : notRecorded;

export const readAiUsage = async (args: ReadAiUsageArgs): Promise<AiUsageSummary> => {
  const { db, clock, registry, settings } = args;
  const windowDays = args.windowDays ?? 30;
  const now = clock.now();
  const since = new Date(now.getTime() - windowDays * 24 * 60 * 60_000);

  const jobs = (await db.generationJob.findMany({
    where: { createdAt: { gte: since } },
    select: {
      id: true,
      providerId: true,
      executionMode: true,
      modelId: true,
      status: true,
      acceptedQuestionCount: true,
      inputTokens: true,
      outputTokens: true,
      tokenUsageReported: true,
      estimatedCost: true,
      costObservable: true,
      attemptCount: true,
      refusalReason: true,
      createdAt: true,
      createdByUserId: true,
    },
    orderBy: { createdAt: 'desc' },
  })) as unknown as JobRow[];

  // Provider states, and the version each provider last actually reported.
  // Null until it has run: there is no version to claim for a provider that has
  // never answered.
  const observedVersions: Partial<Record<GenerationProviderId, string | null>> = {};
  for (const providerId of GENERATION_PROVIDER) {
    const latest = await db.generationProviderCall.findFirst({
      where: { providerId, providerVersion: { not: null } },
      orderBy: { startedAt: 'desc' },
      select: { providerVersion: true },
    });
    observedVersions[providerId] = latest?.providerVersion ?? null;
  }

  const providers: readonly ProviderStateAssessment[] = registry.describe().map((assessment) => ({
    ...assessment,
    providerVersion: observedVersions[assessment.providerId] ?? assessment.providerVersion,
  }));

  // Per-provider usage and health.
  const healthSince = new Date(now.getTime() - settings.health.windowMinutes * 60_000);
  const healthRows = await db.generationProviderCall.findMany({
    where: { startedAt: { gte: healthSince } },
    select: { providerId: true, outcome: true, startedAt: true, errorClass: true, latencyMs: true },
  });

  const providerUsage: ProviderUsage[] = providers
    .map((assessment) => {
      const rows = jobs.filter((job) => job.providerId === assessment.providerId);
      const samples: HealthSample[] = healthRows
        .filter((row) => row.providerId === assessment.providerId)
        .map((row) => ({
          outcome: row.outcome,
          startedAt: row.startedAt,
          errorClass: (row.errorClass as CallErrorClass | null) ?? null,
          latencyMs: row.latencyMs,
        }));
      const health = assessProviderHealth(samples, settings.health, now);
      const lastUsed = rows
        .map((row) => row.createdAt)
        .sort((a, b) => b.getTime() - a.getTime())[0];

      return {
        providerId: assessment.providerId,
        generations: rows.length,
        questionsGenerated: rows.reduce((sum, row) => sum + row.acceptedQuestionCount, 0),
        tokens: tokenAccount(
          rows.reduce((sum, row) => sum + row.inputTokens, 0),
          rows.reduce((sum, row) => sum + row.outputTokens, 0),
          rows.length > 0 && rows.every((row) => row.tokenUsageReported),
        ),
        cost: aggregateCost(rows.map((row) => costOfJob(row, settings))),
        refusals: rows.filter((row) => row.status === 'REFUSED').length,
        failures: rows.filter((row) => row.status === 'FAILED').length,
        health: health.state,
        healthReason: health.reason,
        lastUsedAt: lastUsed?.toISOString() ?? null,
        executionModes: [...new Set(rows.map((row) => row.executionMode))],
      } satisfies ProviderUsage;
    })
    // A provider with no activity and no state worth reporting would be noise;
    // one that is blocked IS worth reporting, because the reason is the point.
    .filter(
      (usage, index) =>
        usage.generations > 0 || providers[index]?.state !== 'UNAVAILABLE' || usage.refusals > 0,
    );

  const windows: readonly BudgetWindow[] = ['DAILY', 'WEEKLY', 'MONTHLY'];
  const budgets: BudgetWindowStatus[] = [];
  for (const window of windows) {
    budgets.push(await budgetStatus(db, window, settings, now, null));
  }

  // Jobs RUNNING right now, per provider. The same count `checkConcurrency`
  // makes when it refuses a job, so the number on the page is the number that
  // is enforced -- not a second definition of "busy".
  const running = await db.generationJob.groupBy({
    by: ['providerId'],
    where: { status: 'RUNNING' },
    _count: { _all: true },
  });
  const activeFor = (providerId: string): number =>
    running.find((row) => row.providerId === providerId)?._count._all ?? 0;

  const history = (await db.generationJob.findMany({
    take: args.historyLimit ?? 25,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      providerId: true,
      executionMode: true,
      modelId: true,
      status: true,
      acceptedQuestionCount: true,
      inputTokens: true,
      outputTokens: true,
      tokenUsageReported: true,
      estimatedCost: true,
      costObservable: true,
      attemptCount: true,
      refusalReason: true,
      createdAt: true,
      createdByUserId: true,
    },
  })) as unknown as JobRow[];

  // `GenerationJob.createdByUserId` carries no relation in the schema, so the
  // names are fetched separately rather than by a join that does not exist.
  const actorIds = [
    ...new Set(history.map((job) => job.createdByUserId).filter((id): id is string => id !== null)),
  ];
  const actors = await db.user.findMany({
    where: { id: { in: actorIds } },
    select: { id: true, displayName: true },
  });
  const actorNames = new Map(actors.map((actor) => [actor.id, actor.displayName]));

  const historyRows: readonly GenerationHistoryRow[] = history.map((job) => ({
    jobId: job.id,
    occurredAt: job.createdAt.toISOString(),
    // The person, or the honest absence of one. Never "Unknown user" for a row
    // that simply has no linked account.
    actorDisplayName:
      job.createdByUserId === null
        ? 'Not recorded'
        : (actorNames.get(job.createdByUserId) ?? 'Not recorded'),
    providerId: job.providerId,
    executionMode: job.executionMode,
    questionsGenerated: job.acceptedQuestionCount,
    tokens: tokenAccount(job.inputTokens, job.outputTokens, job.tokenUsageReported),
    cost: costOfJob(job, settings),
    outcome: job.status,
    refusalReason: job.refusalReason,
    attemptCount: job.attemptCount,
  }));

  const hasActivity = jobs.length > 0;
  const daily = budgets.find((budget) => budget.window === 'DAILY');

  /**
   * OVER_BUDGET, overlaid on the registry's verdict.
   *
   * The registry cannot decide this: it has no database, by design (B4), and
   * budget consumption is a query. So a provider the registry called AVAILABLE
   * is re-labelled here when any window it is subject to is already spent.
   *
   * The test matches what `checkWindowBudgets` ENFORCES rather than inventing
   * a second rule: that check compares TENANT-WIDE usage against the limit in
   * force for the provider, so this does the same with the totals already
   * computed above. No extra query, and no risk of the page disagreeing with
   * the refusal.
   */
  const overBudgetWindow = (providerId: GenerationProviderId): BudgetWindow | null => {
    for (const status of budgets) {
      const limit = limitFor(status.window, settings, providerId);
      if (status.usedTokens >= limit) return status.window;
    }
    return null;
  };

  const withBudgetState: readonly ProviderStateAssessment[] = providers.map((assessment) => {
    if (assessment.state !== 'AVAILABLE') return assessment;
    const window = overBudgetWindow(assessment.providerId);
    if (window === null) return assessment;
    return {
      ...assessment,
      state: 'OVER_BUDGET' as const,
      reason: `The ${window.toLowerCase()} token budget in force for this provider is spent. Generation is refused until the window resets or the ceiling is raised.`,
    };
  });
  const available = providers.filter((provider) => provider.state === 'AVAILABLE').length;
  const registeredCount = providers.filter((provider) => provider.registered).length;

  return {
    asOf: now.toISOString(),
    windowDays,
    kpis: {
      // Always known: the registry is code and configuration, not activity.
      providersRegistered: recorded(registeredCount),
      providersAvailable: recorded(available),
      totalGenerations: countOrNotRecorded(jobs.length, hasActivity),
      questionsGenerated: countOrNotRecorded(
        jobs.reduce((sum, job) => sum + job.acceptedQuestionCount, 0),
        hasActivity,
      ),
      estimatedTokens: countOrNotRecorded(
        jobs.reduce((sum, job) => sum + job.inputTokens + job.outputTokens, 0),
        hasActivity,
      ),
      // Budget figures are known from configuration even with no activity: a
      // full budget is a fact, not an absence.
      remainingDailyBudget: recorded(daily?.remainingTokens ?? 0),
      dailyBudget: recorded(daily?.budgetTokens ?? 0),
      budgetUtilizationPercent: recorded(daily?.utilizationPercent ?? 0),
      // The window's total spend. Unobservable as a whole if ANY contributor
      // is, because summing only the observable part presents an undercount
      // as a total.
      estimatedCost: hasActivity
        ? aggregateCost(jobs.map((job) => costOfJob(job, settings)))
        : {
            observable: false,
            amount: null,
            unobservableReason: 'No generation has been recorded in this window.',
          },
      activeAuthors: countOrNotRecorded(
        new Set(jobs.map((job) => job.createdByUserId).filter((id) => id !== null)).size,
        hasActivity,
      ),
    },
    activeProvider: registry.activeProvider,
    providers: withBudgetState,
    providerUsage,
    budgets,
    concurrency: {
      providerId: registry.activeProvider,
      active: activeFor(registry.activeProvider),
      limit: concurrencyLimitFor(settings, registry.activeProvider),
    },
    timeline: {
      day: bucketize(jobs, 'day', settings),
      week: bucketize(jobs, 'week', settings),
      month: bucketize(jobs, 'month', settings),
    },
    history: historyRows,
    limits: {
      perJobTokenBudget: perJobLimitFor(settings, registry.activeProvider),
      concurrency: concurrencyLimitFor(settings, registry.activeProvider),
      // The ceiling in force for the ACTIVE provider, which is what the rest
      // of this block reports. A per-provider override wins, exactly as it
      // does at call time -- a page showing the platform default while a
      // different number is enforced is worse than no number.
      maxAttempts:
        (settings.providerLimits as Record<string, { maxAttempts?: number } | undefined>)[
          registry.activeProvider
        ]?.maxAttempts ?? settings.maxAttempts,
    },
  };
};
