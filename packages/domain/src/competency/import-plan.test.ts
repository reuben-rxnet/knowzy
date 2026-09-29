// The structure-only competency planner —
// docs/competencies/COMPETENCY_IMPORT_PLAN.md §7.
//
// The grid below is SYNTHETIC and shaped like the reference workbook: two team
// sheets (one with its category band on row 1, one on row 2), an Agile
// training sheet with Present and Target, a distribution summary and an
// aggregate summary. Every person-level position holds a PLANTED value, and
// the first describe block proves none of them reaches the plan or the report.
//
// No value here was copied from the real workbook's person rows. The header
// labels are the ones COMPETENCY_MODEL.md §5.3 declares.

import type {
  WorkbookGrid,
  WorkbookGridCell,
  WorkbookGridMerge,
  WorkbookGridSheet,
} from '@knowzy/shared-types';
import { describe, expect, it } from 'vitest';
import { buildCompetencyImportPlan, type CompetencyImportPlan } from './import-plan.js';
import { RX_COMPETENCY_MATRIX_2024 } from './reference-profile.js';
import { formatCompetencyImportReport } from './report.js';

// ------------------------------------------------------------------ planted

const PLANTED = [
  'Zelda Quimbleworth',
  'Ottoline Vexmoor',
  'Barnaby Thistlecombe',
  'EMP-4410001',
  'Chief Synthetic Officer',
  'Planted Vendor GmbH',
  'Project Moonlark',
  'Planted training plan: shadow the coach in Q3',
  'Lisbon-Planted',
  '37.25',
  'Yes-critical-planted',
] as const;

// -------------------------------------------------------------- grid helpers

const col = (letters: string): number =>
  [...letters].reduce((total, letter) => total * 26 + (letter.charCodeAt(0) - 64), 0);

/** `cells('B1', 'Full Name', 'C1', 'Role', ...)` */
const cells = (...pairs: string[]): WorkbookGridCell[] => {
  const out: WorkbookGridCell[] = [];
  for (let index = 0; index < pairs.length; index += 2) {
    const match = /^([A-Z]+)(\d+)$/.exec(pairs[index] as string);
    if (match === null) throw new Error(`bad ref ${pairs[index]}`);
    out.push({
      row: Number(match[2]),
      column: col(match[1] as string),
      text: pairs[index + 1] as string,
    });
  }
  return out;
};

const merge = (range: string): WorkbookGridMerge => {
  const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(range);
  if (match === null) throw new Error(`bad range ${range}`);
  return {
    firstRow: Number(match[2]),
    firstColumn: col(match[1] as string),
    lastRow: Number(match[4]),
    lastColumn: col(match[3] as string),
  };
};

const sheet = (
  name: string,
  position: number,
  body: WorkbookGridCell[],
  merges: WorkbookGridMerge[] = [],
  rowsBeyondLimit = 0,
  hidden = false,
): WorkbookGridSheet => ({
  name,
  position,
  hidden,
  cells: body,
  merges,
  retainedRowLimit: 6,
  rowsBeyondLimit,
});

// Band on ROW 1. (The reference sheets have theirs on row 2, under a spacer
// row; a band on row 1 is the other layout a matrix can take.)
const teamAlpha = sheet(
  'Team Alpha',
  0,
  [
    ...cells('B1', 'Full Name', 'C1', 'Role', 'D1', 'Critical', 'E1', 'Int/Ext'),
    ...cells('F1', 'Database', 'I1', 'ERP', 'K1', 'DevOps', 'L1', 'Power Skills'),
    ...cells('F3', 'Postgress', 'G3', 'Oracle', 'H3', 'MySQL', 'I3', 'Oracle', 'J3', 'SAP'),
    ...cells('L3', 'Leadership', 'M3', '46294'),
    // Person rows: every position planted.
    ...cells('B4', PLANTED[0], 'C4', PLANTED[4], 'D4', PLANTED[10], 'E4', 'Ext'),
    ...cells('F4', 'G', 'G4', 'A', 'H4', 'NI', 'I4', 'R', 'J4', 'G', 'K4', 'A', 'L4', 'G'),
    ...cells('B5', PLANTED[1], 'C5', 'Dev', 'F5', 'NI', 'L5', 'R'),
    ...cells('B6', PLANTED[2], 'C6', 'QA', 'F6', 'A'),
  ],
  [merge('F2:H2'), merge('I2:J2'), merge('K2:K3'), merge('B2:B3')],
  7,
);

