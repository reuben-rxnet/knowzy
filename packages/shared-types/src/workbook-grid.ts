// A workbook as a grid of HEADER cells — COMPETENCY-M0/M1.
//
// Produced by `readXlsxGrid` in @knowzy/content-extraction and consumed by the
// competency import planner in @knowzy/domain. It lives here because the domain
// may not reach content-extraction (boundary rule B3), and a structural type
// in two places is how the two ends stop agreeing.
//
// THE SHAPE IS THE PRIVACY CONTROL. A sheet carries decoded text only for its
// first `retainedRowLimit` rows. Every row below that is COUNTED, never
// decoded, so a consumer cannot read a person row even by mistake: there is no
// field that holds one. See docs/competencies/COMPETENCY_IMPORT_PLAN.md §1.

/** One non-empty cell. Row and column are 1-based, as a spreadsheet shows them. */
export interface WorkbookGridCell {
  readonly row: number;
  readonly column: number;
  readonly text: string;
}

/** A merged range, inclusive at both ends. */
export interface WorkbookGridMerge {
  readonly firstRow: number;
  readonly firstColumn: number;
  readonly lastRow: number;
  readonly lastColumn: number;
}

export interface WorkbookGridSheet {
  readonly name: string;
  /** Position in the workbook's own sheet order, from 0. */
  readonly position: number;
  /** `state="hidden"` or `veryHidden`. */
  readonly hidden: boolean;
  /** Non-empty cells in rows 1..retainedRowLimit only. */
  readonly cells: readonly WorkbookGridCell[];
  readonly merges: readonly WorkbookGridMerge[];
  readonly retainedRowLimit: number;
  /** Non-empty rows below the limit: counted, never decoded. */
  readonly rowsBeyondLimit: number;
}

export interface WorkbookGrid {
  readonly sheets: readonly WorkbookGridSheet[];
  /** SHA-256 of the file's bytes, lower-case hex. */
  readonly contentSha256: string;
}

/** `A` is 1, `Z` is 26, `AA` is 27. */
export const columnLetters = (column: number): string => {
  let n = column;
  let letters = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
};

/** `B3` for row 3, column 2. */
export const cellReference = (row: number, column: number): string =>
  `${columnLetters(column)}${row}`;
