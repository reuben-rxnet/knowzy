// Deterministic-generator baseline capture (PILOT-T2 item 4).
//
// Produces the control arm for LIVE_CLAUDE_EVALUATION_PLAN.md §4.2. Everything
// runs through the real API with real policy checks and the full, unmodified
// gate chain, so the numbers are what the platform actually does rather than
// what a harness reproduces.
//
//   npx tsx scripts/baseline.ts --reset "<source name>"      clear the state
//   npx tsx scripts/baseline.ts --generate "<source name>"   run a job
//   npx tsx scripts/baseline.ts --report                     print the table
//   npx tsx scripts/baseline.ts --report --json <path>       machine-readable
//   npx tsx scripts/baseline.ts --report --markdown <path>   the recorded table
//
// `--reset` exists because of something found while re-measuring on 2026-09-23:
// `document_section.coverage_status` is a DENORMALIZED CLAIM that outlives the
// question it refers to. The integration suites delete `draft_question` rows
// and nothing clears the coverage flag, so the corpora reported 20 covered
// sections while the database held zero generated questions. A baseline taken
// in that state measures a memory of a run, not a run. Reset is therefore part
// of the measurement procedure, and it says what it is clearing.
//
// Two things this script deliberately does NOT do:
//
//   * relax anything. A refusal is a result, not an obstacle.
//   * hide the confound. Both corpora are derived from the same SOPs, so a
//     question generated from one can legitimately duplicate a question from
//     the other. The report gives the duplicate disposition PER SOURCE and
//     prints the caveat, because a single combined rate would be meaningless.
//     It does NOT attribute each match to a corpus -- `maxSimilarityScore` is
//     stored without the matched question, so that attribution is not
//     available from these tables. The controlled arm runs on a clean database
//     instead, which is the right fix rather than a cleverer query.

import { writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const API = process.env['PILOT_DEMO_API'] ?? 'http://localhost:8080';
const SUBJECT = 'knowzy-administrator@local.invalid';

const prisma = new PrismaClient();

interface CallOptions {
  readonly method?: 'GET' | 'POST';
  readonly body?: unknown;
}

const call = async <T>(path: string, options: CallOptions = {}): Promise<T> => {
  const response = await fetch(`${API}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'x-knowzy-subject': SUBJECT,
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} -> ${response.status}: ${text.slice(0, 400)}`);
  return (text.length === 0 ? {} : JSON.parse(text)) as T;
};

const say = (...parts: readonly string[]): void => console.log(`   ${parts.join(' ')}`);
const step = (label: string): void => console.log(`\n── ${label}`);

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

const generate = async (sourceName: string): Promise<void> => {
  step(`Baseline generation over "${sourceName}"`);

  const sources = await call<{ sources: { sourceId: string; name: string }[] }>(
    '/api/v1/authoring/sources',
  );
  const source = sources.sources.find((s) => s.name === sourceName);
  if (source === undefined) throw new Error(`No source named "${sourceName}".`);

  const containers = await call<{ containers: { containerId: string }[] }>(
    `/api/v1/authoring/sources/${source.sourceId}/containers`,
  );
  const candidates: { id: string; name: string; sections: number }[] = [];
  for (const container of containers.containers) {
    const items = await call<{
      items: {
        documentId: string | null;
        name: string;
        sectionCount: number | null;
        isSelectable: boolean;
      }[];
    }>(
      `/api/v1/authoring/sources/${source.sourceId}/items?containerId=${encodeURIComponent(
        container.containerId,
      )}&recursive=true`,
    );
    for (const item of items.items) {
      if (item.documentId === null || !item.isSelectable) continue;
      candidates.push({ id: item.documentId, name: item.name, sections: item.sectionCount ?? 0 });
    }
  }
  if (candidates.length === 0) throw new Error('No selectable documents.');

  // Ranked by ASSESSABLE section count, which is the ranking
  // PILOT-T1-CORPUS-SELECTION.md §5.1 recommends and the pilot run did not
  // use. `sectionCount` from the API is total sections, so the assessable
  // count is read from the database — the column preflight already reports.
  const assessableByDocument = new Map(
    (
      await prisma.documentSection.groupBy({
        by: ['documentId'],
        where: { documentId: { in: candidates.map((c) => c.id) }, isAssessable: true },
        _count: { _all: true },
      })
    ).map((row) => [row.documentId, row._count._all]),
  );

  const MAX_DOCUMENTS_PER_JOB = 10;
  const selected = [...candidates]
    .map((c) => ({ ...c, assessable: assessableByDocument.get(c.id) ?? 0 }))
    .sort((a, b) => b.assessable - a.assessable || (a.name < b.name ? -1 : 1))
    .slice(0, MAX_DOCUMENTS_PER_JOB);

  say(
    `${candidates.length} selectable, ${selected.length} selected (cap ${MAX_DOCUMENTS_PER_JOB})`,
  );
  for (const entry of selected) {
    say(`  ${String(entry.assessable).padStart(3)} assessable`, entry.name);
  }

  const preflight = await call<{
    preflightId: string;
    recommendation: string;
    documents: {
      documentName: string;
      coveragePercent: number;
      sections?: {
        assessable: number;
        attempted: number;
        generated: number;
        refused: number;
        unresolved: number;
      };
    }[];
  }>('/api/v1/authoring/generation/preflight', {
    method: 'POST',
    body: { sourceId: source.sourceId, documentIds: selected.map((s) => s.id) },
  });
  say('preflight recommendation', preflight.recommendation);
  for (const doc of preflight.documents) {
    const a = doc.sections;
    if (a === undefined) continue;
    say(
      `  ${doc.documentName}:`,
      `assessable=${a.assessable}`,
      `attempted=${a.attempted}`,
      `generated=${a.generated}`,
      `refused=${a.refused}`,
      `unresolved=${a.unresolved}`,
      `coverage=${doc.coveragePercent}%`,
    );
  }

  await call(`/api/v1/authoring/generation/preflight/${preflight.preflightId}/decide`, {
    method: 'POST',
    body: { chosenAction: 'GENERATE_NEW' },
  });

  const taxonomy = await call<{
    domains: { domainId: string; code: string; topics: { topicId: string }[] }[];
  }>('/api/v1/authoring/taxonomy');
  // The SEEDED domain by preference, not `domains[0]`.
  //
  // Taxonomy administration made this matter: the catalogue is ordered by
  // display name, so once a tenant adds "Rx.Net" the first domain changes and
  // the baseline would silently file its questions somewhere else. A baseline
  // has to be reproducible, and where the questions land is part of that.
  const domain =
    taxonomy.domains.find((candidate) => candidate.code === 'SUPPORT_OPS') ?? taxonomy.domains[0];
  const topic = domain?.topics[0];
  if (domain === undefined || topic === undefined) throw new Error('No seeded taxonomy.');
  say('filing under domain', domain.code);

  // Ask for one question per assessable section in scope, capped by the
  // profile's own per-job ceiling. Asking for fewer would measure the request
  // rather than the corpus.
  const inScope = selected.reduce((sum, s) => sum + s.assessable, 0);
  const requested = Math.min(50, Math.max(1, inScope));
  say(`requesting ${requested} question(s) across ${inScope} assessable section(s) in scope`);

  try {
    const job = await call<{
      jobId: string;
      acceptedQuestionCount: number;
      sectionCount: number;
      rejections: { reason: string }[];
      insufficientEvidenceSections: unknown[];
      tokens: { input: number; output: number };
    }>('/api/v1/authoring/generation-jobs', {
      method: 'POST',
      body: {
        preflightId: preflight.preflightId,
        scope: 'ENTIRE_DOCUMENT',
        domainId: domain.domainId,
        topicId: topic.topicId,
        reasonCode: 'NEW_KNOWLEDGE',
        requestedQuestionCount: requested,
      },
    });
    say(
      `accepted=${job.acceptedQuestionCount}`,
      `sections=${job.sectionCount}`,
      `rejections=${job.rejections.length}`,
      `insufficient=${job.insufficientEvidenceSections.length}`,
      `tokens=${job.tokens.input}/${job.tokens.output}`,
    );
    const byReason = new Map<string, number>();
    for (const r of job.rejections) byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + 1);
    for (const [reason, count] of byReason) say(`  rejected ${reason}: ${count}`);
  } catch (error) {
    const message = (error as Error).message;
    if (!message.includes('GENERATION_SCOPE_EMPTY')) throw error;
    say('refused: GENERATION_SCOPE_EMPTY — every assessable section in scope is already covered');
  }
};

