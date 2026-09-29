// Structure-only competency import: grid in, reference definitions out —
// docs/competencies/COMPETENCY_IMPORT_PLAN.md §2–§5.
//
// Pure. No database, no I/O, no clock. The same grid and profile produce the
// same plan, byte for byte, which is what makes a dry run a faithful preview
// of an apply.
//
// THE RULE THIS FILE EXISTS TO KEEP: a person row contributes a COUNT and
// nothing else. The grid already carries text only for its first few rows;
// within those, this planner reads the rows above and including the detected
// header row, and for everything below it asks one question -- "is the row
// non-empty?" -- whose answer is a number. There is no code path from a person
// row's cell text to the plan, and import-plan.test.ts plants values in every
// person-level position to keep it that way.

import {
  cellReference,
  type WorkbookGrid,
  type WorkbookGridCell,
  type WorkbookGridMerge,
  type WorkbookGridSheet,
} from '@knowzy/shared-types';
import { deriveCodeSegment, foldLabel, isNearMatch } from './fold.js';
import type {
  AliasDecision,
  CategoryKind,
  CompetencyImportProfile,
  DeclaredCategory,
  DeclaredCompetency,
} from './reference-profile.js';

export type SheetClass =
  | 'PERSON_MATRIX'
  | 'TRAINING_MATRIX'
  | 'DISTRIBUTION_SUMMARY'
  | 'AGGREGATE_SUMMARY'
  | 'UNRECOGNIZED'
  | 'HIDDEN';

export type FindingSeverity = 'INFO' | 'WARNING' | 'DECISION_REQUIRED' | 'BLOCKING';

export interface ImportFinding {
  readonly code: string;
  readonly severity: FindingSeverity;
  readonly sheetName: string | null;
  /** Always a reference into a HEADER row, or null. */
  readonly cellReference: string | null;
  /** A header label, never person-row content. */
  readonly subjectLabel: string | null;
  readonly message: string;
}

export interface SourceRef {
  readonly sheetName: string;
  readonly cellReference: string;
  readonly rawLabel: string;
}

export interface PlannedAlias {
  readonly alias: string;
  readonly foldedAlias: string;
  readonly decision: AliasDecision;
  /** Category code for a competency alias; '' for a category alias. */
  readonly contextCode: string;
  readonly note: string | null;
}

export interface PlannedCategory {
  readonly code: string;
  readonly name: string;
  readonly kind: CategoryKind;
  readonly ordinal: number;
  readonly aliases: readonly PlannedAlias[];
  readonly provenance: readonly SourceRef[];
}

export interface PlannedCompetency {
  readonly code: string;
  readonly categoryCode: string;
  readonly scaleCode: string;
  readonly name: string;
  /** False for a label the profile did not declare (rule N4). */
  readonly declared: boolean;
  readonly aliases: readonly PlannedAlias[];
  readonly provenance: readonly SourceRef[];
}

export interface PlannedLevel {
  readonly code: string;
  readonly label: string;
  readonly ordinal: number;
  readonly sourceLabels: readonly string[];
  readonly provenance: readonly SourceRef[];
}

export interface PlannedScale {
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly levels: readonly PlannedLevel[];
}

export interface SheetReport {
  readonly name: string;
  readonly position: number;
  readonly sheetClass: SheetClass;
  readonly reason: string;
  readonly headerRow: number | null;
  /** Rows below the header, counted and never read. */
  readonly personRowsSkipped: number;
  /** HEADER labels of excluded person-attribute columns. */
  readonly excludedColumns: readonly string[];
  /** Competency header cells read from this sheet. */
  readonly competencyHeadersRead: number;
}

export interface ImportSummary {
  readonly sheetsInspected: number;
  readonly categoriesDetected: number;
  readonly competenciesDetected: number;
  readonly aliasesProposed: number;
  readonly personRowsSkipped: number;
  /** Header occurrences that resolved to a definition already seen. */
  readonly duplicateDefinitions: number;
  readonly ambiguities: number;
  readonly decisionsRequired: number;
  readonly blocking: number;
}

