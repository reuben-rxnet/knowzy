// Detection and validation, per shape.
//
// The fixtures are deliberately awkward in the ways a real question bank is:
// a cell containing the column separator, an answer on the next slide, an
// explanation that wraps, an option list that stops at C. Each of those is a
// specific failure this module has to report rather than guess through.

import { describe, expect, it } from 'vitest';
import { detectQuestions, type ImportSection } from './detect.js';
import { validateDetected } from './validate.js';

const section = (text: string, overrides: Partial<ImportSection> = {}): ImportSection => ({
  sectionKey: 'k'.repeat(64),
  heading: null,
  pageNumber: null,
  slideNumber: null,
  sheetName: null,
  startOffset: 0,
  text,
  ...overrides,
});

const EXPLANATION = 'The procedure states this rule directly, so the other options are wrong.';

describe('tabular detection (XLSX)', () => {
  const header = 'Domain — Topic — Question — A — B — C — D — Answer — Explanation';
  const row =
    'Support Ops — Escalation — Which team owns a stuck orchestration record? — ' +
    `L2 RXIT — DBA L4 — Wintel — Incident Management — A — ${EXPLANATION}`;

  it('reads a row into a question with the row as its evidence', () => {
    const result = detectQuestions({
      fileName: 'bank.xlsx',
      sections: [section(`${header}\n${row}`)],
    });
    expect(result.strategy).toBe('TABULAR');
    expect(result.detected).toHaveLength(1);
    const q = result.detected[0]!;
    expect(q.questionText).toBe('Which team owns a stuck orchestration record?');
    expect(q.options.A).toBe('L2 RXIT');
    expect(q.options.D).toBe('Incident Management');
    expect(q.correctOption).toBe('A');
    expect(q.domainName).toBe('Support Ops');
    expect(q.topicName).toBe('Escalation');
    expect(q.locator).toBe('row 2');
  });

  it('quotes the row verbatim, at offsets that re-locate in the document', () => {
    const text = `${header}\n${row}`;
    const result = detectQuestions({
      fileName: 'bank.xlsx',
      sections: [section(text, { startOffset: 500 })],
    });
    const q = result.detected[0]!;
    // The offsets index the DOCUMENT, so subtracting the section start must
    // recover the exact span. This is the property that lets an imported
    // question pass gate 11 and gate 12.
    expect(text.slice(q.evidenceStartOffset - 500, q.evidenceEndOffset)).toBe(q.evidence);
    expect(q.evidence).toBe(row);
  });

  it('also reads the normalized separator, because X1 folds the em dash', () => {
    // The XLSX extractor joins cells with ' — ' and normalization rewrites it
    // to ' - '. Detection has to work on the STORED text, not the extractor's
    // output.
    const normalized = `${header}\n${row}`.replace(/ — /g, ' - ');
    const result = detectQuestions({ fileName: 'bank.xlsx', sections: [section(normalized)] });
    expect(result.detected).toHaveLength(1);
    expect(result.detected[0]?.correctOption).toBe('A');
  });

  it('prefers the em dash, so an in-cell hyphen is not ambiguous', () => {
    // Worth asserting because it is why the ambiguity below is NARROW. While
    // the extractor's own separator survives, a cell containing ' - ' splits
    // correctly and the row imports.
    const hyphenInCell =
      'Support Ops — Escalation — What is the pass - fail threshold? — ' +
      `Seventy — Eighty — Ninety — One hundred — B — ${EXPLANATION}`;
    const result = detectQuestions({
      fileName: 'bank.xlsx',
      sections: [section(`${header}\n${hyphenInCell}`)],
    });
    expect(result.detected).toHaveLength(1);
    expect(result.detected[0]?.questionText).toBe('What is the pass - fail threshold?');
  });

  it('reports a row it cannot split rather than guessing', () => {
    // The real ambiguity, and the only one: once X1 has folded the em dash the
    // separator and an in-cell hyphen are the SAME string, so this row yields
    // ten parts where nine are expected. Reported, not mis-split.
    const normalizedHeader = header.replace(/ — /g, ' - ');
    const ambiguous = (
      'Support Ops — Escalation — What is the pass - fail threshold? — ' +
      `Seventy — Eighty — Ninety — One hundred — B — ${EXPLANATION}`
    ).replace(/ — /g, ' - ');
    const result = detectQuestions({
      fileName: 'bank.xlsx',
      sections: [section(`${normalizedHeader}\n${ambiguous}`)],
    });
    expect(result.detected).toHaveLength(0);
    expect(result.issues[0]?.code).toBe('ROW_SHAPE');
    expect(result.issues[0]?.locator).toBe('row 2');
  });

  it('accepts a row whose TRAILING columns are blank', () => {
    // The shape of every row in the first working question-bank template this
    // met: fifteen named columns, twelve filled, the last three left for a
    // reviewer. A spreadsheet writes nothing at all for a trailing empty cell,
    // so the row arrives short -- and refusing it rejected the whole bank.
    const wide =
      'QuestionID — Domain — Topic — Difficulty — Question — OptionA — OptionB — OptionC — ' +
      'OptionD — CorrectAnswer — IsActive — Explanation — SourceDocument — ApprovedBySME — ' +
      'LastReviewed';
    const filled =
      'VS-E-002 — VisionStar — Support Escalation — Easy — ' +
      'Which team should be contacted for Level 2 support? — SAP BASIS Team — ' +
      `DXC Database Team — RXIT L2 Support Team — Lab Technical Services — C — Yes — ${EXPLANATION}`;
    const result = detectQuestions({
      fileName: 'bank.xlsx',
      sections: [section(`${wide}\n${filled}`)],
    });
    expect(result.issues).toHaveLength(0);
    expect(result.detected).toHaveLength(1);
    const q = result.detected[0]!;
    expect(q.correctOption).toBe('C');
    expect(q.options.D).toBe('Lab Technical Services');
    expect(q.explanation).toBe(EXPLANATION);
    // Padding must not invent a value for a column that was genuinely blank.
    expect(q.sourceLabel).toBeNull();
    expect(validateDetected(result.detected).valid).toHaveLength(1);
  });

  it('reports a SHORT row whose answer column holds the wrong thing', () => {
    // The other face of the separator problem. This row is short AND shifted:
    // an option containing ' - ' split in two, so every later value moved one
    // place left and the answer column holds an option. Padding a short row is
    // only safe when it was short at the TAIL, so this has to be caught rather
    // than imported as a question with a wrong key.
    const wide =
      'QuestionID — Domain — Topic — Difficulty — Question — OptionA — OptionB — OptionC — ' +
      'OptionD — CorrectAnswer — IsActive — Explanation — SourceDocument — ApprovedBySME — ' +
      'LastReviewed';
    const shifted = (
      'VS-E-004 — VisionStar — Environment Variables — Easy — ' +
      'Which command loads the environment variables? — sqlplus prism/lmscole — ' +
      `sudo su - root — lms.sh — startPROD.s — C — Yes — ${EXPLANATION}`
    ).replace(/ — /g, ' - ');
    const result = detectQuestions({
      fileName: 'bank.xlsx',
      sections: [section(`${wide.replace(/ — /g, ' - ')}\n${shifted}`)],
    });
    expect(result.detected).toHaveLength(0);
    expect(result.issues[0]?.code).toBe('ROW_SHAPE');
    expect(result.issues[0]?.detail).toContain('startPROD.s');
  });

  it('does not treat ordinary prose with hyphens as a header', () => {
    const prose = 'The duty manager - who is on call - must be paged within fifteen minutes.';
    const result = detectQuestions({ fileName: 'sop.docx', sections: [section(prose)] });
    expect(result.strategy).not.toBe('TABULAR');
  });
});

