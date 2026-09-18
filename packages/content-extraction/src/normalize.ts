// Text normalization — architecture.md §8.4 and knowledge-source-adapters.md
// §2.4 X1.
//
// One pipeline, used by extraction, content hashing, evidence verification, and
// similarity scoring. If any of those normalized differently, a question's
// evidence would verify at generation time and fail later, so there is exactly
// one implementation and everything calls it.
//
// X8: deterministic. The same input produces byte-identical output, which is
// what makes change detection and re-verification meaningful.

/** Characters that collapse to a plain ASCII equivalent. */
const CHARACTER_FOLDS: ReadonlyArray<readonly [RegExp, string]> = [
  // Quotes and apostrophes.
  [/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'"],
  [/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"'],
  // Dashes and minus signs.
  [/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, '-'],
  // Ligatures. NFKC handles most, but these appear in PDF text layers.
  [/\uFB00/g, 'ff'],
  [/\uFB01/g, 'fi'],
  [/\uFB02/g, 'fl'],
  [/\uFB03/g, 'ffi'],
  [/\uFB04/g, 'ffl'],
  // Ellipsis and non-breaking / zero-width space family.
  [/\u2026/g, '...'],
  [/[\u00A0\u2007\u202F]/g, ' '],
  [/[\u200B\u200C\u200D\uFEFF]/g, ''],
  // Bullets that carry no meaning once structure is captured separately.
  [/[\u2022\u25CF\u25AA\u00B7]/g, '-'],
];

/**
 * Joins a word broken across a line by a hyphen: "config-\nuration" becomes
 * "configuration".
 *
 * Deliberately conservative: it only joins when a lowercase letter precedes the
 * hyphen and follows the break, so a genuine compound at a line end
 * ("read-\nonly") is not silently fused into a different word.
 */
const dehyphenate = (text: string): string => text.replace(/([a-z])-\n([a-z])/g, '$1$2');

/**
 * Normalizes a text fragment.
 *
 * Line structure is preserved: paragraph breaks carry meaning for sectioning,
 * and collapsing them would make a section's text unreadable in the review
 * workspace. Runs of spaces and tabs collapse; runs of blank lines collapse to
 * one blank line.
 */
export const normalizeText = (raw: string): string => {
  let text = raw.normalize('NFKC');

  // Unify line endings first so every later rule sees the same shape. Windows
  // checkouts and PDF text layers both produce \r.
  text = text.replace(/\r\n?/g, '\n');

  for (const [pattern, replacement] of CHARACTER_FOLDS) {
    text = text.replace(pattern, replacement);
  }

  text = dehyphenate(text);

  // Horizontal whitespace collapses; vertical structure survives.
  text = text.replace(/[ \t\f\v]+/g, ' ');
  text = text
    .split('\n')
    .map((line) => line.trim())
    .join('\n');
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
};

/**
 * Normalization used for COMPARISON only — evidence verification and similarity
 * scoring (workflows.md §2.5).
 *
 * Lowercases and collapses all whitespace including newlines, so a span that
 * differs only in line wrapping still matches. The stored evidence keeps its
 * original casing; this is applied to both sides of a comparison and never to
 * anything persisted as content.
 */
export const normalizeForComparison = (raw: string): string =>
  normalizeText(raw).replace(/\s+/g, ' ').toLowerCase();
