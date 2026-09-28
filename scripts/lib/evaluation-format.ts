// Pure helpers for the Codex evaluation packets (EVAL-M1, 2026-09-28).
//
// No I/O here, so the rules that make a packet trustworthy are testable:
// CSV that opens correctly in Excel, a blind ordering that is reproducible
// but does not reveal the provider, and a blind packet that genuinely hides
// what it says it hides. scripts/lib/evaluation-format.test.ts
// asserts all three.

export interface PacketQuestion {
  readonly questionId: string;
  readonly providerId: string;
  readonly modelId: string | null;
  readonly jobId: string | null;
  readonly sourceName: string;
  readonly documentName: string;
  readonly sectionKey: string;
  readonly status: string;
  readonly stem: string;
  readonly options: Readonly<Record<string, string>>;
  readonly correctOption: string | null;
  readonly explanation: string;
  readonly evidence: string;
  readonly evidenceMode: string | null;
  readonly confidence: number | null;
  readonly maxSimilarity: number | null;
  readonly createdAt: string;
}

/** RFC 4180 field: quoted when it holds a comma, quote or line break; quotes doubled. */
export const csvField = (value: unknown): string => {
  const text = value === null || value === undefined ? '' : String(value);
  // A leading = + - @ makes Excel evaluate the cell as a formula. Prefix it
  // with an apostrophe so a stem that begins "-5 degrees" stays text.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** Rows to CSV, with a UTF-8 BOM so Excel reads accented characters correctly. */
export const toCsv = (header: readonly string[], rows: readonly (readonly unknown[])[]): string =>
  '﻿' + [header, ...rows].map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n';

/** A small, seeded PRNG (mulberry32): the same seed gives the same order. */
const mulberry32 = (seed: number) => () => {
  let t = (seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Fisher-Yates with a seed. Reproducible, so the key can be regenerated. */
export const seededShuffle = <T>(items: readonly T[], seed: number): T[] => {
  const out = [...items];
  const random = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
};

/** The review packet: everything a subject-matter reviewer needs, one row per question. */
export const REVIEW_HEADER = [
  'Question ID',
  'Provider',
  'Model',
  'Source',
  'Source document',
  'Section',
  'Status',
  'Evidence (verbatim from the document)',
  'Stem',
  'Option A',
  'Option B',
  'Option C',
  'Option D',
  'Correct answer',
  'Explanation',
  'Evidence check',
  'Confidence',
  'Highest similarity to another question',
  'Reviewer',
  'Accurate (Y/N)',
  'Clear (Y/N)',
  'Distractors plausible (Y/N)',
  'Would approve (Y/N)',
  'Comments',
] as const;

export const reviewRow = (q: PacketQuestion): readonly unknown[] => [
  q.questionId,
  q.providerId,
  q.modelId ?? '',
  q.sourceName,
  q.documentName,
  q.sectionKey.slice(0, 12),
  q.status,
  q.evidence,
  q.stem,
  q.options['A'] ?? '',
  q.options['B'] ?? '',
  q.options['C'] ?? '',
  q.options['D'] ?? '',
  q.correctOption ?? '',
  q.explanation,
  q.evidenceMode ?? '',
  q.confidence === null ? '' : q.confidence.toFixed(3),
  q.maxSimilarity === null ? '' : q.maxSimilarity.toFixed(3),
  '',
  '',
  '',
  '',
  '',
  '',
];

/**
 * The blind-stem packet. The stem ONLY: no options, no answer, no
 * explanation, no evidence -- and no provider, model, question id or source,
 * so a reviewer cannot tell which generator wrote it. Items are numbered in a
 * seeded, shuffled order; the separate key maps an item back.
 */
export const BLIND_HEADER = [
  'Item',
  'Reviewer',
  'Question',
  'Answerable from stem (Y/N)',
  'Comments',
] as const;
export const BLIND_KEY_HEADER = [
  'Item',
  'Question ID',
  'Provider',
  'Model',
  'Source document',
] as const;

export interface BlindPacket {
  readonly rows: readonly (readonly unknown[])[];
  readonly key: readonly (readonly unknown[])[];
}

export const blindPacket = (questions: readonly PacketQuestion[], seed: number): BlindPacket => {
  const shuffled = seededShuffle(questions, seed);
  const rows = shuffled.map((q, index) => [
    `B-${String(index + 1).padStart(3, '0')}`,
    '',
    q.stem,
    '',
    '',
  ]);
  const key = shuffled.map((q, index) => [
    `B-${String(index + 1).padStart(3, '0')}`,
    q.questionId,
    q.providerId,
    q.modelId ?? '',
    q.documentName,
  ]);
  return { rows, key };
};

/** A readable Markdown packet, grouped by source document. */
export const reviewMarkdown = (title: string, questions: readonly PacketQuestion[]): string => {
  const lines: string[] = [
    `# ${title}`,
    '',
    `${questions.length} question(s). Every one is a DRAFT unless its status says otherwise.`,
    '',
  ];
  const byDocument = new Map<string, PacketQuestion[]>();
  for (const q of questions) {
    const list = byDocument.get(q.documentName) ?? [];
    list.push(q);
    byDocument.set(q.documentName, list);
  }
  for (const [document, list] of [...byDocument.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`## ${document}`, '');
    for (const q of list) {
      lines.push(`### ${q.stem}`, '');
      lines.push(
        `- **Question ID:** \`${q.questionId}\` · **Provider:** ${q.providerId} (${q.modelId ?? 'no model'}) · **Status:** ${q.status}`,
      );
      for (const letter of ['A', 'B', 'C', 'D']) {
        const marker = letter === q.correctOption ? ' ✔' : '';
        lines.push(`- **${letter}.** ${q.options[letter] ?? ''}${marker}`);
      }
      lines.push(`- **Explanation:** ${q.explanation}`);
      lines.push(
        `- **Evidence (${q.evidenceMode ?? 'unverified'}):** > ${q.evidence.replace(/\s+/g, ' ')}`,
      );
      lines.push(
        `- **Confidence:** ${q.confidence === null ? '—' : q.confidence.toFixed(3)} · **Highest similarity:** ${q.maxSimilarity === null ? '—' : q.maxSimilarity.toFixed(3)}`,
        '',
      );
    }
  }
  return lines.join('\n');
};