// ---------------------------------------------------------------------------
// Reset — a measurement precondition, stated out loud
// ---------------------------------------------------------------------------

/**
 * Clears the generation STATE of one source so a baseline measures a run.
 *
 * What it clears, and nothing else:
 *
 *   - `coverage_status` back to NOT_COVERED, and the attempt counter to 0
 *   - `last_generation_outcome` back to NOT_ATTEMPTED (the column's own
 *     default; it is NOT NULL, so "never tried" has a value rather than an
 *     absence — which is the right design and worth not fighting)
 *   - `last_refusal_reason`
 *   - draft questions with `acquisition = 'GENERATED'` for that source
 *
 * What it deliberately does NOT touch: imported questions, published
 * references, the documents, the extracted text, the sections themselves, or
 * any audit row. An imported bank in the same database is a real duplicate
 * comparator and removing it would flatter the numbers.
 */
const reset = async (sourceName: string): Promise<void> => {
  step(`Reset generation state for "${sourceName}"`);

  const source = await prisma.knowledgeSource.findFirst({
    where: { name: sourceName },
    select: { id: true, name: true },
  });
  if (source === null) throw new Error(`No source named "${sourceName}".`);

  const generated = await prisma.draftQuestion.findMany({
    where: { sourceId: source.id, acquisition: 'GENERATED' },
    select: { id: true, status: true },
  });
  const published = generated.filter((q) => q.status === 'PUBLISHED');
  if (published.length > 0) {
    // Refused rather than handled: deleting a published question would orphan
    // a bank item and a QuestionID that has already left this platform.
    throw new Error(
      `${published.length} generated question(s) for this source are PUBLISHED. ` +
        'Reset refuses to delete published lineage — retire them first, or measure on a clean ' +
        'database as the evaluation plan requires for the controlled arm.',
    );
  }

  const deleted = await prisma.draftQuestion.deleteMany({
    where: { sourceId: source.id, acquisition: 'GENERATED' },
  });
  const cleared = await prisma.$executeRaw`
    UPDATE document_section s
       SET coverage_status = 'NOT_COVERED',
           generation_attempt_count = 0,
           last_generation_outcome = 'NOT_ATTEMPTED',
           last_refusal_reason = NULL
     WHERE s.document_id IN (SELECT id FROM knowledge_document WHERE source_id = ${source.id}::uuid)`;

  say(`deleted ${deleted.count} generated draft(s) · cleared state on ${cleared} section(s)`);
  say('imported questions, published references, documents and audit rows untouched');
};

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

interface Accounting {
  readonly source: string;
  readonly documents: number;
  readonly sections: number;
  readonly assessable: number;
  readonly attempted: number;
  readonly generated: number;
  readonly refused: number;
  readonly unresolved: number;
}