// Band on ROW 2, with the attribute columns the reference "Rxlab.NET" sheet has.
const teamBeta = sheet(
  'Team Beta',
  1,
  [
    ...cells(
      'B2',
      'Sr #',
      'C2',
      'Employee number',
      'D2',
      'Full Name',
      'E2',
      'Role',
      'F2',
      'Vendor',
    ),
    ...cells(
      'G2',
      'Project',
      'H2',
      'Experience',
      'K2',
      'LMS',
      'O2',
      'Development',
      'R2',
      'Power Skills',
    ),
    ...cells('H3', 'Overall', 'I3', 'Essilor', 'J3', 'External'),
    ...cells('K3', 'RxUniverse/RXSuite', 'L3', 'Rxlab.NET', 'M3', 'RxLab.NET', 'N3', 'RXSolun OFS'),
    ...cells('O3', 'Agular', 'P3', 'React Js', 'Q3', 'Ansi-C', 'R3', 'Leadership'),
    ...cells('B4', '1', 'C4', PLANTED[3], 'D4', PLANTED[1], 'E4', PLANTED[4], 'F4', PLANTED[5]),
    ...cells('G4', PLANTED[6], 'H4', PLANTED[9], 'I4', '4', 'J4', '0.75', 'K4', 'G', 'O4', 'A'),
  ],
  [merge('H2:J2'), merge('K2:N2'), merge('O2:Q2'), merge('B2:B3')],
  0,
);

const agile = sheet(
  'Agile',
  2,
  [
    ...cells('B2', 'Team details', 'G2', 'Present', 'I2', 'Target'),
    ...cells(
      'B3',
      'Name',
      'C3',
      'Role',
      'D3',
      'Product/Service',
      'E3',
      'Location',
      'F3',
      'int / ext',
    ),
    ...cells(
      'G3',
      'Agile Basics',
      'H3',
      'Scrum Master',
      'I3',
      'Agile Basics',
      'J3',
      'Scrum Master',
    ),
    ...cells('K3', 'Training plan to implement'),
    ...cells(
      'B4',
      PLANTED[0],
      'E4',
      PLANTED[8],
      'G4',
      'Trained',
      'H4',
      'Untrained',
      'I4',
      'Certified',
    ),
    ...cells('K4', PLANTED[7]),
  ],
  [merge('B2:F2'), merge('G2:H2'), merge('I2:J2')],
  40,
);

const distribution = sheet('DB', 3, [
  ...cells('A2', 'SQL Server', 'E2', 'MySQL'),
  ...cells('A3', 'Limited competency', 'B3', '0.14', 'C3', '17', 'E3', 'Limited involvement'),
  ...cells('A4', 'Competency Improving', 'A5', 'Competent', 'A6', 'Not Involved'),
]);

const aggregate = sheet('Summary - new', 4, [
  ...cells('D2', 'LMS', 'K2', 'Functional/Domain', 'D3', 'Rx.NET', 'K3', 'B2B'),
  ...cells('B4', 'Team Alpha', 'C4', 'R', 'D4', '3', 'C5', 'A', 'D5', '1'),
]);

const hiddenSheet = sheet('Scratch', 5, cells('A1', 'Full Name', 'B1', PLANTED[0]), [], 0, true);

const grid = (...sheets: WorkbookGridSheet[]): WorkbookGrid => ({
  sheets,
  contentSha256: 'a'.repeat(64),
});

const REFERENCE_GRID = grid(teamAlpha, teamBeta, agile, distribution, aggregate, hiddenSheet);

const plan = (source: WorkbookGrid = REFERENCE_GRID): CompetencyImportPlan =>
  buildCompetencyImportPlan({
    grid: source,
    profile: RX_COMPETENCY_MATRIX_2024,
    sourceFileName: 'synthetic.xlsx',
  });

const byCode = (result: CompetencyImportPlan, code: string) =>
  result.competencies.find((entry) => entry.code === code);

/** Every key of every object, recursively. */
const keysOf = (value: unknown, into = new Set<string>()): Set<string> => {
  if (Array.isArray(value)) value.forEach((item) => keysOf(item, into));
  else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      into.add(key);
      keysOf(child, into);
    }
  }
  return into;
};

// ------------------------------------------------------------------- privacy