export interface CompetencyImportPlan {
  readonly profileCode: string;
  readonly importerVersion: string;
  readonly framework: CompetencyImportProfile['framework'];
  readonly sourceFileName: string;
  readonly sourceContentSha256: string;
  readonly sheets: readonly SheetReport[];
  readonly scales: readonly PlannedScale[];
  readonly categories: readonly PlannedCategory[];
  readonly competencies: readonly PlannedCompetency[];
  readonly findings: readonly ImportFinding[];
  readonly summary: ImportSummary;
}

export interface BuildPlanArgs {
  readonly grid: WorkbookGrid;
  readonly profile: CompetencyImportProfile;
  /** The file's name, recorded as provenance. Never its path. */
  readonly sourceFileName: string;
}

// ---------------------------------------------------------------- internals

const NUMERIC = /^-?\d+([.,]\d+)?(E[+-]?\d+)?$/i;

/** Header rows are searched in rows 1..3 only (COMPETENCY_IMPORT_PLAN.md §3). */
const HEADER_SEARCH_ROWS = 3;

interface MutableCompetency {
  code: string;
  categoryCode: string;
  scaleCode: string;
  name: string;
  declared: DeclaredCompetency | null;
  aliases: Map<string, PlannedAlias>;
  provenance: SourceRef[];
}

interface MutableCategory {
  declared: DeclaredCategory;
  aliases: Map<string, PlannedAlias>;
  provenance: SourceRef[];
}

class Planner {
  private readonly findings = new Map<string, ImportFinding>();
  private readonly categories = new Map<string, MutableCategory>();
  private readonly competencies = new Map<string, MutableCompetency>();
  private readonly levelHarvest = new Map<string, { labels: string[]; provenance: SourceRef[] }>();
  private readonly sheets: SheetReport[] = [];
  private headerOccurrences = 0;

  private readonly identityFolds: ReadonlySet<string>;
  private readonly attributeFolds: ReadonlySet<string>;
  private readonly categoryByFold: ReadonlyMap<string, DeclaredCategory>;
  private readonly levelByFold: ReadonlyMap<string, { scale: string; code: string }>;
  private readonly ratingCodeFolds: ReadonlySet<string>;

  constructor(private readonly profile: CompetencyImportProfile) {
    this.identityFolds = new Set(profile.identityHeaders.map(foldLabel));
    this.attributeFolds = new Set(profile.personAttributeHeaders.map(foldLabel));
    const categoryByFold = new Map<string, DeclaredCategory>();
    for (const category of profile.categories) {
      for (const label of category.labels) categoryByFold.set(foldLabel(label.label), category);
    }
    this.categoryByFold = categoryByFold;
    // Only the default (matrix) scale has labels a summary sheet writes out.
    const levelByFold = new Map<string, { scale: string; code: string }>();
    const matrix = profile.scales.find((scale) => scale.code === profile.defaultScaleCode);
    for (const level of matrix?.levels ?? []) {
      for (const label of [level.label, ...level.sourceLabels]) {
        levelByFold.set(foldLabel(label), { scale: profile.defaultScaleCode, code: level.code });
      }
    }
    this.levelByFold = levelByFold;
    this.ratingCodeFolds = new Set(
      profile.scales.flatMap((scale) =>
        scale.levels.flatMap((level) => [foldLabel(level.code), foldLabel(level.label)]),
      ),
    );
  }

  /** True when at least half the cells are level codes of a declared scale. */
  private looksLikeRatings(cells: readonly WorkbookGridCell[]): boolean {
    const hits = cells.filter((cell) => this.ratingCodeFolds.has(foldLabel(cell.text))).length;
    return hits * 2 >= cells.length;
  }

  private finding(entry: ImportFinding): void {
    const key = `${entry.code}\u0000${entry.sheetName ?? ''}\u0000${entry.cellReference ?? ''}\u0000${entry.subjectLabel ?? ''}`;
    if (!this.findings.has(key)) this.findings.set(key, entry);
  }

  // ------------------------------------------------------------ classification

