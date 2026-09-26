// Configuration key catalogue — environment-and-configuration.md §3.2 P1.
//
// Every key is declared once, with its type, default, permitted layers, and a
// one-line description. An undeclared key cannot be read (P1), and a value out
// of range falls back to the code default AND raises a platform finding rather
// than crashing a request or silently using a nonsense value (P2).
//
// P4: no default points at a real tenant, site, list, or credential. Defaults
// are safe-and-inert.

import { z } from 'zod';
import {
  GenerationProviderSchema,
  ProviderLimitsSchema,
  ProviderSettingsSchema,
  TokenPriceSchema,
  type ConfigurationScope,
  type GenerationProviderId,
  type ProviderLimits,
  type ProviderSettings,
  type TokenPrice,
} from '@knowzy/shared-types';

/** The layers of environment-and-configuration.md §3, highest precedence first. */
export const CONFIG_LAYERS = [
  'ASSESSMENT',
  'PROFILE_OR_SOURCE',
  'DOMAIN',
  'PLATFORM',
  'ENVIRONMENT',
  'CODE_DEFAULT',
] as const;
export type ConfigLayer = (typeof CONFIG_LAYERS)[number];

export interface ConfigDeclaration<T> {
  /** Dotted key, stable forever. */
  readonly key: string;
  readonly description: string;
  readonly schema: z.ZodType<T>;
  readonly defaultValue: T;
  /** Layers at which this key may be set. A row at any other layer is ignored. */
  readonly layers: readonly ConfigLayer[];
  /** Scope values that may carry an override for this key. */
  readonly scopes: readonly ConfigurationScope[];
}

const decl = <T>(d: ConfigDeclaration<T>): ConfigDeclaration<T> => d;

const PLATFORM_ONLY: readonly ConfigLayer[] = ['PLATFORM', 'CODE_DEFAULT'];
const PLATFORM_OR_PROFILE: readonly ConfigLayer[] = [
  'PROFILE_OR_SOURCE',
  'PLATFORM',
  'CODE_DEFAULT',
];
const DOWN_TO_ASSESSMENT: readonly ConfigLayer[] = [
  'ASSESSMENT',
  'PROFILE_OR_SOURCE',
  'DOMAIN',
  'PLATFORM',
  'CODE_DEFAULT',
];

const proportion = z.number().min(0).max(1);
const percentage = z.number().min(0).max(100);
const positiveInt = z.number().int().positive();

/**
 * The catalogue. Generation and coverage defaults are transcribed from
 * generation-governance.md §13; proficiency and gap defaults from
 * live-learning-portal.md §5; privacy and retention from data-model.md §14 and
 * reporting.md §7.
 */
