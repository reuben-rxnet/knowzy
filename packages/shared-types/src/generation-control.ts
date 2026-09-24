// The AI Generation Control Layer — architecture.md §9.0, amended 2026-09-24.
//
// Everything here is PROVIDER-INDEPENDENT on purpose. It was written and
// validated against the deterministic local generator, which cannot send a
// request anywhere, so the day a real provider arrives it inherits ceilings
// that are already enforced and already tested rather than introducing them.
//
// Two rules shape every type below, and both are about refusing to invent:
//
//   1. A provider is never silently downgraded. Ineligibility has one of five
//      NAMED states, each carrying its own reason, because "unavailable" tells
//      an operator nothing about whether they need a credential, an approval,
//      or a different provider entirely.
//
//   2. An unobservable quantity is `null`, never 0. Zero is a claim that
//      something was measured and found to be nothing; null says it could not
//      be known. A per-seat licence has no marginal cost at any granularity
//      and a user-managed run bills an account the platform cannot read, so
//      both record null and every surface says "Not observable in this mode".

import { z } from 'zod';
import type { GenerationExecutionModeSchema, GenerationProviderSchema } from './enums.js';

// ---------------------------------------------------------------------------
// Provider availability
// ---------------------------------------------------------------------------

/**
 * Why a provider can or cannot be used, here and now.
 *
 * `BLOCKED_BY_APPROVAL` is the one that exists for a legal reason rather than
 * a technical one: a provider can be registered, credentialled and healthy and
 * still be refused because no data-processing approval has been recorded for
 * it (T-29 for Anthropic). That is what turns an approval from a promise into
 * a control.
 */
export const PROVIDER_STATES = [
  'AVAILABLE',
  'UNAVAILABLE',
  'BLOCKED_BY_CONFIGURATION',
  'BLOCKED_BY_APPROVAL',
  'BLOCKED_BY_CAPABILITY',
] as const;
export const ProviderStateSchema = z.enum(PROVIDER_STATES);
export type ProviderState = z.infer<typeof ProviderStateSchema>;

/**
 * Observed behaviour, which is a different question from availability.
 *
 * A provider can be AVAILABLE and FAILING: configured, approved, and returning
 * errors. `UNKNOWN` is first-class because a provider with no calls in the
 * window has not earned "healthy" — it has simply not been asked.
 */
export const PROVIDER_HEALTH_STATES = ['HEALTHY', 'DEGRADED', 'FAILING', 'UNKNOWN'] as const;
export const ProviderHealthStateSchema = z.enum(PROVIDER_HEALTH_STATES);
export type ProviderHealthState = z.infer<typeof ProviderHealthStateSchema>;

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

/**
 * Every way the control layer can decline to generate, as a closed union.
 *
 * A refusal is not a failure: nothing broke, the platform decided. The job
 * state is `REFUSED` and carries one of these, so an operator reading the
 * generation history can tell "we stopped this" from "this fell over".
 */
export const GENERATION_REFUSAL_REASONS = [
  'PROVIDER_NOT_REGISTERED',
  'PROVIDER_BLOCKED_BY_CONFIGURATION',
  'PROVIDER_BLOCKED_BY_APPROVAL',
  'PROVIDER_BLOCKED_BY_CAPABILITY',
  'PROVIDER_UNAVAILABLE',
  'EXECUTION_MODE_UNSUPPORTED',
  'PER_JOB_TOKEN_BUDGET_EXCEEDED',
  'DAILY_TOKEN_BUDGET_EXHAUSTED',
  'WEEKLY_TOKEN_BUDGET_EXHAUSTED',
  'MONTHLY_TOKEN_BUDGET_EXHAUSTED',
  'CONCURRENCY_LIMIT_REACHED',
  'RETRY_LIMIT_EXHAUSTED',
] as const;
export const GenerationRefusalReasonSchema = z.enum(GENERATION_REFUSAL_REASONS);
export type GenerationRefusalReason = z.infer<typeof GenerationRefusalReasonSchema>;

