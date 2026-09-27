// The control layer's orchestrator — architecture.md §9.0 rule 4.
//
// Every generation call in the platform goes through `invokeWithControls`,
// including the deterministic one. That is deliberate: a control applied only
// to the "real" providers is a control that has never run, and this whole layer
// was written to be proven against a provider that cannot send a request
// anywhere.
//
// The order of enforcement is the cheapest and most permanent check first:
//
//   1. provider state      a refusal that no amount of budget changes
//   2. per-job estimate     no database read needed
//   3. window budgets       day, then week, then month
//   4. concurrency          a count of RUNNING jobs
//   5. the call             with retries, each attempt recorded
//
// A refusal at any step raises `GenerationRefusedError`, and the caller records
// the job as REFUSED with the reason. Nothing is silently truncated: the
// platform does not quietly generate five questions because twenty would have
// breached a ceiling.

import {
  ProviderRefusedError,
  addTokens,
  computeCost,
  emptyTokenAccount,
  estimateInputTokens,
  tokenAccount,
  PROVIDER_CATALOGUE,
  type GenerateArgs,
  type GenerationProvider,
  type GeneratorRegistry,
  type ProviderGenerateResult,
} from '@knowzy/claude-services';
import type { DbClient } from '@knowzy/database';
import type { Clock } from '@knowzy/observability';
import type {
  BudgetWindow,
  CostAccount,
  ErrorCode,
  GenerationExecutionMode,
  GenerationProviderId,
  GenerationRefusalReason,
  TokenAccount,
  TokenPrice,
} from '@knowzy/shared-types';
import { checkPerJobBudget, checkWindowBudgets, type BudgetSettings } from './budget.js';
import { checkConcurrency, type ConcurrencySettings } from './concurrency.js';
import {
  decideRetry,
  isRetryable,
  outcomeForError,
  retryPolicyFor,
  type RetryPolicy,
} from './retry.js';

/**
 * A refusal by the control layer, carrying everything the caller must record.
 *
 * `limitName`, `limitValue` and `observedValue` travel with it because a
 * refusal without numbers is unactionable — an author told "budget exhausted"
 * with no figures cannot plan around it, and neither can an operator.
 */
export class GenerationRefusedError extends Error {
  override readonly name = 'GenerationRefusedError';
  constructor(
    readonly refusalReason: GenerationRefusalReason,
    readonly code: ErrorCode,
    readonly detail: string,
    readonly limitName: string | null = null,
    readonly limitValue: number | null = null,
    readonly observedValue: number | null = null,
    readonly budgetWindow: BudgetWindow | null = null,
  ) {
    super(detail);
  }
}

export interface ControlSettings extends BudgetSettings, ConcurrencySettings {
  readonly retry: RetryPolicy;
  readonly prices: Readonly<Record<string, TokenPrice>>;
}

export interface ControlContext {
  readonly jobId: string;
  readonly correlationId: string;
  readonly requestedByUserId: string | null;
  readonly onBehalfOfUserId: string | null;
  readonly executionMode: GenerationExecutionMode;
  readonly modelId: string;
  /** Characters of section text going into the prompt, for the estimate. */
  readonly promptCharacterCount: number;
}

/** Recorded per retry so a storm is reconstructable rather than inferred. */
export interface RetryObservation {
  readonly attempt: number;
  readonly errorClass: string;
  readonly delayMs: number;
}

export interface ControlledCallResult {
  readonly result: ProviderGenerateResult;
  readonly provider: GenerationProvider;
  readonly tokens: TokenAccount;
  readonly cost: CostAccount;
  readonly attemptCount: number;
  readonly retries: readonly RetryObservation[];
  /** The pre-call estimate the budgets were checked against (0014). */
  readonly estimatedInputTokens: number;
}

