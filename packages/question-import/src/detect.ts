// Question detection over an already-extracted document.
//
// THE DESIGN DECISION THIS FILE RESTS ON, stated first because everything else
// follows from it:
//
// An imported question has no evidence span, and every approval gate in this
// platform requires one. Gate 1 refuses a question with no supporting
// evidence; gate 11 verifies the span character-by-character against the
// section it cites; gate 12 re-locates it in the current text. `DraftQuestion`
// makes `sourceDocumentId`, `sectionKey`, `supportingEvidence` and its offsets
// NON-NULL and immutable after insert.
//
// So there were two options: add an "imported" question that skips the
// grounding gates, or make an imported question grounded like any other. The
// first would have put an ungrounded, unverifiable question into the same
// review queue as a grounded one, which is the distinction the whole platform
// exists to maintain.
//
// This takes the second. THE UPLOADED FILE BECOMES A KNOWLEDGE DOCUMENT. It is
// extracted and sectioned by the same pipeline that reads an SOP, and a
// detected question's evidence span is the verbatim block it was read from, at
// real offsets into that document's normalized text. Every gate then passes
// for the same reason it passes for a generated question: the span is really
// there, and a reviewer can see exactly which lines of the uploaded file the
// question came from.
//
// Import is therefore a different ACQUISITION path onto the same rails, not a
// second set of rails. Nothing downstream needs to know the difference —
// except a reviewer, which is why the draft records that it was imported.
//
// This module holds no dependency on the extraction package: it takes plain
// data, so the domain can consume it without violating boundary rule B3.

import { normalizeForComparison } from '@knowzy/shared-types';

/** §2.5: too short is not evidence. Matches EVIDENCE_MIN_CHARS. */
export const EVIDENCE_MIN_CHARS = 40;
export const EVIDENCE_MAX_CHARS = 1_200;

export const OPTION_KEYS = ['A', 'B', 'C', 'D'] as const;
export type OptionKey = (typeof OPTION_KEYS)[number];

export interface ImportSection {
  readonly sectionKey: string;
  readonly heading: string | null;
  readonly pageNumber: number | null;
  readonly slideNumber: number | null;
  readonly sheetName: string | null;
  /** Offset of this section within the document's normalized text. */
  readonly startOffset: number;
  readonly text: string;
}

export interface DetectInput {
  readonly fileName: string;
  readonly sections: readonly ImportSection[];
}

export type ImportStrategy = 'TABULAR' | 'PROSE' | 'SLIDE_PAIR';

export interface DetectedQuestion {
  readonly ordinal: number;
  readonly questionText: string;
  readonly options: Readonly<Record<OptionKey, string>>;
  readonly correctOption: OptionKey | null;
  readonly explanation: string | null;
  readonly domainName: string | null;
  readonly topicName: string | null;
  readonly difficulty: string | null;
  readonly tags: readonly string[];
  readonly sourceLabel: string | null;
  /** The verbatim block, quoted from the document. This is the evidence. */
  readonly evidence: string;
  /** Offsets into the DOCUMENT's normalized text, so the span re-locates. */
  readonly evidenceStartOffset: number;
  readonly evidenceEndOffset: number;
  readonly sectionKey: string;
  readonly strategy: ImportStrategy;
  /** Where a person should look in the file: "row 7", "slide 4", "page 3". */
  readonly locator: string;
}

export type ImportIssueCode =
  | 'NO_QUESTIONS_FOUND'
  | 'ROW_SHAPE'
  | 'HEADER_NOT_RECOGNISED'
  | 'MISSING_FIELD'
  | 'OPTION_INCOMPLETE'
  | 'ANSWER_MISSING'
  | 'ANSWER_INVALID'
  | 'EVIDENCE_TOO_SHORT';

export interface DetectionIssue {
  readonly locator: string;
  readonly code: ImportIssueCode;
  readonly detail: string;
}

export interface DetectionResult {
  readonly strategy: ImportStrategy | null;
  readonly detected: readonly DetectedQuestion[];
  readonly issues: readonly DetectionIssue[];
}

// ---------------------------------------------------------------------------
// Shared helpers

