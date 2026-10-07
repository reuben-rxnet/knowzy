import { describe, expect, it } from 'vitest';
import {
  canonicalDefinitions,
  definitionsDigest,
  separationRefusal,
  type FrameworkDefinitions,
} from './definitions-digest.js';

const BASE: FrameworkDefinitions = {
  frameworkCode: 'TEST_FRAMEWORK',
  scales: [
    {
      code: 'NI_R_A_G',
      name: 'Matrix scale',
      levels: [
        { code: 'R', label: 'Limited competency', ordinal: 1 },
        { code: 'NI', label: 'Not involved', ordinal: 0 },
      ],
    },
  ],
  categories: [
    { code: 'DATABASE', name: 'Database', kind: 'TECHNICAL', ordinal: 2, status: 'ACTIVE' },
    { code: 'CLOUD', name: 'Cloud', kind: 'TECHNICAL', ordinal: 1, status: 'ACTIVE' },
  ],
  competencies: [
    {
      code: 'DATABASE.POSTGRESQL',
      name: 'PostgreSQL',
      description: null,
      categoryCode: 'DATABASE',
      scaleCode: 'NI_R_A_G',
      status: 'ACTIVE',
    },
  ],
  aliases: [
    {
      subject: 'COMPETENCY',
      contextCode: 'DATABASE',
      foldedAlias: 'postgress',
      alias: 'Postgress',
      targetCode: 'DATABASE.POSTGRESQL',
      decision: 'SPELLING_CORRECTION',
      status: 'ACTIVE',
    },
  ],
};

describe('definitionsDigest', () => {
  it('is 64 lower-case hex characters', () => {
    expect(definitionsDigest(BASE)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not depend on the order rows arrive in', () => {
    const shuffled: FrameworkDefinitions = {
      ...BASE,
      categories: [...BASE.categories].reverse(),
      scales: BASE.scales.map((scale) => ({ ...scale, levels: [...scale.levels].reverse() })),
    };
    expect(definitionsDigest(shuffled)).toBe(definitionsDigest(BASE));
  });

  it('changes when a status changes -- a retired competency is a different framework', () => {
    const retired: FrameworkDefinitions = {
      ...BASE,
      competencies: BASE.competencies.map((row) => ({ ...row, status: 'RETIRED' })),
    };
    expect(definitionsDigest(retired)).not.toBe(definitionsDigest(BASE));
  });

  it('changes when a name, kind, alias decision or description changes', () => {
    const variants: FrameworkDefinitions[] = [
      { ...BASE, categories: [{ ...BASE.categories[0]!, name: 'Databases' }, BASE.categories[1]!] },
      { ...BASE, categories: [{ ...BASE.categories[0]!, kind: 'PROCESS' }, BASE.categories[1]!] },
      { ...BASE, aliases: [{ ...BASE.aliases[0]!, decision: 'PROVISIONAL' }] },
      { ...BASE, competencies: [{ ...BASE.competencies[0]!, description: 'Relational' }] },
    ];
    const digests = new Set(variants.map(definitionsDigest));
    expect(digests.size).toBe(variants.length);
    expect(digests.has(definitionsDigest(BASE))).toBe(false);
  });

  it('covers every definition kind in its canonical form', () => {
    const canonical = canonicalDefinitions(BASE);
    for (const value of ['NI_R_A_G', 'DATABASE', 'DATABASE.POSTGRESQL', 'postgress']) {
      expect(canonical).toContain(value);
    }
  });
});

describe('separationRefusal', () => {
  const ADMIN_1 = '00000000-0000-7000-8000-000000000001';
  const ADMIN_2 = '00000000-0000-7000-8000-000000000002';

  it('refuses the creator', () => {
    expect(
      separationRefusal({
        approverId: ADMIN_1,
        createdByUserId: ADMIN_1,
        editorUserIds: [],
        noun: 'version',
      }),
    ).toMatch(/created this version/);
  });

  it('refuses an editor, and the last editor', () => {
    expect(
      separationRefusal({
        approverId: ADMIN_2,
        createdByUserId: ADMIN_1,
        editorUserIds: [ADMIN_1, ADMIN_2],
        noun: 'target',
      }),
    ).toMatch(/edited this target/);
    expect(
      separationRefusal({
        approverId: ADMIN_2,
        createdByUserId: ADMIN_1,
        modifiedByUserId: ADMIN_2,
        editorUserIds: [],
        noun: 'target',
      }),
    ).toMatch(/edited/);
  });

  it('allows someone who neither created nor edited it', () => {
    expect(
      separationRefusal({
        approverId: ADMIN_2,
        createdByUserId: ADMIN_1,
        modifiedByUserId: ADMIN_1,
        editorUserIds: [ADMIN_1],
        noun: 'version',
      }),
    ).toBeNull();
  });

  it('allows an approver of an imported version, which has no verified creator', () => {
    expect(
      separationRefusal({
        approverId: ADMIN_2,
        createdByUserId: null,
        editorUserIds: [],
        noun: 'version',
      }),
    ).toBeNull();
  });
});
