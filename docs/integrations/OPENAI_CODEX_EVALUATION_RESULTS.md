# OpenAI Codex — Evaluation Results (EVAL-M1)

**Run:** 2026-09-28, both arms on the same day, same database, same pinned scope.
**Question this answers:** *Is Codex materially better than the deterministic generator?*
**Short answer:** **On every automated measure, yes, by a wide margin. Adoption under the
pre-registered rule is not yet decidable:** three of its seven criteria need human review that has
not happened, and one needs a price nobody has stated. §8 has the detail.

Every number below is read from the database, the recorded job rows, or the exported packets in
`RealWorldPilot/Evaluation/`. Nothing is estimated, carried over or invented. A value that was not
measured says **not measured**.

| | Arm A — deterministic | Arm B — OpenAI Codex |
| --- | --- | --- |
| Provider / model | `DETERMINISTIC_LOCAL` / `knowzy-deterministic-local-1` | `OPENAI` / `gpt-5.3-codex_codeassist` via the EssilorLuxottica Azure API Management gateway |
| Prompt | PromptVersion 1.2.0 (shared, byte for byte) | PromptVersion 1.2.0 (shared, byte for byte) |
| Gate chain | unmodified | unmodified |
| Approval | not needed (no data leaves) | recorded — Teams message, 2026-09-28 |

---

## 0. Procedure, and what went wrong before it went right

1. **Preserve.** Every draft that existed was exported first (37 questions:
   22 Codex, 15 deterministic) to `RealWorldPilot/Evaluation/preserved/`, because a reset deletes them.
2. **Reset both corpora** (`scripts/baseline.ts --reset`). Published lineage is never deleted: 2
   **published** questions from the Generation-Ready corpus were **kept**. Both are browser-test
   fixtures from 2026-09-27, approved by the second test identity within 0.1 s of submission. They
   stayed in the duplicate corpus for **both** arms. The reset printed a second line about them,
   calling them "retired drafts"; that wording was wrong and is fixed.
3. **Arm A** on each corpus, then the report and the packet.
4. **Reset both again. Arm B** on each corpus, then the report and the packet.

The scope was identical for both arms:
- 10 of the SOP corpus's 30 documents (ranked by assessable sections), 93 sections in scope;
- all 7 Generation-Ready documents, 76 sections;
- `requestedQuestionCount` = 50, `ENTIRE_DOCUMENT`, `NEW_KNOWLEDGE`, domain `SUPPORT_OPS`.

**The first Arm A attempt was discarded, and why matters.**

- **The SOP run measured the wrong documents.** When the stack was restarted that morning,
  `PILOT_CORPUS_HOST_PATH` was unset, so the `/corpus` mount fell back to `fixtures/pilot-mirror`, 12
  synthetic files. The SOP source had been reading that folder since then. A browser-suite
  synchronize at 10:58 added 6 of those fixtures to it, and the first Arm A run listed only them
  (4 sections in scope).
- **The Generation-Ready reset had refused**, because of the 2 published fixtures.

Both were fixed before any number below was taken:
- The mirror path now lives in the git-ignored `infrastructure/compose/.env`. The SOP source
  re-synchronized against the real mirror: 30 scanned, 30 unchanged, 0 added.
- The reset now keeps published lineage instead of refusing.

**The SOP arm then reproduced the 2026-09-23 and 2026-09-27 baselines to the digit** (4 accepted, 89
insufficient, 21,561 / 1,084 tokens). That is the evidence the corpus is the same one.

The six fixture rows are still recorded against the SOP source. A full sync did **not** mark them
deleted, although the folder no longer holds them. That is a synchronizer defect, recorded in §9.
They add **4 assessable sections** to the SOP denominator: 122 where the real corpus has 118.
Coverage is given against both.

---

## 1. Deterministic results (Arm A)

| Measure | Original SOP corpus | GenerationReady corpus |
| --- | ---: | ---: |
| Job | `01a0e84e-7ce6…` PARTIAL | `01a0e84e-8b3f…` PARTIAL |
| Sections in scope | 93 | 76 |
| Questions requested | 50 | 50 |
| **Accepted** | **4** | **14** |
| Judged insufficient (refused by the generator) | 89 | 62 |
| Rejected by the gates (evidence, integrity, duplicate) | 0 | 0 |
| Distinct sections covered | 4 | 14 |
| Documents that produced a question | 2 of 10 | 5 of 7 |
| **Coverage** (sections covered ÷ assessable) | **3.4%** of 118 (3.3% of 122) | **18.4%** of 76 |
| Evidence | 4 / 4 STRICT; mean span 108 chars | 14 / 14 STRICT; mean span 173 chars |
| **Confidence**, mean (min–max) | **0.734** (0.679–0.778) | **0.709** (0.658–0.760) |
| optionDistinctness, the weakest component | 0.256 | 0.168 |
| **Duplicate rate** / highest similarity | **0%** / 0.594 | **0%** / 0.483 |
| Tokens in / out | 21,561 / 1,084 — the generator's own estimates | 18,288 / 5,120 — estimates |
| Cost | **0.000000**, measured | **0.000000** |
| Wall time | 0.12 s | 0.22 s |
| Stems in the "According to …, which statement is correct?" template | 4 of 4 | 14 of 14 |