/**
 * Both separators, because normalization folds an em dash to a hyphen.
 *
 * The XLSX extractor joins cells with ` — `, and X1 rewrites that to ` - ` on
 * the way into the stored text. Detection therefore has to accept the
 * normalized form, and a cell whose own content contains ` - ` becomes
 * genuinely ambiguous — which is reported as ROW_SHAPE rather than guessed at.
 */
const CELL_SEPARATORS = [' — ', ' - '] as const;

const splitRow = (line: string): string[] => {
  for (const separator of CELL_SEPARATORS) {
    if (line.includes(separator)) {
      return line.split(separator).map((cell) => cell.trim());
    }
  }
  return [line.trim()];
};

const OPTION_PATTERN = /^\s*\(?([A-Da-d])[).:\-\s]\s*(.+)$/;

/**
 * Anything before the keyword is tolerated, and it has to be.
 *
 * A real question bank marks its answer line with a tick, a bullet, a dash or
 * a bold glyph — `✅ Correct Answer: C. …` is what Word produced for the first
 * bank this was tried on. Anchoring on `^\s*` refused the whole file, and the
 * screen said NO_QUESTIONS_FOUND about a document that plainly contained ten
 * questions.
 *
 * `[^A-Za-z]*` rather than a list of known markers: enumerating the decorations
 * people use is a losing game, and the keyword itself is the real anchor.
 */
const ANSWER_PATTERN =
  /^[^A-Za-z]*(?:correct\s*answer|answer|ans|key)\s*[:.-]\s*\(?([A-Da-d])\)?\b/i;
const EXPLANATION_PATTERN = /^[^A-Za-z]*(?:explanation|rationale|why|reason)\s*[:.-]\s*(.*)$/i;

/**
 * The same keywords once more, UNANCHORED, for a trailer on the option line.
 *
 * A document flattened to one paragraph carries the options, the answer and
 * the explanation in a single line, so the line-anchored patterns above cannot
 * reach them. `TRAILING_TRAILER_PATTERN` is what option D is trimmed with:
 * either keyword ends the option, whichever appears first.
 */
const TRAILING_ANSWER_PATTERN =
  /\b(?:correct\s*answer|answer|ans|key)\s*[:.-]\s*\(?([A-Da-d])\)?\b/i;
const TRAILING_EXPLANATION_PATTERN = /\b(?:explanation|rationale|why|reason)\s*[:.-]\s*(.*)$/i;
const TRAILING_TRAILER_PATTERN =
  /\s*[^A-Za-z]*\b(?:correct\s*answer|answer|ans|key|explanation|rationale|why|reason)\s*[:.-].*$/i;

const blank = (line: string): boolean => line.trim().length === 0;

const emptyOptions = (): Record<OptionKey, string> => ({ A: '', B: '', C: '', D: '' });

// ---------------------------------------------------------------------------
// Tabular (XLSX, and any document whose rows carry a header)

interface HeaderMap {
  readonly columns: number;
  readonly index: Readonly<Record<string, number>>;
}

/**
 * Column names, with the spellings real templates actually use.
 *
 * The list grew after meeting a working SharePoint question-bank template
 * whose columns were `OptionA` and `CorrectAnswer`. `optiona` already matched;
 * `correctanswer` did not, so every row of an otherwise well-formed bank would
 * have imported with no answer and been refused. Recognising the customer's
 * spelling is the platform's job, not theirs.
 */
const HEADER_ALIASES: Readonly<Record<string, readonly string[]>> = {
  domain: ['domain'],
  topic: ['topic', 'subtopic', 'subject'],
  question: ['question', 'stem', 'question text', 'questiontext'],
  a: ['a', 'option a', 'optiona', 'option_a', 'choice a', 'choicea'],
  b: ['b', 'option b', 'optionb', 'option_b', 'choice b', 'choiceb'],
  c: ['c', 'option c', 'optionc', 'option_c', 'choice c', 'choicec'],
  d: ['d', 'option d', 'optiond', 'option_d', 'choice d', 'choiced'],
  answer: [
    'answer',
    'correct',
    'correct answer',
    'correctanswer',
    'correct_answer',
    'answer key',
    'answerkey',
    'key',
  ],
  explanation: ['explanation', 'rationale', 'justification'],
  difficulty: ['difficulty', 'level'],
  tags: ['tags', 'keywords'],
  source: ['source', 'reference', 'sourcedocument', 'source document'],
  version: ['version'],
};

