// The Codex evaluation's packets and review analytics (EVAL-M1, 2026-09-28).
//
//   npx tsx scripts/evaluation.ts --export <dir> [--sources "A;B"] [--provider ID] [--jobs "j1;j2"] [--label L]
//       every draft from those sources (all sources when absent) as a review
//       packet: <label>.json, <label>.csv (opens in Excel), <label>.md
//   npx tsx scripts/evaluation.ts --blind <dir> --from <a.json;b.json> [--seed N]
//       the blind-stem packet from one or more exported packets:
//       blind-stems.csv for reviewers and blind-key.csv, kept apart from them
//   npx tsx scripts/evaluation.ts --review-analytics [--json <path>]
//       approval, rejection, change-request, comment and time-to-review
//       figures by provider, from the recorded review and approval rows
//
// READ-ONLY. It writes files and nothing to the database. Every figure comes
// from a row; a provider with no review activity reports zeros and says so,
// rather than a rate over nothing.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import {
  BLIND_HEADER,
  BLIND_KEY_HEADER,
  REVIEW_HEADER,
  blindPacket,
  reviewMarkdown,
  reviewRow,
  toCsv,
  type PacketQuestion,
} from './lib/evaluation-format';

const prisma = new PrismaClient();

const valueOf = (args: readonly string[], flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

const list = (raw: string | undefined): readonly string[] =>
  (raw ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

// ---------------------------------------------------------------------------

const loadQuestions = async (
  sources: readonly string[],
  provider: string | undefined,
  jobs: readonly string[] = [],
): Promise<PacketQuestion[]> => {
  const knowledgeSources = await prisma.knowledgeSource.findMany({
    select: { id: true, name: true },
  });
  const nameOf = new Map(knowledgeSources.map((row) => [row.id, row.name]));
  const wanted = knowledgeSources.filter((row) => sources.includes(row.name)).map((row) => row.id);
  if (sources.length > 0 && wanted.length !== sources.length) {
    throw new Error(
      `Unknown source name(s): ${sources.filter((n) => !knowledgeSources.some((r) => r.name === n)).join(', ')}`,
    );
  }
  const rows = await prisma.draftQuestion.findMany({
    where: {
      archivedAt: null,
      acquisition: 'GENERATED',
      ...(provider === undefined ? {} : { providerId: provider as never }),
      ...(sources.length === 0 ? {} : { sourceId: { in: wanted } }),
      // Exactly one arm's questions: the jobs that arm ran, so a question kept
      // from an earlier run (published lineage is never deleted) is not
      // counted as this arm's.
      ...(jobs.length === 0 ? {} : { generationJobId: { in: [...jobs] } }),
    },
    select: {
      id: true,
      providerId: true,
      modelId: true,
      generationJobId: true,
      sourceDocumentName: true,
      sectionKey: true,
      status: true,
      questionText: true,
      answerPayload: true,
      explanation: true,
      supportingEvidence: true,
      evidenceVerificationMode: true,
      confidenceScore: true,
      maxSimilarityScore: true,
      createdAt: true,
      sourceId: true,
    },
    orderBy: [{ sourceDocumentName: 'asc' }, { createdAt: 'asc' }],
  });
  return rows.map((row) => {
    const payload = (row.answerPayload ?? {}) as {
      options?: Record<string, string>;
      correctOption?: string;
    };
    return {
      questionId: row.id,
      providerId: String(row.providerId ?? 'UNKNOWN'),
      modelId: row.modelId,
      jobId: row.generationJobId,
      sourceName: nameOf.get(row.sourceId) ?? '',
      documentName: row.sourceDocumentName ?? '',
      sectionKey: row.sectionKey ?? '',
      status: String(row.status),
      stem: row.questionText,
      options: payload.options ?? {},
      correctOption: payload.correctOption ?? null,
      explanation: row.explanation ?? '',
      evidence: row.supportingEvidence ?? '',
      evidenceMode:
        row.evidenceVerificationMode === null ? null : String(row.evidenceVerificationMode),
      confidence: row.confidenceScore === null ? null : Number(row.confidenceScore),
      maxSimilarity: row.maxSimilarityScore === null ? null : Number(row.maxSimilarityScore),
      createdAt: row.createdAt.toISOString(),
    };
  });
};

const exportPacket = async (args: readonly string[]): Promise<void> => {
  const dir = valueOf(args, '--export') ?? '';
  const sources = list(valueOf(args, '--sources'));
  const provider = valueOf(args, '--provider');
  const label = valueOf(args, '--label') ?? 'review-packet';
  const questions = await loadQuestions(sources, provider, list(valueOf(args, '--jobs')));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${label}.json`), JSON.stringify(questions, null, 2));
  writeFileSync(join(dir, `${label}.csv`), toCsv(REVIEW_HEADER, questions.map(reviewRow)));
  writeFileSync(join(dir, `${label}.md`), reviewMarkdown(`Review packet — ${label}`, questions));
  const byProvider = new Map<string, number>();
  for (const q of questions) byProvider.set(q.providerId, (byProvider.get(q.providerId) ?? 0) + 1);
  console.log(
    `exported ${questions.length} question(s) to ${join(dir, label)}.{json,csv,md}:`,
    [...byProvider.entries()].map(([id, n]) => `${id}=${n}`).join(' '),
  );
};

const exportBlind = (args: readonly string[]): void => {
  const dir = valueOf(args, '--blind') ?? '';
  const seed = Number(valueOf(args, '--seed') ?? '20260928');
  const questions = list(valueOf(args, '--from')).flatMap(
    (path) => JSON.parse(readFileSync(path, 'utf8')) as PacketQuestion[],
  );
  const packet = blindPacket(questions, seed);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'blind-stems.csv'), toCsv(BLIND_HEADER, packet.rows));
  writeFileSync(join(dir, 'blind-key.csv'), toCsv(BLIND_KEY_HEADER, packet.key));
  console.log(
    `blind packet: ${packet.rows.length} stem(s), seed ${seed}. Give reviewers blind-stems.csv only; keep blind-key.csv apart.`,
  );
};

// ---------------------------------------------------------------------------

interface ProviderReview {
  readonly providerId: string;
  readonly drafts: number;
  readonly byStatus: Record<string, number>;
  readonly approvalDecisions: Record<string, number>;
  readonly approvalRate: number | null;
  readonly rejectionRate: number | null;
  readonly changeRequests: number;
  readonly reviewComments: number;
  readonly medianHoursToFirstDecision: number | null;
  readonly decided: number;
}

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0);
};

const reviewAnalytics = async (args: readonly string[]): Promise<void> => {
  const drafts = await prisma.draftQuestion.findMany({
    where: { archivedAt: null, acquisition: 'GENERATED' },
    select: { id: true, providerId: true, status: true, createdAt: true },
  });
  const ids = drafts.map((d) => d.id);
  const approvals = await prisma.questionApproval.findMany({
    where: { questionId: { in: ids } },
    select: { questionId: true, decision: true, decidedAt: true },
  });
  const reviews = await prisma.questionReview.findMany({
    where: { questionId: { in: ids } },
    select: { questionId: true, comment: true, outcome: true },
  });
  const changeAudits = await prisma.auditEvent.findMany({
    where: { action: 'AUTHORING.QUESTION.CHANGES_REQUESTED', entityId: { in: ids } },
    select: { entityId: true },
  });

  const providerOf = new Map(drafts.map((d) => [d.id, String(d.providerId ?? 'UNKNOWN')]));
  const createdOf = new Map(drafts.map((d) => [d.id, d.createdAt.getTime()]));
  const providers = [...new Set(drafts.map((d) => String(d.providerId ?? 'UNKNOWN')))].sort();

  const out: ProviderReview[] = providers.map((providerId) => {
    const mine = drafts.filter((d) => String(d.providerId ?? 'UNKNOWN') === providerId);
    const byStatus: Record<string, number> = {};
    for (const d of mine) byStatus[String(d.status)] = (byStatus[String(d.status)] ?? 0) + 1;
    const myApprovals = approvals.filter((a) => providerOf.get(a.questionId) === providerId);
    const decisions: Record<string, number> = {};
    for (const a of myApprovals)
      decisions[String(a.decision)] = (decisions[String(a.decision)] ?? 0) + 1;
    const decided = myApprovals.length;
    const firstDecision = new Map<string, number>();
    for (const a of myApprovals) {
      const at = a.decidedAt.getTime();
      const prior = firstDecision.get(a.questionId);
      if (prior === undefined || at < prior) firstDecision.set(a.questionId, at);
    }
    const hours = [...firstDecision.entries()].map(
      ([questionId, at]) => (at - (createdOf.get(questionId) ?? at)) / 3_600_000,
    );
    const approved = decisions['APPROVED'] ?? 0;
    const rejected = decisions['REJECTED'] ?? 0;
    return {
      providerId,
      drafts: mine.length,
      byStatus,
      approvalDecisions: decisions,
      decided,
      approvalRate: decided === 0 ? null : approved / decided,
      rejectionRate: decided === 0 ? null : rejected / decided,
      changeRequests:
        (decisions['CHANGES_REQUESTED'] ?? 0) +
        changeAudits.filter((a) => providerOf.get(a.entityId ?? '') === providerId).length,
      reviewComments: reviews.filter(
        (r) => providerOf.get(r.questionId) === providerId && (r.comment ?? '').trim().length > 0,
      ).length,
      medianHoursToFirstDecision: median(hours),
    };
  });

  for (const row of out) {
    const pct = (value: number | null) =>
      value === null ? 'no decisions yet' : `${(value * 100).toFixed(1)}%`;
    console.log(
      `${row.providerId}: ${row.drafts} draft(s) ${JSON.stringify(row.byStatus)} · ${row.decided} approval decision(s) · approved ${pct(row.approvalRate)} · rejected ${pct(row.rejectionRate)} · change requests ${row.changeRequests} · comments ${row.reviewComments} · median hours to first decision ${row.medianHoursToFirstDecision === null ? '—' : row.medianHoursToFirstDecision.toFixed(1)}`,
    );
  }
  const jsonPath = valueOf(args, '--json');
  if (jsonPath !== undefined) {
    writeFileSync(
      jsonPath,
      JSON.stringify({ measuredAt: new Date().toISOString(), providers: out }, null, 2),
    );
    console.log(`written ${jsonPath}`);
  }
};

// ---------------------------------------------------------------------------

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  if (args.includes('--export')) await exportPacket(args);
  else if (args.includes('--blind')) exportBlind(args);
  else if (args.includes('--review-analytics')) await reviewAnalytics(args);
  else {
    console.log('Usage: --export <dir> | --blind <dir> --from <files> | --review-analytics');
    process.exitCode = 1;
  }
};

main()
  .catch((error: unknown) => {
    console.error((error as Error).message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