describe('prose detection (DOCX, PDF)', () => {
  const block = [
    'Which cancellation reason sends no status to the customer?',
    'A. LAB SYSTEM SETUP AND TEST',
    'B. LMS PATIENT REQUEST',
    'C. LMS DISCONTINUED',
    'D. A blank reason',
    'Answer: A',
    `Explanation: ${EXPLANATION}`,
  ].join('\n');

  it('reads a stem, four options, the answer and the explanation', () => {
    const result = detectQuestions({ fileName: 'bank.docx', sections: [section(block)] });
    expect(result.strategy).toBe('PROSE');
    const q = result.detected[0]!;
    expect(q.questionText).toBe('Which cancellation reason sends no status to the customer?');
    expect(q.options.B).toBe('LMS PATIENT REQUEST');
    expect(q.correctOption).toBe('A');
    expect(q.explanation).toBe(EXPLANATION);
  });

  it('accepts the common option and answer punctuation', () => {
    const variant = block
      .replace(/^A\. /m, '(A) ')
      .replace(/^B\. /m, 'B) ')
      .replace('Answer: A', 'Correct answer: A');
    const result = detectQuestions({ fileName: 'bank.docx', sections: [section(variant)] });
    expect(result.detected[0]?.correctOption).toBe('A');
    expect(result.detected[0]?.options.A).toBe('LAB SYSTEM SETUP AND TEST');
  });

  it('keeps two adjacent questions apart', () => {
    const second = block.replace('Which cancellation reason', 'Which reason suppresses status');
    const result = detectQuestions({
      fileName: 'bank.docx',
      sections: [section(`${block}\n\n${second}`)],
    });
    expect(result.detected).toHaveLength(2);
    // The second stem must not have absorbed the first question's trailer.
    expect(result.detected[1]?.questionText).toBe(
      'Which reason suppresses status sends no status to the customer?',
    );
    expect(result.detected[1]?.questionText).not.toContain('Explanation');
  });

  it('gathers an explanation that wraps onto the next line', () => {
    const wrapped = block.replace(
      `Explanation: ${EXPLANATION}`,
      'Explanation: The procedure states this rule directly,\nso the other options are wrong.',
    );
    const result = detectQuestions({ fileName: 'bank.docx', sections: [section(wrapped)] });
    expect(result.detected[0]?.explanation).toBe(
      'The procedure states this rule directly, so the other options are wrong.',
    );
  });

  it('ignores an option list that stops before D', () => {
    const truncated = block.replace('D. A blank reason\n', '');
    const result = detectQuestions({ fileName: 'bank.docx', sections: [section(truncated)] });
    // Three options is not a MULTIPLE_CHOICE_4 question, and inventing a
    // fourth is exactly what the platform refuses elsewhere.
    expect(result.detected).toHaveLength(0);
  });

  it('reads a question whose options are INLINE on one paragraph', () => {
    // The shape a real import produced, and the reason this strategy exists.
    // The markdown extractor joins a paragraph's lines, and DOCX concatenates
    // runs the same way, so a bank written one-option-per-line arrives as a
    // single line. Line-based detection saw nothing and reported
    // NO_QUESTIONS_FOUND on a file that plainly contained questions.
    const inline =
      'Which cancellation reason sends no status message to the customer? ' +
      'A. LAB SYSTEM SETUP AND TEST B. LMS PATIENT REQUEST C. A blank reason ' +
      `D. Any reason chosen by the handler Answer: A Explanation: ${EXPLANATION}`;
    const result = detectQuestions({ fileName: 'bank.md', sections: [section(inline)] });
    expect(result.detected).toHaveLength(1);
    const q = result.detected[0]!;
    expect(q.questionText).toBe(
      'Which cancellation reason sends no status message to the customer?',
    );
    expect(q.options.A).toBe('LAB SYSTEM SETUP AND TEST');
    expect(q.options.D).toBe('Any reason chosen by the handler');
    expect(q.correctOption).toBe('A');
    expect(q.explanation).toBe(EXPLANATION);
    expect(q.evidence).toBe(inline);
  });

  it('prefers line-based detection when options ARE on their own lines', () => {
    // Guards the ordering: an inline match has to infer where the stem ends,
    // so the more precise strategy must win when both could match.
    const result = detectQuestions({ fileName: 'bank.docx', sections: [section(block)] });
    expect(result.detected[0]?.questionText).toBe(
      'Which cancellation reason sends no status to the customer?',
    );
  });

  it('quotes the whole block as evidence, at document offsets', () => {
    const result = detectQuestions({
      fileName: 'bank.docx',
      sections: [section(block, { startOffset: 1_000 })],
    });
    const q = result.detected[0]!;
    expect(block.slice(q.evidenceStartOffset - 1_000, q.evidenceEndOffset - 1_000)).toBe(
      q.evidence,
    );
    expect(q.evidence).toContain('Answer: A');
  });
});