interface CorpusMetrics {
  readonly source: string;
  readonly documents: number;
  readonly sections: number;
  readonly assessable: number;
  readonly attempted: number;
  readonly generated: number;
  readonly refused: number;
  readonly unresolved: number;
  readonly coveragePercent: number | null;
  readonly questions: number;
  readonly evidence: {
    readonly accepted: number;
    readonly strict: number;
    readonly exactSpans: number;
    readonly unverifiedRejections: number;
    /** accepted / (accepted + unverified). Null when nothing was attempted. */
    readonly successRate: number | null;
    readonly meanSpanChars: number | null;
  };
  readonly duplicates: {
    readonly flagged: number;
    readonly blocked: number;
    readonly dispositioned: number;
    /** (flagged + blocked) / (accepted + blocked). */
    readonly rate: number | null;
    readonly maxSimilarity: number | null;
  };
  readonly confidence: {
    readonly mean: number | null;
    readonly min: number | null;
    readonly max: number | null;
    readonly components: Readonly<Record<string, number>>;
  };
  readonly rejectionsByReason: Readonly<Record<string, number>>;
}

const ratio = (numerator: number, denominator: number): number | null =>
  denominator === 0 ? null : Number((numerator / denominator).toFixed(4));

const pct = (value: number | null): string =>
  value === null ? '—' : `${(value * 100).toFixed(1)}%`;

const num = (value: number | null, digits = 3): string =>
  value === null ? '—' : value.toFixed(digits);

/**
 * Every metric work item B names, per knowledge source, from the database.
 *
 * Nothing is computed from a previous report or from a plan: each number is a
 * query. Where a metric has no denominator the value is NULL rather than 0,
 * because "no questions were attempted" and "every question failed" are
 * different facts and a zero would merge them.
 */
