// EVAL-M1: the evaluation packets are evidence, so their rules are tested.
//
//   * CSV opens correctly in Excel: quoting, doubled quotes, line breaks, a
//     UTF-8 BOM, and no cell a spreadsheet would evaluate as a formula.
//   * The blind-stem packet hides what it says it hides: no option, answer,
//     explanation, evidence, provider, model, question id or source document
//     reaches the reviewer's file -- only the key file maps an item back.
//   * The blind order is reproducible from its seed, and is not the input
//     order (which is grouped by provider and would give the provider away).

import { describe, expect, it } from 'vitest';
import {
  BLIND_HEADER,
  REVIEW_HEADER,
  blindPacket,
  csvField,
  reviewRow,
  seededShuffle,
  toCsv,
  type PacketQuestion,
} from './evaluation-format.js';

const question = (n: number, providerId: string): PacketQuestion => ({
  questionId: `q-${providerId}-${n}`,
  providerId,
  modelId: providerId === 'OPENAI' ? 'gpt-5.3-codex_codeassist' : 'knowzy-deterministic-local-1',
  jobId: `job-${providerId}`,
  sourceName: 'KNOWZY Real-World Pilot SOP Corpus',
  documentName: `SOP ${n}.docx`,
  sectionKey: 'abcdef0123456789',
  status: 'DRAFT',
  stem: `Which step comes first in procedure ${n}?`,
  options: { A: `OPTION-A-${n}`, B: `OPTION-B-${n}`, C: `OPTION-C-${n}`, D: `OPTION-D-${n}` },
  correctOption: 'B',
  explanation: `EXPLANATION-${n}`,
  evidence: `EVIDENCE-${n}`,
  evidenceMode: 'STRICT',
  confidence: 0.9,
  maxSimilarity: 0.2,
  createdAt: '2026-09-28T00:00:00.000Z',
});

describe('csv', () => {
  it('quotes and escapes what Excel needs, and nothing else', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a, b')).toBe('"a, b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('line\nbreak')).toBe('"line\nbreak"');
    expect(csvField(null)).toBe('');
  });

  it('never lets a cell be evaluated as a formula', () => {
    for (const risky of ['=SUM(A1)', '+1', '-5 degrees', '@cmd']) {
      expect(csvField(risky).replace(/^"/, '').startsWith("'")).toBe(true);
    }
  });

  it('starts with a UTF-8 BOM and ends rows with CRLF', () => {
    const csv = toCsv(['a'], [['é']]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('a\r\né\r\n');
  });

  it('gives the review packet one column per header', () => {
    expect(reviewRow(question(1, 'OPENAI'))).toHaveLength(REVIEW_HEADER.length);
  });
});

describe('the blind-stem packet', () => {
  const questions = [
    ...[1, 2, 3, 4, 5].map((n) => question(n, 'DETERMINISTIC_LOCAL')),
    ...[6, 7, 8, 9, 10].map((n) => question(n, 'OPENAI')),
  ];
  const packet = blindPacket(questions, 20260928);
  const reviewerFile = toCsv(BLIND_HEADER, packet.rows);

  it('shows the stem and hides everything that would give the answer or the provider away', () => {
    for (const q of questions) {
      expect(reviewerFile).toContain(q.stem);
      for (const hidden of [
        ...Object.values(q.options),
        q.explanation,
        q.evidence,
        q.questionId,
        q.documentName,
        q.jobId ?? '',
      ]) {
        expect(reviewerFile, hidden).not.toContain(hidden);
      }
    }
    for (const leak of ['OPENAI', 'DETERMINISTIC', 'codex', 'deterministic-local', 'STRICT']) {
      expect(reviewerFile.toLowerCase(), leak).not.toContain(leak.toLowerCase());
    }
  });

  it('keeps the mapping in the key only, item for item', () => {
    expect(packet.key).toHaveLength(questions.length);
    const ids = packet.key.map((row) => row[1]);
    expect(new Set(ids)).toEqual(new Set(questions.map((q) => q.questionId)));
    expect(packet.rows.map((row) => row[0])).toEqual(packet.key.map((row) => row[0]));
  });

  it('is reproducible from its seed, and is not the provider-grouped input order', () => {
    const again = blindPacket(questions, 20260928);
    expect(again.key).toEqual(packet.key);
    expect(packet.key.map((row) => row[1])).not.toEqual(questions.map((q) => q.questionId));
    expect(seededShuffle([1, 2, 3, 4, 5, 6, 7, 8], 1)).not.toEqual(
      seededShuffle([1, 2, 3, 4, 5, 6, 7, 8], 2),
    );
  });
});