  private classify(sheet: WorkbookGridSheet, cells: readonly WorkbookGridCell[]): SheetClass {
    if (sheet.hidden) return 'HIDDEN';
    const top = cells.filter((cell) => cell.row <= 3);
    if (top.some((cell) => this.identityFolds.has(foldLabel(cell.text)))) {
      const folds = new Set(top.map((cell) => foldLabel(cell.text)));
      const training = this.profile.trainingMatrix;
      return folds.has(foldLabel(training.presentBand)) && folds.has(foldLabel(training.targetBand))
        ? 'TRAINING_MATRIX'
        : 'PERSON_MATRIX';
    }
    if (cells.some((cell) => this.levelByFold.has(foldLabel(cell.text))))
      return 'DISTRIBUTION_SUMMARY';
    const bandHits = top.filter((cell) => this.categoryByFold.has(foldLabel(cell.text))).length;
    if (bandHits >= 2) return 'AGGREGATE_SUMMARY';
    return 'UNRECOGNIZED';
  }

  // ------------------------------------------------------------------- sheets

  addSheet(sheet: WorkbookGridSheet): void {
    const cells = [...sheet.cells].sort((a, b) => a.row - b.row || a.column - b.column);
    const sheetClass = this.classify(sheet, cells);

    switch (sheetClass) {
      case 'PERSON_MATRIX':
      case 'TRAINING_MATRIX':
        this.matrixSheet(sheet, cells, sheetClass);
        return;
      case 'DISTRIBUTION_SUMMARY':
        this.distributionSheet(sheet, cells);
        return;
      case 'AGGREGATE_SUMMARY':
        this.skipSheet(
          sheet,
          sheetClass,
          'AGGREGATE_NOT_IMPORTED',
          'A computed summary of team-by-level counts. Its figures are workbook aggregates with ' +
            'unverified formulas and denominators, and are not imported as authoritative.',
        );
        return;
      case 'HIDDEN':
        this.skipSheet(
          sheet,
          sheetClass,
          'SHEET_HIDDEN',
          'A hidden sheet is not imported. If it holds definitions, unhide it and import again.',
        );
        return;
      case 'UNRECOGNIZED':
        this.skipSheet(
          sheet,
          sheetClass,
          'SHEET_UNRECOGNIZED',
          'No person-identity header, category band or level vocabulary was found in the first ' +
            'rows, so nothing on this sheet can be interpreted safely.',
        );
        return;
    }
  }

  private skipSheet(
    sheet: WorkbookGridSheet,
    sheetClass: SheetClass,
    code: string,
    message: string,
  ): void {
    this.finding({
      code,
      severity: 'WARNING',
      sheetName: sheet.name,
      cellReference: null,
      subjectLabel: null,
      message,
    });
    this.sheets.push({
      name: sheet.name,
      position: sheet.position,
      sheetClass,
      reason: message,
      headerRow: null,
      personRowsSkipped: 0,
      excludedColumns: [],
      competencyHeadersRead: 0,
    });
  }

  private distributionSheet(sheet: WorkbookGridSheet, cells: readonly WorkbookGridCell[]): void {
    for (const cell of cells) {
      const level = this.levelByFold.get(foldLabel(cell.text));
      if (level === undefined) continue;
      const key = `${level.scale}\u0000${level.code}`;
      const harvest = this.levelHarvest.get(key) ?? { labels: [], provenance: [] };
      if (!harvest.labels.includes(cell.text)) harvest.labels.push(cell.text);
      harvest.provenance.push({
        sheetName: sheet.name,
        cellReference: cellReference(cell.row, cell.column),
        rawLabel: cell.text,
      });
      this.levelHarvest.set(key, harvest);
    }
    const message =
      'A distribution summary: its level labels are recorded as source labels; its counts and ' +
      'percentages are workbook aggregates and are not imported.';
    this.finding({
      code: 'AGGREGATE_NOT_IMPORTED',
      severity: 'WARNING',
      sheetName: sheet.name,
      cellReference: null,
      subjectLabel: null,
      message,
    });
    this.sheets.push({
      name: sheet.name,
      position: sheet.position,
      sheetClass: 'DISTRIBUTION_SUMMARY',
      reason: message,
      headerRow: null,
      personRowsSkipped: 0,
      excludedColumns: [],
      competencyHeadersRead: 0,
    });
  }

