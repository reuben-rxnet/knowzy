// AI Document Studio M3 -- what is checked on a prepared text before a person
// sees it (docs/competencies/AI_DOCUMENT_STUDIO_ARCHITECTURE.md §11.3), and
// how the review screen marks what changed.
//
// PURE. Text in, findings out. Three kinds of result, and the difference
// between them is deliberate:
//
//   * an INVENTED QUANTITY -- a number, percentage, date or duration in the
//     prepared text that the original does not contain -- REFUSES a provider's
//     output outright. It is the most damaging fabrication, because a question
//     built on it is wrong with total confidence.
//   * a CHANGED OBLIGATION (must <-> should) and a POSSIBLY REMOVED safety
//     statement are WARNINGS. Matching sentences across a reorganized document
//     is approximate, and refusing on an approximation would refuse good work;
//     a person reads the warning beside the text.
//   * CONTENT REDUCED -- less than nine tenths of the original's words survive
//     -- is a WARNING naming the original lines that went. Measured 2026-10-22:
//     a model asked to restructure a long SOP silently condensed it to 69%,
//     dropping order numbers and ticket subjects, and nothing on the screen
//     said so.
//   * REWORDED text is neither: it is highlighted, because rewording is what
//     preparation is for.
//
// A person's own edit is never refused here. Its invented figures are warned
// about instead: the person is the authority on their edit, and the warning
// stays on the version for whoever adds it.

import {
  nodeTexts,
  normalizeForComparison,
  overlap,
  quantitiesOf,
  sentencesOf,
  tokensOf,
  type PreparedNode,
} from '@knowzy/shared-types';

export type PreparationWarningKind =
  | 'INVENTED_QUANTITY'
  | 'OBLIGATION_STRENGTHENED'
  | 'OBLIGATION_WEAKENED'
  | 'POSSIBLY_REMOVED'
  | 'CONTENT_REDUCED';

export interface PreparationWarning {
  readonly kind: PreparationWarningKind;
  /** The prepared sentence concerned, or the original one for POSSIBLY_REMOVED and CONTENT_REDUCED. */
  readonly text: string;
  /** The closest original sentence, where one was matched. */
  readonly originalText: string | null;
  /** Plain-language explanation for the review screen. */
  readonly message: string;
}

export interface PreparationCheckResult {
  /** Figures in the prepared text that are not in the original. */
  readonly inventedFigures: readonly string[];
  readonly warnings: readonly PreparationWarning[];
}

const STRONG = /\b(must|shall|required|mandatory|is not permitted|must not|shall not)\b/i;
const WEAK = /\b(should|may|recommended|can|could|ideally|where possible)\b/i;
const SAFETY =
  /\b(warning|caution|danger|hazard|escalat\w*|never|must not|do not|prohibited|safety|immediately|stop)\b/i;

/** Below this share of the original's words, the prepared text is reported as reduced. */
export const MIN_CONTENT_COVERAGE = 0.9;
const REDUCED_LINES_SHOWN = 5;

const wordsOf = (text: string): string[] =>
  (text.toLowerCase().match(/[\p{L}\p{N}_%./-]+/gu) ?? []).filter((word) => word.length > 1);

/**
 * Share of `original`'s words, counted WITH repetition, that occur in
 * `prepared`. A set would call a document that mentions an order number once
 * where the original listed it in five steps complete.
 */
export const wordCoverage = (original: string, prepared: string): number => {
  const pool = new Map<string, number>();
  for (const word of wordsOf(prepared)) pool.set(word, (pool.get(word) ?? 0) + 1);
  const source = wordsOf(original);
  if (source.length === 0) return 1;
  let kept = 0;
  for (const word of source) {
    const left = pool.get(word) ?? 0;
    if (left > 0) {
      kept += 1;
      pool.set(word, left - 1);
    }
  }
  return kept / source.length;
};

