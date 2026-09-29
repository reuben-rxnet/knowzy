// The competency gap rule — KNOWLEDGE_PROFICIENCY_ARCHITECTURE.md §4.
//
// Each precondition is removed on its own and must produce NOT_CALCULABLE
// naming it; removing everything must name everything. A gap figure that
// appears without an approved target is the failure this rule exists to stop.

import { describe, expect, it } from 'vitest';
import { evaluateCompetencyGap, type GapObservation, type GapTarget } from './gap.js';

const NOW = new Date('2026-09-29T12:00:00Z');

const approved: GapTarget = {
  status: 'APPROVED',
  approvedAt: new Date('2026-09-01T00:00:00Z'),
  approvedByUserId: '01a0ec8d-0000-7000-8000-000000000001',
  approvalReference: 'Workforce plan 2026, item 4',
  populationActive: true,
  scaleCode: 'NI_R_A_G',
  levelOrdinal: 3,
};

const observed: GapObservation = {
  scaleCode: 'NI_R_A_G',
  levelOrdinal: 2,
  source: 'SME_ASSESSMENT',
  asOf: new Date('2026-09-15T00:00:00Z'),
  reviewBy: new Date('2027-03-15T00:00:00Z'),
};

const evaluate = (target: GapTarget | null, observation: GapObservation | null) =>
  evaluateCompetencyGap({ target, observation, now: NOW });

describe('evaluateCompetencyGap', () => {
  it('computes a gap only when all five preconditions hold', () => {
    expect(evaluate(approved, observed)).toEqual({
      state: 'GAP',
      shortfall: 1,
      source: 'SME_ASSESSMENT',
      asOf: observed.asOf,
    });
    expect(evaluate(approved, { ...observed, levelOrdinal: 3 })).toMatchObject({
      state: 'MEETS_TARGET',
      shortfall: 0,
    });
  });

  it('never reports a negative shortfall when the observation exceeds the target', () => {
    expect(evaluate({ ...approved, levelOrdinal: 1 }, observed)).toMatchObject({ shortfall: 0 });
  });

  it.each([
    ['Q1 no population', { ...approved, populationActive: false }, observed, 'NO_POPULATION'],
    [
      'Q2 target only proposed',
      { ...approved, status: 'PROPOSED' as const },
      observed,
      'NO_APPROVED_TARGET',
    ],
    [
      'Q2 approved without a reference',
      { ...approved, approvalReference: '  ' },
      observed,
      'NO_APPROVED_TARGET',
    ],
    [
      'Q2 approved without an approver',
      { ...approved, approvedByUserId: null },
      observed,
      'NO_APPROVED_TARGET',
    ],
    [
      'Q3 observation past its review date',
      approved,
      { ...observed, reviewBy: new Date('2026-01-01T00:00:00Z') },
      'NO_VALID_OBSERVATION',
    ],
    [
      'Q3 observation dated in the future',
      approved,
      { ...observed, asOf: new Date('2027-01-01T00:00:00Z') },
      'NO_VALID_OBSERVATION',
    ],
    [
      'Q3 a different scale',
      approved,
      { ...observed, scaleCode: 'AGILE_TRAINING' },
      'SCALE_MISMATCH',
    ],
    [
      'Q4 an undeclared source',
      approved,
      { ...observed, source: 'HALLWAY_CONVERSATION' },
      'UNDECLARED_SOURCE',
    ],
    ['Q4 no source', approved, { ...observed, source: null }, 'UNDECLARED_SOURCE'],
    ['Q5 no as-of date', approved, { ...observed, asOf: null }, 'NO_AS_OF_DATE'],
  ] as const)('%s is NOT_CALCULABLE', (_label, target, observation, reason) => {
    const result = evaluate(target as GapTarget, observation as GapObservation);
    expect(result.state).toBe('NOT_CALCULABLE');
    expect(result.state === 'NOT_CALCULABLE' ? result.missing : []).toContain(reason);
  });

  it('names EVERY missing precondition, not the first', () => {
    expect(evaluate(null, null)).toEqual({
      state: 'NOT_CALCULABLE',
      missing: ['NO_POPULATION', 'NO_APPROVED_TARGET', 'NO_VALID_OBSERVATION'],
    });
    expect(
      evaluate(
        { ...approved, status: 'PROPOSED', populationActive: null },
        { ...observed, source: null, asOf: null },
      ),
    ).toEqual({
      state: 'NOT_CALCULABLE',
      missing: ['NO_POPULATION', 'NO_APPROVED_TARGET', 'UNDECLARED_SOURCE', 'NO_AS_OF_DATE'],
    });
  });

  it('refuses a target taken straight from a per-person "Target" column', () => {
    // What the reference workbook's Agile sheet holds: a level, no role, no approval.
    const perPerson: GapTarget = {
      status: 'PROPOSED',
      approvedAt: null,
      approvedByUserId: null,
      approvalReference: null,
      populationActive: null,
      scaleCode: 'AGILE_TRAINING',
      levelOrdinal: 2,
    };
    expect(evaluate(perPerson, { ...observed, scaleCode: 'AGILE_TRAINING' }).state).toBe(
      'NOT_CALCULABLE',
    );
  });
});
