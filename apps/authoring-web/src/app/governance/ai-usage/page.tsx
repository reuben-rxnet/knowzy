// Governance → AI Usage & Budgets.
//
// The page platform owners read before deciding whether to enable a paid
// provider, so its one hard rule is that **no figure here is invented**. Every
// number is a count or a sum of rows that exist; where nothing has been
// recorded it says "Not Yet Recorded", and where a cost cannot be known it says
// "Not observable" with the reason — never 0.00, which would claim a
// measurement nobody took.
//
// It is functional BEFORE any provider is enabled, and that is the point: the
// deterministic provider has been running through the same accounting since
// this milestone, so the page is exercised rather than waiting to be.
//
// Three things it deliberately does not show:
//
//   * no trend, no "vs last month" — no KPI history is stored anywhere, so
//     none is computable (the standing rule in CLAUDE.md);
//   * no provider that does not exist. The table lists the DECLARED catalogue,
//     each with its real state and the reason, so an operator can see why the
//     platform will not use one — which is more useful than hiding it;
//   * no spend for a provider that reports none.

import {
  ActivityHeatmap,
  Badge,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  KpiCard,
  PageHero,
  StatusBadge,
  TBody,
  THead,
  Td,
  Th,
  Tr,
} from '@knowzy/shared-ui';
import { Activity, Coins, Cpu, Gauge, Users } from 'lucide-react';
import { t } from '../../../copy';
import { api } from '../../../lib/api';
import { Problem } from '../../../components/Problem';
import { ProviderLimitButton } from '../../../components/ProviderLimitForm';
import { currentSubject } from '../../../lib/identity';

interface RecordedNumber {
  readonly recorded: boolean;
  readonly value?: number;
}

interface CostAccount {
  readonly observable: boolean;
  readonly amount: string | null;
  readonly unobservableReason: string | null;
}

interface TokenAccount {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly reported: boolean;
}

interface ProviderState {
  readonly providerId: string;
  readonly state: string;
  readonly reason: string;
  readonly registered: boolean;
  readonly approved: boolean;
  readonly groundingSafe: boolean;
  readonly supportedExecutionModes: readonly string[];
  readonly reportsCost: boolean;
  readonly reportsTokenUsage: boolean;
  readonly maxInputTokens: number;
  readonly providerVersion: string | null;
}

interface ProviderUsage {
  readonly providerId: string;
  readonly generations: number;
  readonly questionsGenerated: number;
  readonly tokens: TokenAccount;
  readonly cost: CostAccount;
  readonly refusals: number;
  readonly failures: number;
  readonly health: string;
  readonly healthReason: string;
  readonly lastUsedAt: string | null;
  readonly executionModes: readonly string[];
}

interface BudgetWindowStatus {
  readonly window: string;
  readonly budgetTokens: number;
  readonly usedTokens: number;
  readonly remainingTokens: number;
  readonly utilizationPercent: number;
  readonly state: string;
  readonly resetsAt: string;
}

interface UsageBucket {
  readonly bucket: string;
  readonly requests: number;
  readonly questionsGenerated: number;
  readonly tokens: number;
  readonly cost: CostAccount;
}

interface HistoryRow {
  readonly jobId: string;
  readonly occurredAt: string;
  readonly actorDisplayName: string;
  readonly providerId: string;
  readonly executionMode: string;
  readonly questionsGenerated: number;
  readonly tokens: TokenAccount;
  readonly cost: CostAccount;
  readonly outcome: string;
  readonly refusalReason: string | null;
  readonly attemptCount: number;
}

interface AiUsage {
  readonly asOf: string;
  readonly windowDays: number;
  readonly kpis: {
    readonly providersRegistered: RecordedNumber;
    readonly providersAvailable: RecordedNumber;
    readonly totalGenerations: RecordedNumber;
    readonly questionsGenerated: RecordedNumber;
    readonly estimatedTokens: RecordedNumber;
    readonly estimatedCost: CostAccount;
    readonly dailyBudget: RecordedNumber;
    readonly remainingDailyBudget: RecordedNumber;
    readonly budgetUtilizationPercent: RecordedNumber;
    readonly activeAuthors: RecordedNumber;
  };
  readonly activeProvider: string;
  readonly providers: readonly ProviderState[];
  readonly providerUsage: readonly ProviderUsage[];
  readonly budgets: readonly BudgetWindowStatus[];
  readonly concurrency: {
    readonly providerId: string;
    readonly active: number;
    readonly limit: number;
  };
  readonly timeline: {
    readonly day: readonly UsageBucket[];
    readonly week: readonly UsageBucket[];
    readonly month: readonly UsageBucket[];
  };
  readonly history: readonly HistoryRow[];
  readonly limits: {
    readonly perJobTokenBudget: number;
    readonly concurrency: number;
    readonly maxAttempts: number;
  };
  /** Resolved by the API from the caller's permissions, never by this page. */
  readonly canManageBudgets: boolean;
}

