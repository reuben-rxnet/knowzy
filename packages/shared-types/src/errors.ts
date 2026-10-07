// Error taxonomy and code registry — error-handling.md §2.
//
// Registry rules enforced here:
//   E1  codes are SCREAMING_SNAKE_CASE, stable forever, one closed union
//   E2  each code maps to exactly one category and one default HTTP status
//   E3  each code has exactly one safe default message, externalized by key
//   E4  a code is never repurposed; retired codes stay with `deprecated: true`
//   E7  codes carry no dynamic content — variable parts go in `details`
//
// The registry is the single table repository-structure.md §5.3 G3 checks.

import { z } from 'zod';

export const ERROR_CATEGORIES = [
  'AUTHENTICATION',
  'AUTHORIZATION',
  'VALIDATION',
  'NOT_FOUND',
  'CONFLICT',
  'CONFIGURATION',
  'THROTTLED',
  'UPSTREAM',
  'INTERNAL',
] as const;
export const ErrorCategorySchema = z.enum(ERROR_CATEGORIES);
export type ErrorCategory = z.infer<typeof ErrorCategorySchema>;

export interface ErrorDefinition {
  readonly category: ErrorCategory;
  readonly status: number;
  /** Safe for display. Never contains a secret, a provider body, or content. */
  readonly message: string;
  readonly retryable: boolean;
  readonly deprecated?: true;
}

/**
 * The registry. Adding a row is how new behaviour gets a code (E5); overloading
 * VALIDATION_FAILED is not.
 */
