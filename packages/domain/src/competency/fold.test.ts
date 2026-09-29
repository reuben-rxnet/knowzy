// The competency label fold and near-match rule — COMPETENCY_MODEL.md §5.

import { describe, expect, it } from 'vitest';
import { deriveCodeSegment, foldLabel, isNearMatch } from './fold.js';
import { RX_COMPETENCY_MATRIX_2024 } from './reference-profile.js';

describe('foldLabel', () => {
  it.each([
    ['React Js', 'React JS', 'reactjs'],
    ['Rx-Universe/ Rx-Suite', 'RxUniverse/RXSuite', 'rxuniverserxsuite'],
    ['Fulfilment & Shipping', 'fulfilment and shipping', 'fulfilmentandshipping'],
    ['.NET', 'NET', 'net'],
    ['Int/Ext', 'int / ext', 'intext'],
  ])('folds %s and %s to one key', (a, b, key) => {
    expect(foldLabel(a)).toBe(key);
    expect(foldLabel(b)).toBe(key);
  });

  it('keeps + and # so C++ and C# are not C', () => {
    expect(foldLabel('C++')).toBe('c++');
    expect(foldLabel('C#')).toBe('c#');
    expect(foldLabel('C++')).not.toBe(foldLabel('C#'));
  });

  it('never merges a spelling variant that needs a decision', () => {
    expect(foldLabel('Postgress')).not.toBe(foldLabel('PostgreSQL'));
    expect(foldLabel('Agular')).not.toBe(foldLabel('Angular'));
    expect(foldLabel('Qliksens')).not.toBe(foldLabel('Qlik Sense'));
  });
});

describe('isNearMatch', () => {
  it.each([
    ['postgress', 'postgresql'],
    ['agular', 'angular'],
    ['qliksens', 'qliksense'],
    ['techarch', 'techarh'],
  ])('flags %s ~ %s', (a, b) => {
    expect(isNearMatch(a, b)).toBe(true);
  });

  it('does not flag distinct products or short codes', () => {
    expect(isNearMatch('mysql', 'mssql')).toBe(true); // flagged: a person decides, which is the point
    expect(isNearMatch('aws', 'gcp')).toBe(false); // too short to judge by spelling
    expect(isNearMatch('oracle', 'oracle')).toBe(false); // identical is not "near"
    expect(isNearMatch('greenplum', 'informix')).toBe(false);
  });
});

describe('deriveCodeSegment', () => {
  it('produces an upper snake segment', () => {
    expect(deriveCodeSegment('Launch Darkly')).toBe('LAUNCH_DARKLY');
    expect(deriveCodeSegment('C++')).toBe('CPP');
    expect(deriveCodeSegment('Pricing & Promotions')).toBe('PRICING_AND_PROMOTIONS');
    expect(deriveCodeSegment('***')).toBe('UNNAMED');
  });
});

describe('the declared reference profile', () => {
  const profile = RX_COMPETENCY_MATRIX_2024;

  it('declares every competency code once', () => {
    const codes = profile.competencies.map((entry) => entry.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('gives every competency a declared category and scale', () => {
    const categories = new Set(profile.categories.map((entry) => entry.code));
    const scales = new Set(profile.scales.map((entry) => entry.code));
    for (const entry of profile.competencies) {
      expect(categories.has(entry.categoryCode)).toBe(true);
      expect(scales.has(entry.scaleCode)).toBe(true);
      expect(entry.code.startsWith(`${entry.categoryCode}.`)).toBe(true);
    }
  });

  it('declares no label twice within one category, which would make N1 ambiguous', () => {
    for (const category of profile.categories) {
      const folds = profile.competencies
        .filter((entry) => entry.categoryCode === category.code)
        .flatMap((entry) => [
          ...new Set([entry.name, ...entry.labels.map((label) => label.label)].map(foldLabel)),
        ]);
      expect(new Set(folds).size).toBe(folds.length);
    }
  });

  it('declares the four matrix levels and no Expert level', () => {
    const matrix = profile.scales.find((scale) => scale.code === 'NI_R_A_G');
    expect(matrix?.levels.map((level) => [level.ordinal, level.code, level.label])).toEqual([
      [0, 'NI', 'Not Involved'],
      [1, 'R', 'Limited Involvement or Limited Competency'],
      [2, 'A', 'Involved and Competency Improving'],
      [3, 'G', 'Involved and Competent'],
    ]);
  });
});
