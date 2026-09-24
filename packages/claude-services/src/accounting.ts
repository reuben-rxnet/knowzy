// Token and cost accounting — architecture.md §9.0, provider-independent.
//
// One rule runs through every function here: AN UNOBSERVABLE QUANTITY IS NULL,
// NEVER ZERO. Zero claims a measurement was taken and came to nothing; null
// says it could not be known. The difference matters because these numbers end
// up on an executive dashboard, where a confident 0.00 for a provider that
// cannot report cost is worse than a blank.
//
// Pure arithmetic over declared prices. Nothing here reaches a provider, a
// database or a clock.

import type {
  CostAccount,
  GenerationExecutionMode,
  GenerationProviderId,
  TokenAccount,
  TokenPrice,
} from '@knowzy/shared-types';

/** Six decimal places, matching `Decimal(12,6)` in the schema. */
export const COST_SCALE = 6;

/**
 * The estimator the platform uses before a call, when no provider has reported
 * anything yet.
 *
 * Four characters per token is the conventional English approximation and it is
 * what `createDeterministicGenerator` already uses for its own reported counts,
 * so the pre-call estimate and the post-call estimate agree instead of
 * disagreeing by a factor nobody documented.
 */
export const CHARS_PER_TOKEN_ESTIMATE = 4;

/**
 * Tokens the framing itself costs, before any document text.
 *
 * Measured from the current `frameGenerationPrompt` output rather than guessed,
 * and a test asserts the real framing stays within tolerance of it -- a
 * constant nothing checks is a constant that silently becomes wrong.
 */
export const PROMPT_OVERHEAD_TOKENS = 700;

/**
 * A deliberately CONSERVATIVE input estimate: it rounds up and adds the framing
 * overhead.
 *
 * An estimate that runs low admits jobs the budget should have refused, and the
 * tokens are spent by the time anyone notices. An estimate that runs high
 * refuses a job that might have fit, which an author can see and act on.
 */
export const estimateInputTokens = (characterCount: number): number =>
  Math.ceil(characterCount / CHARS_PER_TOKEN_ESTIMATE) + PROMPT_OVERHEAD_TOKENS;

export const tokenAccount = (
  inputTokens: number,
  outputTokens: number,
  reported: boolean,
): TokenAccount => ({
  inputTokens,
  outputTokens,
  totalTokens: inputTokens + outputTokens,
  reported,
});

export const emptyTokenAccount = (reported = false): TokenAccount => tokenAccount(0, 0, reported);

export const addTokens = (left: TokenAccount, right: TokenAccount): TokenAccount =>
  tokenAccount(
    left.inputTokens + right.inputTokens,
    left.outputTokens + right.outputTokens,
    // An estimate mixed with a report is an estimate. Claiming otherwise would
    // let one measured call launder a batch of estimated ones.
    left.reported && right.reported,
  );

/**
 * The price for a provider and model, most specific first.
 *
 * `PROVIDER:modelId` beats `PROVIDER`, and an absent entry returns null rather
 * than a zero price — because a zero price computes a zero cost, which is a
 * fabricated measurement for every provider except the deterministic one.
 */
export const resolvePrice = (
  prices: Readonly<Record<string, TokenPrice>>,
  providerId: GenerationProviderId,
  modelId: string,
): TokenPrice | null => prices[`${providerId}:${modelId}`] ?? prices[providerId] ?? null;

const format = (amount: number): string => amount.toFixed(COST_SCALE);

export const unobservableCost = (reason: string): CostAccount => ({
  observable: false,
  amount: null,
  unobservableReason: reason,
});

export const observableCost = (amount: string): CostAccount => ({
  observable: true,
  amount,
  unobservableReason: null,
});

export interface CostInput {
  readonly providerId: GenerationProviderId;
  readonly modelId: string;
  readonly executionMode: GenerationExecutionMode;
  /** `capabilities.reportsCost`. */
  readonly reportsCost: boolean;
  readonly tokens: TokenAccount;
  readonly prices: Readonly<Record<string, TokenPrice>>;
}

/**
 * What a run cost, or why that cannot be known.
 *
 * The four outcomes, in the order they are decided:
 *
 *   1. the deterministic provider  → exactly 0, and that is a FACT: it runs in
 *                                    process and there is no marginal cost to
 *                                    estimate
 *   2. a licence-based provider    → not observable at any granularity; a
 *                                    per-seat licence has no per-call price
 *   3. a user-managed run          → not observable; the spend lands on the
 *                                    author's account, which the platform
 *                                    cannot read
 *   4. no configured price         → not observable; a missing price is not a
 *                                    free provider
 */
export const computeCost = (input: CostInput): CostAccount => {
  if (input.providerId === 'DETERMINISTIC_LOCAL') {
    return observableCost(format(0));
  }

  if (!input.reportsCost) {
    return unobservableCost(
      'This provider is licence-based and reports no per-call cost, so there is no figure to record.',
    );
  }

  if (input.executionMode === 'USER_MANAGED') {
    return unobservableCost(
      "A user-managed run is billed to the author's own account, which the platform cannot read.",
    );
  }

  const price = resolvePrice(input.prices, input.providerId, input.modelId);
  if (price === null) {
    return unobservableCost(
      'No token price is configured for this provider and model, so no cost can be computed.',
    );
  }

  const amount =
    (input.tokens.inputTokens * price.inputPerMillion +
      input.tokens.outputTokens * price.outputPerMillion) /
    1_000_000;
  return observableCost(format(amount));
};

/**
 * Sum costs across runs, refusing to produce a misleading total.
 *
 * If ANY contributing run has no observable cost, the aggregate is not
 * observable either, and the reason says how many. Summing only the observable
 * part would present an undercount as a total, which is the arithmetic version
 * of fabrication: every number in it is real and the answer is wrong.
 */
export const aggregateCost = (accounts: readonly CostAccount[]): CostAccount => {
  if (accounts.length === 0) {
    return unobservableCost('Nothing has been recorded yet.');
  }

  const unobservable = accounts.filter((account) => !account.observable);
  if (unobservable.length > 0) {
    return unobservableCost(
      `${unobservable.length} of ${accounts.length} runs record no observable cost, so this total would be an undercount.`,
    );
  }

  const total = accounts.reduce((sum, account) => sum + Number(account.amount ?? 0), 0);
  return observableCost(format(total));
};