  private matrixSheet(
    sheet: WorkbookGridSheet,
    cells: readonly WorkbookGridCell[],
    sheetClass: 'PERSON_MATRIX' | 'TRAINING_MATRIX',
  ): void {
    const at = new Map(cells.map((cell) => [`${cell.row}:${cell.column}`, cell]));

    // Person-attribute columns, widened across any merge their header sits in
    // (so "Experience" over Overall / Essilor / External excludes all three).
    const attributeColumns = new Set<number>();
    const excludedLabels: string[] = [];
    for (const cell of cells) {
      if (cell.row > 3 || !this.attributeFolds.has(foldLabel(cell.text))) continue;
      if (!excludedLabels.includes(cell.text)) excludedLabels.push(cell.text);
      const merge = mergeAt(sheet.merges, cell.row, cell.column);
      const first = merge?.firstColumn ?? cell.column;
      const last = merge?.lastColumn ?? cell.column;
      for (let column = first; column <= last; column += 1) attributeColumns.add(column);
    }

    const region = (row: number): WorkbookGridCell[] =>
      cells.filter((cell) => cell.row === row && !attributeColumns.has(cell.column));

    // The competency header row: the LOWEST of rows 1-3 with cells outside the
    // person columns -- the sub-headers sit under their bands. Row 4 is never a
    // candidate: on the reference workbook it is the first PERSON row. A row
    // that reads mostly as rating codes is refused as a header for the same
    // reason; that test looks at the row and copies nothing.
    let headerRow: number | null = null;
    for (let row = 1; row <= Math.min(HEADER_SEARCH_ROWS, sheet.retainedRowLimit); row += 1) {
      const candidates = region(row);
      if (candidates.length === 0 || this.looksLikeRatings(candidates)) continue;
      headerRow = row;
    }
    // The category band: the densest row above it.
    let bandRow: number | null = null;
    for (let row = 1; headerRow !== null && row < headerRow; row += 1) {
      if (
        region(row).length > 0 &&
        (bandRow === null || region(row).length > region(bandRow).length)
      ) {
        bandRow = row;
      }
    }

    const personRowsSkipped =
      headerRow === null
        ? 0
        : new Set(cells.filter((cell) => cell.row > headerRow).map((cell) => cell.row)).size +
          sheet.rowsBeyondLimit;

    if (headerRow === null || bandRow === null) {
      this.finding({
        code: 'NO_HEADER_STRUCTURE',
        severity: 'WARNING',
        sheetName: sheet.name,
        cellReference: null,
        subjectLabel: null,
        message:
          'A person-identity header was found but no category band above a header row, so no ' +
          'column can be interpreted. Nothing was taken from this sheet.',
      });
      this.pushMatrixReport(sheet, sheetClass, headerRow, personRowsSkipped, excludedLabels, 0);
      return;
    }

    const headerCells = region(headerRow);
    const bandCells = region(bandRow);
    const lastHeaderColumn = Math.max(0, ...headerCells.map((cell) => cell.column));
    const claimed = new Set<number>();
    let competencyHeadersRead = 0;

    bandCells.forEach((band, index) => {
      const next = bandCells[index + 1];
      const merge = sheet.merges.find(
        (range) =>
          range.firstColumn === band.column &&
          range.firstRow >= bandRow &&
          range.firstRow <= headerRow,
      );
      const end =
        merge !== undefined && merge.lastColumn > merge.firstColumn
          ? merge.lastColumn
          : merge !== undefined
            ? band.column
            : next !== undefined
              ? next.column - 1
              : lastHeaderColumn;
      for (let column = band.column; column <= end; column += 1) claimed.add(column);

      const bandRef = cellReference(band.row, band.column);
      const training = this.profile.trainingMatrix;

      if (sheetClass === 'TRAINING_MATRIX') {
        if (foldLabel(band.text) === foldLabel(training.targetBand)) {
          this.finding({
            code: 'PER_PERSON_TARGETS_NOT_IMPORTED',
            severity: 'WARNING',
            sheetName: sheet.name,
            cellReference: bandRef,
            subjectLabel: band.text,
            message:
              'This block records a target PER PERSON, not per role. It is not a role target and ' +
              'is not imported (KNOWLEDGE_PROFICIENCY_ARCHITECTURE.md §4).',
          });
          return;
        }
        if (foldLabel(band.text) !== foldLabel(training.presentBand)) return;
      }

      const category =
        sheetClass === 'TRAINING_MATRIX'
          ? this.profile.categories.find((entry) => entry.code === training.categoryCode)
          : this.categoryByFold.get(foldLabel(band.text));
      if (category === undefined) {
        this.finding({
          code: 'UNDECLARED_CATEGORY',
          severity: 'BLOCKING',
          sheetName: sheet.name,
          cellReference: bandRef,
          subjectLabel: band.text,
          message:
            'This band is not a declared category. A category needs a kind (technical, ' +
            'functional, ...) that cannot be inferred, so it must be declared in the profile first.',
        });
        return;
      }
      this.touchCategory(category, band, sheet.name, sheetClass === 'PERSON_MATRIX');

      for (let column = band.column; column <= end; column += 1) {
        const header = at.get(`${headerRow}:${column}`);
        if (header === undefined) {
          if (band.column === end) {
            // A vertically merged band with no sub-header: its own competency.
            this.finding({
              code: 'CATEGORY_IS_OWN_COMPETENCY',
              severity: 'INFO',
              sheetName: sheet.name,
              cellReference: bandRef,
              subjectLabel: band.text,
              message:
                'The band has no sub-header, so the category is recorded as its own competency.',
            });
            competencyHeadersRead += 1;
            this.resolveCompetency(category.code, band.text, {
              sheetName: sheet.name,
              cellReference: bandRef,
              rawLabel: band.text,
            });
          }
          continue;
        }
        if (NUMERIC.test(header.text)) {
          this.numericHeader(sheet.name, header);
          continue;
        }
        competencyHeadersRead += 1;
        this.resolveCompetency(category.code, header.text, {
          sheetName: sheet.name,
          cellReference: cellReference(header.row, header.column),
          rawLabel: header.text,
        });
      }
    });

    for (const header of headerCells) {
      if (claimed.has(header.column)) continue;
      if (NUMERIC.test(header.text)) {
        this.numericHeader(sheet.name, header);
        continue;
      }
      this.finding({
        code: 'HEADER_OUTSIDE_CATEGORY_BAND',
        severity: 'WARNING',
        sheetName: sheet.name,
        cellReference: cellReference(header.row, header.column),
        subjectLabel: header.text,
        message: 'A header outside every category band is not imported: its category is unknown.',
      });
    }

    if (excludedLabels.some((label) => foldLabel(label) === 'role')) {
      this.finding({
        code: 'ROLE_CATALOGUE_NOT_DERIVED',
        severity: 'INFO',
        sheetName: null,
        cellReference: null,
        subjectLabel: null,
        message:
          'Role titles on person rows are assignments, not catalogue definitions, and are not ' +
          'read. The role catalogue is the existing JobRole taxonomy (COMPETENCY_MODEL.md §2.1).',
      });
    }

    this.finding({
      code: 'PERSON_ROWS_SKIPPED',
      severity: 'INFO',
      sheetName: sheet.name,
      cellReference: null,
      subjectLabel: null,
      message: `${personRowsSkipped} person row(s) below the header were counted and not read.`,
    });
    this.pushMatrixReport(
      sheet,
      sheetClass,
      headerRow,
      personRowsSkipped,
      excludedLabels,
      competencyHeadersRead,
    );
  }

