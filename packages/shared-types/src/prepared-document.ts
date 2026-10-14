// AI Document Studio M3 -- the assessment-prepared document
// (docs/competencies/AI_DOCUMENT_STUDIO_ARCHITECTURE.md §11).
//
// Shared by three packages that may not import each other: the domain (which
// stores, checks and lists versions), content-extraction (which writes the
// Word and PDF downloads) and claude-services (whose providers return the
// preparation output). So the shapes, the small Markdown dialect a person edits
// and the pure text helpers live here, and nothing here performs I/O.
//
// Two rules this file is where a change would break:
//
//   * MISSING-INFORMATION MARKERS ARE NOT CONTENT. They are rendered in the
//     review screen and the downloads, and `repositoryMarkdown` drops them, so
//     a question can never be generated from a note about what is absent.
//
//   * THE TEST PREPARATION PROVIDER IS NOT A GENERATION PROVIDER. Its id sits
//     outside GENERATION_PROVIDER on purpose, so it can never be approved, made
//     active, or chosen on the Generate screen.

import { z } from 'zod';
import type { GenerationProviderId } from './enums.js';
import { normalizeForComparison } from './normalize.js';

export const PREPARED_VERSION_STATES = [
  'DRAFT',
  'READY_FOR_QUESTION_GENERATION',
  'SUPERSEDED',
  'REVALIDATION_REQUIRED',
  'REJECTED',
] as const;
export type PreparedVersionState = (typeof PREPARED_VERSION_STATES)[number];

/** §11.4. Local environment only, never AI, never a generation provider. */
export const TEST_PREPARATION_PROVIDER = 'TEST_PREPARATION' as const;
export const TEST_PREPARATION_MODEL = 'knowzy-test-preparation-1' as const;
export type PreparationProviderId = GenerationProviderId | typeof TEST_PREPARATION_PROVIDER;

export const SECTION_KINDS = [
  'RULE',
  'PROCEDURE',
  'THRESHOLD',
  'SCENARIO',
  'EXCEPTION',
  'DEFINITION',
  'DECISION',
  'RESPONSIBILITY',
  'GENERAL',
] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

export const FINDING_KINDS = ['MISSING_INFORMATION', 'UNCLEAR', 'NOT_FOR_ASSESSMENT'] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];

const Text = z.string().min(1).max(8_000);
const Cell = z.string().max(2_000);

export const PreparedBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('paragraph'), text: Text }).strict(),
  z.object({ type: z.literal('list'), items: z.array(Text).min(1).max(200) }).strict(),
  z.object({ type: z.literal('numbered_list'), items: z.array(Text).min(1).max(200) }).strict(),
  z
    .object({
      type: z.literal('table'),
      header: z.array(Cell).min(1).max(20),
      rows: z.array(z.array(Cell).max(20)).max(500),
    })
    .strict(),
  z.object({ type: z.literal('warning'), text: Text }).strict(),
]);
export type PreparedBlock = z.infer<typeof PreparedBlockSchema>;

/** What a preparation provider returns. Strict: an extra field is a failed preparation. */
export const PreparationOutputSchema = z
  .object({
    sections: z
      .array(
        z
          .object({
            heading: z.string().min(1).max(300),
            kind: z.enum(SECTION_KINDS),
            blocks: z.array(PreparedBlockSchema).min(1).max(400),
          })
          .strict(),
      )
      .min(1)
      .max(400),
    findings: z
      .array(
        z
          .object({
            kind: z.enum(FINDING_KINDS),
            sectionHeading: z.string().max(300).nullable(),
            message: z.string().min(1).max(2_000),
          })
          .strict(),
      )
      .max(400),
  })
  .strict();
export type PreparationOutput = z.infer<typeof PreparationOutputSchema>;
export type PreparationFinding = PreparationOutput['findings'][number];

// ---------------------------------------------------------------- the dialect

export type PreparedNode =
  | { readonly type: 'heading'; readonly level: number; readonly text: string }
  | { readonly type: 'paragraph'; readonly text: string }
  | { readonly type: 'list'; readonly ordered: boolean; readonly items: readonly string[] }
  | {
      readonly type: 'table';
      readonly header: readonly string[];
      readonly rows: readonly (readonly string[])[];
    }
  | { readonly type: 'warning'; readonly text: string }
  | { readonly type: 'marker'; readonly marker: FindingKind; readonly text: string };

const MARKER_TAG: Readonly<Record<FindingKind, string>> = {
  MISSING_INFORMATION: 'MISSING',
  UNCLEAR: 'UNCLEAR',
  NOT_FOR_ASSESSMENT: 'NOT_FOR_ASSESSMENT',
};
const TAG_MARKER: Readonly<Record<string, FindingKind>> = {
  MISSING: 'MISSING_INFORMATION',
  UNCLEAR: 'UNCLEAR',
  NOT_FOR_ASSESSMENT: 'NOT_FOR_ASSESSMENT',
};