const readHeader = (line: string): HeaderMap | null => {
  const cells = splitRow(line);
  if (cells.length < 6) return null;
  const index: Record<string, number> = {};
  cells.forEach((cell, position) => {
    const value = cell.trim().toLowerCase();
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.includes(value) && index[field] === undefined) index[field] = position;
    }
  });
  // A header must at least name the question and one option; without those the
  // line is ordinary prose that happens to contain separators.
  if (index['question'] === undefined || index['a'] === undefined) return null;
  return { columns: cells.length, index };
};

const cellAt = (cells: readonly string[], position: number | undefined): string | null => {
  if (position === undefined) return null;
  const value = cells[position];
  return value === undefined || value.trim().length === 0 ? null : value.trim();
};

const detectTabular = (input: DetectInput): DetectionResult | null => {
  for (const section of input.sections) {
    const lines = section.text.split('\n');
    const headerAt = lines.findIndex((line) => readHeader(line) !== null);
    if (headerAt === -1) continue;
    const header = readHeader(lines[headerAt] as string);
    if (header === null) continue;

    const detected: DetectedQuestion[] = [];
    const issues: DetectionIssue[] = [];
    // Offset of each line within the section, so an evidence span points at
    // the real row rather than at the section as a whole.
    let cursor = 0;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] as string;
      const lineStart = cursor;
      cursor += line.length + 1;
      if (i <= headerAt || blank(line)) continue;

      const locator = `row ${i + 1}`;
      const ambiguous =
        `A cell containing the column separator cannot be told apart from a column ` +
        'break, so the row is reported rather than guessed at.';
      const cells = splitRow(line);

      // MORE cells than the header names can only mean a cell contained the
      // separator, which moves every later value and cannot be undone.
      if (cells.length > header.columns) {
        issues.push({
          locator,
          code: 'ROW_SHAPE',
          detail: `Expected ${header.columns} columns and found ${cells.length}. ${ambiguous}`,
        });
        continue;
      }

      // FEWER is normal and must be accepted: a spreadsheet writes nothing for
      // a trailing empty cell, so a template whose last columns are left blank
      // -- SourceDocument, ApprovedBySME, LastReviewed on the first real bank
      // this met -- produces a short row for every question in the file.
      // Refusing them rejected a well-formed bank in full. The extractor
      // preserves column position for interior gaps (see extractors/xlsx.ts),
      // so a short row is short only at the tail and padding cannot shift a
      // value into the wrong column.
      const padded = [...cells];
      while (padded.length < header.columns) padded.push('');

      const options = emptyOptions();
      for (const key of OPTION_KEYS) {
        options[key] = cellAt(padded, header.index[key.toLowerCase()]) ?? '';
      }
      const answerRaw = cellAt(padded, header.index['answer']);
      const answer = answerRaw?.trim().toUpperCase().charAt(0) ?? '';

      // A short row whose answer cell holds something that is not an option
      // letter is the other face of the separator problem: the row was short
      // because a cell SPLIT, not because a column was blank, and the values
      // after it are one place out. Said plainly, rather than passed on as a
      // question with a wrong answer.
      if (
        cells.length < header.columns &&
        answerRaw !== null &&
        !(OPTION_KEYS as readonly string[]).includes(answer)
      ) {
        issues.push({
          locator,
          code: 'ROW_SHAPE',
          detail:
            `Expected ${header.columns} columns and found ${cells.length}, and the answer ` +
            `column holds "${answerRaw}" rather than A, B, C or D. ${ambiguous}`,
        });
        continue;
      }

      detected.push({
        ordinal: detected.length + 1,
        questionText: cellAt(padded, header.index['question']) ?? '',
        options,
        correctOption: (OPTION_KEYS as readonly string[]).includes(answer)
          ? (answer as OptionKey)
          : null,
        explanation: cellAt(padded, header.index['explanation']),
        domainName: cellAt(padded, header.index['domain']),
        topicName: cellAt(padded, header.index['topic']),
        difficulty: cellAt(padded, header.index['difficulty']),
        tags:
          cellAt(padded, header.index['tags'])
            ?.split(/[,;]/)
            .map((tag) => tag.trim())
            .filter((tag) => tag.length > 0) ?? [],
        sourceLabel: cellAt(padded, header.index['source']),
        // The row exactly as the document holds it. Quoting the whole row
        // rather than the question cell keeps the span locatable and gives a
        // reviewer the answer and explanation in the same breath.
        evidence: line.trim(),
        evidenceStartOffset:
          section.startOffset + lineStart + (line.length - line.trimStart().length),
        evidenceEndOffset: section.startOffset + lineStart + line.trimEnd().length,
        sectionKey: section.sectionKey,
        strategy: 'TABULAR',
        locator,
      });
    }

    if (detected.length > 0 || issues.length > 0) {
      return { strategy: 'TABULAR', detected, issues };
    }
  }
  return null;
};