export const ERROR_REGISTRY = {
  // ------------------------------------------------------- authentication
  UNAUTHENTICATED: {
    category: 'AUTHENTICATION',
    status: 401,
    message: 'Your session expired. Sign in to continue.',
    retryable: false,
  },
  TOKEN_INVALID: {
    category: 'AUTHENTICATION',
    status: 401,
    message: 'Your sign-in could not be verified. Sign in again.',
    retryable: false,
  },

  // -------------------------------------------------------- authorization
  FORBIDDEN: {
    category: 'AUTHORIZATION',
    status: 403,
    message: 'You do not have permission to perform this action.',
    retryable: false,
  },
  SOURCE_FORBIDDEN: {
    category: 'AUTHORIZATION',
    status: 403,
    message: 'You do not have access to this knowledge source.',
    retryable: false,
  },
  SEPARATION_OF_DUTIES: {
    category: 'AUTHORIZATION',
    status: 403,
    message: 'You may not approve a question you authored or last edited.',
    retryable: false,
  },
  LAST_ADMINISTRATOR: {
    category: 'AUTHORIZATION',
    status: 403,
    message: 'This change would leave the platform with no administrator.',
    retryable: false,
  },
  ENVELOPE_INVALID: {
    category: 'AUTHORIZATION',
    status: 403,
    message: 'The request could not be authorized.',
    retryable: false,
  },
  SESSION_TOKEN_REQUIRED: {
    category: 'AUTHORIZATION',
    status: 403,
    message: 'This operation is only available while an assessment is being started.',
    retryable: false,
  },
  PORTAL_ACCESS_DENIED: {
    category: 'AUTHORIZATION',
    status: 403,
    message: 'Your account does not have access to this application.',
    retryable: false,
  },

  // ------------------------------------------------------------ not found
  NOT_FOUND: {
    category: 'NOT_FOUND',
    status: 404,
    message: 'Not found, or no longer available.',
    retryable: false,
  },

  // ------------------------------------------------- validation — schema
  VALIDATION_FAILED: {
    category: 'VALIDATION',
    status: 400,
    message: 'Some of the information supplied is not valid.',
    retryable: false,
  },

  // ------------------------------- validation — generation preconditions
  SOURCE_NOT_GENERATION_ENABLED: {
    category: 'VALIDATION',
    status: 422,
    message: 'This knowledge source is not enabled for question generation.',
    retryable: false,
  },
  GENERATION_SELECTION_REQUIRED: {
    category: 'VALIDATION',
    status: 422,
    message: 'Select between one and ten documents to generate from.',
    retryable: false,
  },
  DOCUMENT_NOT_READY: {
    category: 'VALIDATION',
    status: 422,
    message: 'One or more selected documents have not finished extracting.',
    retryable: false,
  },
  DOCUMENT_UNSUPPORTED: {
    category: 'VALIDATION',
    status: 422,
    message: 'One or more selected documents are of a type that cannot be extracted.',
    retryable: false,
  },
  /**
   * The document changed between scoping a job and running it.
   *
   * Distinct from VERSION_CONFLICT, which is a concurrent EDIT to the same
   * platform record. This is the source moving underneath a pinned scope, and
   * the remedy differs: re-run the preflight so the questions are grounded in
   * the current text rather than retrying the same job.
   */
  DOCUMENT_CONTENT_DRIFT: {
    category: 'CONFLICT',
    status: 409,
    message: 'The source document changed after this generation was scoped.',
    retryable: false,
  },
  TAXONOMY_MISSING: {
    category: 'VALIDATION',
    status: 422,
    message: 'A domain and topic are required.',
    retryable: false,
  },
  /**
   * A domain code, or a topic within a domain, already exists.
   *
   * Its own code rather than VALIDATION_FAILED (E5): a duplicate code is the
   * one refusal a taxonomy administrator will meet repeatedly, and it needs a
   * message that says which value collided rather than "invalid".
   */
  TAXONOMY_DUPLICATE: {
    category: 'CONFLICT',
    status: 409,
    message: 'A domain or topic with that code or name already exists.',
    retryable: false,
  },
  /**
   * An attempt to change a domain code that something already depends on.
   *
   * The code appears in every QuestionID published under the domain
   * (`KNZ-{DOMAIN_CODE}-{YYYY}-{SEQ}`), so changing it would orphan published
   * identifiers that live in the Question Bank outside this platform.
   */
  TAXONOMY_INACTIVE: {
    category: 'VALIDATION',
    status: 422,
    message: 'That department or role is deactivated, so a new question cannot be filed under it.',
    retryable: false,
  },
  TAXONOMY_CODE_IMMUTABLE: {
    category: 'CONFLICT',
    status: 409,
    message: 'This domain code can no longer be changed.',
    retryable: false,
  },
  /**
   * An import names a domain or topic the platform does not hold.
   *
   * Refused rather than created: a spreadsheet typo would otherwise mint a
   * permanent domain code, and a domain code cannot be taken back once a
   * question has published under it.
   */
  TAXONOMY_MAPPING_REQUIRED: {
    category: 'VALIDATION',
    status: 422,
    message: 'The file names a domain or topic that does not exist. Map it before importing.',
    retryable: false,
  },
  // Competency administration (COMPETENCY-M2,
  // docs/competencies/COMPETENCY_ADMINISTRATION.md). Their own codes because
  // each asks the administrator for a different next step.
  /** A category, competency, alias or version with that identity already exists. */
  COMPETENCY_DUPLICATE: {
    category: 'CONFLICT',
    status: 409,
    message: 'A competency definition with that code, name or content already exists.',
    retryable: false,
  },
  /** A new competency is within edit distance 2 of an existing one in its category. */
  COMPETENCY_NEAR_MATCH: {
    category: 'CONFLICT',
    status: 409,
    message: 'That name is very close to an existing competency. Confirm it is distinct.',
    retryable: false,
  },
  /** A retired category or competency cannot take a new competency or target. */
  COMPETENCY_INACTIVE: {
    category: 'VALIDATION',
    status: 422,
    message: 'That competency definition is retired, so nothing new can be based on it.',
    retryable: false,
  },
  /** The definitions changed after the version was drawn up; its hash no longer matches. */
  COMPETENCY_VERSION_STALE: {
    category: 'CONFLICT',
    status: 409,
    message: 'The definitions changed after this version was drawn up. Create a new version.',
    retryable: false,
  },
  /** A role target can be approved only against an approved framework version. */
  COMPETENCY_FRAMEWORK_NOT_APPROVED: {
    category: 'CONFLICT',
    status: 409,
    message: 'The framework has no approved version, so a role target cannot be approved yet.',
    retryable: false,
  },
  PROFILE_NOT_AVAILABLE: {
    category: 'VALIDATION',
    status: 422,
    message: 'The selected generation profile is not available for this domain.',
    retryable: false,
  },
  GENERATION_JUSTIFICATION_REQUIRED: {
    category: 'VALIDATION',
    status: 422,
    message: 'A reason for generating is required.',
    retryable: false,
  },
  PREFLIGHT_REQUIRED: {
    category: 'VALIDATION',
    status: 422,
    message: 'Run the pre-generation check and choose an action before generating.',
    retryable: false,
  },
  GENERATION_SCOPE_EMPTY: {
    category: 'VALIDATION',
    status: 422,
    message: 'The selected scope contains no sections to generate from.',
    retryable: false,
  },
  PROVIDER_NOT_REGISTERED: {
    category: 'VALIDATION',
    status: 422,
    message:
      'That generation provider is not available in this environment. No substitute is used.',
    retryable: false,
  },
  PROVIDER_MODE_NOT_SUPPORTED: {
    category: 'VALIDATION',
    status: 422,
    message: 'That provider does not support the requested execution mode.',
    retryable: false,
  },
  PROVIDER_CREDENTIAL_UNAVAILABLE: {
    category: 'UPSTREAM',
    status: 503,
    message: 'The provider credential could not be resolved, so no generation was attempted.',
    retryable: true,
  },
  PROVIDER_NOT_GROUNDING_SAFE: {
    category: 'VALIDATION',
    status: 422,
    message:
      'That provider retrieves its own context, so a question it drafts cannot be grounded in the selected sections alone.',
    retryable: false,
  },
  USER_ENTITLEMENT_UNAVAILABLE: {
    category: 'VALIDATION',
    status: 422,
    message:
      'User-managed generation needs your own provider entitlement, and none was found for your account.',
    retryable: false,
  },
  BUDGET_EXCEEDED: {
    category: 'VALIDATION',
    status: 422,
    message: 'The generation budget for this period has been used.',
    retryable: false,
  },
  PROVIDER_NOT_APPROVED: {
    category: 'VALIDATION',
    status: 422,
    // Separate from PROVIDER_CREDENTIAL_UNAVAILABLE because the remedy is
    // completely different: one needs a key, this one needs a signature. A
    // single "unavailable" would send an operator hunting for a credential
    // that is already present.
    message:
      'No data-processing approval is recorded for that provider, so it cannot be used for generation.',
    retryable: false,
  },
  GENERATION_CONCURRENCY_LIMIT: {
    category: 'THROTTLED',
    status: 429,
    message: 'Too many generation jobs are already running. Try again when one finishes.',
    retryable: true,
  },
  PROVIDER_RETRY_EXHAUSTED: {
    category: 'UPSTREAM',
    status: 503,
    message: 'The provider kept failing and the retry limit was reached, so the job was stopped.',
    retryable: true,
  },

  // ------------------------------- validation — candidate rejection reasons
  SCHEMA_INVALID: {
    category: 'VALIDATION',
    status: 422,
    message: 'The generated question did not match the required structure.',
    retryable: false,
  },
  EVIDENCE_UNVERIFIED: {
    category: 'VALIDATION',
    status: 422,
    message: 'The supporting evidence could not be verified against the source document.',
    retryable: false,
  },
  DUPLICATE: {
    category: 'VALIDATION',
    status: 422,
    message: 'This question duplicates an existing question.',
    retryable: false,
  },
  DUPLICATE_SUSPECTED: {
    category: 'VALIDATION',
    status: 422,
    message: 'This question may duplicate an existing question and needs a reviewer decision.',
    retryable: false,
  },
  INSUFFICIENT_EVIDENCE: {
    category: 'VALIDATION',
    status: 422,
    message: 'This section does not contain content that can be tested reliably.',
    retryable: false,
  },

  // ---------------------------------- validation — approval gates (1–13)
  EVIDENCE_MISSING: {
    category: 'VALIDATION',
    status: 422,
    message: 'Source evidence is missing or has not been verified.',
    retryable: false,
  },
  QUESTION_INCOMPLETE: {
    category: 'VALIDATION',
    status: 422,
    message: 'The question text is missing or too short.',
    retryable: false,
  },
  OPTION_MISSING: {
    category: 'VALIDATION',
    status: 422,
    message: 'All four answer options are required.',
    retryable: false,
  },
  OPTION_DUPLICATE: {
    category: 'VALIDATION',
    status: 422,
    message: 'Two or more answer options are the same.',
    retryable: false,
  },
  ANSWER_INVALID: {
    category: 'VALIDATION',
    status: 422,
    message: 'The correct answer must be exactly one of A, B, C, or D.',
    retryable: false,
  },
  EXPLANATION_MISSING: {
    category: 'VALIDATION',
    status: 422,
    message: 'An explanation is required.',
    retryable: false,
  },
  DOMAIN_MISSING: {
    category: 'VALIDATION',
    status: 422,
    message: 'A domain is required.',
    retryable: false,
  },
  TOPIC_MISSING: {
    category: 'VALIDATION',
    status: 422,
    message: 'A topic is required.',
    retryable: false,
  },
  METADATA_MISSING: {
    category: 'VALIDATION',
    status: 422,
    message: 'A required field is missing.',
    retryable: false,
  },
  DUPLICATE_THRESHOLD_EXCEEDED: {
    category: 'VALIDATION',
    status: 422,
    message: 'A possible duplicate has not been reviewed yet.',
    retryable: false,
  },
  SOURCE_INACCESSIBLE: {
    category: 'VALIDATION',
    status: 422,
    message: 'The source document could not be reached to confirm the evidence.',
    retryable: true,
  },
  SOURCE_VALIDATION_FAILED: {
    category: 'VALIDATION',
    status: 422,
    message: 'The source document has changed and the evidence needs revalidation.',
    retryable: false,
  },
  SME_SIGNOFF_REQUIRED: {
    category: 'VALIDATION',
    status: 422,
    message: 'A subject matter expert must endorse this version before it can be approved.',
    retryable: false,
  },

  // ------------------------------------------- validation — assessments
  POOL_DUPLICATE_CONFLICT: {
    category: 'VALIDATION',
    status: 422,
    message: 'This assessment contains two questions that test the same knowledge.',
    retryable: false,
  },

  // --------------------------------------------------------------- conflict
  VERSION_CONFLICT: {
    category: 'CONFLICT',
    status: 409,
    message: 'Someone else edited this while you were working.',
    retryable: true,
  },
  REMOTE_PRECONDITION_FAILED: {
    category: 'CONFLICT',
    status: 409,
    message: 'The Question Bank item changed. The change was not applied.',
    retryable: true,
  },
  STATE_TRANSITION_INVALID: {
    category: 'CONFLICT',
    status: 409,
    message: 'This action is not available from the current state.',
    retryable: false,
  },
  IDEMPOTENCY_KEY_REUSED: {
    category: 'CONFLICT',
    status: 409,
    message: 'This request was already made with different details.',
    retryable: false,
  },
  IDEMPOTENCY_IN_PROGRESS: {
    category: 'CONFLICT',
    status: 409,
    message: 'This request is still being processed.',
    retryable: true,
  },
  SESSION_SEQUENCE_CONFLICT: {
    category: 'CONFLICT',
    status: 409,
    message: 'This assessment is open in another window. Reloading will catch you up.',
    retryable: true,
  },
  SESSION_NOT_ACTIVE: {
    category: 'CONFLICT',
    status: 409,
    message: 'This assessment attempt has already finished.',
    retryable: false,
  },
  SESSION_ALREADY_IN_PROGRESS: {
    category: 'CONFLICT',
    status: 409,
    message: 'You already have an attempt in progress for this assessment.',
    retryable: false,
  },
  ASSESSMENT_POOL_INSUFFICIENT: {
    category: 'CONFLICT',
    status: 409,
    message: 'This assessment is temporarily unavailable.',
    retryable: true,
  },
  ASSESSMENT_NOT_ELIGIBLE: {
    category: 'CONFLICT',
    status: 409,
    message: 'You are not currently eligible to take this assessment.',
    retryable: false,
  },
  SOURCE_HAS_LINEAGE: {
    category: 'CONFLICT',
    status: 409,
    message: 'This source cannot be deleted because questions trace to it. Archive it instead.',
    retryable: false,
  },

  // ---------------------------------------------------------- configuration
  SOURCE_NOT_CONFIGURED: {
    category: 'CONFIGURATION',
    status: 422,
    message: 'This source has no credential configured.',
    retryable: false,
  },
  SOURCE_AUTH_FAILED: {
    category: 'CONFIGURATION',
    status: 422,
    message:
      'Authentication failed. The configured credential was rejected. Check the secret and the app registration.',
    retryable: false,
  },
  SOURCE_SITE_NOT_FOUND: {
    category: 'CONFIGURATION',
    status: 422,
    message: 'No site was found at the configured URL. Check the tenant hostname and site path.',
    retryable: false,
  },
  SOURCE_SITE_FORBIDDEN: {
    category: 'CONFIGURATION',
    status: 422,
    message:
      'The platform identity does not have access to this site. Grant access to this specific site.',
    retryable: false,
  },
  SOURCE_LIBRARY_NOT_FOUND: {
    category: 'CONFIGURATION',
    status: 422,
    message: 'No document library with that name exists on this site.',
    retryable: false,
  },
  SOURCE_FOLDER_NOT_FOUND: {
    category: 'CONFIGURATION',
    status: 422,
    message: 'The folder path was not found in this library.',
    retryable: false,
  },
  SOURCE_EMPTY: {
    category: 'CONFIGURATION',
    status: 422,
    message: 'No documents were found at the configured path.',
    retryable: false,
  },
  SOURCE_TYPE_NOT_AVAILABLE: {
    category: 'CONFIGURATION',
    status: 422,
    message: 'Support for this source type is not available yet.',
    retryable: false,
  },
  EXTRACTION_EMPTY: {
    category: 'CONFIGURATION',
    status: 422,
    message: 'No text could be extracted from this document. It may be image-only.',
    retryable: false,
  },
  FIELD_MAPPING_INCOMPLETE: {
    category: 'CONFIGURATION',
    status: 422,
    message: 'The Question Bank field mapping is incomplete. Publishing is unavailable.',
    retryable: false,
  },
  FIELD_VALUE_TOO_LONG: {
    category: 'CONFIGURATION',
    status: 422,
    message: 'A value is longer than the Question Bank column allows.',
    retryable: false,
  },
  FIELD_TRANSFORM_FAILED: {
    category: 'CONFIGURATION',
    status: 422,
    message: 'A value could not be converted for the Question Bank column.',
    retryable: false,
  },
  QUESTIONBANK_LIST_NOT_FOUND: {
    category: 'CONFIGURATION',
    status: 422,
    message: 'The configured Question Bank list was not found.',
    retryable: false,
  },
  QUESTIONBANK_WRITE_FORBIDDEN: {
    category: 'CONFIGURATION',
    status: 422,
    message: 'The platform identity cannot write to the Question Bank list.',
    retryable: false,
  },
  QUESTIONBANK_SCHEMA_INCOMPLETE: {
    category: 'CONFIGURATION',
    status: 422,
    message: 'The Question Bank list is missing required columns.',
    retryable: false,
  },
  QUESTIONBANK_INDEX_MISSING: {
    category: 'CONFIGURATION',
    status: 422,
    message: 'One or more Question Bank columns that must be indexed are not indexed.',
    retryable: false,
  },
  QUESTIONBANK_VERSIONING_DISABLED: {
    category: 'CONFIGURATION',
    status: 422,
    message: 'Versioning is not enabled on the Question Bank list.',
    retryable: false,
  },
  WRITE_NOT_ENABLED: {
    category: 'CONFIGURATION',
    status: 422,
    message: 'Publishing is not enabled for this environment.',
    retryable: false,
  },

  // -------------------------------------------------------------- throttled
  RATE_LIMITED: {
    category: 'THROTTLED',
    status: 429,
    message: 'Too many requests. Try again shortly.',
    retryable: true,
  },
  SOURCE_THROTTLED: {
    category: 'THROTTLED',
    status: 429,
    message: 'The knowledge source is throttling requests. Retrying automatically.',
    retryable: true,
  },

  // --------------------------------------------------------------- upstream
  UPSTREAM_UNEXPECTED: {
    category: 'UPSTREAM',
    status: 502,
    message: 'A dependency returned an unexpected response.',
    retryable: true,
  },
  CIRCUIT_OPEN: {
    category: 'UPSTREAM',
    status: 503,
    message: 'This dependency is temporarily unavailable. Retrying shortly.',
    retryable: true,
  },
  REQUEST_TIMEOUT: {
    category: 'UPSTREAM',
    status: 504,
    message: 'The operation did not complete in time.',
    retryable: true,
  },
  SOURCE_TIMEOUT: {
    category: 'UPSTREAM',
    status: 504,
    message: 'The knowledge source did not respond in time.',
    retryable: true,
  },
  MCP_UNAVAILABLE: {
    category: 'UPSTREAM',
    status: 503,
    message:
      'The knowledge gateway is unavailable. This is a platform issue, not a configuration issue.',
    retryable: true,
  },
  DEPENDENCY_DEGRADED: {
    category: 'UPSTREAM',
    status: 200,
    message: 'This result is complete but some information is unavailable.',
    retryable: false,
  },
  DATABASE_UNAVAILABLE: {
    category: 'UPSTREAM',
    status: 503,
    message: 'The platform is temporarily unavailable.',
    retryable: true,
  },
  LLM_UNAVAILABLE: {
    category: 'UPSTREAM',
    status: 503,
    message: 'Question generation is temporarily unavailable. Your drafts are unaffected.',
    retryable: true,
  },

  // --------------------------------------------------------------- internal
  INTERNAL_ERROR: {
    category: 'INTERNAL',
    status: 500,
    message: 'Something went wrong on our side.',
    retryable: false,
  },
  RESPONSE_SHAPE_VIOLATION: {
    category: 'INTERNAL',
    status: 500,
    message: 'Something went wrong on our side.',
    retryable: false,
  },
} as const satisfies Record<string, ErrorDefinition>;

