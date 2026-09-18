// Sectioning — generation-governance.md §6.1 and knowledge-source-adapters.md
// §2.4 X2-X4, X6.
//
// A DocumentSection is the coverage unit and the anchor for every evidence
// span, so the invariants here are the ones the whole grounding chain rests on:
//
//   X2  offsets index into the returned normalizedText, and
//       normalizedText.slice(start, end) equals the section text EXACTLY
//   X3  sections are ordered and non-overlapping
//   X4  a document with no headings falls back to labelled windows; a heading
//       is never invented
//   X6  truncation ends at a section boundary and is reported
//
// The function returns text and sections together for exactly that reason: it
// is the only arrangement in which an offset cannot drift from the string it
// indexes.

import { createHash } from 'node:crypto';
import type { Block, StructuredDocument } from './structure.js';
import { normalizeText } from './normalize.js';

export interface SectionizeOptions {
  /** Hard cap on retained characters. Truncation ends at a section boundary. */
  readonly maxChars?: number;
  /** Below this a section is NON_ASSESSABLE (coverage.minAssessableChars). */
  readonly minAssessableChars?: number;
  /** Characters per window when there is no heading structure. */
  readonly fallbackWindowChars?: number;
}

const DEFAULTS = {
  maxChars: 200_000,
  minAssessableChars: 300,
  fallbackWindowChars: 1_500,
} as const;

export interface Section {
  /** Stable across re-extraction: sha256(heading path + ordinal within parent). */
  readonly sectionKey: string;
  readonly ordinal: number;
  readonly heading: string | null;
  readonly headingPath: string | null;
  readonly pageNumber: number | null;
  readonly slideNumber: number | null;
  readonly sheetName: string | null;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly text: string;
  readonly sectionContentHash: string;
  readonly assessableCharCount: number;
  readonly isAssessable: boolean;
  readonly nonAssessableReason: string | null;
  /** Honest label when there is no heading: "Segment 3 of 14" (X4). */
  readonly label: string;
}

export interface SectionizeResult {
  readonly normalizedText: string;
  readonly sections: readonly Section[];
  readonly truncated: boolean;
  readonly contentHash: string;
}

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

/**
 * Headings whose sections carry nothing worth testing —
 * generation-governance.md §6.2. Without this, coverage percentages are
 * dominated by content nobody should be assessed on.
 */
const NON_ASSESSABLE_HEADINGS = new RegExp(
  [
    '^table of contents$',
    '^contents$',
    '^revision history$',
    '^change history$',
    '^document history$',
    '^approval table$',
    '^approvals?$',
    '^legal notice$',
    '^disclaimer$',
    '^glossary$',
    '^references?$',
    '^bibliography$',
    '^index$',
  ].join('|'),
  'i',
);

interface PendingSection {
  heading: string | null;
  headingPath: string | null;
  parentPath: string | null;
  ordinalWithinParent: number;
  pageNumber: number | null;
  slideNumber: number | null;
  sheetName: string | null;
  paragraphs: string[];
}

/** Groups blocks under their headings, tracking the heading path. */
const groupBlocks = (blocks: readonly Block[]): PendingSection[] => {
  const out: PendingSection[] = [];
  const stack: { level: number; text: string }[] = [];
  const ordinalByParent = new Map<string, number>();

  let current: PendingSection | null = null;

  const open = (
    heading: { level: number; text: string } | null,
    block?: Block,
  ): PendingSection => {
    let headingPath: string | null = null;
    let parentPath: string | null = null;

    if (heading) {
      while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= heading.level) {
        stack.pop();
      }
      parentPath = stack.map((h) => h.text).join(' > ') || null;
      stack.push(heading);
      headingPath = stack.map((h) => h.text).join(' > ');
    }

    const parentKey = parentPath ?? '';
    const ordinalWithinParent = (ordinalByParent.get(parentKey) ?? 0) + 1;
    ordinalByParent.set(parentKey, ordinalWithinParent);

    const location = block && block.kind === 'text' ? block : undefined;
    const next: PendingSection = {
      heading: heading?.text ?? null,
      headingPath,
      parentPath,
      ordinalWithinParent,
      pageNumber: location?.pageNumber ?? null,
      slideNumber: location?.slideNumber ?? null,
      sheetName: location?.sheetName ?? null,
      paragraphs: [],
    };
    out.push(next);
    return next;
  };

  for (const block of blocks) {
    if (block.kind === 'heading') {
      current = open({ level: block.level, text: block.text });
      continue;
    }
    if (block.text.trim().length === 0) continue;
    if (current === null) current = open(null, block);
    current.paragraphs.push(block.text);
  }

  // Heading-only sections are dropped: a heading alone is not assessable
  // content, and keeping it would inflate the coverage denominator.
  return out.filter((s) => s.paragraphs.length > 0);
};

