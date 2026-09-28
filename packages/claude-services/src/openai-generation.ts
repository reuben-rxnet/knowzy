// OpenAI (Codex) as a GENERATION provider — OPENAI-CODEX-01.
//
// It PROPOSES questions and decides nothing else. Every candidate it returns
// goes through the same unmodified gate chain the deterministic generator's
// do: scope, evidence verification character by character, integrity,
// duplicate detection, confidence, then a person's review and a different
// person's approval. Nothing in this file can publish, approve or skip a gate,
// and nothing downstream knows which provider drafted a question except the
// provenance columns.
//
// WHAT IT SENDS, and nothing else: the framed prompt from `framing.ts` — the
// same system prompt, byte for byte, as every other provider, so PromptVersion
// 1.2.0 describes both arms of the comparison — plus a JSON schema for the
// answer. No tools (`GENERATION_TOOL_GRANT` is empty), no retrieval, no
// conversation state.
//
// THE KEY, under the same rules as the readiness client (openai.ts): resolved
// per call through the audited Secret Resolution Layer, revealed only into the
// auth header, sent only to an allow-listed host over https, redirects
// refused, and a provider error MESSAGE never kept — only its code.
//
// TWO API STYLES, because the endpoint in front of the model is not yet known
// (the owner's key is a gateway subscription key, 2026-09-27):
//
//   RESPONSES          POST {base}/responses          -- OpenAI's current API,
//                                                        and the only one Codex
//                                                        models are served on
//   CHAT_COMPLETIONS   POST {base}/chat/completions   -- what most gateways
//                                                        pass through
//
// and configurable AUTHENTICATION (GATEWAY-M1): a header -- `authorization`
// sends `Bearer <key>`, any other name carries the key as its value -- or a
// query parameter such as Azure API Management's `subscription-key`, plus
// fixed non-secret headers. The request itself is built by `providerFetch`,
// the same function Test connection uses, so the two cannot drift again.
//
// FAILURES ARE CLASSIFIED FOR THE CONTROL LAYER, not handled here. A 429 or a
// 5xx is thrown with its status, so `classifyError` marks it retryable and the
// retry policy (llm.maxAttempts, backoff) applies; a timeout is thrown as a
// TimeoutError; anything the model returns that does not parse is thrown with
// code MALFORMED_OUTPUT, which is NOT retried — the tokens are spent, and a
// retry could pay twice for a partial success.

import { z } from 'zod';
import type { RevealableSecret } from '@knowzy/shared-types';
import { frameGenerationPrompt, GENERATION_TOOL_GRANT } from './framing.js';
import type { GenerateArgs } from './generator.js';
import { GenerationOutputSchema, type GenerationOutput } from './output-schema.js';
import {
  classifyTransportError,
  endpointPermission,
  providerFetch,
  type ProviderAuth,
} from './provider-request.js';
import {
  PROVIDER_CATALOGUE,
  type ExecutionContext,
  type GenerationProvider,
  type ProviderGenerateResult,
} from './provider.js';

export const OPENAI_API_STYLES = ['RESPONSES', 'CHAT_COMPLETIONS'] as const;
export type OpenAIApiStyle = (typeof OPENAI_API_STYLES)[number];

/** Everything one call needs, resolved per call — never held between calls. */
export interface OpenAICallConfig {
  readonly baseUrl: string;
  readonly modelId: string;
  readonly apiKey: RevealableSecret;
  readonly allowedHosts: readonly string[];
  readonly apiStyle: OpenAIApiStyle;
  /** GATEWAY-M1: where the credential travels. No fallback between the two. */
  readonly auth: ProviderAuth;
  /** Fixed, non-secret headers from the provider's settings. */
  readonly extraHeaders: Readonly<Record<string, string>>;
  readonly temperature: number | null;
  readonly maxOutputTokens: number | null;
}

/** Thrown for every failure, carrying only what the control layer classifies on. */
export class OpenAIGenerationError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string | null,
  ) {
    super(message);
    this.name = 'OpenAIGenerationError';
  }
}

// ---------------------------------------------------------------------------
// The answer's shape, as OpenAI structured outputs require it
// ---------------------------------------------------------------------------
//
// Strict structured outputs need an OBJECT at the root with every property
// required (optional ones become nullable), so the platform's union — questions
// OR one insufficient result — is sent as an object with two arrays and mapped
// back. The mapping is the only translation: the platform's own
// GenerationOutputSchema still parses the result.

