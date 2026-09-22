# KNOWZY Generation Limitations

## Purpose

This document records the known limitations discovered during the PILOT-T1 and PILOT-T2 evaluations.

These findings must be considered before evaluating Claude, Copilot, or any future generation provider.

---

# Current Deterministic Generator Limitations

The deterministic generator is template-based and not AI-driven.

It generates questions by:

- Identifying rule-like sentences
- Reusing source text as the correct answer
- Creating distractors through:
  - quantity swaps
  - modal swaps
  - actor substitutions

Because of this design:

- It cannot reason.
- It cannot infer knowledge from procedures.
- It cannot create novel distractors.
- It cannot summarize concepts.
- It cannot understand context.
- It cannot create questions when suitable distractors do not exist.

Examples:

"An SSL certificate must be renewed 30 days before expiry."

Works well because:

- 30 can become 60 or 90.
- A distractor can be generated.

Example:

"L2 must not wait for business impact."

Often produces no question because:

- No quantity.
- No actor variation.
- No alternate distractors.

---

# Pilot Findings

## Original SOP Corpus

- 28 documents
- 122,106 characters
- 234 sections
- 115 assessable sections
- 4 accepted questions
- Coverage: 3.5%

## GenerationReady Corpus

- 7 documents
- 78 sections
- 76 assessable sections
- 16 accepted questions
- Coverage: 21.1%

Result:

GenerationReady structure improved yield by approximately 4x.

---

# Structural Issues Identified

## Missing Heading Styles

15 of 28 documents contain no Word heading hierarchy.

Consequences:

- Weak section labels.
- Reduced traceability.
- Poor citation quality.
- Lower generation yield.

## Heading Per Step

Documents using:

```text
Step 1
Step 2
Step 3