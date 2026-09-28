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
export declare const csvField: (value: unknown) => string;
/** Rows to CSV, with a UTF-8 BOM so Excel reads accented characters correctly. */
export declare const toCsv: (
  header: readonly string[],
  rows: readonly (readonly unknown[])[],
) => string;
/** Fisher-Yates with a seed. Reproducible, so the key can be regenerated. */
export declare const seededShuffle: <T>(items: readonly T[], seed: number) => T[];
/** The review packet: everything a subject-matter reviewer needs, one row per question. */
export declare const REVIEW_HEADER: readonly [
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
];
export declare const reviewRow: (q: PacketQuestion) => readonly unknown[];
/**
 * The blind-stem packet. The stem ONLY: no options, no answer, no
 * explanation, no evidence -- and no provider, model, question id or source,
 * so a reviewer cannot tell which generator wrote it. Items are numbered in a
 * seeded, shuffled order; the separate key maps an item back.
 */
export declare const BLIND_HEADER: readonly [
  'Item',
  'Reviewer',
  'Question',
  'Answerable from stem (Y/N)',
  'Comments',
];
export declare const BLIND_KEY_HEADER: readonly [
  'Item',
  'Question ID',
  'Provider',
  'Model',
  'Source document',
];
export interface BlindPacket {
  readonly rows: readonly (readonly unknown[])[];
  readonly key: readonly (readonly unknown[])[];
}
export declare const blindPacket: (
  questions: readonly PacketQuestion[],
  seed: number,
) => BlindPacket;
/** A readable Markdown packet, grouped by source document. */
export declare const reviewMarkdown: (
  title: string,
  questions: readonly PacketQuestion[],
) => string;
//# sourceMappingURL=evaluation-format.d.ts.map
