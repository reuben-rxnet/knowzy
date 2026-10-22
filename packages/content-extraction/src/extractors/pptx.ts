// PPTX → Blocks.
//
// Slide order is resolved from `ppt/presentation.xml` and its relationships,
// NOT from sorting `slide1.xml`, `slide2.xml`, … numerically. The numeric
// order usually matches, and when it does not — a slide reordered after
// creation, or one deleted and another added — the numeric order is wrong, and
// wrong reading order silently changes how the sectionizer's fallback windows
// split the text. It falls back to numeric order only when the presentation
// part cannot be read, and that fallback is deterministic (X8).
//
// WHAT IS DELIBERATELY NOT READ:
//
//   Speaker notes   not read. Notes are frequently informal — a reminder to
//                   the presenter, a draft, an aside — and a question grounded
//                   in a speaker note cites something the audience never saw.
//                   A recorded limitation, not an oversight: notes sometimes
//                   carry the real procedure.
//   Slide masters   not read. Layout furniture repeats on every slide and
//   and layouts     states no rule.
//   Charts, SmartArt, embedded objects, macros — never touched. Only slide
//   parts are read, so a `vbaProject.bin` is inert.
//
// A caution worth stating where it will be read: slide text is the format
// least likely to state a testable rule. A bullet reading "Renewal: 30 days"
// is a fragment, not a sentence, and the generator needs a sentence stating a
// rule. So PPTX extraction working does not mean PPTX generates well, and the
// coverage report will show that honestly rather than the platform pretending.

import type { DocumentType } from '@knowzy/shared-types';
import { openZip, ZipError, type ZipLimits } from '../zip.js';
import { textBlock, type Block, type StructuredDocument } from '../structure.js';
import { relationshipTargets, runText, stripElements, topLevelElements } from './ooxml.js';

export class PptxError extends Error {
  constructor(
    readonly code: 'NOT_A_PPTX' | 'ENCRYPTED' | 'MALFORMED' | 'LIMIT_EXCEEDED',
    message: string,
  ) {
    super(message);
    this.name = 'PptxError';
  }
}

export interface PptxOptions {
  readonly zipLimits?: ZipLimits;
  readonly maxSlides?: number;
}

const DEFAULT_MAX_SLIDES = 500;

/** Slide paths in presentation order, or null when the order cannot be resolved. */
const slideOrderFromPresentation = (
  presentationXml: string | null,
  relsXml: string | null,
): string[] | null => {
  if (presentationXml === null || relsXml === null) return null;
  const targets = relationshipTargets(relsXml, 'ppt/');
  const order: string[] = [];
  const matcher = /<p:sldId\b[^>]*r:id="([^"]+)"[^>]*\/>/g;
  let match = matcher.exec(presentationXml);
  while (match !== null) {
    const target = targets.get(match[1] ?? '');
    if (target !== undefined) order.push(target);
    match = matcher.exec(presentationXml);
  }
  return order.length > 0 ? order : null;
};

/** `ppt/slides/slide12.xml` → 12, for the deterministic fallback ordering. */
const slideNumberOf = (path: string): number => {
  const digits = /slide(\d+)\.xml$/.exec(path)?.[1];
  return digits === undefined ? Number.MAX_SAFE_INTEGER : Number(digits);
};

/**
 * One block per slide, carrying its slide number.
 *
 * `hasHeadingStructure` is false: a slide title is a shape with a title
 * placeholder, which is visual prominence rather than document structure, and
 * promoting it to a heading would be inventing structure (X4). The
 * sectionizer's labelled-window fallback applies, and a section is honestly
 * called "Segment 3 of 14".
 */
export const extractPptx = (bytes: Uint8Array, options: PptxOptions = {}): StructuredDocument => {
  let slidePaths: string[];
  let read: (name: string) => string | null;

  try {
    const zip = openZip(bytes, options.zipLimits);
    read = (name) => zip.readText(name);

    const ordered = slideOrderFromPresentation(
      zip.readText('ppt/presentation.xml'),
      zip.readText('ppt/_rels/presentation.xml.rels'),
    );

    const present = zip.names.filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
    if (present.length === 0) {
      throw new PptxError('NOT_A_PPTX', 'The container has no slide parts.');
    }

    slidePaths =
      ordered === null
        ? [...present].sort((a, b) => slideNumberOf(a) - slideNumberOf(b))
        : // Only slides that actually exist, in presentation order, then any
          // slide the presentation part did not mention, numerically.
          [
            ...ordered.filter((path) => present.includes(path)),
            ...present
              .filter((path) => !ordered.includes(path))
              .sort((a, b) => slideNumberOf(a) - slideNumberOf(b)),
          ];
  } catch (error) {
    if (error instanceof PptxError) throw error;
    if (error instanceof ZipError) {
      if (error.code === 'ENCRYPTED') {
        throw new PptxError('ENCRYPTED', 'The presentation is encrypted or password-protected.');
      }
      if (error.code === 'LIMIT_EXCEEDED') throw new PptxError('LIMIT_EXCEEDED', error.message);
      if (error.code === 'NOT_A_ZIP') {
        throw new PptxError('NOT_A_PPTX', 'The file is not a PPTX container.');
      }
      throw new PptxError('MALFORMED', error.message);
    }
    throw new PptxError('MALFORMED', 'The PPTX container could not be decompressed.');
  }

  const blocks: Block[] = [];
  const limit = Math.min(slidePaths.length, options.maxSlides ?? DEFAULT_MAX_SLIDES);

  for (let index = 0; index < limit; index += 1) {
    const path = slidePaths[index] as string;
    let slideXml: string | null;
    try {
      slideXml = read(path);
    } catch {
      // Per-part isolation: one unreadable slide must not lose the rest.
      continue;
    }
    if (slideXml === null) continue;

    // Charts and diagrams carry axis labels and node text that read as
    // fragments; removed so they do not pollute the slide's prose.
    const body = stripElements(slideXml, ['c:chart', 'dgm:relIds', 'p:attrNameLst']);

    const lines: string[] = [];
    for (const paragraph of topLevelElements(body, ['a:p'])) {
      const text = paragraph.body === null ? '' : runText(paragraph.body, 'a');
      if (text.length > 0) lines.push(text);
    }

    if (lines.length === 0) continue;
    // `slideNumber` is the position in reading order, which is what a citation
    // should say — not the part's filename number, which may differ.
    blocks.push(textBlock(lines.join('\n'), { slideNumber: index + 1 }));
  }

  return {
    documentType: 'PPTX' as DocumentType,
    blocks,
    hasHeadingStructure: false,
  };
};
