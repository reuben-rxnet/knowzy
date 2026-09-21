// Shared OOXML helpers for the DOCX, PPTX and XLSX extractors.
//
// All three formats are ZIP containers of XML parts, and all three need the
// same three primitives: decode the five entities WordprocessingML actually
// uses, remove whole elements including their children, and pull the text out
// of a run of `<x:t>` elements. Extracted here rather than copied so a fix to
// entity handling cannot apply to one format and not the others.
//
// No XML library is used, deliberately. The relevant subset of each format is
// a handful of element names, and a focused scanner is auditable in a way a
// general parser configured with entity expansion disabled is not: XXE and
// billion-laughs are not reachable, because entities are never expanded.

/** The five XML entities OOXML actually uses, plus numeric character refs. */
export const decodeEntities = (text: string): string =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => {
      const point = Number.parseInt(hex, 16);
      return point > 0 && point < 0x110000 ? String.fromCodePoint(point) : '';
    })
    .replace(/&#(\d+);/g, (_m, code: string) => {
      const point = Number(code);
      return point > 0 && point < 0x110000 ? String.fromCodePoint(point) : '';
    })
    // Ampersand last, so `&amp;lt;` decodes to `&lt;` and not to `<`.
    .replace(/&amp;/g, '&');

/**
 * Removes whole elements, including their children, by tag name.
 *
 * Scans for the matching close tag rather than using a single regex, so
 * nesting is handled — which matters for a `w:del` inside a `w:p` inside a
 * `w:tc`, and for a grouped shape inside a grouped shape on a slide.
 */
export const stripElements = (xml: string, tagNames: readonly string[]): string => {
  let out = xml;
  for (const tag of tagNames) {
    const open = new RegExp(`<${tag}(?:\\s[^>]*)?>`, 'g');
    let result = '';
    let cursor = 0;
    open.lastIndex = 0;
    let match = open.exec(out);
    while (match !== null) {
      result += out.slice(cursor, match.index);
      let depth = 1;
      let scan = match.index + match[0].length;
      const scanner = new RegExp(`<(/?)${tag}(?:\\s[^>]*)?>`, 'g');
      scanner.lastIndex = scan;
      let inner = scanner.exec(out);
      while (inner !== null && depth > 0) {
        depth += inner[1] === '/' ? -1 : 1;
        scan = inner.index + inner[0].length;
        if (depth === 0) break;
        inner = scanner.exec(out);
      }
      cursor = depth === 0 ? scan : out.length;
      open.lastIndex = cursor;
      match = open.exec(out);
    }
    result += out.slice(cursor);
    out = result;
  }
  return out;
};

/** Self-closing elements that contribute whitespace rather than nothing. */
export const expandBreaks = (xml: string): string =>
  xml
    .replace(/<w:tab\b[^>]*\/>/g, '\t')
    .replace(/<w:br\b[^>]*\/>/g, ' ')
    .replace(/<a:br\b[^>]*\/>/g, ' ');

/**
 * The visible text of a fragment, concatenated across its `<prefix:t>` runs.
 *
 * Concatenating WITHOUT a separator is correct and necessary. Word and
 * PowerPoint split a single sentence across many runs for reasons of their own
 * — a spell-check boundary, a formatting change, a revision id — and inserting
 * spaces between runs would break words in the middle. A broken word then
 * fails evidence verification later for a reason nobody could diagnose.
 */
export const runText = (fragment: string, prefix: 'w' | 'a'): string => {
  const expanded = expandBreaks(fragment);
  let text = '';
  const matcher = new RegExp(`<${prefix}:t(?:\\s[^>]*)?>([\\s\\S]*?)</${prefix}:t>`, 'g');
  let match = matcher.exec(expanded);
  while (match !== null) {
    text += decodeEntities(match[1] ?? '');
    match = matcher.exec(expanded);
  }
  return text.replace(/[\t\r\n]+/g, ' ').trim();
};

/**
 * Renders table-like rows as prose.
 *
 * An em dash separator rather than a pipe: a row can still state a rule a
 * question is built from, and the span is quoted verbatim into the evidence,
 * where a pipe would look like markup to a reviewer.
 */
export const CELL_SEPARATOR = ' — ';

/** Resolves an OOXML relationship id to its target part path. */
export const relationshipTargets = (relsXml: string, basePath: string): Map<string, string> => {
  const map = new Map<string, string>();
  const matcher = /<Relationship\b[^>]*\/>/g;
  let match = matcher.exec(relsXml);
  while (match !== null) {
    const element = match[0];
    const id = /\bId="([^"]+)"/.exec(element)?.[1];
    const target = /\bTarget="([^"]+)"/.exec(element)?.[1];
    if (id !== undefined && target !== undefined) {
      const normalized = target.startsWith('/')
        ? target.slice(1)
        : `${basePath}${target}`.replace(/[^/]+\/\.\.\//g, '');
      map.set(id, normalized);
    }
    match = matcher.exec(relsXml);
  }
  return map;
};