  private pushMatrixReport(
    sheet: WorkbookGridSheet,
    sheetClass: 'PERSON_MATRIX' | 'TRAINING_MATRIX',
    headerRow: number | null,
    personRowsSkipped: number,
    excludedColumns: readonly string[],
    competencyHeadersRead: number,
  ): void {
    this.sheets.push({
      name: sheet.name,
      position: sheet.position,
      sheetClass,
      reason:
        sheetClass === 'TRAINING_MATRIX'
          ? 'A training matrix: competency headers under the Present band are read; the Target ' +
            'block and every person row are not.'
          : 'A person matrix: category bands and competency headers are read; person rows and ' +
            'person-attribute columns are not.',
      headerRow,
      personRowsSkipped,
      excludedColumns,
      competencyHeadersRead,
    });
  }

  private numericHeader(sheetName: string, header: WorkbookGridCell): void {
    this.finding({
      code: 'NUMERIC_HEADER_IGNORED',
      severity: 'WARNING',
      sheetName,
      cellReference: cellReference(header.row, header.column),
      subjectLabel: header.text,
      message: 'A header that is a bare number (a date serial, a stray value) is not a competency.',
    });
  }

  // ---------------------------------------------------------------- categories

  private touchCategory(
    declared: DeclaredCategory,
    band: WorkbookGridCell,
    sheetName: string,
    recordAlias: boolean,
  ): void {
    const entry = this.categories.get(declared.code) ?? {
      declared,
      aliases: new Map<string, PlannedAlias>(),
      provenance: [],
    };
    entry.provenance.push({
      sheetName,
      cellReference: cellReference(band.row, band.column),
      rawLabel: band.text,
    });
    const folded = foldLabel(band.text);
    if (recordAlias && !entry.aliases.has(folded)) {
      const label = declared.labels.find((candidate) => foldLabel(candidate.label) === folded);
      entry.aliases.set(folded, {
        alias: band.text,
        foldedAlias: folded,
        decision: decisionFor(band.text, declared.name, label?.label, label?.decision),
        contextCode: '',
        note: null,
      });
    }
    this.categories.set(declared.code, entry);
  }