describe('structure-only import emits no person-level record', () => {
  const result = plan();
  const serialized = JSON.stringify(result);
  const report = formatCompetencyImportReport(result);

  it.each(PLANTED)('never carries the planted value %s', (value) => {
    expect(serialized).not.toContain(value);
    expect(report).not.toContain(value);
  });

  it('references no cell below a header row', () => {
    const refs = [
      ...result.findings.map((finding) => finding.cellReference),
      ...result.categories.flatMap((entry) => entry.provenance.map((ref) => ref.cellReference)),
      ...result.competencies.flatMap((entry) => entry.provenance.map((ref) => ref.cellReference)),
    ].filter((ref): ref is string => ref !== null);
    // Header rows are 1-3 on every matrix sheet; distribution labels sit in 2-6 on a sheet with no people.
    const matrixSheets = new Set(['Team Alpha', 'Team Beta', 'Agile']);
    const matrixRefs = [
      ...result.findings
        .filter((finding) => matrixSheets.has(finding.sheetName ?? ''))
        .map((f) => f.cellReference),
      ...result.competencies.flatMap((entry) =>
        entry.provenance
          .filter((ref) => matrixSheets.has(ref.sheetName))
          .map((ref) => ref.cellReference),
      ),
    ].filter((ref): ref is string => ref !== null);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of matrixRefs) expect(Number(/\d+$/.exec(ref)?.[0])).toBeLessThanOrEqual(3);
  });

  it('has no field shaped like a person attribute anywhere in the plan', () => {
    const forbidden = [
      'fullName',
      'employee',
      'employeeNumber',
      'rating',
      'ratings',
      'vendor',
      'experience',
      'critical',
      'intExt',
      'project',
      'location',
      'role',
      'roleTitle',
      'trainingPlan',
      'target',
    ];
    const keys = keysOf(result);
    for (const key of forbidden) expect(keys.has(key)).toBe(false);
  });

  it('counts the person rows it skipped, which proves they were seen and not missed', () => {
    const rows = Object.fromEntries(
      result.sheets.map((entry) => [entry.name, entry.personRowsSkipped]),
    );
    // Team Alpha: rows 4-6 retained plus 7 beyond the limit. Team Beta: row 4. Agile: row 4 plus 40.
    expect(rows).toMatchObject({ 'Team Alpha': 10, 'Team Beta': 1, Agile: 41 });
    expect(result.summary.personRowsSkipped).toBe(52);
  });

  it('reports excluded person columns by their HEADER label only', () => {
    const beta = result.sheets.find((entry) => entry.name === 'Team Beta');
    expect(beta?.excludedColumns).toEqual([
      'Sr #',
      'Employee number',
      'Full Name',
      'Role',
      'Vendor',
      'Project',
      'Experience',
    ]);
    // The Experience sub-headers are person attributes too, via its merge, and are not competencies.
    expect(
      result.competencies.some((entry) => ['Overall', 'Essilor', 'External'].includes(entry.name)),
    ).toBe(false);
  });

  it('never reads a hidden sheet', () => {
    const hidden = result.sheets.find((entry) => entry.name === 'Scratch');
    expect(hidden?.sheetClass).toBe('HIDDEN');
    expect(result.findings.some((finding) => finding.code === 'SHEET_HIDDEN')).toBe(true);
  });
});

// ---------------------------------------------------------- classification