export interface InvokeArgs {
  readonly db: DbClient;
  readonly clock: Clock;
  readonly registry: GeneratorRegistry;
  readonly settings: ControlSettings;
  readonly context: ControlContext;
  readonly generateArgs: GenerateArgs;
  /** Explicit provider, else the registry's active one. */
  readonly providerId?: GenerationProviderId;
  /**
   * An already-constructed provider instance to call.
   *
   * Used by the legacy generator port and by tests that need to control the
   * output. It replaces the registry's INSTANTIATION only -- the state check
   * below still runs against its id, so an injected provider cannot smuggle
   * past an approval, a capability or a configuration block. Skipping that
   * check for injected providers would put a hole in the control layer whose
   * only user is the test suite, which is the worst possible owner for one.
   */
  readonly providerOverride?: GenerationProvider;
  /** Injected so backoff is assertable. Defaults to Math.random. */
  readonly random?: () => number;
  /** Injected so a test does not actually wait out a backoff. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Called once per retry, for the audit row. */
  readonly onRetry?: (observation: RetryObservation) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Record one attempt.
 *
 * Written OUTSIDE the caller's transaction on purpose: a failed attempt that
 * leads to a refusal must still be recorded, and a row written inside a
 * transaction the refusal rolls back would erase the evidence of the spend.
 */
const recordCall = async (args: {
  readonly db: DbClient;
  readonly context: ControlContext;
  readonly providerId: GenerationProviderId;
  readonly providerVersion: string | null;
  readonly attempt: number;
  readonly outcome: 'SUCCEEDED' | 'FAILED' | 'RATE_LIMITED' | 'REFUSED';
  readonly tokens: TokenAccount;
  readonly cost: CostAccount;
  readonly startedAt: Date;
  readonly completedAt: Date;
  readonly errorClass: string | null;
  readonly refusalReason: GenerationRefusalReason | null;
}): Promise<void> => {
  await args.db.generationProviderCall.create({
    data: {
      jobId: args.context.jobId,
      providerId: args.providerId,
      providerVersion: args.providerVersion,
      modelId: args.context.modelId,
      executionMode: args.context.executionMode,
      attempt: args.attempt,
      outcome: args.outcome,
      inputTokens: args.tokens.inputTokens,
      outputTokens: args.tokens.outputTokens,
      // 0014: the estimate beside the measurement, on every attempt.
      estimatedInputTokens: estimateInputTokens(args.context.promptCharacterCount),
      tokenUsageReported: args.tokens.reported,
      estimatedCost: args.cost.amount,
      costObservable: args.cost.observable,
      latencyMs: args.completedAt.getTime() - args.startedAt.getTime(),
      errorClass: args.errorClass,
      refusalReason: args.refusalReason,
      requestedByUserId: args.context.requestedByUserId,
      onBehalfOfUserId: args.context.onBehalfOfUserId,
      correlationId: args.context.correlationId,
      startedAt: args.startedAt,
      completedAt: args.completedAt,
    },
  });
};

/**
 * Resolve a provider and enforce every ceiling, then call it.
 *
 * Throws `GenerationRefusedError` for a control decision and rethrows anything
 * else unchanged — a provider that breaks is not a refusal, and flattening the
 * two would make "did the controls hold?" unanswerable.
 */
export const invokeWithControls = async (args: InvokeArgs): Promise<ControlledCallResult> => {
  const { db, clock, registry, settings, context } = args;
  const wanted = args.providerId ?? registry.activeProvider;
  // The retry policy in force for THIS provider: the platform default with a
  // per-provider attempt ceiling applied where one is configured.
  const retry = retryPolicyFor(settings.retry, settings.providerLimits?.[wanted]);
  const random = args.random ?? Math.random;
  const sleep = args.sleep ?? defaultSleep;

  // ---------------------------------------------------------------- 1. state
  let provider: GenerationProvider;
  try {
    const resolved = registry.forJob({
      providerId: wanted,
      executionMode: context.executionMode,
      modelId: context.modelId,
    });
    provider = args.providerOverride ?? resolved;
  } catch (error) {
    if (error instanceof ProviderRefusedError) {
      throw new GenerationRefusedError(error.refusalReason, error.code, error.detail);
    }
    throw error;
  }

  // ------------------------------------------------------------- 2. per job
  const estimatedTokens = estimateInputTokens(context.promptCharacterCount);
  const perJob = checkPerJobBudget(estimatedTokens, settings, wanted);
  if (perJob !== null) {
    throw new GenerationRefusedError(
      perJob.refusalReason,
      'BUDGET_EXCEEDED',
      perJob.detail,
      perJob.limitName,
      perJob.limitValue,
      perJob.observedValue,
      perJob.budgetWindow,
    );
  }

  // -------------------------------------------------------------- 3. windows
  const window = await checkWindowBudgets(db, estimatedTokens, settings, wanted, clock.now());
  if (window !== null) {
    throw new GenerationRefusedError(
      window.refusalReason,
      'BUDGET_EXCEEDED',
      window.detail,
      window.limitName,
      window.limitValue,
      window.observedValue,
      window.budgetWindow,
    );
  }

  // ---------------------------------------------------------- 4. concurrency
  const concurrency = await checkConcurrency(db, settings, wanted, context.jobId);
  if (concurrency !== null) {
    throw new GenerationRefusedError(
      'CONCURRENCY_LIMIT_REACHED',
      'GENERATION_CONCURRENCY_LIMIT',
      concurrency.detail,
      'llm.concurrency',
      concurrency.limitValue,
      concurrency.observedValue,
      null,
    );
  }

  // ---------------------------------------------------------------- 5. call
  const capabilities = PROVIDER_CATALOGUE[wanted];
  const retries: RetryObservation[] = [];
  let attempt = 0;

  while (true) {
    attempt += 1;
    const startedAt = clock.now();
    try {
      const result = await provider.generate(args.generateArgs, {
        mode: context.executionMode,
        onBehalfOfUserId: context.onBehalfOfUserId,
        correlationId: context.correlationId,
      });

      const tokens = tokenAccount(
        result.inputTokens,
        result.outputTokens,
        result.tokenUsageReported,
      );
      const cost = computeCost({
        providerId: result.providerId,
        modelId: result.modelId,
        executionMode: context.executionMode,
        reportsCost: capabilities.reportsCost,
        tokens,
        prices: settings.prices,
      });

      await recordCall({
        db,
        context,
        providerId: result.providerId,
        providerVersion: result.providerVersion,
        attempt,
        outcome: 'SUCCEEDED',
        tokens,
        cost,
        startedAt,
        completedAt: clock.now(),
        errorClass: null,
        refusalReason: null,
      });

      return {
        result,
        provider,
        // The successful attempt's tokens, plus nothing for the failed ones:
        // a failed call reports no usage the platform can trust, and its row
        // carries zeros rather than a guess. What the budget sees is the sum of
        // the rows, so an attempt that did report usage still counts.
        tokens: addTokens(emptyTokenAccount(tokens.reported), tokens),
        cost,
        attemptCount: attempt,
        retries,
        estimatedInputTokens: estimatedTokens,
      };
    } catch (error) {
      const decision = decideRetry(error, attempt, retry, random);
      await recordCall({
        db,
        context,
        providerId: wanted,
        providerVersion: null,
        attempt,
        outcome: outcomeForError(decision.errorClass),
        tokens: emptyTokenAccount(false),
        // A failed call still has a cost basis of "nothing observable": zero
        // would claim the failure was free, which is not knowable.
        cost: { observable: false, amount: null, unobservableReason: 'The call failed.' },
        startedAt,
        completedAt: clock.now(),
        errorClass: decision.errorClass,
        refusalReason: null,
      });

      if (!decision.retry) {
        // A RETRYABLE class that ran out of attempts is a REFUSAL: the platform
        // stopped trying. Anything else is the provider's own failure and is
        // rethrown untouched.
        //
        // The condition tests the CLASS, not just the attempt count. The first
        // version tested `attempt >= maxAttempts`, which with maxAttempts = 1
        // relabelled every 400 as RETRY_LIMIT_EXHAUSTED -- turning a provider
        // rejecting our request into "the platform gave up", and putting a
        // provider defect in the refusal metrics. Caught by the integration
        // test that asserts a client error is NOT a refusal.
        if (isRetryable(decision.errorClass) && attempt >= retry.maxAttempts) {
          throw new GenerationRefusedError(
            'RETRY_LIMIT_EXHAUSTED',
            'PROVIDER_RETRY_EXHAUSTED',
            decision.reason,
            // The limit NAME follows the limit that actually bound: naming the
            // platform key when a per-provider override was what stopped the
            // run would send an administrator to change the wrong setting.
            settings.providerLimits?.[wanted]?.maxAttempts === undefined
              ? 'llm.maxAttempts'
              : `llm.providerLimits.${wanted}.maxAttempts`,
            retry.maxAttempts,
            attempt,
            null,
          );
        }
        throw error;
      }

      retries.push({ attempt, errorClass: decision.errorClass, delayMs: decision.delayMs });
      await args.onRetry?.({
        attempt,
        errorClass: decision.errorClass,
        delayMs: decision.delayMs,
      });
      await sleep(decision.delayMs);
    }
  }
};