describe('slide-pair detection (PPTX)', () => {
  const questionSlide = [
    'Which service is restarted first?',
    'A. RxPrinting',
    'B. Print Spooler',
    'C. Both together',
    'D. Neither',
  ].join('\n');

  it('takes the answer from the following slide', () => {
    const result = detectQuestions({
      fileName: 'deck.pptx',
      sections: [
        section(questionSlide, { slideNumber: 3 }),
        section(`Answer: A\nExplanation: ${EXPLANATION}`, { slideNumber: 4 }),
      ],
    });
    expect(result.strategy).toBe('SLIDE_PAIR');
    const q = result.detected[0]!;
    expect(q.correctOption).toBe('A');
    expect(q.explanation).toBe(EXPLANATION);
    expect(q.locator).toBe('slide 3');
  });

  it('reports a question slide with no answer slide', () => {
    const result = detectQuestions({
      fileName: 'deck.pptx',
      sections: [
        section(questionSlide, { slideNumber: 3 }),
        section('Thank you for attending.', { slideNumber: 4 }),
      ],
    });
    expect(result.issues.some((i) => i.code === 'ANSWER_MISSING')).toBe(true);
  });
});

describe('nothing recognisable', () => {
  it('says so, and says what each shape needs', () => {
    const result = detectQuestions({
      fileName: 'policy.docx',
      sections: [section('A certificate must be renewed thirty days before expiry.')],
    });
    expect(result.strategy).toBeNull();
    expect(result.issues[0]?.code).toBe('NO_QUESTIONS_FOUND');
    expect(result.issues[0]?.detail).toContain('header row');
  });
});