// ---------------------------------------------------------------------------
// Prose (DOCX, PDF, and anything shaped as stem / A-D / answer / explanation)

interface ProseBlock {
  readonly startLine: number;
  readonly endLine: number;
  readonly stem: string;
  readonly options: Record<OptionKey, string>;
  readonly correctOption: OptionKey | null;
  readonly explanation: string | null;
}

/**
 * Reads one question block starting at the line where option A appears.
 *
 * The stem is collected by walking BACKWARDS, because a question's text
 * precedes its options and there is no marker for where it begins — only
 * where the options do.
 */
const readProseBlock = (lines: readonly string[], optionALine: number): ProseBlock | null => {
  const options = emptyOptions();
  let line = optionALine;
  let expected = 0;

  while (line < lines.length && expected < OPTION_KEYS.length) {
    const match = OPTION_PATTERN.exec(lines[line] as string);
    if (match === null) {
      if (blank(lines[line] as string)) {
        line += 1;
        continue;
      }
      break;
    }
    const key = (match[1] as string).toUpperCase() as OptionKey;
    if (key !== OPTION_KEYS[expected]) break;
    options[key] = (match[2] as string).trim();
    expected += 1;
    line += 1;
  }
  if (expected < OPTION_KEYS.length) return null;

  let correctOption: OptionKey | null = null;
  let explanation: string | null = null;
  let end = line - 1;

  // Answer and explanation follow the options, in either order, with blanks
  // permitted between. Scanning a bounded window keeps one question's trailer
  // from being read as the next question's stem.
  for (let ahead = line; ahead < Math.min(lines.length, line + 6); ahead += 1) {
    const text = lines[ahead] as string;
    if (blank(text)) continue;
    const answer = ANSWER_PATTERN.exec(text);
    if (answer !== null) {
      correctOption = (answer[1] as string).toUpperCase() as OptionKey;
      end = ahead;
      continue;
    }
    const why = EXPLANATION_PATTERN.exec(text);
    if (why !== null) {
      explanation = (why[1] as string).trim();
      end = ahead;
      // An explanation may wrap onto following lines that carry no marker.
      for (let more = ahead + 1; more < Math.min(lines.length, ahead + 4); more += 1) {
        const next = lines[more] as string;
        if (blank(next) || OPTION_PATTERN.test(next) || ANSWER_PATTERN.test(next)) break;
        explanation = `${explanation} ${next.trim()}`.trim();
        end = more;
      }
      continue;
    }
    break;
  }

  const stemLines: string[] = [];
  for (let back = optionALine - 1; back >= 0; back -= 1) {
    const text = lines[back] as string;
    if (blank(text)) {
      if (stemLines.length > 0) break;
      continue;
    }
    // Stop at the previous question's trailer rather than absorbing it.
    if (ANSWER_PATTERN.test(text) || EXPLANATION_PATTERN.test(text) || OPTION_PATTERN.test(text)) {
      break;
    }
    stemLines.unshift(text.trim());
    if (stemLines.length >= 6) break;
  }

  return {
    startLine: Math.max(0, optionALine - stemLines.length),
    endLine: end,
    stem: stemLines.join(' ').trim(),
    options,
    correctOption,
    explanation,
  };
};