const nullable = (type: string) => ({ type: [type, 'null'] });

export const OPENAI_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['questions', 'insufficient'],
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'sectionKey',
          'questionText',
          'options',
          'correctOption',
          'explanation',
          'supportingEvidence',
          'modelConfidence',
          'difficulty',
        ],
        properties: {
          sectionKey: { type: 'string' },
          questionText: { type: 'string' },
          options: {
            type: 'object',
            additionalProperties: false,
            required: ['A', 'B', 'C', 'D'],
            properties: {
              A: { type: 'string' },
              B: { type: 'string' },
              C: { type: 'string' },
              D: { type: 'string' },
            },
          },
          correctOption: { type: 'string', enum: ['A', 'B', 'C', 'D'] },
          explanation: { type: 'string' },
          supportingEvidence: { type: 'string' },
          modelConfidence: nullable('number'),
          difficulty: {
            type: ['string', 'null'],
            enum: ['RECALL', 'APPLICATION', 'ANALYSIS', null],
          },
        },
      },
    },
    insufficient: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['sectionKey', 'reason'],
        properties: { sectionKey: { type: 'string' }, reason: { type: 'string' } },
      },
    },
  },
} as const;

const ModelAnswerSchema = z
  .object({
    questions: z.array(
      z
        .object({
          sectionKey: z.string(),
          questionText: z.string(),
          options: z
            .object({ A: z.string(), B: z.string(), C: z.string(), D: z.string() })
            .strict(),
          correctOption: z.enum(['A', 'B', 'C', 'D']),
          explanation: z.string(),
          supportingEvidence: z.string(),
          modelConfidence: z.number().min(0).max(1).nullable(),
          difficulty: z.enum(['RECALL', 'APPLICATION', 'ANALYSIS']).nullable(),
        })
        .strict(),
    ),
    insufficient: z.array(z.object({ sectionKey: z.string(), reason: z.string() }).strict()),
  })
  .strict();

/**
 * The model's answer, as the platform's union plus its insufficient list.
 *
 * Exported for a table test. A questions array that is empty with no
 * insufficient entry is still a valid answer — "nothing here" — and is mapped
 * to one insufficient result per requested section, so a silent empty reply is
 * recorded as a refusal per section rather than as nothing at all.
 */
export const mapModelAnswer = (
  raw: unknown,
  sectionKeys: readonly string[],
): { output: GenerationOutput; insufficientSections: { sectionKey: string; reason: string }[] } => {
  const answer = ModelAnswerSchema.parse(raw);
  const insufficientSections = answer.insufficient.map((row) => ({
    sectionKey: row.sectionKey,
    reason: row.reason.length >= 10 ? row.reason : `${row.reason} (no reason given)`.padEnd(10),
  }));

  if (answer.questions.length > 0) {
    const output = GenerationOutputSchema.parse({
      questions: answer.questions.map((q) => ({
        sectionKey: q.sectionKey,
        questionText: q.questionText,
        options: q.options,
        correctOption: q.correctOption,
        explanation: q.explanation,
        supportingEvidence: q.supportingEvidence,
        ...(q.modelConfidence === null ? {} : { modelConfidence: q.modelConfidence }),
        ...(q.difficulty === null ? {} : { difficulty: q.difficulty }),
      })),
    });
    return { output, insufficientSections };
  }

  const covered = new Set(insufficientSections.map((row) => row.sectionKey));
  for (const key of sectionKeys) {
    if (!covered.has(key)) {
      insufficientSections.push({
        sectionKey: key,
        reason: 'The model returned no question and no reason for this section.',
      });
    }
  }
  const first = insufficientSections[0] ?? {
    sectionKey: sectionKeys[0] ?? 'unknown',
    reason: 'The model returned no question for any section.',
  };
  return {
    output: GenerationOutputSchema.parse({
      result: 'insufficientEvidence',
      sectionKey: first.sectionKey,
      reason: first.reason,
    }),
    insufficientSections,
  };
};

// ---------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------

const IDENTIFIER = /^[a-z0-9_.-]{1,64}$/i;

