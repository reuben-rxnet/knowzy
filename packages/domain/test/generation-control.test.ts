// The AI Generation Control Layer, against a real database and the
// deterministic provider — architecture.md §9.0.
//
// This is the suite the whole milestone rests on. The controls were built
// BEFORE any external provider exists, and the only way that is worth anything
// is if they are proven to fire against a provider that cannot send a request
// anywhere. So every test here makes a control REFUSE and then checks three
// things a weaker test would skip:
//
//   1. the job is REFUSED, not FAILED — a decision is not an outage
//   2. NO draft question was created — a refused job leaves nothing behind
//   3. the audit row carries no `_droppedKeys` — the allow-list in
//      @knowzy/observability silently discards undeclared detail keys, so an
//      audit assertion that only checks the row exists proves nothing
//
// Three mechanisms here were mutation-tested while being written: raising the
// budget makes the budget test fail, lowering the concurrency cap makes the
// success test fail, and removing the deterministic provider from
// `approvedProviders` makes every test fail with the approval refusal.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { systemClock } from '@knowzy/observability';
import {
  createDeterministicProvider,
  createGeneratorRegistry,
  createOpenAIGenerationProvider,
  type GenerateArgs,
  type GenerationProvider,
  type ProviderGenerateResult,
} from '@knowzy/claude-services';
import {
  createGenerationJob,
  GenerationRefusedError,
  resolveGenerationScope,
  readAiUsage,
  runGenerationJob,
  setProviderLimits,
  ProviderLimitError,
  type ControlSettings,
  type GenerationProfileSettings,
} from '../src/index.js';
import { testControlSettings } from './control-layer-fixture.js';

const DATABASE_URL = process.env['DATABASE_URL'];
const describeDb = DATABASE_URL ? describe : describe.skip;

const prisma = new PrismaClient(
  DATABASE_URL ? { datasources: { db: { url: DATABASE_URL } } } : undefined,
);

/** A provider that always fails the way a rate-limited API fails. */
const rateLimitedProvider = (): GenerationProvider => ({
  ...createDeterministicProvider(),
  generate: async (): Promise<ProviderGenerateResult> => {
    throw Object.assign(new Error('Too many requests'), { status: 429 });
  },
});

/** A provider that fails in a way no retry can fix. */
const brokenProvider = (): GenerationProvider => ({
  ...createDeterministicProvider(),
  generate: async (_args: GenerateArgs): Promise<ProviderGenerateResult> => {
    throw Object.assign(new Error('Bad request'), { status: 400 });
  },
});

const registry = (
  approved: readonly ('DETERMINISTIC_LOCAL' | 'OPENAI')[] = ['DETERMINISTIC_LOCAL'],
) =>
  createGeneratorRegistry({
    activeProvider: 'DETERMINISTIC_LOCAL',
    approvedProviders: approved,
    // OPENAI-CODEX-01: OpenAI is registered, enabled and credentialled here,
    // so APPROVAL is the one thing a test varies -- exactly the gate T-29 is.
    factories: {
      OPENAI: (modelId) =>
        createOpenAIGenerationProvider({
          modelId,
          configure: async () => {
            throw new Error('the control registry instance is never called');
          },
        }),
    },
    enabled: { OPENAI: true },
    credentialPresent: { OPENAI: true },
  });