const detectProseIn = (
  section: ImportSection,
  strategy: ImportStrategy,
  locatorFor: (line: number) => string,
  startOrdinal: number,
): { detected: DetectedQuestion[]; issues: DetectionIssue[] } => {
  const lines = section.text.split('\n');
  // Offset of the first character of each line within the section.
  const lineStarts: number[] = [];
  let cursor = 0;
  for (const line of lines) {
    lineStarts.push(cursor);
    cursor += line.length + 1;
  }

  const detected: DetectedQuestion[] = [];
  const issues: DetectionIssue[] = [];
  let ordinal = startOrdinal;
  let index = 0;

  while (index < lines.length) {
    const match = OPTION_PATTERN.exec(lines[index] as string);
    if (match === null || (match[1] as string).toUpperCase() !== 'A') {
      index += 1;
      continue;
    }
    const block = readProseBlock(lines, index);
    if (block === null) {
      index += 1;
      continue;
    }

    const from = lineStarts[block.startLine] ?? 0;
    const lastLine = lines[block.endLine] ?? '';
    const to = (lineStarts[block.endLine] ?? 0) + lastLine.length;
    const evidence = section.text.slice(from, to).trim();
    const locator = locatorFor(block.startLine + 1);

    detected.push({
      ordinal,
      questionText: block.stem,
      options: block.options,
      correctOption: block.correctOption,
      explanation: block.explanation,
      domainName: null,
      topicName: section.heading,
      difficulty: null,
      tags: [],
      sourceLabel: null,
      evidence,
      evidenceStartOffset: section.startOffset + from,
      evidenceEndOffset: section.startOffset + to,
      sectionKey: section.sectionKey,
      strategy,
      locator,
    });
    ordinal += 1;
    index = block.endLine + 1;
  }

  return { detected, issues };
};

// ---------------------------------------------------------------------------
// Inline prose (one question per PARAGRAPH, not one option per line)
//
// Found by running an import end to end rather than by reading the code. The
// markdown extractor joins the lines of a paragraph into a single line, and
// DOCX concatenates runs the same way, so a question bank written as
//
//     Which reason suppresses status?
//     A. First
//     B. Second
//     ...
//
// arrives as ONE line: "Which reason suppresses status? A. First B. Second ...".
// Line-based detection sees no option lines at all and reports
// NO_QUESTIONS_FOUND on a file that plainly contains questions.
//
// So the options are matched INLINE as well, anchored on the A-B-C-D sequence
// in order. Requiring the order is what stops a stray "A." inside prose from
// starting a false match.

/**
 * No word boundary before the option letters, and that is deliberate.
 *
 * The DOCX extractor concatenates a paragraph's runs WITHOUT a separator, so
 * four options written as four runs arrive as
 * `A. Financial Reporting SystemB. Customer Relationship Management ToolC. …`
 * — with `B` pressed against the previous word. `\bB` cannot match there
 * (letter followed by letter is no boundary), so the first real Word question
 * bank this met produced nothing at all.
 *
 * Dropping `\b` widens what could match, so two things keep it safe: the
 * letters must appear in the order A, B, C, D, and each must be followed by a
 * delimiter. A stray "B." mid-sentence cannot satisfy a full ordered run.
 */
/**
 * An ordered A-B-C-D run on ONE line, with the answer allowed to follow.
 *
 * Split from the answer deliberately. A real Word bank puts the four options
 * in one paragraph and the answer in the NEXT one:
 *
 *     1. What is the primary purpose of VisionStar LMS?
 *
 *     A. Financial Reporting SystemB. Customer Relationship ManagementC. ...
 *
 *     \u2705 Correct Answer: C. Lab Management System ...
 *
 * Requiring the answer on the same line as the options refused that file
 * entirely. So this pattern finds the options, and the answer is looked for on
 * the following lines using the same tolerant pattern the line-based strategy
 * uses.
 *
 * No word boundary before the letters, and that is deliberate too: the DOCX
 * extractor concatenates a paragraph's runs WITHOUT a separator, so `B` arrives
 * pressed against the previous word and `\bB` cannot match. Two things keep the
 * looser pattern safe -- the letters must appear in order, and each must carry
 * a delimiter -- so a stray "B." in prose cannot satisfy a full ordered run.
 */
const INLINE_OPTIONS_PATTERN =
  /(?<stem>.*?)A[).:]\s*(?<a>.+?)B[).:]\s*(?<b>.+?)C[).:]\s*(?<c>.+?)D[).:]\s*(?<d>.+)$/i;