/** One line, no pipes: what a table cell or a list item may hold in the dialect. */
const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();
const cell = (text: string): string => oneLine(text).replace(/\|/g, '/');

const markerLine = (kind: FindingKind, text: string): string =>
  `> [!${MARKER_TAG[kind]}] ${oneLine(text)}`;

const blockLines = (block: PreparedBlock): string[] => {
  switch (block.type) {
    case 'paragraph':
      return [oneLine(block.text)];
    case 'list':
      return block.items.map((item) => `- ${oneLine(item)}`);
    case 'numbered_list':
      return block.items.map((item, index) => `${index + 1}. ${oneLine(item)}`);
    case 'warning':
      return [`> Warning: ${oneLine(block.text).replace(/^warning:\s*/i, '')}`];
    case 'table': {
      const width = block.header.length;
      const pad = (row: readonly string[]): string[] =>
        Array.from({ length: width }, (_, i) => cell(row[i] ?? ''));
      return [
        `| ${pad(block.header).join(' | ')} |`,
        `| ${Array.from({ length: width }, () => '---').join(' | ')} |`,
        ...block.rows.map((row) => `| ${pad(row).join(' | ')} |`),
      ];
    }
  }
};

/**
 * The provider's output as the editable dialect. Findings are placed after
 * the section they name, or at the end when they name none (or none that
 * exists), so a reviewer reads each one beside what it is about.
 */
export const renderPreparationMarkdown = (output: PreparationOutput): string => {
  const byHeading = new Map<string, PreparationFinding[]>();
  const unplaced: PreparationFinding[] = [];
  const headings = new Set(output.sections.map((section) => oneLine(section.heading)));
  for (const finding of output.findings) {
    const heading = finding.sectionHeading === null ? null : oneLine(finding.sectionHeading);
    if (heading !== null && headings.has(heading)) {
      byHeading.set(heading, [...(byHeading.get(heading) ?? []), finding]);
    } else {
      unplaced.push(finding);
    }
  }
  const parts: string[] = [];
  for (const section of output.sections) {
    const heading = oneLine(section.heading);
    parts.push(`## ${heading}`);
    for (const block of section.blocks) parts.push(blockLines(block).join('\n'));
    for (const finding of byHeading.get(heading) ?? []) {
      parts.push(markerLine(finding.kind, finding.message));
    }
    byHeading.delete(heading);
  }
  for (const finding of unplaced) parts.push(markerLine(finding.kind, finding.message));
  return `${parts.join('\n\n')}\n`;
};

const splitRow = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((value) => value.trim());

/** Parses the dialect. Anything it does not recognise is a paragraph, never dropped. */
export const parsePreparedMarkdown = (raw: string): PreparedNode[] => {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  const nodes: PreparedNode[] = [];
  let paragraph: string[] = [];
  // Asserted rather than annotated: `flush` resets these inside a closure,
  // which control-flow narrowing cannot see.
  let list = null as { ordered: boolean; items: string[] } | null;
  let table = null as string[][] | null;

  const flush = (): void => {
    if (paragraph.length > 0) {
      const text = oneLine(paragraph.join(' '));
      if (text.length > 0) nodes.push({ type: 'paragraph', text });
      paragraph = [];
    }
    if (list !== null) {
      nodes.push({ type: 'list', ordered: list.ordered, items: list.items });
      list = null;
    }
    if (table !== null) {
      const [header = [], ...rows] = table;
      nodes.push({ type: 'table', header, rows });
      table = null;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) {
      flush();
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      flush();
      nodes.push({
        type: 'heading',
        level: Math.min(3, heading[1]?.length ?? 1),
        text: oneLine(heading[2] ?? ''),
      });
      continue;
    }
    const marker = /^>\s*\[!([A-Z_]+)\]\s*(.*)$/.exec(line);
    if (marker && TAG_MARKER[marker[1] ?? ''] !== undefined) {
      flush();
      nodes.push({
        type: 'marker',
        marker: TAG_MARKER[marker[1] ?? ''] as FindingKind,
        text: oneLine(marker[2] ?? ''),
      });
      continue;
    }
    const quote = /^>\s*(.*)$/.exec(line);
    if (quote) {
      flush();
      const text = oneLine((quote[1] ?? '').replace(/^warning:\s*/i, ''));
      if (text.length > 0) nodes.push({ type: 'warning', text });
      continue;
    }
    if (line.startsWith('|')) {
      if (table === null) {
        flush();
        table = [];
      }
      const cells = splitRow(line);
      // The separator row under the header carries no content.
      if (!cells.every((value) => /^:?-{2,}:?$/.test(value))) table.push(cells);
      continue;
    }
    const bullet = /^[-*+]\s+(.+)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.+)$/.exec(line);
    if (bullet || numbered) {
      const ordered = numbered !== null;
      let current: { ordered: boolean; items: string[] } | null = list;
      if (current === null || current.ordered !== ordered) {
        flush();
        current = { ordered, items: [] };
        list = current;
      }
      current.items.push(oneLine((bullet ?? numbered)?.[1] ?? ''));
      continue;
    }
    if (list !== null || table !== null) flush();
    paragraph.push(line);
  }
  flush();
  return nodes;
};

