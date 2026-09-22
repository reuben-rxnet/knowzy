// The recorded prompt body, DERIVED from the code that builds the prompt.
//
// `PromptVersion` is immutable after creation, is referenced by every
// generation job and every question it produced, and is documented as the row
// that makes a job reproducible. Until PILOT-T2 its `body` column held a
// hand-written paraphrase of the rules, while the prompt that `framing.ts`
// assembles at call time was a different text with the same intent. Two texts,
// one meaning, no mechanical link.
//
// That was harmless only because the deterministic generator never reads the
// prompt. The moment a model does, "this question was generated under prompt
// version 1.1.0" becomes a claim about a body that was never sent — and the
// immutability that exists to make the claim trustworthy makes the wrong body
// permanent.
//
// So the body is no longer written alongside the prompt. It IS the prompt,
// rendered with a fixed nonce, and `PROMPT_BODY_SHA256` pins it. Editing
// `framing.ts` fails the contract test until someone updates the hash and the
// semantic version together, which is exactly the governance the immutable
// table was designed for.

import { createHash } from 'node:crypto';
import { frameGenerationPrompt } from './framing.js';

/**
 * Stand-in for the per-call random nonce.
 *
 * Production always uses fresh random bytes (security.md §5), so a nonce
 * cannot appear in a stored body. A fixed placeholder keeps the recorded text
 * byte-stable while still rendering the real delimiter statement, which is
 * part of the instruction and must be recorded.
 */
export const CANONICAL_PROMPT_NONCE = 'NONCE-PER-CALL';

/** The exact system prompt a generation call sends, nonce placeheld. */
export const canonicalPromptBody = (): string =>
  frameGenerationPrompt({
    sections: [],
    doNotDuplicate: [],
    requestedQuestionCount: 0,
    domainName: '',
    topicName: '',
    nonce: CANONICAL_PROMPT_NONCE,
  }).system;

/**
 * SHA-256 of `canonicalPromptBody()`.
 *
 * Updating this by hand is the point. A prompt change that does not also bump
 * `PROMPT_SEMANTIC_VERSION` is a provenance change nobody declared, and the
 * contract test refuses it.
 */
export const PROMPT_BODY_SHA256 =
  '9925ff4ae5c6b208973ca83be2edaa0c1574b583c9011ef4d3ae5a4d0654a3c1';

/** Bumped with every change to the body. Never edited in place. */
export const PROMPT_SEMANTIC_VERSION = '1.2.0';

export const promptBodyHash = (body: string): string =>
  createHash('sha256').update(body, 'utf8').digest('hex');
