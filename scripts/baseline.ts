// Deterministic-generator baseline capture (PILOT-T2 item 4).
//
// Produces the control arm for LIVE_CLAUDE_EVALUATION_PLAN.md §4.2. Everything
// runs through the real API with real policy checks and the full, unmodified
// gate chain, so the numbers are what the platform actually does rather than
// what a harness reproduces.
//
//   npx tsx scripts/baseline.ts --generate "<source name>"   run a job
//   npx tsx scripts/baseline.ts --report                     print the table
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
    domains: { domainId: string; topics: { topicId: string }[] }[];
  }>('/api/v1/authoring/taxonomy');
  const domain = taxonomy.domains[0];
  const topic = domain?.topics[0];
  if (domain === undefined || topic === undefined) throw new Error('No seeded taxonomy.');

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

const report = async (): Promise<void> => {
  const rows = (
    await prisma.$queryRaw<
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
               AND s.last_generation_outcome <> 'REFUSED'
           )::bigint AS unresolved
    FROM knowledge_source ks
    JOIN knowledge_document d ON d.source_id = ks.id
    LEFT JOIN document_section s ON s.document_id = d.id
    GROUP BY ks.name
    ORDER BY ks.name`
  ).map<Accounting>((r) => ({
    source: r.source,
    documents: Number(r.documents),
    sections: Number(r.sections),
    assessable: Number(r.assessable),
    attempted: Number(r.attempted),
    generated: Number(r.generated),
    refused: Number(r.refused),
    unresolved: Number(r.unresolved),
  }));

  console.log('\nSection accounting, per knowledge source');
  console.log('========================================');
  for (const r of rows) {
    const coverage =
      r.assessable === 0 ? '—' : `${((r.generated / r.assessable) * 100).toFixed(1)}%`;
    console.log(`\n${r.source}`);
    console.log(`  documents ${r.documents} · sections ${r.sections}`);
    console.log(
      `  assessable ${r.assessable} · attempted ${r.attempted} · generated ${r.generated}` +
        ` · refused ${r.refused} · unresolved ${r.unresolved}`,
    );
    console.log(`  coverage ${coverage}  (generated / assessable)`);
  }

  // Questions, evidence verification and duplicates, per source.
  const questions = await prisma.$queryRaw<
    {
      source: string;
      questions: bigint;
      strict: bigint;
      exact: bigint;
      avg_span: number | null;
      avg_confidence: number | null;
    }[]
  >`
    SELECT ks.name AS source,
           count(*)::bigint AS questions,
           count(*) FILTER (WHERE q.evidence_verification_mode = 'STRICT')::bigint AS strict,
           count(*) FILTER (WHERE q.evidence_similarity_score = 1.000)::bigint AS exact,
           avg(length(q.supporting_evidence)) AS avg_span,
           avg(q.confidence_score) AS avg_confidence
    FROM draft_question q
    JOIN knowledge_source ks ON ks.id = q.source_id
    GROUP BY ks.name
    ORDER BY ks.name`;

  console.log('\n\nQuestions and evidence verification');
  console.log('===================================');
  for (const r of questions) {
    console.log(`\n${r.source}`);
    console.log(
      `  questions ${Number(r.questions)} · STRICT ${Number(r.strict)}` +
        ` · exact (similarity 1.000) ${Number(r.exact)}`,
    );
    console.log(
      `  mean evidence span ${Math.round(Number(r.avg_span ?? 0))} chars` +
        ` · mean composite confidence ${Number(r.avg_confidence ?? 0).toFixed(3)}`,
    );
  }

  // Rejections by reason, per source. This is where evidence refusals and
  // duplicate blocks appear, and they are the two that matter most.
  const rejections = await prisma.$queryRaw<{ source: string; reason: string; count: bigint }[]>`
    SELECT ks.name AS source, r.reason::text AS reason, count(*)::bigint AS count
    FROM generation_job_rejection r
    JOIN generation_job j ON j.id = r.job_id
    JOIN knowledge_source ks ON ks.id = j.source_id
    GROUP BY ks.name, r.reason
    ORDER BY ks.name, count(*) DESC`;

  console.log('\n\nRejections by reason (every generation job on record)');
  console.log('====================================================');
  let current = '';
  for (const r of rejections) {
    if (r.source !== current) {
      console.log(`\n${r.source}`);
      current = r.source;
    }
    console.log(`  ${r.reason.padEnd(24)} ${Number(r.count)}`);
  }

  // Duplicate disposition on accepted drafts, split by whether the match sits
  // in the SAME corpus or a different one. Both corpora derive from the same
  // SOPs, so a cross-corpus match is expected and says nothing about either
  // generator -- reporting one combined rate would be misleading.
  const duplicates = await prisma.$queryRaw<
    { source: string; disposition: string | null; matches: bigint; max_similarity: number | null }[]
  >`
    SELECT ks.name AS source,
           q.duplicate_disposition::text AS disposition,
           count(*)::bigint AS matches,
           max(q.max_similarity_score) AS max_similarity
    FROM draft_question q
    JOIN knowledge_source ks ON ks.id = q.source_id
    GROUP BY ks.name, q.duplicate_disposition
    ORDER BY ks.name`;

  console.log('\n\nDuplicate disposition on accepted drafts');
  console.log('========================================');
  for (const r of duplicates) {
    console.log(
      `  ${r.source.padEnd(50)} ${String(r.disposition ?? 'none').padEnd(12)}` +
        ` ${Number(r.matches)} draft(s), max similarity ${Number(r.max_similarity ?? 0).toFixed(3)}`,
    );
  }

  console.log(
    '\nNote: both corpora derive from the same SOPs, so a duplicate match ACROSS them is' +
      "\nexpected and is not a property of the generator. The evaluation plan's controlled" +
      '\narm must run on a clean database for this metric to mean anything.',
  );
};

// ---------------------------------------------------------------------------

const run = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const generateIndex = args.indexOf('--generate');
  try {
    if (generateIndex !== -1) {
      const name = args[generateIndex + 1];
      if (name === undefined) throw new Error('--generate requires a source name.');
      await generate(name);
    }
    if (args.includes('--report') || generateIndex === -1) await report();
  } finally {
    await prisma.$disconnect();
  }
};

void run();
