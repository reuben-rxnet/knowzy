// HTML extractor.
//
// security.md §10: a SANITIZING parser, not a regex sweep. Scripts and styles
// are discarded rather than flattened into text, because their contents would
// otherwise become "document text" that Claude reads and an evidence span could
// cite — which is both a prompt-injection surface (§5) and nonsense content.
//
// Also covers exported knowledge-base HTML and SharePoint page canvases, which
// knowledge-source-administration.md §7.7 treats as HTML.

import { parse, type HTMLElement, type Node, type TextNode } from 'node-html-parser';
import { headingBlock, textBlock, type Block, type StructuredDocument } from '../structure.js';
import { normalizeText } from '../normalize.js';

/** Elements whose entire subtree is discarded, contents included. */
const DISCARDED = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'canvas',
  'iframe',
  'object',
  'embed',
  'head',
  'nav',
  'footer',
]);

const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

/** Elements that end a text run. */
const BLOCK_LEVEL = new Set([
  'p',
  'div',
  'section',
  'article',
  'li',
  'td',
  'th',
  'tr',
  'blockquote',
  'pre',
  'dd',
  'dt',
  'figcaption',
]);

const isElement = (node: Node): node is HTMLElement =>
  typeof (node as HTMLElement).tagName === 'string';

export const extractHtml = (raw: string): StructuredDocument => {
  const root = parse(raw, {
    lowerCaseTagName: true,
    comment: false,
    // Keeping script/style/noscript content as RAW TEXT is deliberate: the
    // walker drops those elements whole, so their contents must stay inside
    // them. Parsing script bodies as markup would let a `<` in the source
    // terminate the element early and leak the remainder into the text.
    blockTextElements: { script: true, noscript: true, style: true, pre: true },
  });

  const blocks: Block[] = [];
  let run: string[] = [];

  const flush = (): void => {
    if (run.length === 0) return;
    const text = normalizeText(run.join(' '));
    if (text.length > 0) blocks.push(textBlock(text));
    run = [];
  };

  const walk = (node: Node): void => {
    if (!isElement(node)) {
      // `text` decodes entities; `rawText` would leave `&amp;` in the extracted
      // text, and an evidence span quoting the rendered page would not match.
      const text = (node as TextNode).text ?? '';
      if (text.trim().length > 0) run.push(text);
      return;
    }

    const tag = node.tagName.toLowerCase();

    if (DISCARDED.has(tag)) return;

    if (HEADINGS.has(tag)) {
      flush();
      const text = normalizeText(node.textContent ?? '');
      if (text.length > 0) blocks.push(headingBlock(Number(tag.slice(1)), text));
      return;
    }

    if (tag === 'br') {
      run.push('\n');
      return;
    }

    if (BLOCK_LEVEL.has(tag)) {
      flush();
      for (const child of node.childNodes) walk(child);
      flush();
      return;
    }

    for (const child of node.childNodes) walk(child);
  };

  const body = root.querySelector('body') ?? root;
  for (const child of body.childNodes) walk(child);
  flush();

  const hasHeadingStructure = blocks.some((b) => b.kind === 'heading');
  return { documentType: 'HTML', blocks, hasHeadingStructure };
};
