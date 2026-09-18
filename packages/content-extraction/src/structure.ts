// The structured intermediate form.
//
// Extractors produce BLOCKS; the sectionizer renders the normalized text and
// its section offsets together (see sectionize.ts). Splitting it this way is
// what makes X2 true by construction: the sectionizer owns the final string, so
// an offset can never disagree with it.
//
// An extractor therefore never computes an offset and never sees the final
// text. It answers one question: what are the headings and paragraphs?

import type { DocumentType } from '@knowzy/shared-types';

export interface HeadingBlock {
  readonly kind: 'heading';
  /** 1-6. Deeper levels are clamped. */
  readonly level: number;
  readonly text: string;
}

export interface TextBlock {
  readonly kind: 'text';
  readonly text: string;
  /** Page, slide, or sheet the block came from, where the format has one. */
  readonly pageNumber?: number;
  readonly slideNumber?: number;
  readonly sheetName?: string;
}

export type Block = HeadingBlock | TextBlock;

export interface StructuredDocument {
  readonly documentType: DocumentType;
  readonly blocks: readonly Block[];
  /**
   * True when the source format carries heading structure. When false the
   * sectionizer falls back to fixed windows and labels them honestly
   * ("Segment 3 of 14") rather than inventing a heading (X4).
   */
  readonly hasHeadingStructure: boolean;
}

export const headingBlock = (level: number, text: string): HeadingBlock => ({
  kind: 'heading',
  level: Math.min(6, Math.max(1, Math.trunc(level))),
  text,
});

export const textBlock = (
  text: string,
  location: Omit<TextBlock, 'kind' | 'text'> = {},
): TextBlock => ({
  kind: 'text',
  text,
  ...location,
});