describe('sheet classification', () => {
  it('classifies each sheet by its header region', () => {
    expect(plan().sheets.map((entry) => [entry.name, entry.sheetClass])).toEqual([
      ['Team Alpha', 'PERSON_MATRIX'],
      ['Team Beta', 'PERSON_MATRIX'],
      ['Agile', 'TRAINING_MATRIX'],
      ['DB', 'DISTRIBUTION_SUMMARY'],
      ['Summary - new', 'AGGREGATE_SUMMARY'],
      ['Scratch', 'HIDDEN'],
    ]);
  });

  it('imports nothing from an aggregate summary, and says why', () => {
    const result = plan();
    expect(byCode(result, 'FUNCTIONAL_DOMAIN.B2B')).toBeUndefined();
    expect(
      result.findings.some(
        (f) => f.code === 'AGGREGATE_NOT_IMPORTED' && f.sheetName === 'Summary - new',
      ),
    ).toBe(true);
  });

  it('takes the level LABELS from a distribution summary, with provenance, and none of its figures', () => {
    const result = plan();
    const scale = result.scales.find((entry) => entry.code === 'NI_R_A_G');
    const limited = scale?.levels.find((level) => level.code === 'R');
    expect(limited?.sourceLabels).toEqual(['Limited involvement', 'Limited competency']);
    expect(limited?.provenance.map((ref) => ref.cellReference)).toEqual(['A3', 'E3']);
    expect(JSON.stringify(result)).not.toContain('0.14');
  });

  it('does not treat a fully rated person row as a header', () => {
    // A team sheet whose row 3 is missing: the densest candidate would be row 4, a person.
    const noHeader = sheet('Team Gamma', 0, [
      ...cells('B1', 'Full Name', 'F1', 'Database'),
      ...cells('B4', PLANTED[0], 'F4', 'G', 'G4', 'A', 'H4', 'NI'),
    ]);
    const result = plan(grid(noHeader));
    expect(JSON.stringify(result)).not.toContain(PLANTED[0]);
    expect(result.competencies).toEqual([]);
  });
});

// ------------------------------------------------------------ normalization

describe('normalization', () => {
  const result = plan();

  it('maps a declared spelling correction, and records the decision', () => {
    const postgres = byCode(result, 'DATABASE.POSTGRESQL');
    expect(postgres?.name).toBe('PostgreSQL');
    expect(postgres?.aliases).toEqual([
      {
        alias: 'Postgress',
        foldedAlias: 'postgress',
        decision: 'SPELLING_CORRECTION',
        contextCode: 'DATABASE',
        note: null,
      },
    ]);
  });

  it('keeps Oracle under Database and Oracle under ERP as two competencies', () => {
    expect(byCode(result, 'DATABASE.ORACLE_DATABASE')?.aliases[0]?.decision).toBe(
      'CATEGORY_QUALIFIED',
    );
    expect(byCode(result, 'ERP.ORACLE_ERP')?.aliases[0]?.decision).toBe('CATEGORY_QUALIFIED');
  });

  it('records a band with no sub-header as its own competency', () => {
    expect(byCode(result, 'DEVOPS.DEVOPS')?.provenance).toEqual([
      { sheetName: 'Team Alpha', cellReference: 'K1', rawLabel: 'DevOps' },
    ]);
    expect(result.findings.some((f) => f.code === 'CATEGORY_IS_OWN_COMPETENCY')).toBe(true);
  });

  it('ignores a numeric header', () => {
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: 'NUMERIC_HEADER_IGNORED',
        cellReference: 'M3',
        subjectLabel: '46294',
      }),
    );
  });

  it('places a competency seen under two bands by declaration, and asks for confirmation', () => {
    const ofs = byCode(result, 'FUNCTIONAL_DOMAIN.RXSOLUN_OFS');
    expect(ofs?.aliases).toEqual([
      expect.objectContaining({
        alias: 'RXSolun OFS',
        contextCode: 'LMS',
        decision: 'PROVISIONAL',
      }),
    ]);
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: 'CATEGORY_PLACEMENT_PROVISIONAL',
        severity: 'DECISION_REQUIRED',
      }),
    );
  });

  it('merges case variants into one competency with one alias per spelling', () => {
    const rxlab = byCode(result, 'LMS.RXLAB_NET');
    expect(rxlab?.aliases.map((alias) => [alias.alias, alias.decision])).toEqual([
      ['Rxlab.NET', 'EXACT'],
    ]);
    // "RxLab.NET" folds to the same key, so it is provenance, not a second alias.
    expect(rxlab?.provenance.map((ref) => ref.rawLabel)).toEqual(['Rxlab.NET', 'RxLab.NET']);
  });

  it('applies the declared corrections from the reference workbook', () => {
    expect(byCode(result, 'DEVELOPMENT.ANGULAR')?.aliases[0]).toMatchObject({
      alias: 'Agular',
      decision: 'SPELLING_CORRECTION',
    });
    expect(byCode(result, 'DEVELOPMENT.REACT_JS')?.aliases[0]?.decision).toBe('CASE_OR_SPACING');
    expect(byCode(result, 'LMS.RX_UNIVERSE')?.aliases[0]?.decision).toBe('PROVISIONAL');
  });

  it('counts a competency repeated across sheets as one definition', () => {
    expect(
      result.competencies.filter((entry) => entry.code === 'POWER_SKILLS.LEADERSHIP'),
    ).toHaveLength(1);
    expect(byCode(result, 'POWER_SKILLS.LEADERSHIP')?.provenance).toHaveLength(2);
    expect(result.summary.duplicateDefinitions).toBeGreaterThanOrEqual(2);
  });

  it('reads the Agile Present block onto its own scale and never the Target block', () => {
    const basics = byCode(result, 'AGILE_PRACTICE.AGILE_BASICS');
    expect(basics?.scaleCode).toBe('AGILE_TRAINING');
    expect(basics?.provenance.map((ref) => ref.cellReference)).toEqual(['G3']);
    expect(result.findings).toContainEqual(
      expect.objectContaining({ code: 'PER_PERSON_TARGETS_NOT_IMPORTED', cellReference: 'I2' }),
    );
    expect(result.findings).toContainEqual(
      expect.objectContaining({ code: 'SCALE_DECLARED_NOT_READ', severity: 'DECISION_REQUIRED' }),
    );
  });

  it('declares no Expert level anywhere', () => {
    const levels = result.scales.flatMap((scale) =>
      scale.levels.map((level) => level.label.toLowerCase()),
    );
    expect(levels.some((label) => label.includes('expert'))).toBe(false);
    expect(
      result.scales.find((scale) => scale.code === 'NI_R_A_G')?.levels.map((level) => level.code),
    ).toEqual(['NI', 'R', 'A', 'G']);
  });

  it('has no blocking finding on the reference shape', () => {
    expect(result.findings.filter((finding) => finding.severity === 'BLOCKING')).toEqual([]);
  });
});