const GRAINS = ['day', 'week', 'month'] as const;
type Grain = (typeof GRAINS)[number];

/**
 * Grain labels as a literal map rather than a computed key.
 *
 * `t()` takes a DECLARED key, so `t(`ai.grain.${option}`)` is a type error and
 * rightly: a computed copy key is how a missing translation reaches a screen.
 */
const GRAIN_LABEL = {
  day: 'ai.grain.day',
  week: 'ai.grain.week',
  month: 'ai.grain.month',
} as const;

const number = (value: number): string => value.toLocaleString('en-GB');

/**
 * `PLATFORM_MANAGED, USER_MANAGED` is 32 characters of column width for two
 * facts. Abbreviated so the Health and Actions columns stay on screen at
 * 1440px, which they did not before this was measured in a browser.
 */
const modes = (values: readonly string[]): string =>
  values
    .map((mode) => (mode === 'PLATFORM_MANAGED' ? t('ai.modePlatform') : t('ai.modeUser')))
    .join(' · ');

/** "Not Yet Recorded" rather than a zero nothing wrote. */
const figure = (value: RecordedNumber, suffix = ''): string =>
  value.recorded && value.value !== undefined
    ? `${number(value.value)}${suffix}`
    : t('ai.notRecorded');

/** A cost, or the honest reason there isn't one. */
const money = (cost: CostAccount): string =>
  cost.observable && cost.amount !== null ? `$${cost.amount}` : t('ai.notObservable');

/** Literal keys, for the same reason as GRAIN_LABEL below. */
const BUDGET_LABEL = {
  DAILY: 'ai.windowDaily',
  WEEKLY: 'ai.windowWeekly',
  MONTHLY: 'ai.windowMonthly',
} as const;

type BudgetLabelKey = keyof typeof BUDGET_LABEL;

const STATE_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  AVAILABLE: 'success',
  UNAVAILABLE: 'neutral',
  BLOCKED_BY_CONFIGURATION: 'warning',
  BLOCKED_BY_APPROVAL: 'warning',
  BLOCKED_BY_CAPABILITY: 'danger',
  // The sixth state, applied by the read model rather than the registry: a
  // provider that is capable, approved, built and configured, and whose budget
  // window is spent. WARNING and not DANGER -- it clears itself when the
  // window rolls over, unlike the other four.
  OVER_BUDGET: 'warning',
};

export const dynamic = 'force-dynamic';