/** One attempt against a provider. Retries produce more than one per job. */
export const GENERATION_CALL_OUTCOMES = ['SUCCEEDED', 'FAILED', 'RATE_LIMITED', 'REFUSED'] as const;
export const GenerationCallOutcomeSchema = z.enum(GENERATION_CALL_OUTCOMES);
export type GenerationCallOutcome = z.infer<typeof GenerationCallOutcomeSchema>;

/** How a failed call is classified, which decides whether it may be retried. */
export const CALL_ERROR_CLASSES = [
  'RATE_LIMIT',
  'SERVER_ERROR',
  'TIMEOUT',
  'MALFORMED_OUTPUT',
  'CLIENT_ERROR',
  'UNKNOWN',
] as const;
export const CallErrorClassSchema = z.enum(CALL_ERROR_CLASSES);
export type CallErrorClass = z.infer<typeof CallErrorClassSchema>;

/**
 * The classes a retry may be attempted for.
 *
 * `MALFORMED_OUTPUT` is deliberately absent. A response that arrived and
 * failed to parse is the bounded single repair path in the generation
 * governance spec, not a retry — retrying it would pay for the same tokens
 * twice and could double-charge a partial success.
 */
export const RETRYABLE_ERROR_CLASSES: readonly CallErrorClass[] = [
  'RATE_LIMIT',
  'SERVER_ERROR',
  'TIMEOUT',
];

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

export const BUDGET_WINDOWS = ['DAILY', 'WEEKLY', 'MONTHLY'] as const;
export const BudgetWindowSchema = z.enum(BUDGET_WINDOWS);
export type BudgetWindow = z.infer<typeof BudgetWindowSchema>;

export const BUDGET_STATES = ['HEALTHY', 'WARNING', 'EXHAUSTED'] as const;
export const BudgetStateSchema = z.enum(BUDGET_STATES);
export type BudgetState = z.infer<typeof BudgetStateSchema>;

/** The refusal each window raises when it is exhausted. */
export const BUDGET_WINDOW_REFUSALS: Readonly<Record<BudgetWindow, GenerationRefusalReason>> =
  Object.freeze({
    DAILY: 'DAILY_TOKEN_BUDGET_EXHAUSTED',
    WEEKLY: 'WEEKLY_TOKEN_BUDGET_EXHAUSTED',
    MONTHLY: 'MONTHLY_TOKEN_BUDGET_EXHAUSTED',
  });

// ---------------------------------------------------------------------------
// Accounting
// ---------------------------------------------------------------------------

export interface TokenAccount {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  /**
   * False when the counts are the platform's own estimate.
   *
   * Carried everywhere the counts are, because "tokens per accepted question"
   * compared across a reported arm and an estimated arm is meaningless unless
   * the difference is visible.
   */
  readonly reported: boolean;
}

/**
 * Money, or the honest absence of it.
 *
 * `observable: false` means no figure exists to record — a per-seat licence or
 * a run billed to someone else's account. `amount` is then null and callers
 * must render the reason, never a zero.
 */
export interface CostAccount {
  readonly observable: boolean;
  /** Fixed-point decimal string, six places. Null when not observable. */
  readonly amount: string | null;
  /** Why, when not observable. Null when it is. */
  readonly unobservableReason: string | null;
}

/** Prices are per million tokens, as every provider quotes them. */
export const TokenPriceSchema = z.object({
  inputPerMillion: z.number().min(0),
  outputPerMillion: z.number().min(0),
});
export type TokenPrice = z.infer<typeof TokenPriceSchema>;

/**
 * Per-provider ceiling overrides.
 *
 * An absent entry means the platform ceiling applies. It never means
 * "unlimited": an unlisted provider is not an unbudgeted one.
 */
export const ProviderLimitsSchema = z.object({
  perJobTokenBudget: z.number().int().min(0).optional(),
  dailyTokenBudget: z.number().int().min(0).optional(),
  weeklyTokenBudget: z.number().int().min(0).optional(),
  monthlyTokenBudget: z.number().int().min(0).optional(),
  concurrency: z.number().int().min(1).max(32).optional(),
});
export type ProviderLimits = z.infer<typeof ProviderLimitsSchema>;