const errorCode = async (response: Response): Promise<string | null> => {
  try {
    const body = (await response.json()) as { error?: { code?: unknown; type?: unknown } };
    const code = body.error?.code ?? body.error?.type;
    return typeof code === 'string' && IDENTIFIER.test(code) ? code : null;
  } catch {
    return null;
  }
};

interface UsageAndText {
  readonly text: string | null;
  readonly refusal: string | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly servedModel: string | null;
}

const readResponses = (body: Record<string, unknown>): UsageAndText => {
  const usage = body['usage'] as { input_tokens?: unknown; output_tokens?: unknown } | undefined;
  let text: string | null = null;
  let refusal: string | null = null;
  const outputs = Array.isArray(body['output']) ? (body['output'] as unknown[]) : [];
  for (const item of outputs) {
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content as { type?: unknown; text?: unknown; refusal?: unknown }[]) {
      if (part.type === 'output_text' && typeof part.text === 'string')
        text = (text ?? '') + part.text;
      if (part.type === 'refusal' && typeof part.refusal === 'string') refusal = part.refusal;
    }
  }
  if (text === null && typeof body['output_text'] === 'string') text = body['output_text'];
  return {
    text,
    refusal,
    inputTokens: typeof usage?.input_tokens === 'number' ? usage.input_tokens : null,
    outputTokens: typeof usage?.output_tokens === 'number' ? usage.output_tokens : null,
    servedModel: typeof body['model'] === 'string' ? body['model'] : null,
  };
};

const readChat = (body: Record<string, unknown>): UsageAndText => {
  const usage = body['usage'] as
    { prompt_tokens?: unknown; completion_tokens?: unknown } | undefined;
  const choice = Array.isArray(body['choices'])
    ? (body['choices'][0] as { message?: { content?: unknown; refusal?: unknown } } | undefined)
    : undefined;
  return {
    text: typeof choice?.message?.content === 'string' ? choice.message.content : null,
    refusal: typeof choice?.message?.refusal === 'string' ? choice.message.refusal : null,
    inputTokens: typeof usage?.prompt_tokens === 'number' ? usage.prompt_tokens : null,
    outputTokens: typeof usage?.completion_tokens === 'number' ? usage.completion_tokens : null,
    servedModel: typeof body['model'] === 'string' ? body['model'] : null,
  };
};