  // -------------------------------------------------------------- competencies

  private resolveCompetency(categoryCode: string, raw: string, ref: SourceRef): void {
    this.headerOccurrences += 1;
    const folded = foldLabel(raw);
    const labelMatches = (declared: DeclaredCompetency): boolean =>
      foldLabel(declared.name) === folded ||
      declared.labels.some((label) => foldLabel(label.label) === folded);

    // N1 — declared in this category, or declared elsewhere and placed here by decision.
    let declared = this.profile.competencies.find(
      (entry) => entry.categoryCode === categoryCode && labelMatches(entry),
    );
    if (declared === undefined) {
      declared = this.profile.competencies.find(
        (entry) => (entry.alsoSeenUnder ?? []).includes(categoryCode) && labelMatches(entry),
      );
      if (declared !== undefined) {
        this.finding({
          code: 'CATEGORY_PLACEMENT_PROVISIONAL',
          severity: 'DECISION_REQUIRED',
          sheetName: ref.sheetName,
          cellReference: ref.cellReference,
          subjectLabel: raw,
          message:
            `Appears under ${categoryCode} here and is placed under ${declared.categoryCode} by declaration. ${declared.provisional ?? ''}`.trim(),
        });
      }
    }

    if (declared !== undefined) {
      const entry = this.competencies.get(declared.code) ?? {
        code: declared.code,
        categoryCode: declared.categoryCode,
        scaleCode: declared.scaleCode,
        name: declared.name,
        declared,
        aliases: new Map<string, PlannedAlias>(),
        provenance: [],
      };
      const aliasKey = `${categoryCode}\u0000${folded}`;
      if (!entry.aliases.has(aliasKey)) {
        const label = declared.labels.find((candidate) => foldLabel(candidate.label) === folded);
        entry.aliases.set(aliasKey, {
          alias: raw,
          foldedAlias: folded,
          decision:
            declared.provisional !== undefined
              ? 'PROVISIONAL'
              : decisionFor(raw, declared.name, label?.label, label?.decision),
          contextCode: categoryCode,
          note: declared.provisional ?? null,
        });
      }
      entry.provenance.push(ref);
      this.competencies.set(declared.code, entry);
      if (declared.provisional !== undefined) {
        this.finding({
          code: 'PROVISIONAL_MAPPING',
          severity: 'DECISION_REQUIRED',
          sheetName: null,
          cellReference: null,
          subjectLabel: declared.name,
          message: declared.provisional,
        });
      }
      return;
    }

    // N2 — an undeclared label already created in this category.
    const existing = [...this.competencies.values()].find(
      (entry) =>
        entry.declared === null &&
        entry.categoryCode === categoryCode &&
        foldLabel(entry.name) === folded,
    );
    if (existing !== undefined) {
      const aliasKey = `${categoryCode}\u0000${folded}`;
      if (!existing.aliases.has(aliasKey)) {
        existing.aliases.set(aliasKey, {
          alias: raw,
          foldedAlias: folded,
          decision: 'CASE_OR_SPACING',
          contextCode: categoryCode,
          note: null,
        });
      }
      existing.provenance.push(ref);
      return;
    }

    // N3 — a near match nobody declared stops the import.
    const candidates: { name: string; fold: string }[] = [
      ...this.profile.competencies
        .filter((entry) => entry.categoryCode === categoryCode)
        .flatMap((entry) => [
          { name: entry.name, fold: foldLabel(entry.name) },
          ...entry.labels.map((label) => ({ name: entry.name, fold: foldLabel(label.label) })),
        ]),
      ...[...this.competencies.values()]
        .filter((entry) => entry.declared === null && entry.categoryCode === categoryCode)
        .map((entry) => ({ name: entry.name, fold: foldLabel(entry.name) })),
    ];
    const near = candidates.find((candidate) => isNearMatch(folded, candidate.fold));
    if (near !== undefined) {
      this.finding({
        code: 'NEAR_MATCH_UNDECLARED',
        severity: 'BLOCKING',
        sheetName: ref.sheetName,
        cellReference: ref.cellReference,
        subjectLabel: raw,
        message:
          `"${raw}" is close to "${near.name}" in ${categoryCode} and no decision says whether ` +
          'they are one competency. Declare it in the profile as an alias or as a new competency.',
      });
      return;
    }

    // N4 — a new, undeclared competency, created as written and flagged for review.
    let code = `${categoryCode}.${deriveCodeSegment(raw)}`;
    for (let suffix = 2; this.competencies.has(code); suffix += 1) {
      code = `${categoryCode}.${deriveCodeSegment(raw)}_${suffix}`;
    }
    const scaleCode =
      categoryCode === this.profile.trainingMatrix.categoryCode
        ? (this.profile.competencies.find((entry) => entry.categoryCode === categoryCode)
            ?.scaleCode ?? this.profile.defaultScaleCode)
        : this.profile.defaultScaleCode;
    this.competencies.set(code, {
      code,
      categoryCode,
      scaleCode,
      name: raw.trim(),
      declared: null,
      aliases: new Map([
        [
          `${categoryCode}\u0000${folded}`,
          {
            alias: raw,
            foldedAlias: folded,
            decision: 'UNDECLARED' as const,
            contextCode: categoryCode,
            note: null,
          },
        ],
      ]),
      provenance: [ref],
    });
    this.finding({
      code: 'UNDECLARED_LABEL',
      severity: 'INFO',
      sheetName: ref.sheetName,
      cellReference: ref.cellReference,
      subjectLabel: raw,
      message: `Not in the declared normalization table; created as written under ${categoryCode} for review.`,
    });
  }

