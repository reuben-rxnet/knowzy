// End to end without a database: a synthetic .xlsx, through readXlsxGrid and
// the planner, to the dry-run report — COMPETENCY_IMPORT_PLAN.md §7.
//
// The workbook is built in memory. Its person rows hold planted values, some
// of them BELOW the reader's row limit, so a regression in either the reader
// (limit ignored) or the planner (a person row read) fails here.

import { describe, expect, it } from 'vitest';
import { formatCompetencyImportReport } from '@knowzy/domain';
import { zipOf as zip } from '../../packages/testing/contracts/support/synthetic-xlsx.js';
import { planFromWorkbook } from './competency-workbook.js';

const inline = (ref: string, text: string): string =>
  `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;

const PLANTED = [
  'Hortensia Plumwhistle',
  'EMP-7730042',
  'Principal Invented Engineer',
  'Mirage Vendor Ltd',
];

// A team sheet: band on row 1, headers on row 3, then people -- rows 4-6 are
// inside the reader's default limit, rows 7-9 beyond it.
const personRow = (row: number, name: string, extra = ''): string =>
  `<row r="${row}">${inline(`B${row}`, name)}${inline(`C${row}`, PLANTED[2] as string)}${inline(`D${row}`, 'G')}${inline(`E${row}`, 'NI')}${extra}</row>`;

const team = `<worksheet><sheetData>
<row r="1">${inline('B1', 'Full Name')}${inline('C1', 'Role')}${inline('D1', 'Database')}${inline('F1', 'Vendor')}</row>
<row r="3">${inline('D3', 'Postgress')}${inline('E3', 'MySQL')}</row>
${personRow(4, PLANTED[0] as string, inline('F4', PLANTED[3] as string))}
${personRow(5, PLANTED[1] as string)}
${personRow(6, 'Second Planted Person')}
${personRow(7, 'Beyond Limit Person')}
${personRow(8, 'Beyond Limit Person Two')}
${personRow(9, 'Beyond Limit Person Three')}
</sheetData><mergeCells count="1"><mergeCell ref="D2:E2"/></mergeCells></worksheet>`;

const bytes = zip({
  '[Content_Types].xml': '<Types/>',
  'xl/workbook.xml':
    '<workbook><sheets><sheet name="Team Synthetic" sheetId="1" r:id="rId1"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels':
    '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
  'xl/worksheets/sheet1.xml': team,
});

describe('competency workbook: reader and planner together', () => {
  const plan = planFromWorkbook(
    bytes,
    'C:\\Users\\someone.private\\Downloads\\synthetic matrix.xlsx',
  );
  const everything = `${JSON.stringify(plan)}\n${formatCompetencyImportReport(plan)}`;

  it.each([...PLANTED, 'Second Planted Person', 'Beyond Limit Person'])(
    'never carries the planted value %s',
    (value) => {
      expect(everything).not.toContain(value);
    },
  );

  it('records the file NAME and never the local path', () => {
    expect(plan.sourceFileName).toBe('synthetic matrix.xlsx');
    expect(everything).not.toContain('someone.private');
  });

  it('reads the definitions and counts all six person rows, inside and beyond the row limit', () => {
    expect(plan.competencies.map((entry) => entry.code)).toEqual([
      'DATABASE.MYSQL',
      'DATABASE.POSTGRESQL',
    ]);
    expect(plan.sheets[0]?.personRowsSkipped).toBe(6);
    expect(plan.summary.blocking).toBe(0);
    expect(plan.sourceContentSha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