describe('validation holds the same standard as generation', () => {
  const good = detectQuestions({
    fileName: 'bank.docx',
    sections: [
      section(
        [
          'Which cancellation reason sends no status to the customer?',
          'A. LAB SYSTEM SETUP AND TEST',
          'B. LMS PATIENT REQUEST',
          'C. LMS DISCONTINUED',
          'D. A blank reason',
          'Answer: A',
          `Explanation: ${EXPLANATION}`,
        ].join('\n'),
      ),
    ],
  }).detected;

  it('passes a complete question', () => {
    const outcome = validateDetected(good);
    expect(outcome.valid).toHaveLength(1);
    expect(outcome.invalid).toHaveLength(0);
  });

  it('refuses a question with no answer, because it cannot be graded', () => {
    const outcome = validateDetected([{ ...good[0]!, correctOption: null }]);
    expect(outcome.valid).toHaveLength(0);
    expect(outcome.invalid[0]?.code).toBe('ANSWER_MISSING');
  });

  it('refuses two identical options', () => {
    const outcome = validateDetected([
      { ...good[0]!, options: { ...good[0]!.options, C: good[0]!.options.B } },
    ]);
    expect(outcome.invalid[0]?.code).toBe('OPTION_INCOMPLETE');
  });

  it('refuses a stem shorter than generation would accept', () => {
    const outcome = validateDetected([{ ...good[0]!, questionText: 'Too short?' }]);
    expect(outcome.invalid[0]?.code).toBe('MISSING_FIELD');
    expect(outcome.invalid[0]?.detail).toContain('two standards');
  });

  it('refuses a missing explanation', () => {
    const outcome = validateDetected([{ ...good[0]!, explanation: null }]);
    expect(outcome.invalid[0]?.detail).toContain('learner sees the explanation');
  });

  it('refuses an evidence block too short to verify', () => {
    const outcome = validateDetected([{ ...good[0]!, evidence: 'A. Yes' }]);
    expect(outcome.invalid[0]?.code).toBe('EVIDENCE_TOO_SHORT');
  });

  it('reports one failure per question, not six', () => {
    const outcome = validateDetected([
      { ...good[0]!, questionText: '', correctOption: null, explanation: null },
    ]);
    expect(outcome.invalid).toHaveLength(1);
  });
});

