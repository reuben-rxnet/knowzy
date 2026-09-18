// Plain text and Markdown extractors.
//
// Both produce blocks only; offsets belong to the sectionizer (X2).

import { headingBlock, textBlock, type Block, type StructuredDocument } from '../structure.js';
import { normalizeText } from '@knowzy/shared-types';

/**
 * Plain text.
 *
 * X4: plain text carries no heading structure, so `hasHeadingStructure` is
 * false and the sectionizer falls back to labelled windows. Guessing headings
 * from, say, ALL-CAPS lines would be inventing structure the document does not
 * have, and an evidence citation would then point at a heading that exists only
 * in Knowzy.
 */
export const extractPlainText = (raw: string): StructuredDocument => {
  const normalized = normalizeText(raw);
  const blocks: Block[] = normalized
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => textBlock(p));

  return { documentType: 'TXT', blocks, hasHeadingStructure: false };
};

const ATX_HEADING = /^(#{1,6})\s+(.*)$/;

/**
 * Markdown.
 *
 * Handles ATX headings (`## Title`) and Setext underlines. Inline emphasis and
 * link syntax are flattened to their text: a question's evidence span is
 * compared against extracted text, so leaving `**bold**` in would make a
 * verbatim quote from the rendered document fail to match.
 */
export const extractMarkdown = (raw: string): StructuredDocument => {
  const lines = normalizeText(raw).split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let inFence = false;

  const flush = (): void => {
    if (paragraph.length === 0) return;
    const text = paragraph.join(' ').trim();
    if (text.length > 0) blocks.push(textBlock(text));
    paragraph = [];
  };

  const flattenInline = (text: string): string =>
    text
      // Links and images: keep the label, drop the target.
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      // Emphasis and inline code markers.
      .replace(/(\*\*\*|\*\*|\*|___|__|_|`)/g, '')
      .trim();

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';

    // Fenced code blocks are retained verbatim as text: a runbook's commands
    // are exactly the kind of content worth testing, and stripping them would
    // remove the most assessable part of the document.
    if (/^(```|~~~)/.test(line.trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      paragraph.push(line);
      continue;
    }

    const atx = ATX_HEADING.exec(line);
    if (atx) {
      flush();
      blocks.push(headingBlock(atx[1]?.length ?? 1, flattenInline(atx[2] ?? '')));
      continue;
    }

    // Setext: a line underlined with === or ---.
    const next = lines[i + 1] ?? '';
    if (line.trim().length > 0 && /^(={3,}|-{3,})$/.test(next.trim())) {
      flush();
      blocks.push(headingBlock(next.trim().startsWith('=') ? 1 : 2, flattenInline(line)));
      i += 1;
      continue;
    }

    if (line.trim().length === 0) {
      flush();
      continue;
    }

    // List markers carry no meaning once the text is extracted.
    paragraph.push(flattenInline(line.replace(/^\s*([-*+]|\d+\.)\s+/, '')));
  }
  flush();

  const hasHeadingStructure = blocks.some((b) => b.kind === 'heading');
  return { documentType: 'TXT', blocks, hasHeadingStructure };
};
