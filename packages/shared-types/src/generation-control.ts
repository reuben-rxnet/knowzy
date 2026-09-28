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
import { KEY_VAULT_REFERENCE, LOCAL_STORE_REFERENCE, type SecretSource } from './secrets.js';
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
  /**
   * Available in every permanent sense, and out of budget right now.
   *
   * THE ONLY STATE THE REGISTRY DOES NOT ASSIGN. The other five are properties
   * of the build and the configuration -- a capability, an approval, a
   * registration, a credential -- and the registry can decide them with no
   * database at all, which is what keeps `@knowzy/claude-services` free of one
   * (B4). Budget consumption is a query over `generation_provider_call`, so
   * this state is applied by the usage read model AFTER the registry has
   * spoken, and only to a provider the registry already called AVAILABLE.
   *
   * It is a sixth state rather than a flag beside the state because it is what
   * a reader of the providers table needs in the same glance: "why can I not
   * generate" has one answer, and splitting it across two columns is how the
   * budget half gets missed. It is deliberately NOT persisted -- a stored
   * OVER_BUDGET would be stale the moment a window rolled over.
   */
  'OVER_BUDGET',
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
  /**
   * Attempts per call, including the first.
   *
   * Per provider because retry economics are not uniform: a provider that
   * bills per attempt and rate-limits aggressively wants fewer attempts than
   * one that does neither, and `llm.maxAttempts` alone forces one answer on
   * all of them. The platform-wide key remains the default.
   */
  maxAttempts: z.number().int().min(1).max(10).optional(),
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
/**
 * A SECRET REFERENCE, never a secret.
 *
 * Two forms since P-5 (2026-09-27): `keyvault://{vault}/secrets/{name}` for
 * Azure Key Vault, and `localstore://{name}` for the local secure store (the
 * local environment only -- the resolver refuses it elsewhere). Validated here
 * as well as in `env.ts` so a reference typed into a screen cannot be a key
 * pasted into the wrong box: an `sk-`-style literal, anything with whitespace
 * and anything long enough to be a token all fail both patterns. A secret that
 * reaches `application_configuration` is a secret in a database backup, a
 * diagnostic export and an audit row.
 */
export const SecretReferenceSchema = z
  .string()
  .refine(
    (value) => LOCAL_STORE_REFERENCE.test(value) || KEY_VAULT_REFERENCE.test(value),
    'must be a localstore://{name} or keyvault://{vault}/secrets/{name} reference, never a secret value',
  );

/**
 * What an administrator may configure about one provider.
 *
 * Every field is optional, and an absent field means "the platform default" --
 * so a provider with no entry behaves exactly as it did before this existed.
 * The ceilings live in `ProviderLimits` rather than here, because a budget is
 * enforced on every provider including the deterministic one while these are
 * the settings of a provider that makes a network call.
 */
// ---------------------------------------------------------------------------
// Request authentication and fixed headers — GATEWAY-M1 (2026-09-28)
// ---------------------------------------------------------------------------
//
// An Azure API Management gateway in front of Azure OpenAI takes its
// subscription key as a QUERY PARAMETER (`subscription-key`) and wants a fixed,
// non-secret routing header (`x-openai-supplier`). Both are provider settings
// rather than code, so a gateway is configuration. The rules below are the
// ones that keep that configuration from becoming a place to put a secret.

/** Where the resolved credential travels. There is no fallback between them. */
export const PROVIDER_AUTH_LOCATIONS = ['HEADER', 'QUERY_PARAMETER'] as const;
export type ProviderAuthLocation = (typeof PROVIDER_AUTH_LOCATIONS)[number];

/**
 * Query parameters that carry a credential, matched EXACTLY and
 * case-insensitively. `sanitizeUrl` replaces their values before any URL is
 * put in a diagnostic; everything else in a query string is left alone, so a
 * harmless parameter is never redacted into uselessness.
 */
export const CREDENTIAL_QUERY_PARAMETERS = [
  'subscription-key',
  'api-key',
  'apikey',
  'key',
  'token',
  'access_token',
  'sig',
  'client_secret',
  'password',
] as const;

export const isCredentialQueryParameter = (name: string): boolean =>
  (CREDENTIAL_QUERY_PARAMETERS as readonly string[]).includes(name.trim().toLowerCase());

/** At most this many fixed headers per provider. Small and explicit. */
export const MAX_EXTRA_HEADERS = 5;

