// PILOT-T2 gates. Three prose rules turned into build failures.
//
// Each of these guards a defect that shipped, passed 624 tests, and was found
// by reading two files against each other rather than by the suite. The point
// of a contract test here is that the next instance fails the build instead.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  canonicalPromptBody,
  promptBodyHash,
  PROMPT_BODY_SHA256,
  PROMPT_SEMANTIC_VERSION,
} from '@knowzy/claude-services';
import { extractContent, scopeSectionKey } from '@knowzy/content-extraction';

const REPO_ROOT = join(__dirname, '..', '..', '..');

/**
 * Source with comments removed.
 *
 * These assertions are about what the code DOES. Both of them first failed
 * against the comments that explain the defect they guard, which would have
 * made the only way to keep the build green deleting the explanation.
 */
const codeOf = (...segments: readonly string[]): string =>
  readFileSync(join(REPO_ROOT, ...segments), 'utf8')
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');

describe('prompt provenance cannot drift silently', () => {
  it('pins the recorded body to the prompt the code builds', () => {
    // If this fails, framing.ts changed. That is allowed — but the recorded
    // body and the semantic version must change WITH it, because every
    // question already generated points at the old version and that row is
    // immutable. Update PROMPT_BODY_SHA256 and bump PROMPT_SEMANTIC_VERSION in
    // the same commit.
    expect(promptBodyHash(canonicalPromptBody())).toBe(PROMPT_BODY_SHA256);
  });

  it('records the real instruction text, not a paraphrase of it', () => {
    const body = canonicalPromptBody();
    // The rules a model actually receives. A hand-written summary would not
    // contain the verbatim-span character count or the delimiter statement,
    // which is how the 1.1.0 body was detectable as a paraphrase.
    expect(body).toContain('UNTRUSTED DATA');
    expect(body).toContain('40 and 1200 characters');
    expect(body).toContain('insufficientEvidence');
    expect(body.length).toBeGreaterThan(800);
  });

  it('is the version the seed records', () => {
    const seed = codeOf('packages', 'database', 'prisma', 'seed.ts');
    // The seed must derive the body rather than restate it. A literal body
    // array in the seed is the defect this test exists to prevent.
    expect(seed).toContain('body: canonicalPromptBody()');
    expect(seed).toContain('DEFAULT_PROMPT_VERSION = PROMPT_SEMANTIC_VERSION');
    expect(PROMPT_SEMANTIC_VERSION).not.toBe('1.1.0');
  });
});

describe('section keys are unique across documents', () => {
  // Two documents with NO headings and identical structure. Before PILOT-T2
  // both produced sha256('segment:1#1'), so one key was shared by 21 documents
  // in the pilot corpus, and both resolvers take the FIRST match.
  const bodyA = `${'Alpha procedure. '.repeat(40)}`;
  const bodyB = `${'Beta procedure. '.repeat(40)}`;

  it('gives two heading-less documents different keys', async () => {
    const a = await extractContent({ fileName: 'alpha.txt', content: bodyA });
    const b = await extractContent({ fileName: 'beta.txt', content: bodyB });
    if (a.status !== 'EXTRACTED' || b.status !== 'EXTRACTED') throw new Error('not extracted');

    const keysA = a.sections.map((s) => s.sectionKey);
    const keysB = b.sections.map((s) => s.sectionKey);
    expect(keysA.some((key) => keysB.includes(key))).toBe(false);
  });

  it('still collides on the unscoped key, which is why the scope exists', async () => {
    // Mutation guard: if this stops being true the fixtures no longer exercise
    // the collision, and the test above would pass for the wrong reason.
    const a = await extractContent({ fileName: 'alpha.txt', content: bodyA });
    const b = await extractContent({ fileName: 'beta.txt', content: bodyB });
    if (a.status !== 'EXTRACTED' || b.status !== 'EXTRACTED') throw new Error('not extracted');

    const v1A = a.sections.map((s) => s.sectionKeyV1);
    const v1B = b.sections.map((s) => s.sectionKeyV1);
    expect(v1A.some((key) => v1B.includes(key))).toBe(true);
  });

  it('is deterministic for the same document and scope', async () => {
    const first = await extractContent({ fileName: 'alpha.txt', content: bodyA });
    const second = await extractContent({ fileName: 'alpha.txt', content: bodyA });
    if (first.status !== 'EXTRACTED' || second.status !== 'EXTRACTED') {
      throw new Error('not extracted');
    }
    expect(first.sections.map((s) => s.sectionKey)).toEqual(
      second.sections.map((s) => s.sectionKey),
    );
  });

  it('derives the scoped key from the v1 key, so migration 0004 can recompute it', async () => {
    // The migration rewrites stored keys in SQL. It can only do that because
    // the new key is a pure function of the OLD key and the document's scope —
    // this is the property that makes the migration possible at all.
    const a = await extractContent({ fileName: 'alpha.txt', content: bodyA });
    if (a.status !== 'EXTRACTED') throw new Error('not extracted');

    for (const section of a.sections) {
      expect(scopeSectionKey(section.sectionKeyV1, 'alpha.txt')).toBe(section.sectionKey);
    }
  });

  it('changes the key when the scope changes and nothing else does', async () => {
    const a = await extractContent({ fileName: 'alpha.txt', content: bodyA });
    // The scope is an OPTION, not part of the input. An adapter passes its
    // own `sourceDocumentId` here; the file name is only the default.
    const b = await extractContent(
      { fileName: 'alpha.txt', content: bodyA },
      { documentScope: 'folder/one/alpha.txt' },
    );
    if (a.status !== 'EXTRACTED' || b.status !== 'EXTRACTED') throw new Error('not extracted');
    expect(a.sections[0]?.sectionKey).not.toBe(b.sections[0]?.sectionKey);
    expect(a.sections[0]?.sectionKeyV1).toBe(b.sections[0]?.sectionKeyV1);
  });
});

describe('coverage never counts a refusal', () => {
  it('does not let generation write NON_ASSESSABLE as a coverage status', () => {
    const service = codeOf('packages', 'domain', 'src', 'generation', 'generation-service.ts');
    // The original defect, and its half-fixed successor, both appeared here as
    // a literal in the coverage write. A refusal belongs in
    // `lastGenerationOutcome`, never in `coverageStatus`.
    const coverageWrite = service.slice(
      service.indexOf('coverageStatus: covered > 0'),
      service.indexOf('documentGenerationStat'),
    );
    expect(coverageWrite).not.toContain("'NON_ASSESSABLE'");
    expect(coverageWrite).toContain('lastGenerationOutcome');
  });

  it('never writes isAssessable from a generation run', () => {
    const service = codeOf('packages', 'domain', 'src', 'generation', 'generation-service.ts');
    expect(service).not.toContain('isAssessable: false');
  });
});