const collect = async (): Promise<CorpusMetrics[]> => {
  // The thresholds the platform actually uses, not a constant chosen here.
  //
  // `maxSimilarityScore` is written on EVERY draft -- it is the highest score
  // found, whatever it was -- so counting non-null values reports a 100%
  // duplicate rate on a corpus whose highest match was 0.483. A flag is a
  // score at or above the profile's flag threshold, and nothing else.
  const profile = await prisma.generationProfile.findFirstOrThrow({
    where: { isActive: true },
    select: { duplicateFlagThreshold: true, duplicateBlockThreshold: true },
  });
  const flagThreshold = Number(profile.duplicateFlagThreshold);

  const sections = await prisma.$queryRaw<
    {
      source: string;
      documents: bigint;
      sections: bigint;
      assessable: bigint;
      attempted: bigint;
      generated: bigint;
      refused: bigint;
      unresolved: bigint;
    }[]
  >`
    SELECT ks.name AS source,
           count(DISTINCT d.id)::bigint AS documents,
           count(s.id)::bigint AS sections,
           count(*) FILTER (WHERE s.is_assessable)::bigint AS assessable,
           count(*) FILTER (WHERE s.is_assessable AND s.generation_attempt_count > 0)::bigint AS attempted,
           count(*) FILTER (WHERE s.is_assessable AND s.coverage_status = 'COVERED')::bigint AS generated,
           count(*) FILTER (
             WHERE s.is_assessable AND s.coverage_status <> 'COVERED'
               AND s.last_generation_outcome = 'REFUSED'
           )::bigint AS refused,
           count(*) FILTER (
             WHERE s.is_assessable AND s.coverage_status <> 'COVERED'
               AND s.last_generation_outcome IS DISTINCT FROM 'REFUSED'
           )::bigint AS unresolved
    FROM knowledge_source ks
    JOIN knowledge_document d ON d.source_id = ks.id
    LEFT JOIN document_section s ON s.document_id = d.id
    GROUP BY ks.name
    ORDER BY ks.name`;

  const questions = await prisma.$queryRaw<
    {
      source: string;
      questions: bigint;
      strict: bigint;
      exact: bigint;
      avg_span: number | null;
      avg_confidence: number | null;
      min_confidence: number | null;
      max_confidence: number | null;
      flagged: bigint;
      dispositioned: bigint;
      max_similarity: number | null;
    }[]
  >`
    SELECT ks.name AS source,
           count(*)::bigint AS questions,
           count(*) FILTER (WHERE q.evidence_verification_mode = 'STRICT')::bigint AS strict,
           count(*) FILTER (WHERE q.evidence_similarity_score = 1.000)::bigint AS exact,
           avg(length(q.supporting_evidence)) AS avg_span,
           avg(q.confidence_score) AS avg_confidence,
           min(q.confidence_score) AS min_confidence,
           max(q.confidence_score) AS max_confidence,
           count(*) FILTER (WHERE q.max_similarity_score >= ${flagThreshold})::bigint AS flagged,
           count(*) FILTER (WHERE q.duplicate_disposition IS NOT NULL)::bigint AS dispositioned,
           max(q.max_similarity_score) AS max_similarity
    FROM draft_question q
    JOIN knowledge_source ks ON ks.id = q.source_id
    WHERE q.acquisition = 'GENERATED'
    GROUP BY ks.name`;

  const rejections = await prisma.$queryRaw<{ source: string; reason: string; count: bigint }[]>`
    SELECT ks.name AS source, r.reason::text AS reason, count(*)::bigint AS count
    FROM generation_job_rejection r
    JOIN generation_job j ON j.id = r.job_id
    JOIN knowledge_source ks ON ks.id = j.source_id
    GROUP BY ks.name, r.reason`;

  // Confidence COMPONENTS, averaged per source.
  //
  // The column holds `{ weights, components }`, so the nested `components`
  // object is the one to read -- iterating the top level finds two objects and
  // no numbers, which is how the first run of this report printed nothing at
  // all under a heading called Confidence. The keys come from the data rather
  // than a list here, so a renamed component appears as a new row instead of
  // vanishing.
  const components = await prisma.$queryRaw<{ source: string; key: string; mean: number }[]>`
    SELECT ks.name AS source, kv.key AS key, avg((kv.value)::text::numeric) AS mean
    FROM draft_question q
    JOIN knowledge_source ks ON ks.id = q.source_id
    CROSS JOIN LATERAL jsonb_each(q.confidence_components -> 'components') AS kv(key, value)
    WHERE q.acquisition = 'GENERATED'
      AND jsonb_typeof(kv.value) = 'number'
    GROUP BY ks.name, kv.key`;

  return sections.map((row) => {
    const q = questions.find((candidate) => candidate.source === row.source);
    const reasons = Object.fromEntries(
      rejections
        .filter((candidate) => candidate.source === row.source)
        .map((candidate) => [candidate.reason, Number(candidate.count)]),
    );
    const accepted = Number(q?.questions ?? 0);
    const unverified = reasons['EVIDENCE_UNVERIFIED'] ?? 0;
    const blocked = reasons['DUPLICATE'] ?? 0;
    const flagged = Number(q?.flagged ?? 0);

    return {
      source: row.source,
      documents: Number(row.documents),
      sections: Number(row.sections),
      assessable: Number(row.assessable),
      attempted: Number(row.attempted),
      generated: Number(row.generated),
      refused: Number(row.refused),
      unresolved: Number(row.unresolved),
      coveragePercent: ratio(Number(row.generated), Number(row.assessable)),
      questions: accepted,
      evidence: {
        accepted,
        strict: Number(q?.strict ?? 0),
        exactSpans: Number(q?.exact ?? 0),
        unverifiedRejections: unverified,
        successRate: ratio(accepted, accepted + unverified),
        meanSpanChars:
          q?.avg_span === null || q?.avg_span === undefined ? null : Math.round(Number(q.avg_span)),
      },
      duplicates: {
        flagged,
        blocked,
        dispositioned: Number(q?.dispositioned ?? 0),
        rate: ratio(flagged + blocked, accepted + blocked),
        maxSimilarity:
          q?.max_similarity === null || q?.max_similarity === undefined
            ? null
            : Number(Number(q.max_similarity).toFixed(3)),
      },
      confidence: {
        mean:
          q?.avg_confidence === undefined || q.avg_confidence === null
            ? null
            : Number(Number(q.avg_confidence).toFixed(3)),
        min:
          q?.min_confidence === undefined || q.min_confidence === null
            ? null
            : Number(Number(q.min_confidence).toFixed(3)),
        max:
          q?.max_confidence === undefined || q.max_confidence === null
            ? null
            : Number(Number(q.max_confidence).toFixed(3)),
        components: Object.fromEntries(
          components
            .filter((candidate) => candidate.source === row.source)
            .map((candidate) => [candidate.key, Number(Number(candidate.mean).toFixed(3))])
            .sort((a, b) => (a[0] < b[0] ? -1 : 1)),
        ),
      },
      rejectionsByReason: reasons,
    } satisfies CorpusMetrics;
  });
};