/** Headers the HTTP client owns. Setting one would corrupt the request. */
export const PROTOCOL_HEADERS = [
  'host',
  'content-length',
  'content-type',
  'connection',
  'transfer-encoding',
  'keep-alive',
  'upgrade',
  'te',
  'trailer',
  'accept',
  'expect',
] as const;

/** Header names that are, or look like, a credential. Refused outright. */
const CREDENTIAL_HEADERS_EXACT = ['authorization', 'cookie', 'set-cookie', 'proxy-authorization'];
const CREDENTIAL_HEADER_FRAGMENTS = [
  'api-key',
  'apikey',
  'subscription-key',
  'token',
  'secret',
  'credential',
  'password',
];

const HEADER_NAME = /^[a-z][a-z0-9-]{0,63}$/;
/** Printable ASCII, no leading or trailing space, at most 256 characters. */
const HEADER_VALUE = /^[\x21-\x7e](?:[\x20-\x7e]{0,254}[\x21-\x7e])?$/;

/** Why a fixed header is refused, or null when it is acceptable. */
export const extraHeaderProblem = (rawName: string, value: string): string | null => {
  const name = rawName.trim().toLowerCase();
  if (name === '') return 'a header name is required';
  if (!HEADER_NAME.test(name)) return `${rawName} is not a valid header name`;
  if ((PROTOCOL_HEADERS as readonly string[]).includes(name)) {
    return `${name} is controlled by the HTTP client and cannot be set`;
  }
  if (
    CREDENTIAL_HEADERS_EXACT.includes(name) ||
    CREDENTIAL_HEADER_FRAGMENTS.some((fragment) => name.includes(fragment))
  ) {
    return `${name} looks like a credential. A fixed header is ordinary configuration and may not carry a secret; a credential goes in the credential reference`;
  }
  if (value === '') return `${name} needs a value`;
  if (!HEADER_VALUE.test(value)) {
    return `the value of ${name} must be printable text without leading or trailing spaces, at most 256 characters`;
  }
  return null;
};

export const ProviderSettingsSchema = z
  .object({
    /**
     * The administrator's intent. Absent means "not decided", which is treated
     * as disabled for every provider except the deterministic one -- a provider
     * nobody has enabled must not start billing because a credential appeared.
     */
    enabled: z.boolean().optional(),
    /** A label for the screens. It never changes which client is used. */
    displayName: z.string().min(1).max(120).optional(),
    baseUrl: z.string().url().optional(),
    modelId: z.string().min(1).max(200).optional(),
    apiKeyRef: SecretReferenceSchema.optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxOutputTokens: z.number().int().min(1).max(200_000).optional(),
    /**
     * OPENAI-CODEX-01: which OpenAI-compatible API the endpoint serves.
     * RESPONSES (`/responses`, OpenAI's current API and the only one Codex
     * models are served on) or CHAT_COMPLETIONS (`/chat/completions`, what most
     * gateways pass through). Absent means RESPONSES.
     */
    apiStyle: z.enum(['RESPONSES', 'CHAT_COMPLETIONS']).optional(),
    /**
     * The header the key travels in. `authorization` (the default) sends
     * `Bearer <key>`; any other name -- `api-key`, `Ocp-Apim-Subscription-Key` --
     * carries the key as its value, for a gateway in front of the model.
     */
    authHeaderName: z
      .string()
      .regex(/^[A-Za-z][A-Za-z0-9-]{1,63}$/, 'a header name: letters, digits and hyphens')
      .optional(),
    /**
     * GATEWAY-M1: where the credential travels. Absent means HEADER. There is
     * no fallback: a QUERY_PARAMETER provider never sends the key in a header,
     * and a HEADER provider never puts it in a URL.
     */
    authLocation: z.enum(PROVIDER_AUTH_LOCATIONS).optional(),
    /** The query parameter the credential travels in, for QUERY_PARAMETER. */
    authQueryParameterName: z
      .string()
      .regex(/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/, 'a parameter name: letters, digits, _ . -')
      .optional(),
    /**
     * Fixed, NON-SECRET headers sent on every request to this provider, e.g.
     * a gateway's routing header. Ordinary configuration: they appear in the
     * configuration history and the audit trail, which is exactly why a
     * credential-shaped name is refused.
     */
    extraHeaders: z.record(z.string(), z.string()).optional(),
  })
  .strict()
  .superRefine((settings, context) => {
    const issue = (path: (string | number)[], message: string) =>
      context.addIssue({ code: z.ZodIssueCode.custom, path, message });
    const location = settings.authLocation ?? 'HEADER';

    if (location === 'QUERY_PARAMETER') {
      if (settings.authQueryParameterName === undefined) {
        issue(
          ['authQueryParameterName'],
          'query-parameter authentication needs the parameter name',
        );
      }
      if (settings.authHeaderName !== undefined) {
        issue(
          ['authHeaderName'],
          'the credential travels in a query parameter, so an auth header name would be a second, unused authentication setting',
        );
      }
    } else if (settings.authQueryParameterName !== undefined) {
      issue(
        ['authQueryParameterName'],
        'the credential travels in a header, so a query-parameter name would be a second, unused authentication setting',
      );
    }

    const headers = Object.entries(settings.extraHeaders ?? {});
    if (headers.length > MAX_EXTRA_HEADERS) {
      issue(['extraHeaders'], `at most ${MAX_EXTRA_HEADERS} fixed headers`);
    }
    const seen = new Set<string>();
    const authHeader =
      location === 'HEADER' ? (settings.authHeaderName ?? 'authorization').toLowerCase() : null;
    for (const [name, value] of headers) {
      const normalized = name.trim().toLowerCase();
      const problem = extraHeaderProblem(name, value);
      if (problem !== null) issue(['extraHeaders', name], problem);
      if (seen.has(normalized)) issue(['extraHeaders', name], `${normalized} is configured twice`);
      if (authHeader !== null && normalized === authHeader) {
        issue(
          ['extraHeaders', name],
          `${normalized} is the authentication header and cannot also be a fixed header`,
        );
      }
      seen.add(normalized);
    }
  });
