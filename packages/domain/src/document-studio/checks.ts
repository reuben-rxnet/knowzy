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
  'INVENTED_QUANTITY' | 'OBLIGATION_STRENGTHENED' | 'OBLIGATION_WEAKENED' | 'POSSIBLY_REMOVED';

export interface PreparationWarning {
  readonly kind: PreparationWarningKind;
  /** The prepared sentence concerned, or the original one for POSSIBLY_REMOVED. */
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

  for (const sentence of original) {
    if (!SAFETY.test(sentence.text)) continue;
    const { score } = closest(sentence, prepared);
    if (score < 0.5) {
      warnings.push({
        kind: 'POSSIBLY_REMOVED',
        text: sentence.text,
        originalText: sentence.text,
        message:
          'This warning, prohibition or escalation in the original has no close match in the prepared document.',
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