/** Fixed windows for a document with no heading structure (X4). */
const windowSections = (text: string, windowChars: number): PendingSection[] => {
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim().length > 0);
  const windows: string[][] = [];
  let currentWindow: string[] = [];
  let size = 0;

  for (const paragraph of paragraphs) {
    if (size > 0 && size + paragraph.length > windowChars) {
      windows.push(currentWindow);
      currentWindow = [];
      size = 0;
    }
    currentWindow.push(paragraph);
    size += paragraph.length;
  }
  if (currentWindow.length > 0) windows.push(currentWindow);

  return windows.map((paras, i) => ({
    heading: null,
    headingPath: null,
    parentPath: null,
    ordinalWithinParent: i + 1,
    pageNumber: null,
    slideNumber: null,
    sheetName: null,
    paragraphs: paras,
  }));
};

export const sectionize = (
  document: StructuredDocument,
  options: SectionizeOptions = {},
): SectionizeResult => {
  const opts = { ...DEFAULTS, ...options };

  let pending: PendingSection[];
  if (document.hasHeadingStructure) {
    pending = groupBlocks(document.blocks);
  } else {
    const joined = document.blocks
      .filter((b): b is Extract<Block, { kind: 'text' }> => b.kind === 'text')
      .map((b) => b.text)
      .join('\n\n');
    pending = windowSections(normalizeText(joined), opts.fallbackWindowChars);
  }

  // The final text is assembled HERE and nowhere else, which is what guarantees
  // X2: every offset is computed against the string being built.
  const parts: string[] = [];
  const sections: Section[] = [];
  let cursor = 0;
  let truncated = false;
  const total = pending.length;

  for (const p of pending) {
    const body = normalizeText(p.paragraphs.join('\n\n'));
    if (body.length === 0) continue;

    // X6: stop at a section boundary rather than cutting one in half. A
    // half-section would produce evidence spans that cannot be re-located.
    if (cursor > 0 && cursor + body.length > opts.maxChars) {
      truncated = true;
      break;
    }

    const separator = cursor === 0 ? '' : '\n\n';
    const startOffset = cursor + separator.length;
    const endOffset = startOffset + body.length;

    parts.push(separator, body);
    cursor = endOffset;

    const headingForKey = p.headingPath ?? `segment:${p.ordinalWithinParent}`;
    const isFurniture = p.heading !== null && NON_ASSESSABLE_HEADINGS.test(p.heading.trim());
    const tooShort = body.length < opts.minAssessableChars;

    sections.push({
      sectionKey: sha256(`${headingForKey}#${p.ordinalWithinParent}`),
      ordinal: sections.length + 1,
      heading: p.heading,
      headingPath: p.headingPath,
      pageNumber: p.pageNumber,
      slideNumber: p.slideNumber,
      sheetName: p.sheetName,
      startOffset,
      endOffset,
      text: body,
      sectionContentHash: sha256(body),
      assessableCharCount: body.length,
      isAssessable: !isFurniture && !tooShort,
      nonAssessableReason: isFurniture
        ? 'Document furniture: not assessable content.'
        : tooShort
          ? `Below the minimum assessable length (${body.length} < ${opts.minAssessableChars}).`
          : null,
      // X4: never claim a heading the document does not have.
      label: p.heading ?? `Segment ${p.ordinalWithinParent} of ${total}`,
    });
  }

  const normalizedText = parts.join('');

  return {
    normalizedText,
    sections,
    truncated,
    // X7: the content hash is over the normalized text.
    contentHash: sha256(normalizedText),
  };
};