const detectInlineIn = (
  section: ImportSection,
  strategy: ImportStrategy,
  locatorFor: (line: number) => string,
  startOrdinal: number,
): DetectedQuestion[] => {
  const lines = section.text.split('\n');
  const lineStarts: number[] = [];
  let cursor = 0;
  for (const line of lines) {
    lineStarts.push(cursor);
    cursor += line.length + 1;
  }

  const detected: DetectedQuestion[] = [];
  let ordinal = startOrdinal;
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] as string;
    const match = INLINE_OPTIONS_PATTERN.exec(line);
    const groups = match?.groups;
    if (groups === undefined) {
      index += 1;
      continue;
    }

    // The stem is whatever preceded option A on this line; when the line
    // begins with the options, it is the nearest non-empty line above.
    let stem = (groups['stem'] ?? '').trim();
    let firstLine = index;
    if (stem.length === 0) {
      for (let back = index - 1; back >= 0 && back >= index - 4; back -= 1) {
        const previous = (lines[back] as string).trim();
        if (previous.length === 0) continue;
        if (ANSWER_PATTERN.test(previous) || EXPLANATION_PATTERN.test(previous)) break;
        stem = previous;
        firstLine = back;
        break;
      }
    }
    // A leading question number is not part of the question.
    stem = stem.replace(/^\s*\d+[).:]\s*/, '').trim();

    let correctOption: OptionKey | null = null;
    let explanation: string | null = null;
    let lastLine = index;

    for (let ahead = index + 1; ahead < Math.min(lines.length, index + 6); ahead += 1) {
      const next = lines[ahead] as string;
      if (next.trim().length === 0) continue;
      const answer = ANSWER_PATTERN.exec(next);
      if (answer !== null) {
        correctOption = (answer[1] as string).toUpperCase() as OptionKey;
        lastLine = ahead;
        continue;
      }
      const why = EXPLANATION_PATTERN.exec(next);
      if (why !== null) {
        explanation = (why[1] as string).trim();
        lastLine = ahead;
        continue;
      }
      // Anything else ends this question, so the next one's stem is not
      // absorbed into this one's trailer.
      break;
    }

    // The answer and the explanation may also TRAIL on the option line, which
    // is what a document flattened to a single paragraph produces.
    if (correctOption === null) {
      const trailing = TRAILING_ANSWER_PATTERN.exec(line);
      if (trailing !== null) correctOption = (trailing[1] as string).toUpperCase() as OptionKey;
    }
    if (explanation === null) {
      const trailing = TRAILING_EXPLANATION_PATTERN.exec(line);
      if (trailing !== null) explanation = (trailing[1] as string).trim();
    }

    const from = lineStarts[firstLine] ?? 0;
    const to = (lineStarts[lastLine] ?? 0) + (lines[lastLine] as string).length;

    // Option D absorbs whatever trailed it, so it is trimmed back to the
    // option itself. Either keyword ends it, whichever comes first.
    const optionD = (groups['d'] ?? '').replace(TRAILING_TRAILER_PATTERN, '').trim();

    detected.push({
      ordinal,
      questionText: stem,
      options: {
        A: (groups['a'] ?? '').trim(),
        B: (groups['b'] ?? '').trim(),
        C: (groups['c'] ?? '').trim(),
        D: optionD,
      },
      correctOption,
      explanation,
      domainName: null,
      topicName: section.heading,
      difficulty: null,
      tags: [],
      sourceLabel: null,
      evidence: section.text.slice(from, to).trim(),
      evidenceStartOffset: section.startOffset + from,
      evidenceEndOffset: section.startOffset + to,
      sectionKey: section.sectionKey,
      strategy,
      locator: locatorFor(firstLine + 1),
    });
    ordinal += 1;
    index = lastLine + 1;
  }

  return detected;
};

