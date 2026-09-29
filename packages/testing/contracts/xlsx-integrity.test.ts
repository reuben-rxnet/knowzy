// XLSX integrity, end to end across packages — XLSX-INTEGRITY-M1.
//
// A styled empty cell used to swallow the next cell and print its
// shared-string INDEX in the wrong column. What that could do downstream is
// what this file pins, through the real code on every path the text feeds:
//
//   * extraction      no bare index enters the text; offsets round-trip (X2);
//                     adding a styled empty cell changes nothing visible, so
//                     the content hash and every section key stay put;
//   * evidence        a correctly positioned span verifies in STRICT mode, and
//                     the span the defective extractor would have produced
//                     does not;
//   * question import a bank row with blank optional columns maps every value
//                     to its own column, and the evidence offsets re-locate;
//   * search          the adapter's snippet shows a value beside its real
//                     neighbours.
//
// Every workbook is synthetic, built in memory. No person, rating or employee
// number appears anywhere in this file.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { verifyEvidence } from '@knowzy/claude-services';
import { extractContent } from '@knowzy/content-extraction';
import {
  createFileRepositoryAdapter,
  type AdapterContext,
} from '@knowzy/knowledge-source-adapters';
import { systemClock } from '@knowzy/observability';
import { detectQuestions } from '@knowzy/question-import';
import { normalizeText } from '@knowzy/shared-types';
import { buildXlsx, num, row, s, si, str, styled } from './support/synthetic-xlsx.js';

const SEP = normalizeText('a — b').slice(1, -1); // the cell separator as it reads after normalization

const STRINGS = [
  si('Renewal window for production certificates'),
  si('Owner'),
  si('Level two operations'),
  si('Escalate to the platform duty manager'),
  si('Certificate policy'),
];

/** A policy row laid out with styled empty cells between its values. */
const policyRows = (withExtraStyledCells: boolean): string =>
  row(1, s('A1', 4)) +
  row(
    2,
    s('A2', 0),
    ...(withExtraStyledCells ? [styled('B2')] : []),
    num('C2', 30),
    s('D2', 1),
    ...(withExtraStyledCells ? [styled('E2'), styled('F2', 3)] : []),
    s('G2', 2),
    styled('H2'),
    s('I2', 3),
  );

const policyWorkbook = (withExtraStyledCells: boolean): Uint8Array =>
  buildXlsx({
    sheets: [{ name: 'Certificate policy', rows: policyRows(withExtraStyledCells) }],
    sharedStrings: STRINGS,
  });

const extract = (bytes: Uint8Array, name = 'policy.xlsx') =>
  extractContent({ fileName: name, content: bytes }, { documentScope: 'xlsx-integrity-contract' });

describe('extraction', () => {
  it('places every value in its own column and lets no shared-string index into the text', async () => {
    const result = await extract(policyWorkbook(true));
    expect(result.status).toBe('EXTRACTED');
    const text = result.normalizedText ?? '';
    const policyLine = [
      'Renewal window for production certificates',
      '',
      '30',
      'Owner',
      '',
      '',
      'Level two operations',
      '',
      'Escalate to the platform duty manager',
    ].join(SEP);
    expect(text).toContain(normalizeText(policyLine));
    // The only digits in this workbook are the visible "30". A leaked index
    // (0-4 here) would add a digit somewhere else.
    expect(text.replace('30', '')).not.toMatch(/\d/);
  });

  it('round-trips every section offset (X2)', async () => {
    const result = await extract(policyWorkbook(true));
    for (const section of result.sections) {
      expect(result.normalizedText?.slice(section.startOffset, section.endOffset)).toBe(
        section.text,
      );
    }
  });

  it('keeps the content hash and every section key when only styled empty cells are added', async () => {
    const plain = await extract(policyWorkbook(false));
    const styledVariant = await extract(policyWorkbook(true));
    // Visible content is identical; the extra cells are empty and styled.
    expect(styledVariant.normalizedText).toBe(plain.normalizedText);
    expect(styledVariant.contentHash).toBe(plain.contentHash);
    expect(styledVariant.sections.map((section) => section.sectionKey)).toEqual(
      plain.sections.map((section) => section.sectionKey),
    );
  });
});

