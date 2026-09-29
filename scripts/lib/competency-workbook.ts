// The pure half of `scripts/competency-import.ts`: workbook bytes to a plan.
//
// Kept apart from the command so it can be tested end to end on a synthetic
// workbook -- reader and planner together -- without a database, and so the
// command itself stays a thin shell around it.
//
// The reader keeps text for the first rows only and the planner reads header
// rows only; see docs/competencies/COMPETENCY_IMPORT_PLAN.md §1.

import { basename } from 'node:path';
import { readXlsxGrid } from '@knowzy/content-extraction';
import {
  buildCompetencyImportPlan,
  RX_COMPETENCY_MATRIX_2024,
  type CompetencyImportPlan,
  type CompetencyImportProfile,
} from '@knowzy/domain';

export const planFromWorkbook = (
  bytes: Uint8Array,
  filePath: string,
  profile: CompetencyImportProfile = RX_COMPETENCY_MATRIX_2024,
): CompetencyImportPlan =>
  buildCompetencyImportPlan({
    grid: readXlsxGrid(bytes),
    profile,
    // The name only. A local path can carry a person's user name.
    sourceFileName: basename(filePath.replace(/\\/g, '/')),
  });