export type ProviderSettings = z.infer<typeof ProviderSettingsSchema>;

// ---------------------------------------------------------------------------
// Provider validation — "Test connection", and what it may honestly claim
// ---------------------------------------------------------------------------

/**
 * The chain a provider must satisfy, in the order the platform checks it.
 *
 * The order IS the policy, and it is the registry's order extended at both
 * ends: capability, approval, implementation, credential, then the live call.
 * Most permanent first, so the reported failure is the one worth acting on --
 * telling somebody to fetch a credential for a provider that can never ground
 * a question would send them to do futile work.
 *
 * LIVE_CALL is in the list and is currently never attempted. That is the whole
 * reason it is named: a validation that stopped at CREDENTIAL and reported
 * "passed" would read as "authentication successful", which no check in this
 * build has established. It reports NOT_ATTEMPTED with the reason instead.
 */
export const PROVIDER_VALIDATION_CHECKS = [
  'CAPABILITY',
  'APPROVAL',
  'IMPLEMENTATION',
  // P-5 and OPENAI-CODEX-00 (2026-09-27): the chain a real readiness check
  // runs. CONFIGURATION is the settings; SECRET_RESOLUTION reads the reference;
  // ENDPOINT, AUTHENTICATION and MODEL are live, metadata-only calls; and
  // GENERATION is named so that "this provider cannot generate in this build"
  // is a recorded result rather than an omission.
  'CONFIGURATION',
  'SECRET_RESOLUTION',
  'ENDPOINT',
  'AUTHENTICATION',
  'MODEL',
  // GATEWAY-M1: named so "the model was never asked to run" is a recorded
  // result. A test connection sends no prompt, so this is always NOT_ATTEMPTED
  // for a network provider.
  'MODEL_EXECUTION',
  'GENERATION',
  // Before P-5. Kept so validation rows recorded then still parse and render;
  // no validation writes them any more.
  'CREDENTIAL',
  'LIVE_CALL',
] as const;
export const ProviderValidationCheckSchema = z.enum(PROVIDER_VALIDATION_CHECKS);
export type ProviderValidationCheck = z.infer<typeof ProviderValidationCheckSchema>;

/**
 * SKIPPED (GATEWAY-M1) is a check the endpoint does not support -- a gateway
 * that exposes no `/models` route. It is not a pass and not a failure, and it
 * makes the outcome INCOMPLETE, never PASSED.
 */
