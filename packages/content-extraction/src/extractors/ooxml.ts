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

/** Tag names are `prefix:name`; only the characters a tag can hold need escaping. */
const escapeTag = (tag: string): string => tag.replace(/[^A-Za-z0-9:_-]/g, '');

/**
 * A tag of one of `tags`, opening, closing or self-closing. `\b` after the
 * name, so `w:p` does not match `w:pPr` and `w:t` does not match `w:tab`.
 *
 * A SELF-CLOSING element must be recognized as one. `<x\b([^>]*)>` alone takes
 * the `/` of `<x .../>` into its attributes and reads it as an OPEN element,
 * which then swallows everything up to some later `</x>` -- or, when the
 * element is always self-closing (`w:commentRangeStart`, `c:chart`), to the
 * end of the part. Found 2026-10-22 on the pilot SOPs: an empty `<w:p/>`
 * after a table absorbed the next table, and its cells arrived glued together.
 */
const tagScanner = (tags: readonly string[]): RegExp =>
  // `(?![\w.-])`, not `\b`: a `\b` typed inside a string is a BACKSPACE.
  new RegExp(`<(/?)(${tags.map(escapeTag).join('|')})(?![\\w.-])([^>]*)>`, 'g');

export interface OoxmlElement {
  readonly tag: string;
  /** Null for a self-closing element: it has no content, by definition. */
  readonly body: string | null;
  /** Offsets of the whole element, tags included. */
  readonly start: number;
  readonly end: number;
}

/**
 * The OUTERMOST elements named in `tags`, in document order. Nesting is
 * counted across all of `tags` together, so a table inside a table cell, or a
 * text-box paragraph inside a paragraph, stays inside its parent. A truncated
 * part runs its last element to the end.
 */
export const topLevelElements = (xml: string, tags: readonly string[]): OoxmlElement[] => {
  const out: OoxmlElement[] = [];
  const scanner = tagScanner(tags);
  let depth = 0;
  let openTag = '';
  let start = 0;
  let contentStart = 0;
  let match = scanner.exec(xml);
  while (match !== null) {
    const closing = match[1] === '/';
    const selfClosing = !closing && (match[3] ?? '').trimEnd().endsWith('/');
    if (depth === 0) {
      if (selfClosing) {
        out.push({ tag: match[2] ?? '', body: null, start: match.index, end: scanner.lastIndex });
      } else if (!closing) {
        depth = 1;
        openTag = match[2] ?? '';
        start = match.index;
        contentStart = scanner.lastIndex;
      }
      // A stray close tag at the top level belongs to nothing and is skipped.
    } else if (closing) {
      depth -= 1;
      if (depth === 0) {
        out.push({
          tag: openTag,
          body: xml.slice(contentStart, match.index),
          start,
          end: scanner.lastIndex,
        });
      }
    } else if (!selfClosing) {
      depth += 1;
    }
    match = scanner.exec(xml);
  }
  if (depth > 0) {
    out.push({ tag: openTag, body: xml.slice(contentStart), start, end: xml.length });
  }
  return out;
};

/**
 * Removes whole elements, including their children, by tag name. Nesting is
 * handled -- a `w:del` inside a `w:p` inside a `w:tc`, a grouped shape inside
 * a grouped shape -- and a self-closing element removes only itself.
 */
export const stripElements = (xml: string, tagNames: readonly string[]): string => {
  let out = xml;
  for (const tag of tagNames) {
    let result = '';
    let cursor = 0;
    for (const element of topLevelElements(out, [tag])) {
      result += out.slice(cursor, element.start);
      cursor = element.end;
    }
    out = result + out.slice(cursor);
  }
  return out;
};

/**
 * Self-closing elements that contribute whitespace rather than nothing,
 * rewritten as TEXT RUNS. A bare space between runs is never read, because
 * only `<x:t>` content is: a code block's `<w:br/>` line breaks once arrived as
 * "...Personal storeGet-ChildItem" (2026-10-22).
 */
export const expandBreaks = (xml: string): string =>
  xml
    .replace(/<w:tab\b[^>]*\/>/g, '<w:t>\t</w:t>')
    .replace(/<w:(?:br|cr)\b[^>]*\/>/g, '<w:t> </w:t>')
    .replace(/<a:br\b[^>]*\/>/g, '<a:t> </a:t>');

/**
 * The visible text of a fragment, concatenated across its `<prefix:t>` runs.
 *
 * Concatenating WITHOUT a separator is correct and necessary. Word and
 * PowerPoint split a single sentence across many runs for reasons of their own
 * — a spell-check boundary, a formatting change, a revision id — and inserting
 * spaces between runs would break words in the middle. A broken word then
 * fails evidence verification later for a reason nobody could diagnose.
 */
export const runText = (fragment: string, prefix: 'w' | 'a'): string =>
  topLevelElements(expandBreaks(fragment), [`${prefix}:t`])
    .map((run) => decodeEntities(run.body ?? ''))
    .join('')
    .replace(/[\t\r\n]+/g, ' ')
    .trim();

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