// ---------------------------------------------------------------------------
// The read model behind Governance → AI Usage & Budgets
// ---------------------------------------------------------------------------

/**
 * Every figure on that page is one of these, and the discriminator is the
 * point: `recorded: false` renders "Not Yet Recorded" and a zero renders as a
 * zero. A page that cannot tell them apart shows a confident 0 for a metric
 * nothing has ever written, which is the single most misleading thing an
 * executive dashboard can do.
 */
export type RecordedNumber =
  { readonly recorded: true; readonly value: number } | { readonly recorded: false };

export const recorded = (value: number): RecordedNumber => ({ recorded: true, value });
export const notRecorded: RecordedNumber = { recorded: false };

export interface ProviderStateAssessment {
  readonly providerId: z.infer<typeof GenerationProviderSchema>;
  readonly state: ProviderState;
  /** One sentence naming what would change the state. */
  readonly reason: string;
  readonly registered: boolean;
  readonly approved: boolean;
  readonly groundingSafe: boolean;
  readonly supportedExecutionModes: readonly z.infer<typeof GenerationExecutionModeSchema>[];
  readonly reportsTokenUsage: boolean;
  readonly reportsCost: boolean;
  readonly maxInputTokens: number;
  /** Null until the provider has actually run: there is no version to claim. */
  readonly providerVersion: string | null;
}

export interface ProviderUsage {
  readonly providerId: z.infer<typeof GenerationProviderSchema>;
  readonly generations: number;
  readonly questionsGenerated: number;
  readonly tokens: TokenAccount;
  readonly cost: CostAccount;
  readonly refusals: number;
  readonly failures: number;
  readonly health: ProviderHealthState;
  readonly healthReason: string;
  readonly lastUsedAt: string | null;
  readonly executionModes: readonly z.infer<typeof GenerationExecutionModeSchema>[];
}

export interface BudgetWindowStatus {
  readonly window: BudgetWindow;
  readonly budgetTokens: number;
  readonly usedTokens: number;
  readonly remainingTokens: number;
  readonly utilizationPercent: number;
  readonly state: BudgetState;
  readonly windowStartedAt: string;
  readonly resetsAt: string;
}

export interface UsageBucket {
  readonly bucket: string;
  readonly startedAt: string;
  readonly requests: number;
  readonly questionsGenerated: number;
  readonly tokens: number;
  readonly cost: CostAccount;
}

export interface GenerationHistoryRow {
  readonly jobId: string;
  readonly occurredAt: string;
  readonly actorDisplayName: string;
  readonly providerId: z.infer<typeof GenerationProviderSchema>;
  readonly executionMode: z.infer<typeof GenerationExecutionModeSchema>;
  readonly questionsGenerated: number;
  readonly tokens: TokenAccount;
  readonly cost: CostAccount;
  readonly outcome: string;
  readonly refusalReason: GenerationRefusalReason | null;
  readonly attemptCount: number;
}

export interface AiUsageSummary {
  readonly asOf: string;
  readonly windowDays: number;
  readonly kpis: {
    readonly providersRegistered: RecordedNumber;
    readonly providersAvailable: RecordedNumber;
    readonly totalGenerations: RecordedNumber;
    readonly questionsGenerated: RecordedNumber;
    readonly estimatedTokens: RecordedNumber;
    readonly remainingDailyBudget: RecordedNumber;
    readonly budgetUtilizationPercent: RecordedNumber;
    readonly activeAuthors: RecordedNumber;
  };
  readonly activeProvider: z.infer<typeof GenerationProviderSchema>;
  readonly providers: readonly ProviderStateAssessment[];
  readonly providerUsage: readonly ProviderUsage[];
  readonly budgets: readonly BudgetWindowStatus[];
  readonly timeline: {
    readonly day: readonly UsageBucket[];
    readonly week: readonly UsageBucket[];
    readonly month: readonly UsageBucket[];
  };
  readonly history: readonly GenerationHistoryRow[];
  readonly limits: {
    readonly perJobTokenBudget: number;
    readonly concurrency: number;
    readonly maxAttempts: number;
  };
}