export const VALIDATION_CHECK_RESULTS = ['PASSED', 'FAILED', 'NOT_ATTEMPTED', 'SKIPPED'] as const;
export const ValidationCheckResultSchema = z.enum(VALIDATION_CHECK_RESULTS);
export type ValidationCheckResult = z.infer<typeof ValidationCheckResultSchema>;

/**
 * Whether the provider as a whole is usable.
 *
 * `INCOMPLETE` rather than `PASSED` when every attempted check passed but the
 * live call was not attempted. There is no outcome that means "probably fine".
 */
export const PROVIDER_VALIDATION_OUTCOMES = ['PASSED', 'FAILED', 'INCOMPLETE'] as const;
export const ProviderValidationOutcomeSchema = z.enum(PROVIDER_VALIDATION_OUTCOMES);
export type ProviderValidationOutcome = z.infer<typeof ProviderValidationOutcomeSchema>;

export interface ProviderValidationStep {
  readonly check: ProviderValidationCheck;
  readonly result: ValidationCheckResult;
  /** Always present, including on a pass. "Why did this pass" is a fair question. */
  readonly detail: string;
  /**
   * Facts the check OBSERVED, never ones it assumed: an HTTP status, a
   * round-trip time, a rate limit the provider reported in its headers.
   * Absent when nothing was observed. Never a secret.
   */
  readonly facts?: Readonly<Record<string, string | number | boolean>>;
}

// ---------------------------------------------------------------------------
// Provider readiness — how far along the path to "usable" a provider is
// ---------------------------------------------------------------------------

/**
 * Readiness, which is a different question from `ProviderState`.
 *
 * `ProviderState` is the GATE: whether a generation request would be refused
 * right now and why, persisted on every validation row. Readiness is the
 * LADDER an administrator climbs to get there, derived from the settings and
 * the latest recorded validation:
 *
 *   BLOCKED_BY_CONFIGURATION  settings incomplete, disabled, or the reference
 *                             does not resolve
 *   CONFIGURED                complete, not yet (or not since) validated
 *   RESOLVED                  the secret was read; authentication unverified
 *   AUTHENTICATED             the provider accepted the key
 *   BLOCKED_BY_APPROVAL       technically ready; no data-processing approval
 *   AVAILABLE                 every check passed and it may generate
 *   UNAVAILABLE               no client, cannot ground, cannot generate in
 *                             this build, or the endpoint is unreachable
 *
 * Never persisted: a readiness stored beside a validation would be stale the
 * moment the settings changed.
 */
export const PROVIDER_READINESS_STATES = [
  'CONFIGURED',
  'RESOLVED',
  'AUTHENTICATED',
  'AVAILABLE',
  'UNAVAILABLE',
  'BLOCKED_BY_APPROVAL',
  'BLOCKED_BY_CONFIGURATION',
] as const;
export type ProviderReadinessState = (typeof PROVIDER_READINESS_STATES)[number];

export interface ProviderReadiness {
  readonly state: ProviderReadinessState;
  /** One sentence naming what would move it up the ladder. */
  readonly reason: string;
  /** The validation it was derived from, or null when none applies. */
  readonly validatedAt: string | null;
}

/**
 * What a provider DECLARES it can do, in the names the administration screen
 * uses. Every provider declares all five explicitly; none is inferred.
 */
export interface DeclaredCapabilities {
  /** Whether THIS BUILD can generate with it. False for a readiness-only client. */
  readonly supportsGeneration: boolean;
  readonly supportsCostReporting: boolean;
  readonly supportsTokenReporting: boolean;
  readonly supportsStreaming: boolean;
  readonly retrievalFree: boolean;
}

export interface ProviderValidationReport {
  readonly providerId: string;
  readonly outcome: ProviderValidationOutcome;
  readonly state: ProviderState;
  readonly steps: readonly ProviderValidationStep[];
  readonly validatedAt: string;
  readonly validatedByDisplayName: string | null;
}

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

/**
 * One row of Administration -> AI Providers.
 *
 * It carries the assessment, the settings an administrator typed, and the
 * LAST VALIDATION as recorded -- not a fresh one. A row that re-validated on
 * every page load would make a read of the screen indistinguishable from a
 * deliberate test, and in a build with a live client it would make opening a
 * page cost money.
 */