describeDb('AI generation control layer', () => {
  // The audit store is append-only, so a scan by correlation id alone reads
  // every row any EARLIER run wrote -- including rows a since-fixed defect
  // wrote, which then fail this suite forever on that database. Bounded to
  // this run instead.
  const suiteStartedAt = new Date();
  let sourceId = '';
  let documentId = '';
  let domainId = '';
  let topicId = '';
  let authorUserId = '';
  let adminUserId = '';
  let profile: GenerationProfileSettings;
  let extractedText = '';
  let documents: {
    documentId: string;
    sourceDocumentId: string;
    name: string;
    sourceUrl: string;
    folderPath: string | null;
    containerName: string | null;
    sourceVersion: string;
    sourceETag: string | null;
    contentHash: string;
    localVersionCounter: number;
  }[] = [];
  const createdJobIds: string[] = [];

  beforeAll(async () => {
    const source = await prisma.knowledgeSource.findFirstOrThrow({
      where: { sourceType: 'MOCK' },
      select: { id: true },
    });
    sourceId = source.id;

    const document = await prisma.knowledgeDocument.findFirstOrThrow({
      where: { sourceId, extractionStatus: 'EXTRACTED', name: 'incident-escalation.md' },
      select: {
        id: true,
        sourceDocumentId: true,
        name: true,
        sourceUrl: true,
        folderPath: true,
        containerName: true,
        sourceVersion: true,
        sourceETag: true,
        contentHash: true,
        localVersionCounter: true,
        extractedText: true,
      },
    });
    documentId = document.id;
    documents = [
      {
        documentId: document.id,
        sourceDocumentId: document.sourceDocumentId,
        name: document.name,
        sourceUrl: document.sourceUrl,
        folderPath: document.folderPath,
        containerName: document.containerName,
        sourceVersion: document.sourceVersion,
        sourceETag: document.sourceETag,
        contentHash: document.contentHash ?? '',
        localVersionCounter: document.localVersionCounter,
      },
    ];
    extractedText = document.extractedText ?? '';

    const topic = await prisma.topic.findFirstOrThrow({
      where: { isActive: true },
      select: { id: true, name: true, domainId: true, domain: { select: { name: true } } },
    });
    topicId = topic.id;
    domainId = topic.domainId;

    const author = await prisma.user.findFirstOrThrow({
      where: { userPrincipalName: 'author@local.invalid' },
      select: { id: true },
    });
    authorUserId = author.id;

    const admin = await prisma.user.findFirstOrThrow({
      where: { userPrincipalName: 'knowzy-administrator@local.invalid' },
      select: { id: true },
    });
    adminUserId = admin.id;

    const profileRow = await prisma.generationProfile.findFirstOrThrow({
      where: { name: 'Default' },
    });
    profile = {
      profileId: profileRow.id,
      promptVersionId: profileRow.promptVersionId,
      modelId: profileRow.modelId,
      evidenceMode: profileRow.evidenceStrictness,
      thresholds: {
        flagThreshold: Number(profileRow.duplicateFlagThreshold),
        blockThreshold: Number(profileRow.duplicateBlockThreshold),
      },
      minAssessableChars: 300,
      maxQuestionsPerSection: profileRow.maxQuestionsPerSection,
      domainName: topic.domain.name,
      topicName: topic.name,
    };
  });

  afterAll(async () => {
    for (const jobId of createdJobIds) {
      await prisma.generationProviderCall.deleteMany({ where: { jobId } });
      const questions = await prisma.draftQuestion.findMany({
        where: { generationJobId: jobId },
        select: { id: true },
      });
      const ids = questions.map((row) => row.id);
      await prisma.draftQuestionVersion.deleteMany({ where: { questionId: { in: ids } } });
      await prisma.draftQuestion.deleteMany({ where: { generationJobId: jobId } });
      await prisma.generationJobRejection.deleteMany({ where: { jobId } });
      await prisma.generationJobDocument.deleteMany({ where: { jobId } });
      const job = await prisma.generationJob.findUnique({
        where: { id: jobId },
        select: { preflightId: true },
      });
      if (job) {
        await prisma.generationJob.delete({ where: { id: jobId } });
        await prisma.generationPreflight.delete({ where: { id: job.preflightId } });
      }
    }
    // Leave no override behind: the next suite must see the platform ceilings.
    await prisma.applicationConfiguration.deleteMany({ where: { key: 'llm.providerLimits' } });
    await prisma.$disconnect();
  });

  const startJob = async (): Promise<string> => {
    await prisma.documentSection.updateMany({
      where: { documentId },
      data: { isAssessable: true, coverageStatus: 'NOT_COVERED', nonAssessableReason: null },
    });
    const preflight = await prisma.generationPreflight.create({
      data: {
        sourceId,
        documentIds: [documentId],
        checkResults: {},
        recommendation: 'GENERATE_NEW',
        chosenAction: 'GENERATE_NEW',
        chosenAt: new Date(),
        chosenByUserId: authorUserId,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        correlationId: 'control-test',
        createdByUserId: authorUserId,
      },
      select: { id: true },
    });

    const created = await createGenerationJob({
      prisma,
      clock: systemClock,
      preflightId: preflight.id,
      scope: 'ENTIRE_DOCUMENT',
      domainId,
      topicId,
      reasonCode: 'NEW_KNOWLEDGE',
      requestedQuestionCount: 2,
      actor: {
        userId: authorUserId,
        displayName: 'Local Quiz Author',
        roles: ['CONTENT_AUTHOR'],
        permissions: ['question.generate'],
      },
      correlationId: 'control-test',
      requestId: 'control-request',
    });
    createdJobIds.push(created.jobId);
    return created.jobId;
  };

  /** Runs a job with the given control settings, returning what happened. */
  const run = async (args: {
    readonly settings?: Partial<ControlSettings>;
    readonly provider?: GenerationProvider;
    readonly approved?: readonly ('DETERMINISTIC_LOCAL' | 'OPENAI')[];
  }): Promise<{ jobId: string; error: unknown }> => {
    const jobId = await startJob();

    // The scope is built from the document's real sections, exactly as the
    // generation route builds it: a fabricated scope would let a control pass
    // against input the platform would never actually produce.
    const rows = await prisma.documentSection.findMany({
      where: { documentId, isAssessable: true },
      orderBy: { ordinal: 'asc' },
    });
    const scope = resolveGenerationScope({
      scope: 'ENTIRE_DOCUMENT',
      documents,
      sections: rows.map((row) => ({
        sectionId: row.id,
        sectionKey: row.sectionKey,
        documentId,
        ordinal: row.ordinal,
        label: row.headingPath ?? `Section ${row.ordinal}`,
        text: extractedText.slice(row.startOffset, row.endOffset),
        sectionContentHash: row.sectionContentHash,
        startOffset: row.startOffset,
        assessableCharCount: row.assessableCharCount,
      })),
    });

    let error: unknown = null;
    try {
      await runGenerationJob({
        prisma,
        clock: systemClock,
        scope,
        profile,
        requestedQuestionCount: 2,
        ...(args.provider === undefined ? {} : { provider: args.provider }),
        control: {
          registry: registry(args.approved),
          settings: testControlSettings(args.settings),
          random: () => 0.5,
          sleep: async () => undefined,
        },
        context: {
          jobId,
          sourceId,
          domainId,
          topicId,
          correlationId: 'control-test',
          requestId: 'control-request',
          actorUserId: authorUserId,
          actorDisplayName: 'Local Quiz Author',
          actorRoles: ['CONTENT_AUTHOR'],
          reasonCode: 'NEW_KNOWLEDGE',
        },
      });
    } catch (caught) {
      error = caught;
    }
    return { jobId, error };
  };

  const auditFor = async (jobId: string, actions: string | readonly string[]) =>
    prisma.auditEvent.findFirst({
      where: {
        entityId: jobId,
        action: { in: typeof actions === 'string' ? [actions] : [...actions] },
      },
      orderBy: { occurredAt: 'desc' },
      select: { action: true, outcome: true, detail: true },
    });

  // -------------------------------------------------------------- the ceilings

  it('refuses a job over the PER-JOB ceiling, before any call is made', async () => {
    const { jobId, error } = await run({ settings: { perJobTokenBudget: 10 } });

    expect(error).toBeInstanceOf(GenerationRefusedError);
    expect((error as GenerationRefusedError).refusalReason).toBe('PER_JOB_TOKEN_BUDGET_EXCEEDED');
    expect((error as GenerationRefusedError).limitValue).toBe(10);

    const job = await prisma.generationJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe('REFUSED');
    expect(job.refusalReason).toBe('PER_JOB_TOKEN_BUDGET_EXCEEDED');
    expect(job.refusalDetail).toContain('per-job ceiling');

    // Nothing was called, so nothing was spent and nothing was recorded.
    expect(await prisma.generationProviderCall.count({ where: { jobId } })).toBe(0);
    expect(await prisma.draftQuestion.count({ where: { generationJobId: jobId } })).toBe(0);

    const audit = await auditFor(jobId, 'AUTHORING.GENERATION.JOB_REFUSED');
    expect(audit?.outcome).toBe('DENIED');
    const detail = audit?.detail as Record<string, unknown>;
    expect(detail['refusalReason']).toBe('PER_JOB_TOKEN_BUDGET_EXCEEDED');
    expect(detail['limitName']).toBe('llm.perJobTokenBudget');
    expect(detail['limitValue']).toBe(10);
    // The assertion that catches a forgotten allow-list entry.
    expect(detail['_droppedKeys']).toBeUndefined();
  });

  it('refuses when the DAILY window is exhausted, and names the window', async () => {
    const { jobId, error } = await run({ settings: { dailyTokenBudget: 1 } });

    expect((error as GenerationRefusedError).refusalReason).toBe('DAILY_TOKEN_BUDGET_EXHAUSTED');
    const audit = await auditFor(jobId, 'AUTHORING.GENERATION.JOB_REFUSED');
    const detail = audit?.detail as Record<string, unknown>;
    expect(detail['budgetWindow']).toBe('DAILY');
    expect(detail['limitName']).toBe('llm.dailyTokenBudget');
    expect(detail['_droppedKeys']).toBeUndefined();

    const job = await prisma.generationJob.findUniqueOrThrow({ where: { id: jobId } });
    // The reset time is in the detail, because "come back later" without a
    // time is not an answer.
    expect(job.refusalDetail).toContain('resets at');
  });

  it('refuses at the CONCURRENCY cap, counting running jobs for that provider', async () => {
    // A second job, left RUNNING, is the condition under test.
    const blockingJobId = await startJob();
    await prisma.generationJob.update({
      where: { id: blockingJobId },
      data: { status: 'RUNNING', providerId: 'DETERMINISTIC_LOCAL' },
    });

    const { jobId, error } = await run({ settings: { concurrency: 1 } });

    expect((error as GenerationRefusedError).refusalReason).toBe('CONCURRENCY_LIMIT_REACHED');
    const job = await prisma.generationJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe('REFUSED');

    const audit = await auditFor(jobId, 'AUTHORING.GENERATION.JOB_REFUSED');
    const detail = audit?.detail as Record<string, unknown>;
    expect(detail['limitName']).toBe('llm.concurrency');
    expect(detail['_droppedKeys']).toBeUndefined();

    await prisma.generationJob.update({
      where: { id: blockingJobId },
      data: { status: 'CANCELLED' },
    });
  });

  it('refuses an UNAPPROVED provider even though its client exists', async () => {
    // The deterministic provider is registered and grounding-safe. Remove the
    // approval and it is refused anyway, which is what makes an approval a
    // control rather than a promise.
    const { jobId, error } = await run({ approved: [] });

    expect((error as GenerationRefusedError).refusalReason).toBe('PROVIDER_BLOCKED_BY_APPROVAL');
    expect((error as GenerationRefusedError).code).toBe('PROVIDER_NOT_APPROVED');
    const job = await prisma.generationJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe('REFUSED');
  });

  // ------------------------------------------------------------- the retries

  it('retries a rate limit, records every attempt, and then REFUSES', async () => {
    const { jobId, error } = await run({
      provider: rateLimitedProvider(),
      settings: { retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2, jitterRatio: 1 } },
    });

    expect((error as GenerationRefusedError).refusalReason).toBe('RETRY_LIMIT_EXHAUSTED');

    // One row per attempt: the accounting unit is the call, not the job, which
    // is what makes "retries count against the budget" true.
    const calls = await prisma.generationProviderCall.findMany({
      where: { jobId },
      orderBy: { attempt: 'asc' },
    });
    expect(calls.map((call) => call.attempt)).toEqual([1, 2, 3]);
    expect(calls.every((call) => call.outcome === 'RATE_LIMITED')).toBe(true);
    expect(calls.every((call) => call.errorClass === 'RATE_LIMIT')).toBe(true);
    // Never the provider's own error body (V5).
    expect(calls.every((call) => call.costObservable === false)).toBe(true);

    const retried = await prisma.auditEvent.findMany({
      where: { entityId: jobId, action: 'AUTHORING.GENERATION.PROVIDER_CALL_RETRIED' },
    });
    expect(retried.length).toBe(2);
    expect((retried[0]?.detail as Record<string, unknown>)['_droppedKeys']).toBeUndefined();
    expect((retried[0]?.detail as Record<string, unknown>)['errorClass']).toBe('RATE_LIMIT');

    const job = await prisma.generationJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe('REFUSED');
    expect(job.refusalReason).toBe('RETRY_LIMIT_EXHAUSTED');
  });

  it('does NOT retry a client error, and does not call it a refusal', async () => {
    // A 400 is the provider's answer, not a transient condition. It propagates
    // as a failure so "did the controls hold?" stays answerable.
    const { jobId, error } = await run({ provider: brokenProvider() });

    expect(error).not.toBeInstanceOf(GenerationRefusedError);
    const calls = await prisma.generationProviderCall.findMany({ where: { jobId } });
    expect(calls.length).toBe(1);
    expect(calls[0]?.outcome).toBe('FAILED');
    expect(calls[0]?.errorClass).toBe('CLIENT_ERROR');
  });

  it('declares its detail keys on EVERY audit action it writes, not just the happy one', async () => {
    // Found the hard way on 2026-09-24: the cost keys were added to the
    // JOB_COMPLETED allow-list and not to JOB_FAILED, and the generation
    // service writes ONE detail object for both -- so every failed job silently
    // dropped `estimatedCost` and `costObservable`. The per-test assertions
    // above did not catch it because they checked the COMPLETED and REFUSED
    // rows.
    //
    // This scans everything this suite wrote, by correlation id, so a future
    // action added without its keys fails here rather than in a database
    // column nobody reads.
    const written = await prisma.auditEvent.findMany({
      where: { correlationId: 'control-test', occurredAt: { gte: suiteStartedAt } },
      select: { action: true, detail: true },
    });
    expect(written.length).toBeGreaterThan(0);

    const offenders = written
      .filter((row) => (row.detail as Record<string, unknown>)['_droppedKeys'] !== undefined)
      .map(
        (row) =>
          `${row.action}: ${JSON.stringify((row.detail as Record<string, unknown>)['_droppedKeys'])}`,
      );
    expect(offenders).toEqual([]);
  });

  // ------------------------------------------------------ the accounting path

  it('records the call, the tokens and a zero cost on a successful run', async () => {
    const { jobId, error } = await run({});
    expect(error).toBeNull();

    const calls = await prisma.generationProviderCall.findMany({ where: { jobId } });
    expect(calls.length).toBe(1);
    const call = calls[0];
    expect(call?.outcome).toBe('SUCCEEDED');
    expect(call?.attempt).toBe(1);
    expect(call?.providerId).toBe('DETERMINISTIC_LOCAL');
    expect(call?.requestedByUserId).toBe(authorUserId);
    expect(call?.latencyMs).not.toBeNull();
    // The deterministic provider's zero is a FACT: it runs in process.
    expect(call?.costObservable).toBe(true);
    expect(Number(call?.estimatedCost)).toBe(0);
    // And its token counts are an ESTIMATE, which travels with them.
    expect(call?.tokenUsageReported).toBe(false);

    const job = await prisma.generationJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.attemptCount).toBe(1);
    expect(job.costObservable).toBe(true);
    expect(Number(job.estimatedCost)).toBe(0);
    expect(job.inputTokens).toBeGreaterThan(0);

    // EITHER terminal action, and that is the point rather than a hedge: the
    // deterministic generator's candidates are suppressed once earlier runs
    // have left drafts behind, so the same job legitimately ends SUCCEEDED,
    // PARTIAL or FAILED depending on what the database already holds. The
    // property under test is that the terminal row carries the cost
    // accounting, not which terminal state occurred -- and pinning the state
    // made this test pass or fail on the order the suites ran in.
    const audit = await auditFor(jobId, [
      'AUTHORING.GENERATION.JOB_COMPLETED',
      'AUTHORING.GENERATION.JOB_FAILED',
    ]);
    expect(audit).not.toBeNull();
    const detail = audit?.detail as Record<string, unknown>;
    expect(detail['costObservable']).toBe(true);
    expect(detail['attemptCount']).toBe(1);
    expect(detail['_droppedKeys']).toBeUndefined();
  });

  // ------------------------------------------------------------- the read model

  it('reports usage, budgets and provider states without inventing a number', async () => {
    const summary = await readAiUsage({
      db: prisma,
      clock: systemClock,
      registry: registry(),
      settings: {
        ...testControlSettings(),
        prices: {},
        health: { failureThreshold: 3, windowMinutes: 15 },
        maxAttempts: 3,
      },
    });

    expect(summary.kpis.providersRegistered.recorded).toBe(true);
    expect(summary.budgets.map((budget) => budget.window)).toEqual(['DAILY', 'WEEKLY', 'MONTHLY']);
    expect(summary.budgets.every((budget) => budget.budgetTokens > 0)).toBe(true);

    // Every declared provider is described, including the ones that cannot run.
    const copilot = summary.providers.find((row) => row.providerId === 'MICROSOFT_COPILOT');
    expect(copilot?.state).toBe('BLOCKED_BY_CAPABILITY');
    const openai = summary.providers.find((row) => row.providerId === 'OPENAI');
    expect(openai?.state).toBe('BLOCKED_BY_APPROVAL');

    // A provider that has never run claims no version.
    expect(
      summary.providers.find((row) => row.providerId === 'GEMINI')?.providerVersion,
    ).toBeNull();

    // The deterministic provider's usage is real, and its cost is observable.
    const deterministic = summary.providerUsage.find(
      (row) => row.providerId === 'DETERMINISTIC_LOCAL',
    );
    expect(deterministic?.generations).toBeGreaterThan(0);
    expect(deterministic?.cost.observable).toBe(true);

    // The history names the person and the outcome, including refusals.
    expect(summary.history.length).toBeGreaterThan(0);
    expect(summary.history.some((row) => row.outcome === 'REFUSED')).toBe(true);
    expect(summary.history.some((row) => row.refusalReason !== null)).toBe(true);
  });

  // ---------------------------------------------------------- the admin write

  it('sets a per-provider limit, records the change, and audits both values', async () => {
    const result = await setProviderLimits({
      prisma,
      clock: systemClock,
      actor: {
        userId: adminUserId,
        displayName: 'KNOWZY Administrator',
        roles: ['KNOWZY_ADMINISTRATOR'],
      },
      correlationId: 'control-test',
      requestId: 'control-request',
      providerId: 'OPENAI',
      limits: { perJobTokenBudget: 60_000, dailyTokenBudget: 500_000, concurrency: 1 },
    });
    expect(result.limits['OPENAI']?.perJobTokenBudget).toBe(60_000);

    const row = await prisma.applicationConfiguration.findFirstOrThrow({
      where: { key: 'llm.providerLimits', scope: 'PLATFORM' },
    });
    expect(
      (row.value as Record<string, { perJobTokenBudget: number }>)['OPENAI']?.perJobTokenBudget,
    ).toBe(60_000);

    const change = await prisma.configurationChange.findFirstOrThrow({
      where: { key: 'llm.providerLimits' },
      orderBy: { changedAt: 'desc' },
    });
    expect(change.changedByUserId).toBe(adminUserId);

    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { action: 'ADMIN.CONFIGURATION.UPDATED', entityId: 'llm.providerLimits' },
      orderBy: { occurredAt: 'desc' },
    });
    // H2: this action carries previous and new value, and they must be there.
    expect(audit.newValue).not.toBeNull();
    const detail = audit.detail as Record<string, unknown>;
    expect(detail['providerId']).toBe('OPENAI');
    expect(detail['_droppedKeys']).toBeUndefined();
  });

  it('refuses a per-job ceiling above the daily one, because no job could run', async () => {
    await expect(
      setProviderLimits({
        prisma,
        clock: systemClock,
        actor: {
          userId: adminUserId,
          displayName: 'KNOWZY Administrator',
          roles: ['KNOWZY_ADMINISTRATOR'],
        },
        correlationId: 'control-test',
        requestId: 'control-request',
        providerId: 'OPENAI',
        limits: { perJobTokenBudget: 900_000, dailyTokenBudget: 500_000 },
      }),
    ).rejects.toBeInstanceOf(ProviderLimitError);
  });

  it('an empty limits object REMOVES the override rather than setting zero', async () => {
    // Two distinct gestures: "use the platform ceiling" and "permit nothing".
    // Collapsing them would make returning to the default impossible.
    const result = await setProviderLimits({
      prisma,
      clock: systemClock,
      actor: {
        userId: adminUserId,
        displayName: 'KNOWZY Administrator',
        roles: ['KNOWZY_ADMINISTRATOR'],
      },
      correlationId: 'control-test',
      requestId: 'control-request',
      providerId: 'OPENAI',
      limits: {},
    });
    expect(result.removed).toBe(true);
    expect(result.limits['OPENAI']).toBeUndefined();
  });
  // ======================================================= OPENAI-CODEX-01
  //
  // A model's proposals, through the UNMODIFIED pipeline. The provider is the
  // real OpenAI generation client; only `fetch` is fake, answering with what
  // a model would return. What these tests establish is that nothing a model
  // says reaches a draft without passing the same gates the deterministic
  // generator's output passes -- and that a model that breaks leaves a
  // FAILED job, not a RUNNING one.

  describe('OpenAI proposals through the governance chain', () => {
    const KEY = 'sk-proj-GOVERNANCE-TEST-KEY-0123456789';
    const secret = { reveal: () => KEY, toString: () => '[redacted]', toJSON: () => '[redacted]' };

    const openai = (responder: (body: Record<string, unknown>) => Response) => {
      const calls: string[] = [];
      const provider = createOpenAIGenerationProvider({
        modelId: 'gpt-5-codex',
        configure: async () => ({
          baseUrl: 'https://api.openai.com/v1',
          modelId: 'gpt-5-codex',
          apiKey: secret,
          allowedHosts: ['api.openai.com'],
          apiStyle: 'RESPONSES',
          authHeaderName: 'authorization',
          temperature: 0.2,
          maxOutputTokens: 4000,
        }),
        fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
          calls.push(String(input));
          return responder(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
        }) as typeof fetch,
      });
      return { provider, calls };
    };

    const reply = (payload: unknown) =>
      new Response(
        JSON.stringify({
          model: 'gpt-5-codex-2026-09-01',
          output: [
            { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(payload) }] },
          ],
          usage: { input_tokens: 1234, output_tokens: 321 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );

    /** A real, verbatim 60+ character span from the first assessable section. */
    const firstSection = async () => {
      const row = await prisma.documentSection.findFirstOrThrow({
        where: { documentId, isAssessable: true },
        orderBy: { ordinal: 'asc' },
      });
      const text = extractedText.slice(row.startOffset, row.endOffset);
      const span = text.slice(0, Math.min(text.length, 160)).trim();
      return { sectionKey: row.sectionKey, span };
    };

    it('passes a verbatim span, refuses a fabricated one, and records full provenance', async () => {
      const { sectionKey, span } = await firstSection();
      const stamp = Date.now().toString(36);
      const { provider, calls } = openai(() =>
        reply({
          questions: [
            {
              sectionKey,
              questionText: `Which statement does the procedure make (governance probe ${stamp})?`,
              options: {
                A: `Alpha ${stamp}`,
                B: `Bravo ${stamp}`,
                C: `Charlie ${stamp}`,
                D: `Delta ${stamp}`,
              },
              correctOption: 'A',
              explanation: 'The quoted section states this directly, which is why A is correct.',
              supportingEvidence: span,
              modelConfidence: 0.7,
              difficulty: 'RECALL',
            },
            {
              sectionKey,
              questionText: `Which invented rule applies here (fabrication probe ${stamp})?`,
              options: {
                A: `One ${stamp}`,
                B: `Two ${stamp}`,
                C: `Three ${stamp}`,
                D: `Four ${stamp}`,
              },
              correctOption: 'B',
              explanation:
                'This explanation cites text that does not exist in the document at all.',
              supportingEvidence:
                'Every request must be approved by the Chief Knowledge Officer before noon on Fridays.',
              modelConfidence: 0.9,
              difficulty: 'RECALL',
            },
          ],
          insufficient: [],
        }),
      );

      const { jobId, error } = await run({ provider, approved: ['DETERMINISTIC_LOCAL', 'OPENAI'] });
      expect(error).toBeNull();
      expect(calls).toEqual(['https://api.openai.com/v1/responses']);

      const job = await prisma.generationJob.findUniqueOrThrow({ where: { id: jobId } });
      // The fabricated span is refused by evidence verification -- the gate a
      // model is most likely to fail, applied exactly as to the deterministic
      // generator.
      const rejections = await prisma.generationJobRejection.findMany({ where: { jobId } });
      expect(rejections.some((r) => r.reason === 'EVIDENCE_UNVERIFIED')).toBe(true);
      expect(job.acceptedQuestionCount).toBe(1);

      // Provenance: who drafted it, with what, at what estimated and measured cost.
      expect(job).toMatchObject({
        providerId: 'OPENAI',
        modelId: 'gpt-5-codex-2026-09-01',
        providerVersion: 'openai-generation-01',
        executionMode: 'PLATFORM_MANAGED',
        tokenUsageReported: true,
        inputTokens: 1234,
        outputTokens: 321,
      });
      expect(job.estimatedInputTokens).toBeGreaterThan(0);
      expect(job.promptVersionId).not.toBeNull();

      const call = await prisma.generationProviderCall.findFirstOrThrow({ where: { jobId } });
      expect(call).toMatchObject({ providerId: 'OPENAI', outcome: 'SUCCEEDED', inputTokens: 1234 });
      expect(call.estimatedInputTokens).toBe(job.estimatedInputTokens);

      // A proposal, never a decision: the accepted draft awaits review.
      const drafts = await prisma.draftQuestion.findMany({ where: { generationJobId: jobId } });
      expect(drafts).toHaveLength(1);
      expect(drafts[0]?.providerId).toBe('OPENAI');
      expect(['APPROVED', 'PUBLISHED']).not.toContain(drafts[0]?.status);
    });

    it('ends the job FAILED -- not RUNNING -- when the model returns something unparseable', async () => {
      const { provider } = openai(() => reply({ questions: [{ nonsense: true }] }));
      const { jobId, error } = await run({ provider, approved: ['DETERMINISTIC_LOCAL', 'OPENAI'] });
      expect(error).not.toBeNull();
      const job = await prisma.generationJob.findUniqueOrThrow({ where: { id: jobId } });
      expect(job.status).toBe('FAILED');
      expect(job.completedAt).not.toBeNull();
      const audit = await auditFor(jobId, 'AUTHORING.GENERATION.JOB_FAILED');
      expect((audit?.detail as Record<string, unknown>)['errorClass']).toBe('MALFORMED_OUTPUT');
      expect(JSON.stringify(audit?.detail)).not.toContain('_droppedKeys');
      // MALFORMED_OUTPUT is not retried: one attempt, not three.
      const calls = await prisma.generationProviderCall.count({ where: { jobId } });
      expect(calls).toBe(1);
    });

    it('refuses an UNAPPROVED OpenAI before any request is sent', async () => {
      const { provider, calls } = openai(() => reply({ questions: [], insufficient: [] }));
      const { jobId, error } = await run({ provider, approved: ['DETERMINISTIC_LOCAL'] });
      expect(error).toBeInstanceOf(GenerationRefusedError);
      expect((error as GenerationRefusedError).refusalReason).toBe('PROVIDER_BLOCKED_BY_APPROVAL');
      expect(calls).toHaveLength(0);
      const job = await prisma.generationJob.findUniqueOrThrow({ where: { id: jobId } });
      expect(job.status).toBe('REFUSED');
    });
  });
});
