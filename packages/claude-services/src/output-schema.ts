// The generation output contract — mcp-tools.md T4 and workflows.md §2.3.
//
// One schema, three consumers: the API, Claude output parsing, and the MCP tool
// surface. Model output that does not satisfy it is rejected as
// SCHEMA_INVALID and no draft is persisted.
//
// §2.7: `insufficientEvidence` is a FIRST-CLASS SUCCESS RESULT, not an error.
// A section that states no testable procedure, threshold, or decision rule
// should say so; the platform never pads a requested count with unsupported
// questions.

import { z } from 'zod';

/** ADR-014: MULTIPLE_CHOICE_4 is the only question type in release 1. */
export const OPTION_KEYS = ['A', 'B', 'C', 'D'] as const;
export type OptionKey = (typeof OPTION_KEYS)[number];

export const GeneratedQuestionSchema = z
  .object({
    /** The section this question is grounded in. Must be in the pinned scope. */
    sectionKey: z.string().min(1),
    questionText: z.string().min(15).max(1_000),
    options: z
      .object({
        A: z.string().min(1).max(500),
        B: z.string().min(1).max(500),
        C: z.string().min(1).max(500),
        D: z.string().min(1).max(500),
      })
      .strict(),
    correctOption: z.enum(OPTION_KEYS),
    explanation: z.string().min(20).max(2_000),
    /** The verbatim span. Verified against the section, never trusted. */
    supportingEvidence: z.string().min(1).max(2_000),
    /**
     * Advisory only, and capped at a 0.10 contribution to the platform's own
     * composite confidence (§2.8). A model's self-report authorizes nothing.
     */
    modelConfidence: z.number().min(0).max(1).optional(),
    difficulty: z.enum(['RECALL', 'APPLICATION', 'ANALYSIS']).optional(),
  })
  .strict();

export type GeneratedQuestion = z.infer<typeof GeneratedQuestionSchema>;

export const InsufficientEvidenceSchema = z
  .object({
    result: z.literal('insufficientEvidence'),
    sectionKey: z.string().min(1),
    /** Shown to the author verbatim: it is a documentation-quality signal. */
    reason: z.string().min(10).max(1_000),
  })
  .strict();

export type InsufficientEvidence = z.infer<typeof InsufficientEvidenceSchema>;

export const GenerationOutputSchema = z.union([
  z.object({ questions: z.array(GeneratedQuestionSchema).min(1) }).strict(),
  InsufficientEvidenceSchema,
]);

export type GenerationOutput = z.infer<typeof GenerationOutputSchema>;

/** SHA-256 of this schema's shape, recorded on PromptVersion (G6). */
export const OUTPUT_SCHEMA_VERSION = '1.0.0';