const markdown = (rows: readonly CorpusMetrics[], capturedAt: string): string => {
  const lines: string[] = [];
  lines.push('# Deterministic generator baseline');
  lines.push('');
  lines.push(`**Captured:** ${capturedAt}`);
  lines.push('**Generator:** `knowzy-deterministic-local-1` (no model call, no credential)');
  lines.push('**Produced by:** `npx tsx scripts/baseline.ts --report --markdown <path>`');
  lines.push('');
  lines.push(
    'Every number is a query against the database after a real generation run through the real ' +
      'API, with the full gate chain unmodified. Nothing here is copied from a plan.',
  );
  lines.push('');

  lines.push('## Section accounting');
  lines.push('');
  lines.push(
    '| Source | Documents | Sections | Assessable | Attempted | Generated | Refused | Unresolved | Coverage |',
  );
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const row of rows) {
    lines.push(
      `| ${row.source} | ${row.documents} | ${row.sections} | ${row.assessable} | ` +
        `${row.attempted} | ${row.generated} | ${row.refused} | ${row.unresolved} | ` +
        `${pct(row.coveragePercent)} |`,
    );
  }
  lines.push('');
  lines.push(
    '`Coverage` is generated / assessable. Since migration `0004` a refusal is recorded as ' +
      '`lastGenerationOutcome = REFUSED` and is **not** counted as coverage.',
  );
  lines.push('');

  lines.push('## Questions, evidence and duplicates');
  lines.push('');
  lines.push(
    '| Source | Questions | STRICT | Exact spans | `EVIDENCE_UNVERIFIED` | Evidence success | Mean span | Duplicate rate | Max similarity |',
  );
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const row of rows) {
    lines.push(
      `| ${row.source} | ${row.questions} | ${row.evidence.strict} | ${row.evidence.exactSpans} | ` +
        `${row.evidence.unverifiedRejections} | ${pct(row.evidence.successRate)} | ` +
        `${row.evidence.meanSpanChars ?? '—'} | ${pct(row.duplicates.rate)} | ` +
        `${num(row.duplicates.maxSimilarity)} |`,
    );
  }
  lines.push('');
  lines.push(
    '**Evidence success** is accepted / (accepted + `EVIDENCE_UNVERIFIED` rejections) — the ' +
      'proportion of candidates whose quoted span was really in the cited section. ' +
      '**Duplicate rate** is (flagged + blocked) / (accepted + blocked), where flagged means a ' +
      "score at or above the active profile's flag threshold. **Max similarity** is the highest " +
      'score observed on any accepted draft, which is the number to read: a rate of 0% with a ' +
      'max well below the threshold says the corpus produced no near-duplicates at all.',
  );
  lines.push('');

  lines.push('## Confidence');
  lines.push('');
  lines.push('| Source | Mean | Min | Max | Components (mean) |');
  lines.push('| --- | ---: | ---: | ---: | --- |');
  for (const row of rows) {
    const components = Object.entries(row.confidence.components)
      .map(([key, value]) => `${key} ${value.toFixed(3)}`)
      .join(' · ');
    lines.push(
      `| ${row.source} | ${num(row.confidence.mean)} | ${num(row.confidence.min)} | ` +
        `${num(row.confidence.max)} | ${components.length === 0 ? '—' : components} |`,
    );
  }
  lines.push('');

  lines.push('## Rejections by reason');
  lines.push('');
  for (const row of rows) {
    const reasons = Object.entries(row.rejectionsByReason).sort((a, b) => b[1] - a[1]);
    if (reasons.length === 0) continue;
    lines.push(`**${row.source}**`);
    lines.push('');
    for (const [reason, count] of reasons) lines.push(`- \`${reason}\` — ${count}`);
    lines.push('');
  }

  lines.push('## Reading this honestly');
  lines.push('');
  lines.push(
    '- Both corpora derive from the SAME SOPs, so a duplicate match across them is expected and ' +
      'is not a property of the generator. The controlled arm in ' +
      '`docs/integrations/LIVE_CLAUDE_EVALUATION_PLAN.md` must run on a clean database.',
  );
  lines.push(
    '- A question-bank import in the same database is part of the duplicate comparator. It is ' +
      'left in place deliberately: removing it would flatter the numbers.',
  );
  lines.push(
    '- `coverage_status` is a denormalized claim. Deleting a draft does not clear it, so a ' +
      'baseline must be taken after `--reset`, which is why that subcommand exists.',
  );
  return `${lines.join('\n')}\n`;
};