export interface CreateOpenAIGenerationProviderArgs {
  /** The configured model. The job's provenance records the model OpenAI SERVED. */
  readonly modelId: string;
  /**
   * Resolves the settings and the key for ONE call. Called inside `generate`,
   * so the key exists only for the duration of a request and a rotated secret
   * is used on the next call.
   */
  readonly configure: () => Promise<OpenAICallConfig>;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

export const OPENAI_GENERATION_PROVIDER_VERSION = 'openai-generation-01';

export const createOpenAIGenerationProvider = (
  args: CreateOpenAIGenerationProviderArgs,
): GenerationProvider => ({
  providerId: 'OPENAI',
  capabilities: PROVIDER_CATALOGUE.OPENAI,
  modelId: args.modelId,
  providerVersion: OPENAI_GENERATION_PROVIDER_VERSION,

  async generate(
    generateArgs: GenerateArgs,
    _context: ExecutionContext,
  ): Promise<ProviderGenerateResult> {
    const config = await args.configure();
    const permission = endpointPermission(config.baseUrl, config.allowedHosts);
    if (!permission.allowed) {
      // A configuration refusal, and a permanent one: status 403-shaped so the
      // control layer does not retry it.
      throw new OpenAIGenerationError(permission.reason, 403, 'ENDPOINT_NOT_ALLOWED');
    }

    const framed = frameGenerationPrompt(generateArgs);
    const style = config.apiStyle;
    const schema = { name: 'knowzy_generation', strict: true, schema: OPENAI_RESPONSE_SCHEMA };
    const body =
      style === 'RESPONSES'
        ? {
            model: config.modelId,
            instructions: framed.system,
            input: framed.user,
            text: { format: { type: 'json_schema', ...schema } },
            tools: GENERATION_TOOL_GRANT,
            store: false,
            ...(config.temperature === null ? {} : { temperature: config.temperature }),
            ...(config.maxOutputTokens === null
              ? {}
              : { max_output_tokens: config.maxOutputTokens }),
          }
        : {
            model: config.modelId,
            messages: [
              { role: 'system', content: framed.system },
              { role: 'user', content: framed.user },
            ],
            response_format: { type: 'json_schema', json_schema: schema },
            ...(config.temperature === null ? {} : { temperature: config.temperature }),
            ...(config.maxOutputTokens === null
              ? {}
              : { max_completion_tokens: config.maxOutputTokens }),
          };

    const timeoutMs = args.timeoutMs ?? 120_000;
    let response: Response;
    try {
      response = await providerFetch(
        {
          baseUrl: config.baseUrl,
          allowedHosts: config.allowedHosts,
          auth: config.auth,
          extraHeaders: config.extraHeaders,
          apiKey: config.apiKey,
        },
        permission.url,
        style === 'RESPONSES' ? '/responses' : '/chat/completions',
        {
          method: 'POST',
          body: JSON.stringify(body),
          timeoutMs,
          ...(args.fetch === undefined ? {} : { fetch: args.fetch }),
        },
      );
    } catch (error) {
      const failure = classifyTransportError(error, permission.url.hostname, timeoutMs);
      if (failure.cause === 'TIMEOUT') {
        const timeout = new OpenAIGenerationError(
          'The provider did not respond in time.',
          null,
          'ETIMEDOUT',
        );
        timeout.name = 'TimeoutError';
        throw timeout;
      }
      // The classified sentence, never the exception's own message. A reset
      // or an unexplained network failure keeps the retryable ECONNRESET code
      // it always had; DNS, TLS, a refused redirect or a refused connection
      // will not change on a retry, so they carry their own (permanent) code.
      const transient = failure.cause === 'CONNECTION_RESET' || failure.cause === 'UNREACHABLE';
      throw new OpenAIGenerationError(
        failure.detail,
        null,
        transient ? 'ECONNRESET' : failure.cause,
      );
    }

    if (!response.ok) {
      const code = await errorCode(response);
      throw new OpenAIGenerationError(
        `The provider answered ${response.status}${code === null ? '' : ` (${code})`}.`,
        response.status,
        response.status === 429 ? 'RATE_LIMITED' : code,
      );
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = (await response.json()) as Record<string, unknown>;
    } catch {
      throw new OpenAIGenerationError(
        'The provider returned a body that is not JSON.',
        null,
        'MALFORMED_OUTPUT',
      );
    }
    const read = style === 'RESPONSES' ? readResponses(parsed) : readChat(parsed);
    const sectionKeys = generateArgs.sections.map((section) => section.sectionKey);

    // A model REFUSAL is not an error and not a question: every section is
    // recorded as insufficient with that as the reason, which is what a
    // reviewer needs to see and what coverage must count as "not covered".
    let mapped: ReturnType<typeof mapModelAnswer>;
    if (read.refusal !== null) {
      const reason = `The model declined to answer: ${read.refusal.slice(0, 300)}`;
      mapped = mapModelAnswer(
        { questions: [], insufficient: sectionKeys.map((sectionKey) => ({ sectionKey, reason })) },
        sectionKeys,
      );
    } else {
      if (read.text === null) {
        throw new OpenAIGenerationError(
          'The provider returned no output text.',
          null,
          'MALFORMED_OUTPUT',
        );
      }
      try {
        mapped = mapModelAnswer(JSON.parse(read.text), sectionKeys);
      } catch {
        throw new OpenAIGenerationError(
          'The model returned output that does not match the schema.',
          null,
          'MALFORMED_OUTPUT',
        );
      }
    }

    const reported = read.inputTokens !== null && read.outputTokens !== null;
    return {
      ...mapped,
      // What OpenAI SERVED -- a dated snapshot -- rather than the alias
      // configured, because a comparison across a silent model change is not
      // a comparison.
      modelId: read.servedModel ?? config.modelId,
      inputTokens: read.inputTokens ?? Math.ceil((framed.system.length + framed.user.length) / 4),
      outputTokens: read.outputTokens ?? Math.ceil((read.text?.length ?? 0) / 4),
      providerId: 'OPENAI',
      providerVersion: OPENAI_GENERATION_PROVIDER_VERSION,
      tokenUsageReported: reported,
    };
  },
});