## 2. Codex results (Arm B)

| Measure | Original SOP corpus | GenerationReady corpus |
| --- | ---: | ---: |
| Job | `01a0e84f-9f3b…` PARTIAL | `01a0e851-120d…` PARTIAL |
| Sections in scope | 93 | 76 |
| Questions requested | 50 | 50 |
| **Accepted** | **56** — six more than requested (§9) | **49** |
| Judged insufficient (the model declined the section) | 39 | 35 |
| **Rejected by the gates** | **3**, all `EVIDENCE_UNVERIFIED` | **1**, `EVIDENCE_UNVERIFIED` |
| Distinct sections covered | 52 | 40 |
| Documents that produced a question | 10 of 10 | 7 of 7 |
| **Coverage** | **44.1%** of 118 (42.6% of 122) | **52.6%** of 76 |
| Evidence | 56 / 56 STRICT; mean span 206 chars | 49 / 49 STRICT; mean span 243 chars |
| **Confidence**, mean (min–max) | **0.922** (0.772–0.986) | **0.933** (0.809–0.989) |
| optionDistinctness | 0.902 | 0.886 |
| **Duplicate rate** / highest similarity | **0%** / 0.217 | **0%** / 0.597 |
| **Tokens in / out** | **22,023 / 13,466**, reported by the gateway (pre-call estimate 19,045 in) | **16,195 / 11,109**, reported (estimate 15,375 in) |
| Attempts | 1, succeeded | 1, succeeded |
| Wall time | 90.2 s | 72.4 s |
| Cost | **not observable** — no price is configured for the deployment | not observable |
| Stems in the "According to …" template | 2 of 56 | 1 of 49 |

## 3. Coverage comparison

| Corpus | Arm A coverage | Arm B coverage | Sections covered, B ÷ A |
| --- | ---: | ---: | ---: |
| Original SOP | 3.4% (4 / 118) | **44.1%** (52 / 118) | **13.0×** |
| GenerationReady | 18.4% (14 / 76) | **52.6%** (40 / 76) | **2.9×** |

Arm A reached 2 of the 10 SOP documents; Arm B reached all 10. On the corpus rewritten to suit a
template (GenerationReady), the template does better and the gap narrows. On the real SOPs, the corpus
the product exists for, it is an order of magnitude.

## 4. Refusal comparison

| Cause, share of sections in scope | Arm A SOP | Arm A GR | Arm B SOP | Arm B GR |
| --- | ---: | ---: | ---: | ---: |
| The generator judged the section insufficient | 89 / 93 (95.7%) | 62 / 76 (81.6%) | 39 / 93 (41.9%) | 35 / 76 (46.1%) |
| Evidence unverified (quote not verbatim in the cited section) | 0 | 0 | 3 | 1 |
| Integrity or duplicate | 0 | 0 | 0 | 0 |

**Evidence refusal rate for Codex** (unverified ÷ all proposals the gates saw) is **3 / 59 = 5.1%** on SOP
and **1 / 50 = 2.0%** on GenerationReady. The four questions it refused cited text that is not in the
section. **The unmodified gate caught every one**, which is the control working on a real model for
the first time.

Arm A refuses **because it is a template**: it needs a sentence with a quantity, actor or modal to
swap. Arm B refuses a section it judges too thin to test. These are different kinds of refusal and
are recorded apart.

## 5. Quality comparison

**Measured, automatically:**

- **Confidence:** 0.922–0.933 for Codex against 0.709–0.734 for the template.
- **Distractor distinctness:** the confidence component for how different the wrong options are
  from the right one is 0.89–0.90 against 0.17–0.26. The template's distractors are single-token
  swaps of the true statement.
- **Stem form:**
  - every template stem is *"According to «section», which statement is correct?"*, so the stem
    carries no question of its own;
  - 3 of 105 Codex stems use that form, and the rest ask a specific question, e.g. *"What
    sleeping-session count may indicate the database pool exhaustion issue is present?"*
- **Evidence:** every accepted question in both arms is a verbatim quote (STRICT). Codex quotes
  longer spans, 206–243 characters against 108–173.

