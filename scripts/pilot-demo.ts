// Restores the demonstration environment on the transitional pilot path.
//
// The whole PILOT-T1 pipeline, in order, against whatever root the pilot
// FILE_REPOSITORY source is configured with — the committed fixture mirror by
// default, or a real synchronized folder once `PILOT_MIRROR_ROOT` names one:
//
//   Test Connection → Synchronize → Preflight → Decide → Generate
//   → Claim → Submit → (gate 13 refusal) → Approve → Publish
//   → Assessment create/validate/submit/approve/publish
//   → Learner attempt → Score
//
// It exists because `npm run verify` truncates the development database, so a
// demonstration has to be rebuildable on demand rather than assembled by hand.
// Re-running it after a reset is the documented recovery.
//
//   npx tsx scripts/pilot-demo.ts
//
// Every identity is a seeded local demo subject and every call goes through the
// real API with a real policy check, so the run exercises authorization exactly
// as a person clicking would. Nothing here bypasses a gate.

const API = process.env['PILOT_DEMO_API'] ?? 'http://localhost:8080';
const SOURCE_NAME = 'KNOWZY Real-World Pilot SOP Corpus';

const SUBJECTS = {
  sourceAdmin: 'source-administrator@local.invalid',
  author: 'author@local.invalid',
  approver: 'approver@local.invalid',
  publisher: 'publisher@local.invalid',
  assessmentManager: 'assessment-manager@local.invalid',
  learner: 'learner@local.invalid',
} as const;

interface CallOptions {
  readonly method?: 'GET' | 'POST';
  readonly body?: unknown;
  readonly idempotencyKey?: string;
  /** Expected non-2xx status, for the refusal this run deliberately provokes. */
  readonly expectStatus?: number;
}

const call = async <T>(subject: string, path: string, options: CallOptions = {}): Promise<T> => {
  const headers: Record<string, string> = { 'x-knowzy-subject': subject };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  // At least 8 characters, which the answer endpoint enforces.
  if (options.idempotencyKey !== undefined) headers['idempotency-key'] = options.idempotencyKey;

  const response = await fetch(`${API}${path}`, {
    method: options.method ?? 'GET',
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });

  const text = await response.text();
  if (options.expectStatus !== undefined) {
    if (response.status !== options.expectStatus) {
      throw new Error(
        `${path} returned ${response.status}, expected ${options.expectStatus}: ${text.slice(0, 200)}`,
      );
    }
    return JSON.parse(text) as T;
  }
  if (!response.ok) {
    throw new Error(`${path} failed ${response.status}: ${text.slice(0, 300)}`);
  }
  return (text === '' ? {} : JSON.parse(text)) as T;
};

const step = (n: string): void => console.log(`\n── ${n}`);
const say = (...parts: unknown[]): void => console.log('  ', ...parts);