/** Share of `a`'s tokens present in `b`: is a contained in b, whatever b adds. */
const containment = (a: ReadonlySet<string>, b: ReadonlySet<string>): number => {
  if (a.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / a.size;
};

/** Sentences worth comparing: a handful of words, not a heading fragment. */
const comparable = (sentence: string): boolean => sentence.split(/\s+/).length >= 4;

interface Indexed {
  readonly text: string;
  readonly tokens: Set<string>;
}

const index = (sentences: readonly string[]): Indexed[] =>
  sentences.filter(comparable).map((text) => ({ text, tokens: tokensOf(text) }));

const closest = (
  sentence: Indexed,
  pool: readonly Indexed[],
): { readonly match: Indexed | null; readonly score: number } => {
  let best: Indexed | null = null;
  let score = 0;
  for (const candidate of pool) {
    const value = overlap(sentence.tokens, candidate.tokens);
    if (value > score) {
      score = value;
      best = candidate;
    }
  }
  return { match: best, score };
};

/** Every readable sentence of a prepared text, markers excluded (they are notes, not content). */
export const preparedSentences = (nodes: readonly PreparedNode[]): string[] =>
  nodes
    .filter((node) => node.type !== 'marker')
    .flatMap((node) => nodeTexts(node))
    .flatMap((text) => sentencesOf(text));

export const checkPreparedText = (
  originalText: string,
  nodes: readonly PreparedNode[],
): PreparationCheckResult => {
  const originalFigures = quantitiesOf(originalText);
  const preparedText = nodes
    .filter((node) => node.type !== 'marker')
    .flatMap((node) => nodeTexts(node))
    .join('\n');
  const inventedFigures = [...quantitiesOf(preparedText)].filter(
    (figure) => !originalFigures.has(figure),
  );

  const warnings: PreparationWarning[] = inventedFigures.map((figure) => ({
    kind: 'INVENTED_QUANTITY' as const,
    text: figure,
    originalText: null,
    message: `The figure "${figure}" does not appear in the original document.`,
  }));

  const original = index(sentencesOf(originalText));
  const prepared = index(preparedSentences(nodes));

  for (const sentence of prepared) {
    const strong = STRONG.test(sentence.text);
    const weak = WEAK.test(sentence.text);
    if (!strong && !weak) continue;
    const { match, score } = closest(sentence, original);
    if (match === null || score < 0.35) continue;
    const originalStrong = STRONG.test(match.text);
    const originalWeak = WEAK.test(match.text);
    if (strong && !originalStrong && originalWeak) {
      warnings.push({
        kind: 'OBLIGATION_STRENGTHENED',
        text: sentence.text,
        originalText: match.text,
        message:
          'This sentence reads as a requirement where the original reads as a recommendation.',
      });
    } else if (weak && !strong && originalStrong) {
      warnings.push({
        kind: 'OBLIGATION_WEAKENED',
        text: sentence.text,
        originalText: match.text,
        message:
          'This sentence reads as a recommendation where the original reads as a requirement.',
      });
    }
  }

  // Containment against whole prepared BLOCKS, not likeness to one sentence: a
  // preparation that merges a warning into a numbered step keeps every word of
  // it, and a symmetric overlap with the longer step read that as removed.
  const blocks = nodes
    .filter((node) => node.type !== 'marker')
    .flatMap((node) => nodeTexts(node))
    .map((text) => tokensOf(text));
  for (const sentence of original) {
    if (!SAFETY.test(sentence.text)) continue;
    const best = blocks.reduce(
      (max, block) => Math.max(max, containment(sentence.tokens, block)),
      0,
    );
    if (best < 0.6) {
      warnings.push({
        kind: 'POSSIBLY_REMOVED',
        text: sentence.text,
        originalText: sentence.text,
        message:
          'This warning, prohibition or escalation in the original has no close match in the prepared document.',
      });
    }
  }

  const coverage = wordCoverage(originalText, preparedText);
  if (coverage < MIN_CONTENT_COVERAGE) {
    const preparedWords = new Set(wordsOf(preparedText));
    const missing = originalText
      .split(/\n+/)
      .map((line) => line.trim())
      .filter((line) => wordsOf(line).length >= 4)
      .map((line) => {
        const lineWords = wordsOf(line);
        return {
          line,
          kept: lineWords.filter((word) => preparedWords.has(word)).length / lineWords.length,
        };
      })
      .filter((entry) => entry.kept < 0.7)
      .sort((a, b) => a.kept - b.kept)
      .slice(0, REDUCED_LINES_SHOWN);
    const percent = Math.round(coverage * 100);
    const message = `The prepared document keeps about ${percent}% of the original's words, so content may have been left out. Compare it with the original before adding it.`;
    if (missing.length === 0) {
      warnings.push({ kind: 'CONTENT_REDUCED', text: message, originalText: null, message });
    }
    for (const entry of missing) {
      warnings.push({
        kind: 'CONTENT_REDUCED',
        text: entry.line,
        originalText: entry.line,
        message: `${message} This line of the original is mostly missing.`,
      });
    }
  }

  return { inventedFigures, warnings };
};

// ------------------------------------------------------------ change marking

export interface MarkedSegment {
  readonly text: string;
  /** True when the sentence occurs verbatim (under normalization) in the original. */
  readonly fromOriginal: boolean;
}

export type MarkedNode =
  | {
      readonly type: 'heading';
      readonly level: number;
      readonly text: string;
      readonly added: boolean;
    }
  | { readonly type: 'paragraph' | 'warning'; readonly segments: readonly MarkedSegment[] }
  | {
      readonly type: 'list';
      readonly ordered: boolean;
      readonly items: readonly (readonly MarkedSegment[])[];
    }
  | {
      readonly type: 'table';
      readonly header: readonly string[];
      readonly rows: readonly (readonly string[])[];
    }
  | { readonly type: 'marker'; readonly marker: string; readonly text: string };

/**
 * The prepared document as the review screen shows it: each sentence marked
 * as taken from the original or reworded, each heading as the original's or
 * added. Computed on read, never stored, so an edit is marked by the same rule.
 */
export const markChanges = (originalText: string, nodes: readonly PreparedNode[]): MarkedNode[] => {
  const haystack = normalizeForComparison(originalText);
  const found = (text: string): boolean => {
    const needle = normalizeForComparison(text).replace(/[.;:]+$/, '');
    return needle.length > 0 && haystack.includes(needle);
  };
  const segments = (text: string): MarkedSegment[] =>
    sentencesOf(text).map((sentence) => ({ text: sentence, fromOriginal: found(sentence) }));
  return nodes.map((node): MarkedNode => {
    switch (node.type) {
      case 'heading':
        return { type: 'heading', level: node.level, text: node.text, added: !found(node.text) };
      case 'paragraph':
      case 'warning':
        return { type: node.type, segments: segments(node.text) };
      case 'list':
        return { type: 'list', ordered: node.ordered, items: node.items.map(segments) };
      case 'table':
        return { type: 'table', header: node.header, rows: node.rows };
      case 'marker':
        return { type: 'marker', marker: node.marker, text: node.text };
    }
  });
};