const report = async (jsonPath?: string, markdownPath?: string): Promise<void> => {
  const capturedAt = new Date().toISOString();
  const rows = await collect();

  console.log('\nSection accounting, per knowledge source');
  console.log('========================================');
  for (const row of rows) {
    console.log(`\n${row.source}`);
    console.log(`  documents ${row.documents} · sections ${row.sections}`);
    console.log(
      `  assessable ${row.assessable} · attempted ${row.attempted} · generated ${row.generated}` +
        ` · refused ${row.refused} · unresolved ${row.unresolved}`,
    );
    console.log(`  coverage ${pct(row.coveragePercent)}  (generated / assessable)`);
    console.log(
      `  questions ${row.questions} · STRICT ${row.evidence.strict}` +
        ` · exact ${row.evidence.exactSpans} · evidence success ${pct(row.evidence.successRate)}`,
    );
    console.log(
      `  duplicate rate ${pct(row.duplicates.rate)}` +
        ` (flagged ${row.duplicates.flagged}, blocked ${row.duplicates.blocked})` +
        ` · max similarity ${num(row.duplicates.maxSimilarity)}`,
    );
    console.log(
      `  confidence mean ${num(row.confidence.mean)}` +
        ` · min ${num(row.confidence.min)} · max ${num(row.confidence.max)}`,
    );
    for (const [key, value] of Object.entries(row.confidence.components)) {
      console.log(`    ${key.padEnd(24)} ${value.toFixed(3)}`);
    }
    const reasons = Object.entries(row.rejectionsByReason).sort((a, b) => b[1] - a[1]);
    for (const [reason, count] of reasons) console.log(`    rejected ${reason}: ${count}`);
  }

  if (jsonPath !== undefined) {
    writeFileSync(jsonPath, `${JSON.stringify({ capturedAt, corpora: rows }, null, 2)}\n`, 'utf8');
    console.log(`\nwrote ${jsonPath}`);
  }
  if (markdownPath !== undefined) {
    writeFileSync(markdownPath, markdown(rows, capturedAt), 'utf8');
    console.log(`wrote ${markdownPath}`);
  }

  console.log(
    '\nNote: both corpora derive from the same SOPs, so a duplicate match ACROSS them is' +
      "\nexpected and is not a property of the generator. The evaluation plan's controlled" +
      '\narm must run on a clean database for this metric to mean anything.',
  );
};

// ---------------------------------------------------------------------------

const valueOf = (args: readonly string[], flag: string): string | undefined => {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
  return value;
};

const run = async (): Promise<void> => {
  const args = process.argv.slice(2);
  try {
    const resetName = valueOf(args, '--reset');
    if (resetName !== undefined) await reset(resetName);

    const generateName = valueOf(args, '--generate');
    if (generateName !== undefined) await generate(generateName);

    if (args.includes('--report') || (resetName === undefined && generateName === undefined)) {
      await report(valueOf(args, '--json'), valueOf(args, '--markdown'));
    }
  } finally {
    await prisma.$disconnect();
  }
};

void run();