// ----------------------------------------------------------- the stop rules

describe('decision order: what stops an apply', () => {
  const withHeaders = (...pairs: string[]): WorkbookGrid =>
    grid(
      sheet(
        'Team Delta',
        0,
        [...cells('B1', 'Full Name', 'F1', 'Database', 'J1', 'Testing'), ...cells(...pairs)],
        [merge('F2:I2'), merge('J2:K2')],
      ),
    );

  it('N3: an undeclared near match of a declared competency blocks and creates nothing', () => {
    const result = plan(withHeaders('F3', 'MySQLL'));
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: 'NEAR_MATCH_UNDECLARED',
        severity: 'BLOCKING',
        subjectLabel: 'MySQLL',
      }),
    );
    expect(result.competencies.some((entry) => entry.name === 'MySQLL')).toBe(false);
  });

  it('N4: an undeclared label unlike anything is created as written, for review', () => {
    const result = plan(withHeaders('F3', 'CockroachDB'));
    expect(byCode(result, 'DATABASE.COCKROACHDB')).toMatchObject({
      name: 'CockroachDB',
      declared: false,
    });
    expect(result.findings).toContainEqual(
      expect.objectContaining({ code: 'UNDECLARED_LABEL', severity: 'INFO' }),
    );
    expect(result.summary.blocking).toBe(0);
  });

  it('an undeclared label under two categories blocks as a category conflict', () => {
    const result = plan(withHeaders('F3', 'Kafka Streams', 'J3', 'Kafka Streams'));
    expect(result.findings).toContainEqual(
      expect.objectContaining({ code: 'CATEGORY_CONFLICT', severity: 'BLOCKING' }),
    );
  });

  it('an undeclared category blocks, because its kind cannot be inferred', () => {
    const result = plan(
      grid(sheet('Team Epsilon', 0, cells('B1', 'Full Name', 'F1', 'Quantum', 'F3', 'Qubits'))),
    );
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: 'UNDECLARED_CATEGORY',
        severity: 'BLOCKING',
        subjectLabel: 'Quantum',
      }),
    );
  });

  it('a workbook with no competency at all blocks', () => {
    expect(plan(grid(aggregate)).findings).toContainEqual(
      expect.objectContaining({ code: 'NO_COMPETENCIES_FOUND', severity: 'BLOCKING' }),
    );
  });
});

// -------------------------------------------------------------- determinism

describe('determinism', () => {
  it('produces the same plan twice', () => {
    expect(plan()).toEqual(plan());
  });

  it('does not depend on the order cells arrive in', () => {
    const shuffled = grid(
      ...REFERENCE_GRID.sheets.map((entry) => ({ ...entry, cells: [...entry.cells].reverse() })),
    );
    expect(plan(shuffled)).toEqual(plan());
  });
});