  // --------------------------------------------------------------------- build

  build(args: BuildPlanArgs): CompetencyImportPlan {
    // An undeclared label under two categories is two competencies that are
    // probably one. Nothing declares which, so the import stops.
    const undeclaredByFold = new Map<string, MutableCompetency[]>();
    for (const entry of this.competencies.values()) {
      if (entry.declared !== null) continue;
      const list = undeclaredByFold.get(foldLabel(entry.name)) ?? [];
      list.push(entry);
      undeclaredByFold.set(foldLabel(entry.name), list);
    }
    for (const list of undeclaredByFold.values()) {
      if (new Set(list.map((entry) => entry.categoryCode)).size < 2) continue;
      this.finding({
        code: 'CATEGORY_CONFLICT',
        severity: 'BLOCKING',
        sheetName: null,
        cellReference: null,
        subjectLabel: list[0]?.name ?? null,
        message:
          `Appears under ${list.map((entry) => entry.categoryCode).join(' and ')} with no ` +
          'declared placement. Declare which category it belongs to.',
      });
    }

    if (this.competencies.size === 0) {
      this.finding({
        code: 'NO_COMPETENCIES_FOUND',
        severity: 'BLOCKING',
        sheetName: null,
        cellReference: null,
        subjectLabel: null,
        message: 'No competency header was found on any sheet. There is nothing to import.',
      });
    }

    const usedScales = new Set([...this.competencies.values()].map((entry) => entry.scaleCode));
    const scales: PlannedScale[] = this.profile.scales
      .filter((scale) => usedScales.has(scale.code))
      .map((scale) => {
        if (scale.declaredNotRead) {
          this.finding({
            code: 'SCALE_DECLARED_NOT_READ',
            severity: 'DECISION_REQUIRED',
            sheetName: null,
            cellReference: null,
            subjectLabel: scale.name,
            message:
              'No header in the workbook defines this scale; its levels are declared by the ' +
              'profile and must be confirmed by the framework owner.',
          });
        }
        return {
          code: scale.code,
          name: scale.name,
          description: scale.description,
          levels: scale.levels.map((level) => {
            const harvest = this.levelHarvest.get(`${scale.code}\u0000${level.code}`);
            return {
              code: level.code,
              label: level.label,
              ordinal: level.ordinal,
              sourceLabels: unique([...level.sourceLabels, ...(harvest?.labels ?? [])]),
              provenance: harvest?.provenance ?? [],
            };
          }),
        };
      });

    const categoryOrdinal = new Map(
      this.profile.categories.map((entry) => [entry.code, entry.ordinal]),
    );
    const categories: PlannedCategory[] = [...this.categories.values()]
      .sort((a, b) => a.declared.ordinal - b.declared.ordinal)
      .map((entry) => ({
        code: entry.declared.code,
        name: entry.declared.name,
        kind: entry.declared.kind,
        ordinal: entry.declared.ordinal,
        aliases: [...entry.aliases.values()],
        provenance: entry.provenance,
      }));

    const competencies: PlannedCompetency[] = [...this.competencies.values()]
      .sort(
        (a, b) =>
          (categoryOrdinal.get(a.categoryCode) ?? 0) - (categoryOrdinal.get(b.categoryCode) ?? 0) ||
          a.code.localeCompare(b.code),
      )
      .map((entry) => ({
        code: entry.code,
        categoryCode: entry.categoryCode,
        scaleCode: entry.scaleCode,
        name: entry.name,
        declared: entry.declared !== null,
        aliases: [...entry.aliases.values()],
        provenance: entry.provenance,
      }));

    const findings = [...this.findings.values()];
    const count = (severity: FindingSeverity): number =>
      findings.filter((entry) => entry.severity === severity).length;

    return {
      profileCode: this.profile.code,
      importerVersion: this.profile.importerVersion,
      framework: this.profile.framework,
      sourceFileName: args.sourceFileName,
      sourceContentSha256: args.grid.contentSha256,
      sheets: this.sheets,
      scales,
      categories,
      competencies,
      findings,
      summary: {
        sheetsInspected: this.sheets.length,
        categoriesDetected: categories.length,
        competenciesDetected: competencies.length,
        aliasesProposed:
          categories.reduce((sum, entry) => sum + entry.aliases.length, 0) +
          competencies.reduce((sum, entry) => sum + entry.aliases.length, 0),
        personRowsSkipped: this.sheets.reduce((sum, entry) => sum + entry.personRowsSkipped, 0),
        duplicateDefinitions: this.headerOccurrences - competencies.length,
        ambiguities: findings.filter((entry) =>
          ['NEAR_MATCH_UNDECLARED', 'CATEGORY_CONFLICT', 'CATEGORY_PLACEMENT_PROVISIONAL'].includes(
            entry.code,
          ),
        ).length,
        decisionsRequired: count('DECISION_REQUIRED'),
        blocking: count('BLOCKING'),
      },
    };
  }
}