const main = async (): Promise<void> => {
  // ── 1. The source ────────────────────────────────────────────────────────
  step('1. Locate the pilot source');
  const sources = await call<{
    sources: { sourceId: string; name: string; sourceType: string }[];
  }>(SUBJECTS.sourceAdmin, '/api/v1/authoring/sources');
  const source = sources.sources.find((candidate) => candidate.name === SOURCE_NAME);
  if (source === undefined) {
    throw new Error(
      `No source named "${SOURCE_NAME}". Run the database seed first: ` +
        'docker compose -f infrastructure/compose/docker-compose.yml up migrate',
    );
  }
  say(source.sourceId, `(${source.sourceType})`);

  // ── 2. Test Connection ───────────────────────────────────────────────────
  step('2. Test Connection');
  const probe = await call<{
    ok: boolean;
    checks: { name: string; outcome: string; detail: string }[];
  }>(SUBJECTS.sourceAdmin, `/api/v1/authoring/sources/${source.sourceId}/test-connection`, {
    method: 'POST',
  });
  const byOutcome = probe.checks.reduce<Record<string, number>>((acc, check) => {
    acc[check.outcome] = (acc[check.outcome] ?? 0) + 1;
    return acc;
  }, {});
  say(`ok=${probe.ok}`, `${probe.checks.length} checks`, JSON.stringify(byOutcome));
  for (const check of probe.checks.filter((c) => c.outcome === 'FAIL')) {
    say('FAIL:', check.name, '—', check.detail);
  }
  if (!probe.ok) throw new Error('Test Connection failed; the corpus is not readable.');

  // ── 3. Synchronize ───────────────────────────────────────────────────────
  step('3. Synchronize (FULL)');
  const sync = await call<{
    outcome: string;
    scanned: number;
    added: number;
    modified: number;
    deleted: number;
    failed: number;
    extractedChars: number;
  }>(SUBJECTS.sourceAdmin, `/api/v1/authoring/sources/${source.sourceId}/synchronize`, {
    method: 'POST',
    body: { mode: 'FULL' },
  });
  say(
    sync.outcome,
    `scanned=${sync.scanned} added=${sync.added} modified=${sync.modified}`,
    `deleted=${sync.deleted} failed=${sync.failed} chars=${sync.extractedChars}`,
  );

  // ── 4. The documents ─────────────────────────────────────────────────────
  step('4. Documents available for generation');
  const containers = await call<{ containers: { containerId: string }[] }>(
    SUBJECTS.author,
    `/api/v1/authoring/sources/${source.sourceId}/containers`,
  );
  const documentIds: string[] = [];
  for (const container of containers.containers) {
    const items = await call<{
      items: {
        documentId: string | null;
        name: string;
        sectionCount: number | null;
        isSelectable: boolean;
      }[];
    }>(
      SUBJECTS.author,
      `/api/v1/authoring/sources/${source.sourceId}/items?containerId=${encodeURIComponent(
        container.containerId,
      )}&recursive=true`,
    );
    for (const item of items.items) {
      if (item.documentId === null || !item.isSelectable) continue;
      documentIds.push(item.documentId);
      say(`${String(item.sectionCount ?? 0).padStart(2)} sections`, item.name);
    }
  }
  if (documentIds.length === 0) throw new Error('No selectable documents after synchronization.');

  // ── 5. Preflight and the recorded decision ───────────────────────────────
  step('5. Preflight, then record the decision');
  const preflight = await call<{ preflightId: string; recommendation: string }>(
    SUBJECTS.author,
    '/api/v1/authoring/generation/preflight',
    { method: 'POST', body: { sourceId: source.sourceId, documentIds } },
  );
  say('recommendation', preflight.recommendation);
  await call(
    SUBJECTS.author,
    `/api/v1/authoring/generation/preflight/${preflight.preflightId}/decide`,
    { method: 'POST', body: { chosenAction: 'GENERATE_NEW' } },
  );
  say('decision recorded — a preflight authorizes nothing until one is');

  // ── 6. Generate ──────────────────────────────────────────────────────────
  step('6. Generate');
  const taxonomy = await call<{
    domains: { domainId: string; code: string; topics: { topicId: string }[] }[];
  }>(SUBJECTS.author, '/api/v1/authoring/taxonomy');
  const domain = taxonomy.domains[0];
  const topic = domain?.topics[0];
  if (domain === undefined || topic === undefined) throw new Error('No seeded taxonomy.');

  interface Job {
    readonly acceptedQuestionCount: number;
    readonly requestedQuestionCount: number;
    readonly sectionCount: number;
    readonly rejections: readonly unknown[];
    readonly insufficientEvidenceSections: readonly unknown[];
    readonly tokens: { readonly input: number; readonly output: number };
  }

  // A second run over the same corpus legitimately has nothing to generate:
  // every assessable section is already covered, so the platform refuses with
  // GENERATION_SCOPE_EMPTY rather than producing a duplicate. That is the
  // governance working, so it is reported and the run continues.
  let job: Job | null = null;
  try {
    job = await call<Job>(SUBJECTS.author, '/api/v1/authoring/generation-jobs', {
      method: 'POST',
      body: {
        preflightId: preflight.preflightId,
        scope: 'ENTIRE_DOCUMENT',
        domainId: domain.domainId,
        topicId: topic.topicId,
        reasonCode: 'NEW_KNOWLEDGE',
        requestedQuestionCount: 6,
      },
    });
  } catch (error) {
    const message = (error as Error).message;
    if (!message.includes('GENERATION_SCOPE_EMPTY')) throw error;
    say('refused: GENERATION_SCOPE_EMPTY — every assessable section is already covered');
  }

  if (job !== null) {
    say(
      `accepted ${job.acceptedQuestionCount}/${job.requestedQuestionCount}`,
      `sections=${job.sectionCount}`,
      `rejections=${job.rejections.length}`,
      `insufficient=${job.insufficientEvidenceSections.length}`,
      `tokens=${job.tokens.input}/${job.tokens.output}`,
    );
    say('a non-zero rejection count would mean evidence verification refused a candidate');
  }

  // ── 7. Claim and submit ──────────────────────────────────────────────────
  //
  // Re-runnable on an already-populated database. Generation suppresses a
  // duplicate rather than producing one, so a second run legitimately accepts
  // nothing and preflight recommends VIEW_EXISTING. The run then carries on
  // with the questions that already exist instead of failing, because the
  // point is a working demonstration, not a fresh one.
  step('7. Claim and submit, as the author');
  const queue = await call<{ items: { questionId: string }[] }>(
    SUBJECTS.author,
    '/api/v1/authoring/questions/review?queue=author',
  );
  let questionIds = queue.items.map((item) => item.questionId);
  const freshlyGenerated = questionIds.length > 0;
  if (!freshlyGenerated) {
    const existing = await call<{ items: { questionId: string }[] }>(
      SUBJECTS.author,
      '/api/v1/authoring/questions/review?queue=all',
    );
    questionIds = existing.items.map((item) => item.questionId);
    say(`nothing new to author; reusing ${questionIds.length} existing question(s)`);
  }
  if (freshlyGenerated) {
    for (const questionId of questionIds) {
      await call(SUBJECTS.author, `/api/v1/authoring/questions/${questionId}/claim`, {
        method: 'POST',
      });
      await call(SUBJECTS.author, `/api/v1/authoring/questions/${questionId}/submit`, {
        method: 'POST',
        body: { comment: 'Grounded in the synchronized pilot SOP corpus.' },
      });
    }
    say(`${questionIds.length} claimed and submitted`);
  }

  // ── 8. Gate 13, demonstrated rather than asserted ────────────────────────
  step('8. Separation of duties');
  const first = freshlyGenerated ? questionIds[0] : undefined;
  if (first !== undefined) {
    await call(SUBJECTS.author, `/api/v1/authoring/questions/${first}/approve`, {
      method: 'POST',
      body: { comment: 'attempting to approve my own draft' },
      expectStatus: 403,
    });
    say('the author was REFUSED (403) on their own draft — gate 13, before anything was recorded');
  } else {
    say('skipped: nothing newly submitted to attempt a self-approval on');
  }

  // ── 9. Approve, as a different identity ──────────────────────────────────
  step('9. Approve, as a different identity');
  for (const questionId of freshlyGenerated ? questionIds : []) {
    await call(SUBJECTS.approver, `/api/v1/authoring/questions/${questionId}/approve`, {
      method: 'POST',
      body: { comment: 'Verified against the source document.' },
    });
  }
  say(
    freshlyGenerated
      ? `${questionIds.length} approved by ${SUBJECTS.approver}`
      : 'already approved',
  );

  // ── 10. Publish ──────────────────────────────────────────────────────────
  step('10. Publish to the Question Bank');
  const published = freshlyGenerated
    ? await call<{
        publishedCount: number;
        failedCount: number;
        items: { outcome: string; bankItemId: string | null }[];
      }>(SUBJECTS.publisher, '/api/v1/authoring/question-bank/publish', {
        method: 'POST',
        body: { questionIds },
      })
    : { publishedCount: 0, failedCount: 0, items: [] };
  say(`published=${published.publishedCount} failed=${published.failedCount}`);
  for (const item of published.items) say(' ', item.outcome, item.bankItemId ?? '');
  if (!freshlyGenerated) {
    say('skipped: nothing newly approved to publish');
  } else if (published.publishedCount === 0) {
    say(
      'NOTE: nothing was published. The mock bank persists OUTSIDE the database, so after a ' +
        'database reset its file can still hold items under the same QuestionIDs and the ' +
        'adapter reports ALREADY_PUBLISHED. Delete fixtures/bank/.state/*.json and re-run for a ' +
        'clean publish.',
    );
  }

  // ── 11. The assessment ───────────────────────────────────────────────────
  step('11. Assessment');
  const stamp = Date.now().toString(36);

  // Reuse a published assessment when one is already available to the learner.
  // Creating a second on every run would leave a pile of near-identical
  // assessments in the demonstration, which is untidy rather than useful.
  const available = await call<{
    assessments: { assessmentId: string; name: string; startable: boolean }[];
  }>(SUBJECTS.learner, '/api/v1/learning/assessments');
  const reusable = available.assessments.find((candidate) => candidate.startable);
  const assessment =
    reusable !== undefined
      ? { assessmentId: reusable.assessmentId, assessmentVersionId: '' }
      : await call<{ assessmentId: string; assessmentVersionId: string }>(
          SUBJECTS.assessmentManager,
          '/api/v1/authoring/assessments',
          {
            method: 'POST',
            body: {
              name: `Pilot SOP Corpus Assessment ${stamp}`,
              slug: `pilot-sop-corpus-${stamp}`,
              domainId: domain.domainId,
              topicIds: [topic.topicId],
              description: 'Built from the synchronized pilot SOP corpus.',
              questionCount: Math.min(4, questionIds.length),
              passPercentage: 70,
            },
          },
        );
  const version = assessment.assessmentVersionId;
  if (version === '') {
    say(`reusing the published assessment "${reusable?.name ?? ''}"`);
  } else {
    const validation = await call<{ valid: boolean; poolSize: number }>(
      SUBJECTS.assessmentManager,
      `/api/v1/authoring/assessments/${version}/validate`,
    );
    say(`validate: valid=${validation.valid} poolSize=${validation.poolSize}`);
    await call(SUBJECTS.assessmentManager, `/api/v1/authoring/assessments/${version}/submit`, {
      method: 'POST',
    });
    // The seeded Assessment Manager role holds manage, approve AND publish, so
    // one identity completes this. Question approval enforces gate 13; the
    // assessment workflow does not, and that asymmetry is worth knowing.
    await call(SUBJECTS.assessmentManager, `/api/v1/authoring/assessments/${version}/approve`, {
      method: 'POST',
    });
    const release = await call<{ poolSize: number }>(
      SUBJECTS.assessmentManager,
      `/api/v1/authoring/assessments/${version}/publish`,
      { method: 'POST' },
    );
    say(`published with a pinned pool of ${release.poolSize}`);
  }

  // ── 12. A learner attempt ────────────────────────────────────────────────
  step('12. Learner attempt');
  const session = await call<{ sessionId: string }>(SUBJECTS.learner, '/api/v1/learning/sessions', {
    method: 'POST',
    body: { assessmentId: assessment.assessmentId },
    idempotencyKey: `pilot-demo-start-${stamp}`,
  });

  interface Current {
    readonly currentIndex: number;
    readonly totalQuestions: number;
    readonly question?: {
      readonly questionText?: string;
      readonly options?: Readonly<Record<string, string>>;
    };
  }

  // A knowledgeable learner, simulated honestly.
  //
  // The harness reads each question's proposed answer through the AUTHORING
  // API as the author identity, which legitimately holds it, and matches it to
  // the served question by text. The LEARNER endpoint never returns an answer
  // key and is not asked to — that protection is asserted below.
  //
  // One answer is then deliberately left wrong, so the result demonstrates
  // both a pass and a real per-topic knowledge gap rather than a flat 100%.
  const answerKey = new Map<string, string>();
  for (const questionId of questionIds) {
    const detail = await call<{
      questionText: string;
      proposedCorrectOption: string;
    }>(SUBJECTS.author, `/api/v1/authoring/questions/${questionId}`);
    answerKey.set(detail.questionText, detail.proposedCorrectOption);
  }

  let answered = 0;
  let deliberatelyWrong = 0;
  for (;;) {
    const current = await call<Current>(
      SUBJECTS.learner,
      `/api/v1/learning/sessions/${session.sessionId}/current`,
    );
    const options = current.question?.options;
    if (options === undefined) break;

    // Answer-key protection, checked rather than assumed: nothing in the
    // served payload may reveal the correct option.
    const servedPayload = JSON.stringify(current);
    if (/correctOption|proposedCorrectOption|isCorrect/.test(servedPayload)) {
      throw new Error('The learner payload leaked an answer key.');
    }

    const keys = Object.keys(options);
    const correct = answerKey.get(current.question?.questionText ?? '') ?? keys[0];

    // Exactly one wrong answer, on the last question.
    const isLast = current.currentIndex === current.totalQuestions - 1;
    let choice = correct;
    if (isLast && deliberatelyWrong === 0) {
      choice = keys.find((key) => key !== correct) ?? correct;
      deliberatelyWrong += 1;
    }

    await call(SUBJECTS.learner, `/api/v1/learning/sessions/${session.sessionId}/answers`, {
      method: 'POST',
      body: { questionIndex: current.currentIndex, selectedOption: choice },
      idempotencyKey: `pilot-demo-answer-${stamp}-${current.currentIndex}`,
    });
    answered += 1;
    if (answered >= current.totalQuestions) break;
  }
  say(`${answered} answered (one deliberately wrong, so the result shows a real gap)`);

  const result = await call<{
    percentageScore: number;
    correctAnswers: number;
    totalQuestions: number;
    passed: boolean;
    proficiencyBand: string;
    knowledgeGaps: unknown[];
  }>(SUBJECTS.learner, `/api/v1/learning/sessions/${session.sessionId}/complete`, {
    method: 'POST',
    body: {},
    idempotencyKey: `pilot-demo-complete-${stamp}`,
  });
  say(
    `${result.correctAnswers}/${result.totalQuestions}`,
    `= ${result.percentageScore}%`,
    result.passed ? 'PASSED' : 'FAILED',
    result.proficiencyBand,
    `gaps=${result.knowledgeGaps.length}`,
  );

  console.log('\n── Demonstration environment ready.');
};

void main().catch((error) => {
  console.error('\nFAILED:', (error as Error).message);
  process.exit(1);
});