const detectProse = (input: DetectInput): DetectionResult | null => {
  const detected: DetectedQuestion[] = [];
  const issues: DetectionIssue[] = [];
  for (const section of input.sections) {
    const locatorFor = (line: number): string =>
      section.pageNumber !== null
        ? `page ${section.pageNumber}, line ${line}`
        : section.heading !== null
          ? `"${section.heading}", line ${line}`
          : `line ${line}`;
    const result = detectProseIn(section, 'PROSE', locatorFor, detected.length + 1);
    if (result.detected.length > 0) {
      detected.push(...result.detected);
      issues.push(...result.issues);
      continue;
    }
    // Nothing on its own line, so try one question per paragraph. Tried
    // SECOND because line-based detection is the more precise of the two: an
    // inline match has to infer where the stem ends.
    detected.push(...detectInlineIn(section, 'PROSE', locatorFor, detected.length + 1));
  }
  return detected.length === 0 ? null : { strategy: 'PROSE', detected, issues };
};

// ---------------------------------------------------------------------------
// Slide pairs (PPTX)

/**
 * A question slide followed by an answer slide.
 *
 * Handles the shape the brief describes: one slide carries the stem and the
 * four options, the NEXT carries the answer and often the explanation. The
 * pair is read as one question, and the evidence span covers the question
 * slide — the answer slide's text is appended to the explanation rather than
 * to the evidence, because a span must be contiguous to re-locate.
 */
const detectSlidePairs = (input: DetectInput): DetectionResult | null => {
  const slides = input.sections.filter((section) => section.slideNumber !== null);
  if (slides.length === 0) return null;

  const detected: DetectedQuestion[] = [];
  const issues: DetectionIssue[] = [];
  let index = 0;

  while (index < slides.length) {
    const slide = slides[index] as ImportSection;
    const locatorFor = (): string => `slide ${slide.slideNumber ?? index + 1}`;
    const found = detectProseIn(slide, 'SLIDE_PAIR', locatorFor, detected.length + 1);

    if (found.detected.length === 0) {
      index += 1;
      continue;
    }

    for (const question of found.detected) {
      let correctOption = question.correctOption;
      let explanation = question.explanation;

      // The answer may be on the FOLLOWING slide, which is the pattern this
      // strategy exists for.
      const next = slides[index + 1];
      if (correctOption === null && next !== undefined) {
        for (const line of next.text.split('\n')) {
          const answer = ANSWER_PATTERN.exec(line);
          if (answer !== null) correctOption = (answer[1] as string).toUpperCase() as OptionKey;
          const why = EXPLANATION_PATTERN.exec(line);
          if (why !== null && explanation === null) explanation = (why[1] as string).trim();
        }
        if (correctOption === null) {
          issues.push({
            locator: locatorFor(),
            code: 'ANSWER_MISSING',
            detail:
              'No answer was found on this slide or the next. A question slide with no answer ' +
              'slide cannot be imported, because the correct option is not stated anywhere.',
          });
        }
      }

      detected.push({ ...question, correctOption, explanation });
    }
    index += 1;
  }

  return detected.length === 0 && issues.length === 0
    ? null
    : { strategy: 'SLIDE_PAIR', detected, issues };
};

// ---------------------------------------------------------------------------

/**
 * Detects questions in an extracted document.
 *
 * Strategies are tried in order of how unambiguous they are: a header row
 * states its own column meaning, a slide pair is structurally explicit, and
 * prose is inferred. The FIRST strategy that finds anything wins, because
 * running several over one document would produce the same question twice
 * under two locators.
 */
export const detectQuestions = (input: DetectInput): DetectionResult => {
  const result = detectTabular(input) ?? detectSlidePairs(input) ?? detectProse(input);
  if (result !== null) return result;
  return {
    strategy: null,
    detected: [],
    issues: [
      {
        locator: input.fileName,
        code: 'NO_QUESTIONS_FOUND',
        detail:
          'No multiple-choice questions were recognised. A tabular import needs a header row ' +
          'naming at least a question and an option column; a prose import needs a stem ' +
          'followed by options A to D; a slide import needs a question slide followed by an ' +
          'answer slide.',
      },
    ],
  };
};

/** Pairwise distinctness under the shared normalization. */
export const optionsAreDistinct = (options: Readonly<Record<OptionKey, string>>): boolean => {
  const seen = new Set<string>();
  for (const key of OPTION_KEYS) {
    const normalized = normalizeForComparison(options[key]);
    if (seen.has(normalized)) return false;
    seen.add(normalized);
  }
  return true;
};