/** Every piece of readable text in a node, in order. Used by the checks. */
export const nodeTexts = (node: PreparedNode): string[] => {
  switch (node.type) {
    case 'heading':
    case 'paragraph':
    case 'warning':
    case 'marker':
      return [node.text];
    case 'list':
      return [...node.items];
    case 'table':
      return [...node.header, ...node.rows.flat()];
  }
};

/**
 * The text written into the Question Generation Repository (§11.8). Markers
 * are dropped; a table becomes one line per row naming its columns, so a
 * question's evidence span can be a whole, readable row.
 */
export const repositoryMarkdown = (nodes: readonly PreparedNode[]): string => {
  const parts: string[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case 'marker':
        break;
      case 'heading':
        parts.push(`${'#'.repeat(Math.max(1, node.level))} ${node.text}`);
        break;
      case 'paragraph':
        parts.push(node.text);
        break;
      case 'warning':
        parts.push(`Warning: ${node.text}`);
        break;
      case 'list':
        parts.push(
          node.items
            .map((item, index) => (node.ordered ? `${index + 1}. ${item}` : `- ${item}`))
            .join('\n'),
        );
        break;
      case 'table':
        parts.push(
          node.rows
            .map(
              (row) =>
                `- ${node.header
                  .map((name, index) => `${name}: ${row[index] ?? ''}`.trim())
                  .join('; ')}.`,
            )
            .join('\n'),
        );
        break;
    }
  }
  return `${parts.filter((part) => part.length > 0).join('\n\n')}\n`;
};

// ------------------------------------------------------------- text helpers

/** Sentences, for comparison. Split on terminal punctuation and on line breaks. */
export const sentencesOf = (text: string): string[] =>
  text
    .split(/(?<=[.!?;])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'be']);

export const tokensOf = (text: string): Set<string> =>
  new Set(
    normalizeForComparison(text)
      .split(/[^\p{L}\p{N}%]+/u)
      .filter((token) => token.length > 0 && !STOP.has(token)),
  );

export const overlap = (a: ReadonlySet<string>, b: ReadonlySet<string>): number => {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
};

/**
 * Numbers, percentages, dates and durations by their DIGITS, normalized so
 * "1,000" and "1000" are one figure and "25%" and "25 percent" are too. A prepared figure absent from this set
 * for the original is an invented quantity (§11.3).
 */
export const quantitiesOf = (text: string): Set<string> =>
  new Set(
    (normalizeForComparison(text).match(/\d+(?:[.,:/-]\d+)*/g) ?? []).map((figure) =>
      figure.replace(/,(?=\d{3}\b)/g, ''),
    ),
  );

/** §11.7: letters, digits, spaces and `- _ . ( )` only. */
export const safeFileStem = (name: string): string => {
  const withoutExtension = name.replace(/\.[A-Za-z0-9]{1,5}$/, '');
  const cleaned = withoutExtension
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N} _.()-]/gu, '')
    .replace(/\s+/g, ' ')
    // A leading dot makes a hidden file, and dots are all a "../" leaves.
    .replace(/^[.\s]+/, '')
    .trim()
    .slice(0, 120);
  return cleaned.length > 0 ? cleaned : 'Document';
};

export const preparedDownloadName = (originalName: string, format: 'docx' | 'pdf'): string =>
  `${safeFileStem(originalName)} - Assessment Prepared.${format}`;

/** The notice that opens every download (§11.7), verbatim from the brief. */
export const preparedNotice = (originalName: string): string =>
  `Assessment-prepared document derived from ${originalName}. This document is intended for question generation and does not replace the authoritative original.`;

/** What a download says about where it came from. */
export interface PreparedDocumentExport {
  readonly title: string;
  readonly originalName: string;
  readonly originalVersion: string;
  readonly preparedVersion: number;
  readonly preparedBy: string;
  readonly preparedAt: string;
  readonly nodes: readonly PreparedNode[];
}