export interface ProviderAdminRow {
  readonly providerId: string;
  readonly displayName: string;
  readonly state: ProviderState;
  readonly stateReason: string;
  readonly enabled: boolean;
  readonly registered: boolean;
  readonly approved: boolean;
  readonly groundingSafe: boolean;
  readonly supportedExecutionModes: readonly string[];
  readonly providerVersion: string | null;
  /** Whether a REFERENCE is recorded. */
  readonly credentialConfigured: boolean;
  /**
   * The reference itself, which names a secret and is not one (P-5). Shown so
   * an administrator can see WHICH secret a provider will read. The secret's
   * value never leaves the API process, and audit and change rows still carry
   * only a fingerprint of the reference.
   */
  readonly credentialReference: string | null;
  readonly credentialSource: SecretSource | null;
  readonly capabilities: DeclaredCapabilities;
  readonly readiness: ProviderReadiness;
  /**
   * When `llm.providerSettings` was last written -- the whole value, not this
   * provider's credential.
   *
   * Named for what it is. A `credentialUpdatedAt` would be a fabricated fact:
   * nothing records when an individual reference changed, and a rotation date
   * inferred from a shared row would be wrong the first time two providers
   * were configured in the same week.
   */
  readonly settingsUpdatedAt: string | null;
  readonly baseUrl: string | null;
  readonly modelId: string | null;
  readonly temperature: number | null;
  readonly maxOutputTokens: number | null;
  /** OPENAI-CODEX-01. Null means the default: RESPONSES, `authorization`. */
  readonly apiStyle: 'RESPONSES' | 'CHAT_COMPLETIONS' | null;
  readonly authHeaderName: string | null;
  /** GATEWAY-M1. HEADER unless configured otherwise. */
  readonly authLocation: 'HEADER' | 'QUERY_PARAMETER';
  readonly authQueryParameterName: string | null;
  /** Fixed, non-secret headers. Shown as configured, because they are not secrets. */
  readonly extraHeaders: Readonly<Record<string, string>>;
  readonly limits: ProviderLimits;
  readonly health: ProviderHealthState;
  readonly healthReason: string;
  readonly lastValidation: ProviderValidationReport | null;
}

export interface ProviderAdministration {
  readonly asOf: string;
  readonly activeProvider: string;
  readonly providers: readonly ProviderAdminRow[];
  /** The platform-wide defaults an empty per-provider field falls back to. */
  readonly defaults: {
    readonly perJobTokenBudget: number;
    readonly dailyTokenBudget: number;
    readonly weeklyTokenBudget: number;
    readonly monthlyTokenBudget: number;
    readonly concurrency: number;
    readonly maxAttempts: number;
  };
  readonly canManage: boolean;
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
    /**
     * Spend over the window, as a fixed-point string, or NOT observable.
     *
     * A `CostAccount` rather than a `RecordedNumber` because there are three
     * answers here, not two: a measured figure, "nothing has been recorded",
     * and "a contributor's cost cannot be observed at all" -- a per-seat
     * licence or a user-managed run. `aggregateCost` refuses a total that
     * would present an undercount as the whole, and the KPI says so rather
     * than showing the observable part as if it were everything.
     */
    readonly estimatedCost: CostAccount;
    /** The ceiling for the current daily window. Configuration, always known. */
    readonly dailyBudget: RecordedNumber;
    readonly remainingDailyBudget: RecordedNumber;
    readonly budgetUtilizationPercent: RecordedNumber;
    readonly activeAuthors: RecordedNumber;
  };
  readonly activeProvider: z.infer<typeof GenerationProviderSchema>;
  readonly providers: readonly ProviderStateAssessment[];
  readonly providerUsage: readonly ProviderUsage[];
  readonly budgets: readonly BudgetWindowStatus[];
  /**
   * Concurrency, as it is actually enforced.
   *
   * `active` counts generation jobs in RUNNING for the active provider, which
   * is exactly what `checkConcurrency` counts when it refuses one. Reported so
   * an administrator can see a cap being approached instead of learning about
   * it from a refusal.
   *
   * THERE IS NO QUEUE. A job over the cap is REFUSED with
   * `CONCURRENCY_LIMIT_REACHED`, not parked -- generation runs inside the
   * request that asked for it. A "queued" figure would therefore be zero
   * forever, which is why this object does not have one.
   */
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
  readonly history: readonly GenerationHistoryRow[];
  readonly limits: {
    readonly perJobTokenBudget: number;
    readonly concurrency: number;
    readonly maxAttempts: number;
  };
}
