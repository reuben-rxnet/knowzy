// @knowzy/content-extraction
//
// Per-type extractors, normalization, sectioning, offsets, hashing.
//
// Boundary: No Graph calls and no database access. Pure text in, sections out.
// The package is deliberately free of I/O so the extraction invariants
// (knowledge-source-adapters.md §2.4 X1-X8) are testable without a source,
// a network, or a database.

// Re-exported, not reimplemented: the pipeline lives in @knowzy/shared-types
// so evidence verification and similarity scoring can reach it without
// crossing a boundary rule. See that file's header.
export { normalizeText, normalizeForComparison } from '@knowzy/shared-types';
export { headingBlock, textBlock } from './structure.js';
export type { Block, HeadingBlock, TextBlock, StructuredDocument } from './structure.js';
export { sectionize, scopeSectionKey } from './sectionize.js';
export type { Section, SectionizeOptions, SectionizeResult } from './sectionize.js';
export { extractPlainText, extractMarkdown } from './extractors/text.js';
export { extractHtml } from './extractors/html.js';
export {
  extractContent,
  fileExtension,
  SUPPORTED_EXTENSIONS,
  supportedDocumentTypes,
} from './extract.js';
export type { ExtractedContent, ExtractInput, ExtractOptions } from './extract.js';

export const PACKAGE_NAME = '@knowzy/content-extraction' as const;