export default async function AiUsagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requested = typeof params['grain'] === 'string' ? params['grain'] : 'day';
  const grain: Grain = GRAINS.includes(requested as Grain) ? (requested as Grain) : 'day';
  const subject = await currentSubject();

  const usage = await api<AiUsage>('/api/v1/authoring/governance/ai-usage');

  if (!usage.ok) {
    return (
      <div className="flex flex-col gap-6">
        <PageHero title={t('ai.heading')} purpose={t('ai.intro')} />
        <Problem problem={usage.problem} actingAs={subject.label} />
      </div>
    );
  }

  const data = usage.data;
  const buckets = data.timeline[grain];
  // The write is administrator-only, so the control is absent rather than
  // present-and-refusing for everyone else. The ANSWER comes from the server:
  // this page does not evaluate permissions, and the PUT re-checks anyway.
  const canManage = data.canManageBudgets;

  return (
    <div className="flex flex-col gap-6">
      <PageHero title={t('ai.heading')} purpose={t('ai.intro')} />

      {/* The window and the active provider, said out loud: every count below
          is over this window, and "$0.00" for the deterministic provider is a
          fact rather than a missing figure. */}
      <Card>
        <CardBody>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-ink-muted">
            <span>
              {t('ai.activeProvider')}: <strong className="text-ink">{data.activeProvider}</strong>
            </span>
            <span>{t('ai.window', { days: String(data.windowDays) })}</span>
            <span>{t('ai.asOf', { at: new Date(data.asOf).toLocaleString('en-GB') })}</span>
            <span>
              {t('ai.perJobCeiling')}: {number(data.limits.perJobTokenBudget)}
            </span>
            <span>
              {t('ai.concurrencyCap')}: {data.limits.concurrency}
            </span>
            <span>
              {t('ai.attemptCap')}: {data.limits.maxAttempts}
            </span>
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label={t('ai.kpiProvidersRegistered')}
          value={figure(data.kpis.providersRegistered)}
          icon={<Cpu className="size-5" />}
        />
        <KpiCard
          label={t('ai.kpiProvidersAvailable')}
          value={figure(data.kpis.providersAvailable)}
          caption={t('ai.kpiProvidersAvailableNote')}
          icon={<Cpu className="size-5" />}
          tone="success"
        />
        <KpiCard
          label={t('ai.kpiGenerations')}
          value={figure(data.kpis.totalGenerations)}
          icon={<Activity className="size-5" />}
        />
        <KpiCard
          label={t('ai.kpiQuestions')}
          value={figure(data.kpis.questionsGenerated)}
          icon={<Activity className="size-5" />}
        />
        <KpiCard
          label={t('ai.kpiTokens')}
          value={figure(data.kpis.estimatedTokens)}
          caption={t('ai.kpiTokensNote')}
          icon={<Gauge className="size-5" />}
          tone="ai"
        />
        {/* Spend, and the ceiling it is spent against. A remaining figure with
            no budget beside it cannot be judged: 400,000 left is comfortable
            against 2,000,000 and alarming against 450,000. */}
        <KpiCard
          label={t('ai.kpiCost')}
          value={money(data.kpis.estimatedCost)}
          caption={
            data.kpis.estimatedCost.observable
              ? t('ai.kpiCostNote')
              : (data.kpis.estimatedCost.unobservableReason ?? t('ai.notObservable'))
          }
          icon={<Coins className="size-5" />}
        />
        <KpiCard
          label={t('ai.kpiDailyBudget')}
          value={figure(data.kpis.dailyBudget)}
          caption={t('ai.kpiDailyBudgetNote')}
          icon={<Coins className="size-5" />}
        />
        <KpiCard
          label={t('ai.kpiRemainingDaily')}
          value={figure(data.kpis.remainingDailyBudget)}
          icon={<Coins className="size-5" />}
        />
        <KpiCard
          label={t('ai.kpiUtilization')}
          value={figure(data.kpis.budgetUtilizationPercent, '%')}
          icon={<Gauge className="size-5" />}
        />
        <KpiCard
          label={t('ai.kpiAuthors')}
          value={figure(data.kpis.activeAuthors)}
          icon={<Users className="size-5" />}
        />
      </div>

      {/* ------------------------------------------------------- concurrency */}
      <Card>
        <CardHeader title={t('ai.concurrencyHeading')} description={t('ai.concurrencyNote')} />
        <CardBody>
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <p className="text-2xl font-semibold text-brand-navy-text">
              {t('ai.concurrencyOf', {
                active: String(data.concurrency.active),
                limit: String(data.concurrency.limit),
              })}
            </p>
            <p className="text-sm text-ink-muted">
              {t('ai.concurrencyProvider', { provider: data.concurrency.providerId })}
            </p>
          </div>
          {/* Said out loud, because the absence of a queue is the kind of thing
              a reader assumes the other way round. */}
          <p className="mt-2 max-w-prose text-2xs text-ink-muted">{t('ai.concurrencyNoQueue')}</p>
        </CardBody>
      </Card>

      {/* ------------------------------------------------------------ budgets */}
      <Card>
        <CardHeader title={t('ai.budgetsHeading')} description={t('ai.budgetsNote')} />
        <CardBody>
          <div className="grid gap-4 md:grid-cols-3">
            {data.budgets.map((budget) => (
              <div
                key={budget.window}
                className="flex flex-col gap-3 rounded-lg border border-line bg-surface-muted p-4"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-ink">
                    {t(BUDGET_LABEL[budget.window as BudgetLabelKey] ?? 'ai.windowDaily')}
                  </span>
                  <StatusBadge status={budget.state} />
                </div>
                <dl className="flex flex-col gap-1 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-ink-muted">{t('ai.budget')}</dt>
                    <dd className="font-semibold text-ink">{number(budget.budgetTokens)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-ink-muted">{t('ai.used')}</dt>
                    <dd className="font-semibold text-ink">{number(budget.usedTokens)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-ink-muted">{t('ai.remaining')}</dt>
                    <dd className="font-semibold text-ink">{number(budget.remainingTokens)}</dd>
                  </div>
                </dl>
                {/* A bar, not a chart library: one number, one length. */}
                <div
                  className="h-2 w-full overflow-hidden rounded-full bg-neutral-soft"
                  role="img"
                  aria-label={t('ai.utilizationOf', {
                    percent: String(budget.utilizationPercent),
                  })}
                >
                  <div
                    className={`h-full ${
                      budget.state === 'EXHAUSTED'
                        ? 'bg-danger'
                        : budget.state === 'WARNING'
                          ? 'bg-warning'
                          : 'bg-success'
                    }`}
                    style={{ width: `${Math.min(100, budget.utilizationPercent)}%` }}
                  />
                </div>
                <p className="text-2xs text-ink-muted">
                  {t('ai.resets', { at: new Date(budget.resetsAt).toLocaleString('en-GB') })}
                </p>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      {/* ----------------------------------------------------------- providers */}
      <Card>
        <CardHeader title={t('ai.providersHeading')} description={t('ai.providersNote')} />
        <CardBody>
          <DataTable caption={t('ai.providersHeading')} captionHidden>
            <THead>
              <Tr>
                <Th scope="col">{t('ai.provider')}</Th>
                <Th scope="col">{t('ai.version')}</Th>
                <Th scope="col">{t('ai.executionMode')}</Th>
                <Th scope="col">{t('ai.registered')}</Th>
                <Th scope="col">{t('ai.state')}</Th>
                <Th scope="col" align="end">
                  {t('ai.generations')}
                </Th>
                <Th scope="col" align="end">
                  {t('ai.questions')}
                </Th>
                <Th scope="col" align="end">
                  {t('ai.tokens')}
                </Th>
                <Th scope="col" align="end">
                  {t('ai.cost')}
                </Th>
                <Th scope="col">{t('ai.health')}</Th>
                {canManage ? <Th scope="col">{t('ai.actions')}</Th> : null}
              </Tr>
            </THead>
            <TBody>
              {data.providers.map((provider) => {
                const usageRow = data.providerUsage.find(
                  (row) => row.providerId === provider.providerId,
                );
                return (
                  <Tr key={provider.providerId}>
                    <Th scope="row">
                      <span className="flex flex-col gap-1">
                        <span className="font-semibold">{provider.providerId}</span>
                        {/* The reason travels with the row: a state with no
                            reason tells an operator nothing about what to do. */}
                        <span className="text-2xs text-ink-muted">{provider.reason}</span>
                      </span>
                    </Th>
                    <Td>{provider.providerVersion ?? t('ai.noVersionYet')}</Td>
                    <Td>{modes(provider.supportedExecutionModes)}</Td>
                    <Td>{provider.registered ? t('ai.yes') : t('ai.no')}</Td>
                    <Td>
                      <Badge tone={STATE_TONE[provider.state] ?? 'neutral'}>{provider.state}</Badge>
                    </Td>
                    <Td align="end">
                      {usageRow === undefined ? '—' : number(usageRow.generations)}
                    </Td>
                    <Td align="end">
                      {usageRow === undefined ? '—' : number(usageRow.questionsGenerated)}
                    </Td>
                    <Td align="end">
                      {usageRow === undefined ? '—' : number(usageRow.tokens.totalTokens)}
                    </Td>
                    <Td align="end">
                      {usageRow === undefined
                        ? provider.reportsCost
                          ? '—'
                          : t('ai.notObservable')
                        : money(usageRow.cost)}
                    </Td>
                    <Td>
                      {usageRow === undefined ? (
                        '—'
                      ) : (
                        <span className="flex flex-col gap-1">
                          <StatusBadge status={usageRow.health} />
                          <span className="text-2xs text-ink-muted">{usageRow.healthReason}</span>
                        </span>
                      )}
                    </Td>
                    {canManage ? (
                      <Td>
                        <ProviderLimitButton
                          providerId={provider.providerId}
                          actingAs={subject.label}
                        />
                      </Td>
                    ) : null}
                  </Tr>
                );
              })}
            </TBody>
          </DataTable>
        </CardBody>
      </Card>

      {/* ----------------------------------------------------------- timeline */}
      <Card>
        <CardHeader
          title={t('ai.timelineHeading')}
          description={t('ai.timelineNote')}
          actions={
            <form method="GET" className="flex items-center gap-2">
              {GRAINS.map((option) => (
                <button
                  key={option}
                  type="submit"
                  name="grain"
                  value={option}
                  className={`rounded-md border px-3 py-1.5 text-sm ${
                    option === grain
                      ? 'border-brand bg-brand-soft font-semibold text-brand-navy-text'
                      : 'border-line text-ink-muted'
                  }`}
                  aria-current={option === grain ? 'true' : undefined}
                >
                  {t(GRAIN_LABEL[option])}
                </button>
              ))}
            </form>
          }
        />
        <CardBody>
          {buckets.length === 0 ? (
            <EmptyState title={t('ai.noActivity')} description={t('ai.noActivityNote')} />
          ) : (
            <>
              {/* The grid FIRST, the table under it. The grid answers "when has
                  this platform been busy" in one look; the table answers "how
                  much, exactly", and both are the same numbers -- the heatmap
                  computes nothing.

                  Oldest first, left to right, which is the only order a
                  calendar reads in. The read model returns newest first
                  because every other consumer wants that, so it is reversed
                  here rather than there. */}
              <div className="mb-5">
                <ActivityHeatmap
                  cells={[...buckets].reverse().map((bucket) => ({
                    bucket: bucket.bucket,
                    value: bucket.tokens,
                    detail: [
                      [t('ai.requests'), bucket.requests],
                      [t('ai.questions'), bucket.questionsGenerated],
                    ] as const,
                  }))}
                  caption={t('ai.heatmapCaption')}
                  valueLabel={t('ai.tokens')}
                  columns={grain === 'day' ? 14 : grain === 'week' ? 13 : 12}
                  emptyLabel={t('ai.heatmapEmpty')}
                />
              </div>
              <DataTable caption={t('ai.timelineHeading')} captionHidden>
                <THead>
                  <Tr>
                    <Th scope="col">{t('ai.period')}</Th>
                    <Th scope="col" align="end">
                      {t('ai.requests')}
                    </Th>
                    <Th scope="col" align="end">
                      {t('ai.questions')}
                    </Th>
                    <Th scope="col" align="end">
                      {t('ai.tokens')}
                    </Th>
                    <Th scope="col" align="end">
                      {t('ai.cost')}
                    </Th>
                  </Tr>
                </THead>
                <TBody>
                  {buckets.map((bucket) => (
                    <Tr key={bucket.bucket}>
                      <Th scope="row">{bucket.bucket}</Th>
                      <Td align="end">{number(bucket.requests)}</Td>
                      <Td align="end">{number(bucket.questionsGenerated)}</Td>
                      <Td align="end">{number(bucket.tokens)}</Td>
                      <Td align="end">
                        <span title={bucket.cost.unobservableReason ?? undefined}>
                          {money(bucket.cost)}
                        </span>
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </DataTable>
            </>
          )}
        </CardBody>
      </Card>

      {/* ------------------------------------------------------------ history */}
      <Card>
        <CardHeader title={t('ai.historyHeading')} description={t('ai.historyNote')} />
        <CardBody>
          {data.history.length === 0 ? (
            <EmptyState title={t('ai.noHistory')} description={t('ai.noHistoryNote')} />
          ) : (
            <DataTable caption={t('ai.historyHeading')} captionHidden>
              <THead>
                <Tr>
                  <Th scope="col">{t('ai.when')}</Th>
                  <Th scope="col">{t('ai.user')}</Th>
                  <Th scope="col">{t('ai.provider')}</Th>
                  <Th scope="col">{t('ai.executionMode')}</Th>
                  <Th scope="col" align="end">
                    {t('ai.questions')}
                  </Th>
                  <Th scope="col" align="end">
                    {t('ai.tokens')}
                  </Th>
                  <Th scope="col" align="end">
                    {t('ai.cost')}
                  </Th>
                  <Th scope="col">{t('ai.outcome')}</Th>
                </Tr>
              </THead>
              <TBody>
                {data.history.map((row) => (
                  <Tr key={row.jobId}>
                    <Th scope="row">{new Date(row.occurredAt).toLocaleString('en-GB')}</Th>
                    <Td>{row.actorDisplayName}</Td>
                    <Td>{row.providerId}</Td>
                    <Td>{modes([row.executionMode])}</Td>
                    <Td align="end">{number(row.questionsGenerated)}</Td>
                    <Td align="end">
                      <span className="flex flex-col items-end">
                        <span>{number(row.tokens.totalTokens)}</span>
                        {/* An estimate is labelled as one: comparing estimated
                            and reported counts as if they were the same number
                            is how a cost model quietly drifts. */}
                        {row.tokens.reported ? null : (
                          <span className="text-2xs text-ink-muted">{t('ai.estimated')}</span>
                        )}
                      </span>
                    </Td>
                    <Td align="end">
                      <span title={row.cost.unobservableReason ?? undefined}>
                        {money(row.cost)}
                      </span>
                    </Td>
                    <Td>
                      <span className="flex flex-col gap-1">
                        <StatusBadge status={row.outcome} />
                        {row.refusalReason === null ? null : (
                          <span className="text-2xs text-ink-muted">{row.refusalReason}</span>
                        )}
                        {row.attemptCount > 1 ? (
                          <span className="text-2xs text-ink-muted">
                            {t('ai.attempts', { count: String(row.attemptCount) })}
                          </span>
                        ) : null}
                      </span>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </DataTable>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