export type ErrorCode = keyof typeof ERROR_REGISTRY;

export const ERROR_CODES = Object.keys(ERROR_REGISTRY) as readonly ErrorCode[];
export const ErrorCodeSchema = z.enum(ERROR_CODES as [ErrorCode, ...ErrorCode[]]);

export const errorDefinition = (code: ErrorCode): ErrorDefinition => ERROR_REGISTRY[code];

/** RFC 9457 problem+json — error-handling.md §3. */
export const ProblemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: ErrorCodeSchema,
  category: ErrorCategorySchema,
  detail: z.string(),
  retryable: z.boolean(),
  retryAfterSeconds: z.number().int().nullable(),
  correlationId: z.string(),
  instance: z.string(),
  details: z.record(z.unknown()).nullable(),
  fieldErrors: z
    .array(z.object({ path: z.string(), code: z.string(), message: z.string() }))
    .nullable(),
  gateFailures: z
    .array(
      z.object({
        gate: z.number().int(),
        code: ErrorCodeSchema,
        passed: z.boolean(),
        detail: z.string().nullable(),
        /**
         * The field that fixes this failure.
         *
         * error-handling.md §328 requires each gate failure to link to the
         * field that resolves it; without the name the client can list
         * problems but cannot point at them. Null for a gate that is not about
         * a field, such as separation of duties.
         */
        field: z.string().nullable(),
      }),
    )
    .nullable(),
});
export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;

export const PROBLEM_TYPE_BASE = 'https://knowzy.internal/errors/';

/** A per-item outcome row. Partial success is 200 with outcomes, never a truncated list. */
export const BatchItemOutcomeSchema = z.object({
  id: z.string(),
  outcome: z.string(),
  code: ErrorCodeSchema.nullable().default(null),
  retryable: z.boolean().default(false),
  detail: z.string().nullable().default(null),
});
export type BatchItemOutcome = z.infer<typeof BatchItemOutcomeSchema>;

export const BatchResultSchema = z.object({
  batchId: z.string(),
  summary: z.object({
    succeeded: z.number().int(),
    failed: z.number().int(),
    skipped: z.number().int(),
  }),
  items: z.array(BatchItemOutcomeSchema),
});
export type BatchResult = z.infer<typeof BatchResultSchema>;