**Not measured:**

- **SME rubric score** (plan §6.2). The review packets are ready (§6); nobody has scored them.
- **Blind-stem answerability** (plan §6.1). The packet is ready (§6); nobody has answered it.
- **Correctness.** A fluent wrong question reads well. Only a subject-matter reviewer can say
  whether Codex's answers are right, and the plan explicitly refuses "the questions look better" as
  a criterion.

## 6. Review comparison

### What exists

| Package | File | Contents |
| --- | --- | --- |
| Review packet, Arm A | `RealWorldPilot/Evaluation/packets/arm-a-deterministic.{csv,md,json}` | 18 questions |
| Review packet, Arm B | `RealWorldPilot/Evaluation/packets/arm-b-codex.{csv,md,json}` | 105 questions |
| Blind-stem packet | `RealWorldPilot/Evaluation/blind-stem/blind-stems.csv` | 123 stems, shuffled, provider hidden |
| Blind-stem key | `RealWorldPilot/Evaluation/blind-stem/blind-key.csv` | the item-to-question mapping — **keep it away from reviewers** |
| Everything before the evaluation | `RealWorldPilot/Evaluation/preserved/` | 37 questions |

- **Each review-packet row carries:**
  - question ID, provider, model, source, source document and section;
  - status;
  - the verbatim evidence, the stem, all four options, the correct answer and the explanation;
  - the evidence check, confidence and highest similarity;
  - empty reviewer columns: Accurate, Clear, Distractors plausible, Would approve, Comments.
- **The CSV opens in Excel:**
  - quoted and BOM-marked;
  - a cell starting `=`, `+`, `-` or `@` is prefixed, so it cannot run as a formula.
- **The blind-stem packet has five columns:** Item, Reviewer, Question, *Answerable from stem (Y/N)*,
  Comments.
  - It has no options, answer, explanation or evidence.
  - It has no provider, model, question ID or document.
  - The order is shuffled with seed `20260928`, so the key can be regenerated.
  - `scripts/lib/evaluation-format.test.ts` asserts that none of those fields reach
    the reviewer's file; a mutation that added the provider failed it.
  - **Limitation:** the template's fixed stem form still identifies Arm A to anyone who reads a few.
    Blinding by provider is therefore partial for Arm A. Answerability is still measured.

### Measured review activity (`scripts/evaluation.ts --review-analytics`)

| Provider | Drafts in the queue | Approval decisions | Approved | Rejected | Change requests | Comments | Median time to first decision |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| OPENAI | 122 | **0** | — | — | 0 | 0 | — |
| DETERMINISTIC_LOCAL | 26 | 7 | 7 | 0 | 0 | 1 | 0.0 h |

**No person has reviewed a Codex question yet.** The deterministic figures are **browser-test
fixtures**: each was approved by the second test identity within 0.1 seconds of submission. They are
shown because they are rows, but they are not reviewer evidence and are excluded from every
comparison.

The queue holds Arm B's 105 questions plus 17 earlier synthetic-content Codex drafts. After the
measured comparison the deterministic generator was run once more on the same scope, so reviewers
see both providers in the queue. It reproduced Arm A exactly (4 + 14) with no duplicate blocks.
That run is recorded apart, in `review-queue-regeneration.json`, and is not part of any figure
above.

## 7. Cost comparison

| | Arm A | Arm B |
| --- | --- | --- |
| Cost per run | 0.000000 (measured) | **not observable**: `llm.tokenPrices` has no price for `gpt-5.3-codex_codeassist` |
| Tokens per run | estimates only | **reported**: 35,489 (SOP) and 27,304 (GR); 62,793 for both |
| Tokens per accepted question | — | **634** (SOP), **557** (GR) |
| Cost per approved question (plan §7 criterion 7) | — | **not measurable**: no price, no approvals, and no business threshold stated in advance |

## 8. Recommendation

### Against the pre-registered decision rule (LIVE_CLAUDE_EVALUATION_PLAN.md §7)

| # | Criterion | Result |
| --- | --- | --- |
| 1 | Quality: ≥ 60% of Arm B scoring ≥ 8/10 on the rubric, and materially better than Arm A | **Not measured.** Packets ready |
| 2 | Groundedness: blind-stem answerability not materially above chance | **Not measured.** Packet ready |
| 3 | Yield ≥ 5× Arm A's accepted questions from the same pinned scope | **SOP: 56 vs 4 = 14× — met.** The rule was written against this scope, and names its 93 sections. **GenerationReady: 49 vs 14 = 3.5× — not met** |
| 4 | Every accepted question passes the unmodified gates, evidence refusals < 40% | **Met.** Every accepted question is STRICT-verified; refusals 5.1% and 2.0% |
| 5 | SME approves ≥ 50% of Arm B submissions | **Not measured.** 0 decisions |
| 6 | No BLOCK-level duplicates within an Arm B batch | **Met.** Highest similarity 0.217 and 0.597, against a 0.92 block threshold |
| 7 | Cost per approved question below a figure stated in advance | **Not measurable.** No price, no threshold |