describe('evidence verification', () => {
  it('verifies a correctly positioned span, and refuses the one the defect would have produced', async () => {
    const result = await extract(policyWorkbook(true));
    const sections = result.sections.map((section) => ({
      sectionKey: section.sectionKey,
      text: section.text,
      startOffset: section.startOffset,
    }));
    const sectionKey = result.sections[0]?.sectionKey ?? '';
    const correct = normalizeText(
      [
        '30',
        'Owner',
        '',
        '',
        'Level two operations',
        '',
        'Escalate to the platform duty manager',
      ].join(SEP),
    );
    // What the defective reader printed: B2's styled cell swallowed C2, and
    // F2's swallowed G2, each showing the next cell's value (or index) early.
    const defective = normalizeText(
      [
        '30',
        '30',
        'Owner',
        '',
        '2',
        'Level two operations',
        '3',
        'Escalate to the platform duty manager',
      ].join(SEP),
    );

    expect(
      verifyEvidence({ evidence: correct, sectionKey, sections, mode: 'STRICT' }).verified,
    ).toBe(true);
    expect(
      verifyEvidence({ evidence: defective, sectionKey, sections, mode: 'STRICT' }).verified,
    ).toBe(false);
  });
});

describe('question import', () => {
  it('maps a bank row with blank optional columns column by column, with offsets that re-locate', async () => {
    const header = [
      'Question',
      'A',
      'B',
      'C',
      'D',
      'Correct',
      'Explanation',
      'Difficulty',
      'Topic',
    ];
    const bytes = buildXlsx({
      sheets: [
        {
          name: 'Bank',
          rows:
            row(
              1,
              ...header.map((label, index) => str(`${String.fromCharCode(65 + index)}1`, label)),
            ) +
            row(
              2,
              str('A2', 'Within how many days must a production certificate be renewed?'),
              str('B2', 'Seven days'),
              str('C2', 'Fourteen days'),
              str('D2', 'Thirty days'),
              str('E2', 'Sixty days'),
              str('F2', 'C'),
              // Explanation is a STYLED blank; Difficulty is OMITTED.
              styled('G2'),
              str('I2', 'Certificates'),
            ),
        },
      ],
    });
    const result = await extract(bytes, 'bank.xlsx');
    const detection = detectQuestions({
      fileName: 'bank.xlsx',
      sections: result.sections.map((section) => ({
        sectionKey: section.sectionKey,
        heading: section.heading,
        pageNumber: section.pageNumber,
        slideNumber: section.slideNumber,
        sheetName: section.sheetName,
        startOffset: section.startOffset,
        text: section.text,
      })),
    });
    expect(detection.strategy).toBe('TABULAR');
    const question = detection.detected[0];
    expect(question?.strategy).toBe('TABULAR');
    expect(question?.options).toEqual({
      A: 'Seven days',
      B: 'Fourteen days',
      C: 'Thirty days',
      D: 'Sixty days',
    });
    expect(question?.correctOption).toBe('C');
    expect(question?.explanation ?? null).toBeNull();
    expect(question?.difficulty ?? null).toBeNull();
    expect(question?.topicName).toBe('Certificates');
    expect(
      result.normalizedText?.slice(question?.evidenceStartOffset, question?.evidenceEndOffset),
    ).toBe(question?.evidence);
  });
});

describe('search', () => {
  const root = mkdtempSync(join(tmpdir(), 'knowzy-xlsx-integrity-'));
  mkdirSync(join(root, 'Policies'));
  writeFileSync(join(root, 'Policies', 'certificate-policy.xlsx'), policyWorkbook(true));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const context = (): AdapterContext => ({
    source: {
      knowledgeSourceId: '00000000-0000-0000-0000-0000000000f7',
      sourceKey: 'xlsx-integrity',
      displayName: 'XLSX integrity contract',
      sourceType: 'FILE_REPOSITORY',
      connection: {
        localRoot: root,
        provenance: 'SHAREPOINT_MIRROR' as const,
        webUrlBase: 'https://example-tenant.invalid/sites/Contract/Shared%20Documents',
        mirrorAccountUpn: 'contract@example.invalid',
        includePatterns: [],
        excludePatterns: [],
        supportedExtensions: [],
        maxFileBytes: 8 * 1024 * 1024,
        partialSyncFloor: 0.8,
        sidecarsEnabled: false,
        isActive: true,
      },
    },
    paths: [],
    credential: { kind: 'none', resolve: () => Promise.reject(new Error('no credential')) },
    permissionMode: 'APP_ONLY_SITES_SELECTED',
    correlationId: 'xlsx-integrity-contract',
    limits: { maxBytes: 8 * 1024 * 1024, maxCharsPerDocument: 200_000, pageSize: 50 },
    clock: systemClock,
    signal: new AbortController().signal,
  });

  it('returns a snippet showing the value beside its real neighbours', async () => {
    const page = await createFileRepositoryAdapter().searchDocuments(context(), {
      text: 'Level two operations',
    });
    expect(page.items).toHaveLength(1);
    const snippet = page.items[0]?.snippet ?? '';
    expect(snippet).toContain(
      normalizeText(['Owner', '', '', 'Level two operations', '', 'Escalate'].join(SEP)),
    );
    expect(snippet.replace('30', '')).not.toMatch(/\d/);
  });
});