export const CONFIG_KEYS = {
  // ------------------------------------------------- source administration
  /**
   * Directories a FILE_REPOSITORY source may be pointed at.
   *
   * PLATFORM_ONLY and empty by default, which is the whole point: registering
   * a source names a path the service will read, so the set of legal paths is
   * deployment configuration rather than something a form may widen. An empty
   * list means no local source can be registered at all.
   */
  'sources.allowedLocalRoots': decl({
    key: 'sources.allowedLocalRoots',
    description:
      'Absolute directories a file-repository source may read. Empty means none, which is the safe default.',
    schema: z.array(z.string().min(1)).max(20),
    defaultValue: [],
    layers: PLATFORM_ONLY,
    scopes: ['PLATFORM'],
  }),
  /**
   * How often the scheduler looks for due synchronizations.
   *
   * The tick is not the schedule: a DAILY source runs once a day whatever this
   * is. It bounds how late a due run can start, and 5 minutes keeps that
   * visible without making the queue busy.
   */
  'sources.schedulerTickMinutes': decl({
    key: 'sources.schedulerTickMinutes',
    description:
      'How often the scheduler checks for due synchronizations. Bounds lateness, not frequency.',
    schema: z.number().int().min(1).max(60),
    defaultValue: 5,
    layers: PLATFORM_ONLY,
    scopes: ['PLATFORM'],
  }),
  /** Attempts a scheduled synchronization gets before it is left exhausted. */
  'sources.scheduledSyncMaxAttempts': decl({
    key: 'sources.scheduledSyncMaxAttempts',
    description:
      'Attempts for a scheduled synchronization before the job is exhausted and left for an operator.',
    schema: z.number().int().min(1).max(10),
    defaultValue: 3,
    layers: PLATFORM_ONLY,
    scopes: ['PLATFORM'],
  }),

  // ---------------------------------------------------------- generation
  'generation.maxDocumentsPerJob': decl({
    key: 'generation.maxDocumentsPerJob',
    description: 'Upper bound on documents in one generation job. Caps unreviewable batches.',
    schema: z.number().int().min(1).max(10),
    defaultValue: 10,
    layers: PLATFORM_ONLY,
    scopes: ['PLATFORM'],
  }),
  'generation.maxQuestionsPerJob': decl({
    key: 'generation.maxQuestionsPerJob',
    description: 'Upper bound on requested questions in one generation job.',
    schema: z.number().int().min(1).max(50),
    defaultValue: 50,
    layers: PLATFORM_OR_PROFILE,
    scopes: ['PLATFORM', 'PROFILE'],
  }),
  'generation.requireObjectives': decl({
    key: 'generation.requireObjectives',
    description:
      'Require objective-driven generation. Recommended true once the objective catalogue is populated.',
    schema: z.boolean(),
    defaultValue: false,
    layers: PLATFORM_ONLY,
    scopes: ['PLATFORM'],
  }),
  'generation.allowCoveredSectionFill': decl({
    key: 'generation.allowCoveredSectionFill',
    description: 'Permit fully covered sections as generation filler. Off: they are never filler.',
    schema: z.boolean(),
    defaultValue: false,
    layers: PLATFORM_OR_PROFILE,
    scopes: ['PLATFORM', 'PROFILE'],
  }),
  'generation.preflightTtlMinutes': decl({
    key: 'generation.preflightTtlMinutes',
    description: 'Lifetime of a preflight decision. An expired preflight cannot authorize a job.',
    schema: z.number().int().min(5).max(240),
    defaultValue: 60,
    layers: PLATFORM_ONLY,
    scopes: ['PLATFORM'],
  }),

  // ------------------------------------------------------------ coverage
  'coverage.charsPerQuestion': decl({
    key: 'coverage.charsPerQuestion',
    description: 'Assessable characters per target question when computing section capacity.',
    schema: positiveInt,
    defaultValue: 1200,
    layers: PLATFORM_OR_PROFILE,
    scopes: ['PLATFORM', 'PROFILE'],
  }),
  'coverage.minPerSection': decl({
    key: 'coverage.minPerSection',
    description: 'Lower clamp on a section target question count.',
    schema: positiveInt,
    defaultValue: 1,
    layers: PLATFORM_OR_PROFILE,
    scopes: ['PLATFORM', 'PROFILE'],
  }),
  'coverage.maxPerSection': decl({
    key: 'coverage.maxPerSection',
    description: 'Upper clamp on a section target question count.',
    schema: positiveInt,
    defaultValue: 5,
    layers: PLATFORM_OR_PROFILE,
    scopes: ['PLATFORM', 'PROFILE'],
  }),
  'coverage.minAssessableChars': decl({
    key: 'coverage.minAssessableChars',
    description: 'Sections below this are NON_ASSESSABLE and leave the coverage denominator.',
    schema: positiveInt,
    defaultValue: 300,
    layers: PLATFORM_OR_PROFILE,
    scopes: ['PLATFORM', 'PROFILE'],
  }),

  // ----------------------------------------------------------- duplicate
  'duplicate.flagThreshold': decl({
    key: 'duplicate.flagThreshold',
    description: 'Composite score at or above which a draft is flagged for reviewer disposition.',
    schema: proportion,
    defaultValue: 0.75,
    layers: PLATFORM_OR_PROFILE,
    scopes: ['PLATFORM', 'PROFILE'],
  }),
  'duplicate.blockThreshold': decl({
    key: 'duplicate.blockThreshold',
    description: 'Composite score at or above which a draft is not persisted at all.',
    schema: proportion,
    defaultValue: 0.92,
    layers: PLATFORM_OR_PROFILE,
    scopes: ['PLATFORM', 'PROFILE'],
  }),
  'duplicate.suppressionStemLimit': decl({
    key: 'duplicate.suppressionStemLimit',
    description: 'Maximum do-not-duplicate stems supplied to the model.',
    schema: z.number().int().min(0).max(500),
    defaultValue: 100,
    layers: PLATFORM_OR_PROFILE,
    scopes: ['PLATFORM', 'PROFILE'],
  }),
  'duplicate.claudeAdjudication.enabled': decl({
    key: 'duplicate.claudeAdjudication.enabled',
    description: 'Advisory model verdict for flag-band pairs. Never auto-decides.',
    schema: z.boolean(),
    defaultValue: true,
    layers: PLATFORM_ONLY,
    scopes: ['PLATFORM'],
  }),

  // ----------------------------------------------------------- objective
  'objective.defaultTargets': decl({
    key: 'objective.defaultTargets',
    description: 'Default target question count per cognitive level.',
    schema: z.object({ RECALL: positiveInt, APPLICATION: positiveInt, ANALYSIS: positiveInt }),
    defaultValue: { RECALL: 3, APPLICATION: 4, ANALYSIS: 5 },
    layers: PLATFORM_ONLY,
    scopes: ['PLATFORM'],
  }),

  // --------------------------------------------------------------- reuse
  'reuse.reviewMinutesPerQuestion': decl({
    key: 'reuse.reviewMinutesPerQuestion',
    description:
      'Constant behind the estimated duplicate-prevention savings. Always displayed with the figure.',
    schema: z.number().positive(),
    defaultValue: 4,
    layers: PLATFORM_ONLY,
    scopes: ['PLATFORM'],
  }),

  // --------------------------------------------------------- proficiency
  'proficiency.thresholds': decl({
    key: 'proficiency.thresholds',
    description:
      'Default bands. Must be contiguous, non-overlapping, and cover 0–100 exactly; copied onto every result.',
    schema: z.array(
      z.object({
        band: z.string(),
        minInclusive: percentage,
        maxExclusive: z.number().min(0).max(100.01),
      }),
    ),
    defaultValue: [
      { band: 'CRITICAL_KNOWLEDGE_GAP', minInclusive: 0, maxExclusive: 40 },
      { band: 'NEEDS_IMPROVEMENT', minInclusive: 40, maxExclusive: 60 },
      { band: 'DEVELOPING', minInclusive: 60, maxExclusive: 75 },
      { band: 'PROFICIENT', minInclusive: 75, maxExclusive: 90 },
      { band: 'EXPERT', minInclusive: 90, maxExclusive: 100.01 },
    ],
    layers: DOWN_TO_ASSESSMENT,
    scopes: ['PLATFORM', 'DOMAIN', 'ASSESSMENT'],
  }),
  'proficiency.gapThreshold': decl({
    key: 'proficiency.gapThreshold',
    description: 'Topic accuracy below which a topic is a knowledge gap.',
    schema: percentage,
    defaultValue: 60.0,
    layers: DOWN_TO_ASSESSMENT,
    scopes: ['PLATFORM', 'DOMAIN', 'ASSESSMENT'],
  }),
  'proficiency.minTopicQuestions': decl({
    key: 'proficiency.minTopicQuestions',
    description:
      'Minimum questions before a topic can be reported as a gap. Below this it is INSUFFICIENT_EVIDENCE.',
    schema: z.number().int().min(1),
    defaultValue: 2,
    layers: DOWN_TO_ASSESSMENT,
    scopes: ['PLATFORM', 'DOMAIN', 'ASSESSMENT'],
  }),
  'proficiency.maxRecommendations': decl({
    key: 'proficiency.maxRecommendations',
    description: 'Maximum knowledge refreshers produced per result.',
    schema: z.number().int().min(1).max(20),
    defaultValue: 5,
    layers: PLATFORM_ONLY,
    scopes: ['PLATFORM'],
  }),

  // ------------------------------------------------------- session rules
  'session.idleExpiryHours': decl({
    key: 'session.idleExpiryHours',
    description: 'Idle window before an untimed session expires.',
    schema: z.number().int().min(1).max(168),
    defaultValue: 24,
    layers: PLATFORM_ONLY,
    scopes: ['PLATFORM'],
  }),
  'session.expiryGraceSeconds': decl({
    key: 'session.expiryGraceSeconds',
    description: 'Grace period absorbing network latency on a final submission.',
    schema: z.number().int().min(0).max(120),
    defaultValue: 10,
    layers: PLATFORM_ONLY,
    scopes: ['PLATFORM'],
  }),

  // ------------------------------------------------ separation of duties
  'approval.authorMayApproveOwn': decl({
    key: 'approval.authorMayApproveOwn',
    description: 'Whether an author may approve a question they authored.',
    schema: z.boolean(),
    defaultValue: false,
    layers: ['DOMAIN', 'PLATFORM', 'CODE_DEFAULT'],
    scopes: ['PLATFORM', 'DOMAIN'],
  }),
  'approval.editorMayApproveOwn': decl({
    key: 'approval.editorMayApproveOwn',
    description: 'Whether the last editor of the current version may approve it.',
    schema: z.boolean(),
    defaultValue: false,
    layers: ['DOMAIN', 'PLATFORM', 'CODE_DEFAULT'],
    scopes: ['PLATFORM', 'DOMAIN'],
  }),
  'approval.approverMayPublishOwn': decl({
    key: 'approval.approverMayPublishOwn',
    description: 'Whether an approver may publish their own approval.',
    schema: z.boolean(),
    defaultValue: true,
    layers: ['DOMAIN', 'PLATFORM', 'CODE_DEFAULT'],
    scopes: ['PLATFORM', 'DOMAIN'],
  }),
  'approval.smeMayApprove': decl({
    key: 'approval.smeMayApprove',
    description: 'Whether SMEs holding question.approve may approve.',
    schema: z.boolean(),
    defaultValue: true,
    layers: ['DOMAIN', 'PLATFORM', 'CODE_DEFAULT'],
    scopes: ['PLATFORM', 'DOMAIN'],
  }),
  // Gate 2 of authoring-portal.md §5.7 says "below the CONFIGURED minimum
  // length", and gate 9 says "any CONFIGURED required metadata field" — so both
  // need a declaration. Without them the gates would carry hardcoded numbers
  // that no administrator could change, which architecture.md §4 forbids.
  'approval.minQuestionTextLength': decl({
    key: 'approval.minQuestionTextLength',
    description:
      'Minimum question text length accepted at submit and approval (gate 2). Below this a stem is too terse to test anything.',
    schema: z.number().int().min(1).max(1000),
    defaultValue: 15,
    layers: ['DOMAIN', 'PLATFORM', 'CODE_DEFAULT'],
    scopes: ['PLATFORM', 'DOMAIN'],
  }),
  'approval.requiredMetadataFields': decl({
    key: 'approval.requiredMetadataFields',
    description:
      'Source metadata field names that must be present before approval (gate 9). Empty means none are required.',
    schema: z.array(z.string().min(1)).max(50),
    defaultValue: [],
    layers: ['DOMAIN', 'PLATFORM', 'CODE_DEFAULT'],
    scopes: ['PLATFORM', 'DOMAIN'],
  }),
  'approval.bulkApproveCap': decl({
    key: 'approval.bulkApproveCap',
    description: 'Maximum items in one bulk approval.',
    schema: z.number().int().min(1).max(200),
    defaultValue: 25,
    layers: PLATFORM_ONLY,
    scopes: ['PLATFORM'],
  }),

  // -------------------------------------------------------------- privacy
  'privacy.minimumGroupSize': decl({
    key: 'privacy.minimumGroupSize',
    description:
      'Aggregates below this are suppressed. Configurable upward only; no override exists.',
    schema: z.number().int().min(5).max(100),
    defaultValue: 5,
    layers: PLATFORM_ONLY,
    scopes: ['PLATFORM'],
  }),

  // ------------------------------------------------------------ platform
  'platform.defaultTimeZone': decl({
    key: 'platform.defaultTimeZone',
    description: 'Tenant default display zone. Storage is always UTC.',
    schema: z.string().min(1),
    defaultValue: 'UTC',
    layers: PLATFORM_ONLY,
    scopes: ['PLATFORM'],
  }),
  'reporting.timeZone': decl({
    key: 'reporting.timeZone',
    description: 'Zone used to resolve date-only report boundaries into a UTC interval.',
    schema: z.string().min(1),
    defaultValue: 'UTC',
    layers: PLATFORM_ONLY,
    scopes: ['PLATFORM'],
  }),
  'platform.requireTwoPersonAdminGrant': decl({
    key: 'platform.requireTwoPersonAdminGrant',
    description: 'Require a second administrator to confirm an administration grant.',
    schema: z.boolean(),
    defaultValue: false,
    layers: PLATFORM_ONLY,
    scopes: ['PLATFORM'],
  }),

  // ------------------------------------------------------------- budgets
  'llm.dailyTokenBudget': decl({
    key: 'llm.dailyTokenBudget',
    description: 'Per-tenant daily token ceiling across all generation.',
    schema: z.number().int().min(0),
    defaultValue: 2_000_000,
    layers: PLATFORM_ONLY,
    scopes: ['PLATFORM'],
  }),
  'llm.perJobTokenBudget': decl({
    key: 'llm.perJobTokenBudget',
    description: 'Token ceiling for a single generation job.',
    schema: z.number().int().min(0),
    defaultValue: 250_000,
    layers: PLATFORM_OR_PROFILE,
    scopes: ['PLATFORM', 'PROFILE'],
  }),
  'llm.concurrency': decl({
    key: 'llm.concurrency',
    description: 'Concurrent model calls across the job runner.',
    schema: z.number().int().min(1).max(32),
    defaultValue: 4,
    layers: PLATFORM_ONLY,
    scopes: ['PLATFORM'],
  }),

  // ------------------------------------------- the generation control layer
  //
  // architecture.md §9.0. These are the keys the AI Generation Control Layer
  // reads; three of them (dailyTokenBudget, perJobTokenBudget, concurrency)
  // predate it and are used AS DECLARED rather than re-declared under a second
  // name — see the reconciliation note in
  // docs/integrations/LIVE_CLAUDE_IMPLEMENTATION_PLAN.md §6.
  'llm.weeklyTokenBudget': decl({
    key: 'llm.weeklyTokenBudget',
    description: 'Per-tenant seven-day token ceiling across all generation.',
    schema: z.number().int().min(0),
    defaultValue: 10_000_000,
    layers: PLATFORM_ONLY,
    scopes: ['PLATFORM'],
  }),
  'llm.monthlyTokenBudget': decl({
    key: 'llm.monthlyTokenBudget',
    description: 'Per-tenant thirty-day token ceiling across all generation.',
    schema: z.number().int().min(0),
    defaultValue: 40_000_000,
    layers: PLATFORM_ONLY,
    scopes: ['PLATFORM'],
  }),
  'llm.budgetWarningRatio': decl({
    key: 'llm.budgetWarningRatio',
    description: 'Utilization at which a budget window reports WARNING rather than HEALTHY.',
    schema: proportion,
    defaultValue: 0.8,
    layers: PLATFORM_ONLY,
    scopes: ['PLATFORM'],
  }),
  'llm.activeProvider': decl({
    key: 'llm.activeProvider',
    // The kill switch. Setting it back to DETERMINISTIC_LOCAL stops every
    // model call without a deployment, and the change is audited like any
    // other configuration write.
    description: 'Which generation provider the registry resolves for a job.',
    schema: GenerationProviderSchema,
    defaultValue: 'DETERMINISTIC_LOCAL' as const,
    layers: PLATFORM_OR_PROFILE,
    scopes: ['PLATFORM', 'PROFILE'],
  }),
  'llm.approvedProviders': decl({
    key: 'llm.approvedProviders',
    // A provider absent from this list is BLOCKED_BY_APPROVAL even with a
    // working credential. This is how a data-processing approval (T-29) is a
    // control rather than a promise: the platform cannot be talked into a
    // provider nobody signed off.
    description: 'Providers with a recorded data-processing approval.',
    schema: z.array(GenerationProviderSchema),
    defaultValue: ['DETERMINISTIC_LOCAL'] as const,
    layers: PLATFORM_ONLY,
    scopes: ['PLATFORM'],
  }),
  'llm.providerLimits': decl({
    key: 'llm.providerLimits',
    // Per-provider OVERRIDES of the ceilings above, keyed by provider id. An
    // absent entry means the platform ceiling applies; it never means
    // unlimited.
    description: 'Per-provider overrides of the token budgets and the concurrency cap.',
    schema: z.record(GenerationProviderSchema, ProviderLimitsSchema),
    defaultValue: {} as Partial<Record<GenerationProviderId, ProviderLimits>>,
    layers: PLATFORM_ONLY,
    scopes: ['PLATFORM'],
  }),
  'llm.providerSettings': decl({
    key: 'llm.providerSettings',
    // What an administrator configures about one provider: whether it is
    // enabled, where it lives, which model, and WHICH KEY VAULT REFERENCE
    // holds its credential. One VALUE keyed by provider id, not seven key
    // names per provider -- a second family of names is how two settings end
    // up half-applied, with the unread one in force.
    //
    // A secret never lands here. `ProviderSettingsSchema` validates
    // `apiKeyRef` as a keyvault:// reference, so a pasted key is refused at
    // the schema rather than stored in a table that appears in every backup.
    description: 'Per-provider settings: enabled, endpoint, model, and a credential REFERENCE.',
    schema: z.record(GenerationProviderSchema, ProviderSettingsSchema),
    defaultValue: {} as Partial<Record<GenerationProviderId, ProviderSettings>>,
    layers: PLATFORM_ONLY,
    scopes: ['PLATFORM'],
  }),
  'llm.tokenPrices': decl({
    key: 'llm.tokenPrices',
    // Keyed by provider id or `PROVIDER:modelId`, most specific winning. An
    // absent price means cost is NOT COMPUTED, and an uncomputed cost is
    // recorded as null rather than zero.
    description: 'Token prices per million, keyed by provider id or PROVIDER:modelId.',
    schema: z.record(z.string(), TokenPriceSchema),
    defaultValue: {} as Record<string, TokenPrice>,
    layers: PLATFORM_ONLY,
    scopes: ['PLATFORM'],
  }),
  'llm.maxAttempts': decl({
    key: 'llm.maxAttempts',
    description: 'Total attempts per generation call, including the first.',
    schema: z.number().int().min(1).max(10),
    defaultValue: 3,
    layers: PLATFORM_ONLY,
    scopes: ['PLATFORM'],
  }),
  'llm.retryBaseDelayMs': decl({
    key: 'llm.retryBaseDelayMs',
    description: 'First retry delay before jitter; doubles per attempt.',
    schema: z.number().int().min(0).max(60_000),
    defaultValue: 500,
    layers: PLATFORM_ONLY,
    scopes: ['PLATFORM'],
  }),
  'llm.retryMaxDelayMs': decl({
    key: 'llm.retryMaxDelayMs',
    description: 'Ceiling on a single retry delay after backoff and jitter.',
    schema: z.number().int().min(0).max(600_000),
    defaultValue: 30_000,
    layers: PLATFORM_ONLY,
    scopes: ['PLATFORM'],
  }),
  'llm.retryJitterRatio': decl({
    key: 'llm.retryJitterRatio',
    // 1.0 is full jitter: the delay is uniform in [0, backoff]. Full jitter is
    // the default because synchronized retries across a batch are how one 429
    // becomes a thundering herd.
    description: 'Proportion of the backoff delay that is randomized. 1 is full jitter.',
    schema: proportion,
    defaultValue: 1,
    layers: PLATFORM_ONLY,
    scopes: ['PLATFORM'],
  }),
  'llm.healthFailureThreshold': decl({
    key: 'llm.healthFailureThreshold',
    description: 'Failed calls within the health window before a provider reports FAILING.',
    schema: positiveInt,
    defaultValue: 3,
    layers: PLATFORM_ONLY,
    scopes: ['PLATFORM'],
  }),
  'llm.healthWindowMinutes': decl({
    key: 'llm.healthWindowMinutes',
    description: 'Window over which provider health is assessed.',
    schema: positiveInt,
    defaultValue: 15,
    layers: PLATFORM_ONLY,
    scopes: ['PLATFORM'],
  }),

  // ------------------------------------------------------------- sources
  'source.maxDocumentBytes': decl({
    key: 'source.maxDocumentBytes',
    description: 'Size cap applied before a download completes.',
    schema: z.number().int().min(1),
    defaultValue: 26_214_400,
    layers: PLATFORM_OR_PROFILE,
    scopes: ['PLATFORM', 'SOURCE'],
  }),
  'source.maxCharsPerDocument': decl({
    key: 'source.maxCharsPerDocument',
    description: 'Extraction truncation cap. Truncation is reported, never silent.',
    schema: z.number().int().min(1000),
    defaultValue: 200_000,
    layers: PLATFORM_OR_PROFILE,
    scopes: ['PLATFORM', 'SOURCE'],
  }),
  'source.testConnectionRateLimitPerHour': decl({
    key: 'source.testConnectionRateLimitPerHour',
    description: 'Test Connection calls per source per hour, so the probe is not a load source.',
    schema: z.number().int().min(1).max(100),
    defaultValue: 10,
    layers: PLATFORM_ONLY,
    scopes: ['PLATFORM'],
  }),
  'source.concurrencyPerSource': decl({
    key: 'source.concurrencyPerSource',
    description:
      'Concurrent adapter operations per source, so one source cannot throttle a tenant.',
    schema: z.number().int().min(1).max(16),
    defaultValue: 4,
    layers: PLATFORM_ONLY,
    scopes: ['PLATFORM', 'SOURCE'],
  }),

  // ----------------------------------------------------------- retention
  'retention.auditYears': decl({
    key: 'retention.auditYears',
    description: 'Audit retention in years. Minimum 1; configurable upward.',
    schema: z.number().int().min(1).max(30),
    defaultValue: 7,
    layers: PLATFORM_ONLY,
    scopes: ['PLATFORM'],
  }),
  'retention.syncHistoryDays': decl({
    key: 'retention.syncHistoryDays',
    description: 'Synchronization run history retention.',
    schema: z.number().int().min(30),
    defaultValue: 400,
    layers: PLATFORM_ONLY,
    scopes: ['PLATFORM'],
  }),
  'retention.sessionYears': decl({
    key: 'retention.sessionYears',
    description:
      'Session and response retention. Answer-key snapshots are removed as early as this allows.',
    schema: z.number().int().min(1).max(10),
    defaultValue: 2,
    layers: PLATFORM_ONLY,
    scopes: ['PLATFORM'],
  }),
  'retention.resultYears': decl({
    key: 'retention.resultYears',
    description: 'Result detail retention before aggregation.',
    schema: z.number().int().min(1).max(20),
    defaultValue: 5,
    layers: PLATFORM_ONLY,
    scopes: ['PLATFORM'],
  }),
  'retention.notificationDays': decl({
    key: 'retention.notificationDays',
    description: 'Notification retention.',
    schema: z.number().int().min(7),
    defaultValue: 180,
    layers: PLATFORM_ONLY,
    scopes: ['PLATFORM'],
  }),
  'retention.exportDays': decl({
    key: 'retention.exportDays',
    description: 'Report export blob retention.',
    schema: z.number().int().min(1).max(365),
    defaultValue: 30,
    layers: PLATFORM_ONLY,
    scopes: ['PLATFORM'],
  }),

  // ---------------------------------------------------------- idempotency
  'idempotency.ttlHours': decl({
    key: 'idempotency.ttlHours',
    description: 'Client Idempotency-Key retention window.',
    schema: z.number().int().min(1).max(168),
    defaultValue: 24,
    layers: PLATFORM_ONLY,
    scopes: ['PLATFORM'],
  }),

  // -------------------------------------------------------- question bank
  'questionBank.mappingProfileKey': decl({
    key: 'questionBank.mappingProfileKey',
    description: 'Active field mapping profile key for this environment.',
    schema: z.string().min(1),
    // P4: inert. The mock bank uses an identity mapping and needs no profile.
    defaultValue: 'mock-identity',
    layers: PLATFORM_ONLY,
    scopes: ['PLATFORM'],
  }),
  'questionBank.listTitle': decl({
    key: 'questionBank.listTitle',
    description: 'Display title of the Question Bank list. Resolved to a list ID at verification.',
    schema: z.string().min(1),
    defaultValue: 'Knowzy Question Bank',
    layers: PLATFORM_ONLY,
    scopes: ['PLATFORM'],
  }),
} as const;

export type ConfigKey = keyof typeof CONFIG_KEYS;
export const CONFIG_KEY_LIST = Object.keys(CONFIG_KEYS) as readonly ConfigKey[];

export type ConfigValue<K extends ConfigKey> = (typeof CONFIG_KEYS)[K]['defaultValue'];

export const configDeclaration = <K extends ConfigKey>(key: K): (typeof CONFIG_KEYS)[K] =>
  CONFIG_KEYS[key];
