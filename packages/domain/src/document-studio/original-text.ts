// AI Document Studio M3 -- the original document as a person reads it.
//
// The sectionizer keeps a heading as the SECTION's heading, not in the
// document's extracted text (a Word or Markdown heading never appears in
// `extracted_text`). So the Studio reads the original section by section, and
// every check that asks "is this in the original?" compares against the text
// WITH its headings -- otherwise each of the original's own headings would be
// marked as added, and a figure in a heading as invented.

import type { DbClient } from '@knowzy/database';

export interface OriginalSection {
  readonly heading: string | null;
  readonly text: string;
}

export interface OriginalText {
  readonly sections: readonly OriginalSection[];
  /** Headings and text, in order: what "in the original" means for the checks. */
  readonly comparisonText: string;
}

export const readOriginalText = async (
  db: DbClient,
  args: {
    readonly documentId: string;
    readonly versionCounter: number;
    readonly extractedText: string;
  },
): Promise<OriginalText> => {
  const rows = await db.documentSection.findMany({
    where: { documentId: args.documentId, documentVersionCounter: args.versionCounter },
    orderBy: { ordinal: 'asc' },
    select: { heading: true, startOffset: true, endOffset: true },
  });
  const sections: OriginalSection[] =
    rows.length === 0
      ? [{ heading: null, text: args.extractedText }]
      : rows.map((row) => ({
          heading: row.heading,
          text: args.extractedText.slice(row.startOffset, row.endOffset),
        }));
  const comparisonText = sections
    .flatMap((section) =>
      section.heading === null ? [section.text] : [section.heading, section.text],
    )
    .join('\n\n');
  return { sections, comparisonText };
};