const mergeAt = (
  merges: readonly WorkbookGridMerge[],
  row: number,
  column: number,
): WorkbookGridMerge | undefined =>
  merges.find(
    (range) =>
      range.firstRow <= row &&
      row <= range.lastRow &&
      range.firstColumn <= column &&
      column <= range.lastColumn,
  );

const unique = (values: readonly string[]): string[] => [...new Set(values)];

/**
 * The alias decision for one source spelling. The name itself is EXACT; a
 * declared spelling carries its declared reason; a spelling that differs from
 * its declaration only in case or spacing says so rather than borrowing a
 * stronger claim.
 */
const decisionFor = (
  raw: string,
  name: string,
  declaredLabel: string | undefined,
  declaredDecision: AliasDecision | undefined,
): AliasDecision => {
  if (raw === name) return 'EXACT';
  if (declaredLabel === undefined || declaredDecision === undefined) return 'CASE_OR_SPACING';
  if (raw === declaredLabel) return declaredDecision;
  return declaredDecision === 'EXACT' ? 'CASE_OR_SPACING' : declaredDecision;
};

/** Grid in, plan out. Deterministic; reads no person row. */
export const buildCompetencyImportPlan = (args: BuildPlanArgs): CompetencyImportPlan => {
  const planner = new Planner(args.profile);
  for (const sheet of [...args.grid.sheets].sort((a, b) => a.position - b.position)) {
    planner.addSheet(sheet);
  }
  return planner.build(args);
};