describe('shapes taken from real question banks', () => {
  // Both fixtures are the EXACT text the platform extracted from a customer
  // file, not an idealised version of it. Each one produced
  // NO_QUESTIONS_FOUND on a document that plainly contained questions.

  it('reads a Word bank whose options concatenate and whose answer is ticked', () => {
    // Two defects in one line. The DOCX extractor joins a paragraph's runs
    // with no separator, so the options arrive pressed together; and the
    // answer line begins with a tick, which an anchored pattern refused.
    const extracted = [
      '1. What is the primary purpose of VisionStar LMS?',
      '',
      'A. Financial Reporting SystemB. Customer Relationship Management ToolC. Lab Management System used to run manufacturing labsD. SAP Integration Platform',
      '',
      '✅ Correct Answer: C. Lab Management System used to run manufacturing labs',
    ].join('\n');

    const result = detectQuestions({
      fileName: 'VisionStar Support Knowledge Assessment Quiz.docx',
      sections: [section(extracted)],
    });
    expect(result.detected).toHaveLength(1);
    const q = result.detected[0]!;
    expect(q.options.A).toBe('Financial Reporting System');
    expect(q.options.B).toBe('Customer Relationship Management Tool');
    expect(q.options.C).toBe('Lab Management System used to run manufacturing labs');
    expect(q.options.D).toBe('SAP Integration Platform');
    expect(q.correctOption).toBe('C');
  });

  it('still refuses a stray option letter mid-sentence', () => {
    // The guard for dropping the word boundary above: an ordered A-B-C-D run
    // is required, so prose mentioning one letter cannot start a false match.
    const prose = 'Escalate to the duty manager. Option B. is not available outside office hours.';
    const result = detectQuestions({ fileName: 'sop.docx', sections: [section(prose)] });
    expect(result.detected).toHaveLength(0);
  });

  it('reads a SharePoint template using OptionA and CorrectAnswer', () => {
    // The customer's own column spelling. `optiona` already matched and
    // `correctanswer` did not, so every row would have imported with no
    // answer and been refused.
    const header =
      'QuestionID — Domain — Topic — Difficulty — Question — OptionA — OptionB — OptionC — ' +
      'OptionD — CorrectAnswer — IsActive — Explanation';
    const row =
      'VS-E-001 — VisionStar — LMS Overview — Easy — What is the primary purpose of VisionStar ' +
      'LMS? — Financial Reporting System — Customer Relationship Management Tool — Lab ' +
      'Management System used to run manufacturing labs — SAP Integration Platform — C — Yes — ' +
      'VisionStar LMS is used as a Lab Management System for manufacturing.';

    const result = detectQuestions({
      fileName: 'Quiz Question Bank Import Template.xlsx',
      sections: [section(`${header}\n${row}`)],
    });
    expect(result.strategy).toBe('TABULAR');
    expect(result.detected).toHaveLength(1);
    const q = result.detected[0]!;
    expect(q.correctOption).toBe('C');
    expect(q.domainName).toBe('VisionStar');
    expect(q.topicName).toBe('LMS Overview');
    expect(q.difficulty).toBe('Easy');
    expect(q.options.D).toBe('SAP Integration Platform');
    expect(validateDetected(result.detected).valid).toHaveLength(1);
  });
});