### The answer

**Codex is materially better than the deterministic generator on everything this platform can
measure without a person:**
- **13× the SOP coverage**, and every document reached;
- **14× the SOP yield**;
- distractors that are actually distinct;
- stems that ask a question;
- the same verbatim-evidence guarantee.

**The gate caught 4 citations Codex got wrong**, so the governance chain is doing its job on a real
model.

**It is not yet adoptable under the rule written before any output was seen.** Correctness,
groundedness and SME approval are unmeasured, cost is unobservable, and on the template-friendly
GenerationReady corpus the yield multiple is 3.5×, below the rule's 5×.

### Next, in order

1. **The SME rubric review**, on the two review packets.
2. **The blind-stem test**, given to a reviewer without the key.
3. **Real approvals in the queue.** An SME approves or rejects Arm B's drafts. Criterion 5 reads
   straight from `--review-analytics`.
4. **A price and a threshold.** Someone who pays for the gateway supplies the per-million token
   price and the acceptable cost per approved question, **before** the review results are seen.
5. **Decide against §7 as written.** Do not relax a criterion after seeing the result. If quality or
   groundedness fails, iterate the **prompt** under a new PromptVersion and re-run both arms on this
   pinned scope.

## 9. Findings recorded during the evaluation

| # | Finding | Severity | Status |
| --- | --- | --- | --- |
| F1 | The `/corpus` mount falls back to `fixtures/pilot-mirror` when `PILOT_CORPUS_HOST_PATH` is unset. A restart without it makes the SOP source read 12 fixture files **silently** | High, for any measurement | Fixed locally: the path is in the git-ignored `infrastructure/compose/.env`. Consider failing startup when a source's root holds unexpected content |
| F2 | A FULL sync that no longer finds six previously synchronized documents reports `deleted: 0` and leaves them ACTIVE | Medium | **Open.** The six fixture rows remain on the SOP source |
| F3 | Codex accepted **56 questions against a request for 50**: the requested count is not a cap | Low | **Open.** Decide whether `requestedQuestionCount` is a ceiling; if so, enforce it in the gate chain for every provider |
| F4 | `scripts/baseline.ts --reset` refused on published lineage, which forced retiring demo-bank questions just to measure | Low | Fixed: published lineage is kept and reported, like retired lineage |
| F5 | `rejectionsByReason` in the baseline report is **cumulative for the source across every past job**, not per run | Low | Recorded. Per-arm figures here come from the job output and the packets |

## 10. How to reproduce

```
# preserve, then reset both corpora
npx tsx scripts/evaluation.ts --export RealWorldPilot/Evaluation/preserved --label all-drafts-before-evaluation
npx tsx scripts/baseline.ts --reset "KNOWZY Real-World Pilot SOP Corpus"
npx tsx scripts/baseline.ts --reset "KNOWZY Generation-Ready Corpus (EVALUATION ONLY)"

# Arm A, then its report and packet (the job ids are in outcomes.json)
npx tsx scripts/baseline.ts --generate "<corpus>" --provider DETERMINISTIC_LOCAL --outcomes RealWorldPilot/Evaluation/outcomes.json
npx tsx scripts/baseline.ts --report --json RealWorldPilot/Evaluation/arm-a-deterministic.json --markdown RealWorldPilot/Evaluation/arm-a-deterministic.md
npx tsx scripts/evaluation.ts --export RealWorldPilot/Evaluation/packets --jobs "<armA-job-1>;<armA-job-2>" --label arm-a-deterministic

# reset both again; Arm B the same way with --provider OPENAI and --label arm-b-codex

# the blind-stem packet and the review analytics
npx tsx scripts/evaluation.ts --blind RealWorldPilot/Evaluation/blind-stem --from "RealWorldPilot/Evaluation/packets/arm-a-deterministic.json;RealWorldPilot/Evaluation/packets/arm-b-codex.json"
npx tsx scripts/evaluation.ts --review-analytics --json RealWorldPilot/Evaluation/review-analytics.json
```

Before a run, check that `/corpus` in the MCP container holds the real mirror:

```
docker compose ... exec mcp sh -c 'find /corpus -type f | wc -l'
```

It should report 32, not 12.
