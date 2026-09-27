# OpenAI Codex — Evaluation Results (OPENAI-CODEX-01)

**Status: the comparison has NOT been run.** Arm A (the deterministic generator) was measured on
both corpora on 2026-09-27. Arm B (OpenAI Codex) was attempted on both corpora through the real API
and **refused before any job was created or any request sent**. There are no OpenAI figures in this
document because none exist. Every number below is read from the database or from the harness's
recorded outcomes. Nothing is estimated, carried over from a plan, or invented.

**Why Arm B did not run** ([OPENAI_CODEX_GENERATION_READINESS.md §0](OPENAI_CODEX_GENERATION_READINESS.md)):

1. **T-29.** No data-processing approval is recorded for OpenAI. The corpora are company SOPs, and
   sending them to an external model is exactly what the approval governs.
2. **No working credential.** OpenAI has no base URL, model or reference configured, and the key
   available is a gateway subscription key whose endpoint and header are not yet known.

The harness recorded the refusal that fired first. The model check happens in the route, before
the job exists, so no job row was left behind:

| Corpus | Arm B outcome | Code | Detail |
| --- | --- | --- | --- |
| Original SOP corpus | **REFUSED** | `PROVIDER_CREDENTIAL_UNAVAILABLE` | "OPENAI has no model configured. Set one in Administration -> AI Providers." |
| GenerationReady corpus | **REFUSED** | `PROVIDER_CREDENTIAL_UNAVAILABLE` | same |

OpenAI jobs created: **0**. OpenAI provider calls recorded: **0**. Source:
`RealWorldPilot/Comparison/outcomes.json`.

**Procedure.** For each arm and corpus:
1. `scripts/baseline.ts --reset "<corpus>"`
2. `scripts/baseline.ts --generate "<corpus>" --provider <arm> --outcomes RealWorldPilot/Comparison/outcomes.json`
3. `--report --json/--markdown` into `RealWorldPilot/Comparison/`.

The settings were identical for both arms:
- the generation profile (STRICT evidence, thresholds unchanged);
- PromptVersion **1.2.0**;
- request `min(50, assessable sections in scope)` per corpus, ENTIRE_DOCUMENT, NEW_KNOWLEDGE.

---

## 1. Original SOP corpus results

KNOWZY Real-World Pilot SOP Corpus: 30 documents, 238 sections, **118 assessable**, 93 in the
scope of the run.

| Measure | Arm A — deterministic | Arm B — OpenAI Codex |
| --- | ---: | --- |
| Job | `01a0e2af-7135…` PARTIAL | not created — refused |
| Questions generated (accepted) | **4** | not run |
| Refusals (insufficient evidence) | **89** of 93 sections | refused at the provider gate |
| Other rejections (evidence, integrity, duplicate) | **0** | not run |
| Coverage (covered ÷ assessable) | **3.4%** (4 / 118) | not run |
| Evidence verification success | **100%** (4 / 4 STRICT, exact spans) | not run |
| Mean evidence span | 108 characters | not run |
| Duplicate rate / max similarity | **0%** / 0.594 | not run |
| Confidence mean (min–max) | **0.734** (0.680–0.778) | not run |
| optionDistinctness (weakest component) | **0.256** | not run |
| Tokens — estimated input / recorded in / out | 19,045 / 21,561 / 1,084 (estimates: `tokenUsageReported` false) | not run |
| Cost | **0.000000** — measured; the one provider where zero is a fact | not run |
| Attempts / duration | 1 / 88 ms | not run |

## 2. GenerationReady corpus results

KNOWZY Generation-Ready Corpus (EVALUATION ONLY): 7 documents, 78 sections, **76 assessable**, all
76 in scope.

| Measure | Arm A — deterministic | Arm B — OpenAI Codex |
| --- | ---: | --- |
| Job | `01a0e2af-846c…` PARTIAL | not created — refused |
| Questions generated (accepted) this run | **15** | not run |
| Refusals (insufficient evidence) | **61** of 76 sections | refused at the provider gate |
| Other rejections | **0** | not run |
| Coverage (covered ÷ assessable) | **21.1%** (16 / 76) — see the caveat below | not run |
| Evidence verification success | **100%** (STRICT, exact spans) | not run |
| Mean evidence span | 170 characters | not run |
| Duplicate rate / max similarity | **0%** / 0.483 | not run |
| Confidence mean (min–max) | **0.709** (0.658–0.760) | not run |
| optionDistinctness | **0.168** | not run |
| Tokens — estimated input / recorded in / out | 15,375 / 18,256 / 5,356 (estimates) | not run |
| Cost | **0.000000** | not run |
| Attempts / duration | 1 / 225 ms | not run |

**Caveat.** One RETIRED question from this corpus (`KNZ-RX_NET-2026-000001`, published by the
browser suite earlier the same day) keeps its published lineage. It was not deleted by the reset,
it covers one section, and it sits in the duplicate corpus. So this run's accepted 15 plus that one
question make the 16 covered sections. This is the reason the evaluation plan requires a clean
database for the controlled comparison.

## 3. Deterministic comparison — Arm A against its own history

The only comparison that can be made today is Arm A against the recorded baseline of 2026-09-23
(`RealWorldPilot/Baseline/DeterministicBaseline.md`).

| Measure | SOP 2026-09-23 | SOP 2026-09-27 | GenerationReady 2026-09-23 | GenerationReady 2026-09-27 |
| --- | ---: | ---: | ---: | ---: |
| Accepted | 4 | **4** | 16 | **15** (+1 retained) |
| Refused | 89 | **89** | 60 | **61** |
| Coverage | 3.4% | **3.4%** | 21.1% | **21.1%** |
| Tokens in / out | 21,561 / 1,084 | **21,561 / 1,084** | 18,203 / 5,784 | 18,256 / 5,356 |

**The SOP run is identical to the digit, and a second run on 2026-09-27 reproduced both corpora
exactly.** That is what makes Arm A usable as a control: a difference between arms is not noise.
GenerationReady moved by one question, which is accounted for by the retained retired draft in §2.

## 4. Coverage comparison

| Corpus | Arm A coverage | Arm B coverage | Decision-rule threshold (evaluation plan §7) |
| --- | ---: | --- | --- |
| Original SOP | 3.4% | not run | Arm B yield ≥ 5× Arm A |
| GenerationReady | 21.1% | not run | same |

Arm A's coverage is the floor any model has to clear. The plan's bar, "yield ≥ 5× Arm A", means at
least 20 accepted questions on the SOP corpus and at least 75 on GenerationReady. On
GenerationReady that is practically every assessable section.

## 5. Refusal comparison

| Cause | Arm A (SOP / GenerationReady) | Arm B (SOP / GenerationReady) |
| --- | --- | --- |
| Generator judged a section insufficient | 89 / 61 | not run |
| Evidence unverified | 0 / 0 | not run |
| Integrity (options, answer, completeness) | 0 / 0 | not run |
| Duplicate blocked | 0 / 0 | not run |
| **Control-layer / provider refusal** | 0 / 0 | **2 / 2 runs refused**: `PROVIDER_CREDENTIAL_UNAVAILABLE` (no model configured) |

Arm A refuses **because it is a template**: it can only build a question from a sentence with a
quantity, actor or modal to swap ([KNOWZY_GENERATION_LIMITATIONS.md](../project/KNOWZY_GENERATION_LIMITATIONS.md)).
Arm B was refused **because it may not run yet**. The two are different kinds of refusal and are
recorded apart, as the evaluation plan §11 requires.

## 6. Cost comparison

| | Arm A | Arm B |
| --- | --- | --- |
| Cost per run | 0.000000 (measured) | not run |
| Tokens | the generator's own estimates (`tokenUsageReported: false`) | not run; OpenAI **reports** usage, recorded with `tokenUsageReported: true` |
| Price configured | not needed | **none**. `llm.tokenPrices` has no OpenAI entry, so an OpenAI run today would record its cost as *not observable*, not a figure |
| Actual (billed) cost | n/a | will stay NULL: the API reports tokens, not an invoice |

The integration test for the OpenAI client shows the accounting works against a fake response of
1,234 input and 321 output tokens: the reported tokens are recorded on the job and the attempt, the
estimate is recorded beside them, and the served model is recorded. **This is a test of the
accounting, not a measurement of OpenAI.**

## 7. Quality observations

Nothing can be said about OpenAI's question quality: no OpenAI question exists. About Arm A, the
measurements repeat what the baseline recorded:

- **Every accepted question's evidence is exact** (100% STRICT). The template never paraphrases.
- **optionDistinctness is the weakest confidence component** (0.256 SOP, 0.168 GenerationReady).
  The template's distractors are single-token swaps of the correct statement, which a reader can
  often spot without the document. A model is expected to do better here, and the blind-stem test
  (evaluation plan §6.1) is the measurement that would show it.
- **Coverage is the headline limitation**, not quality: 3.4% of assessable SOP sections.

What the governance chain will do with a model's output was **verified, not assumed**, against the
real OpenAI client with a fake transport (`packages/domain/test/generation-control.test.ts`):
- a fabricated evidence span is refused `EVIDENCE_UNVERIFIED`;
- a verbatim span is accepted as a DRAFT, not APPROVED and not PUBLISHED;
- an unparseable answer ends the job FAILED after one attempt;
- an unapproved OpenAI is refused before any request is sent.

## 8. Recommendation

**Do not draw any conclusion about OpenAI Codex yet. Nothing has been measured.** The engineering
for the comparison is complete, and the comparison is one command per corpus once the blockers are
cleared. In order:

1. **Record T-29.** This is still the critical path. Send the drafted request
   (`docs/integrations/T29_PRIVACY_LEGAL_REQUEST.md`), and include one point for the reviewers:
   readiness checks run before an approval, and generation does not.
2. **Get the gateway details for the key:** base URL, header name, API style, and whether an
   application may use it. Configure OpenAI with them, add the host to `LLM_ENDPOINT_ALLOWLIST`, and
   make Test connection pass.
3. **Set a price** for the model in `llm.tokenPrices`, agreed with whoever pays. Otherwise cost is
   recorded as not observable. The plan's cost bar must be set **before** the run.
4. **Run both arms on a clean database** (plan §4.1). Then do the SME rubric and the blind-stem
   test, because the automated metrics alone cannot adopt a model (plan §7).

## 9. How to run the comparison when it is permitted

```
# on a clean database, both corpora synchronized
npx tsx scripts/baseline.ts --reset "KNOWZY Real-World Pilot SOP Corpus"
npx tsx scripts/baseline.ts --reset "KNOWZY Generation-Ready Corpus (EVALUATION ONLY)"
npx tsx scripts/baseline.ts --generate "<corpus>" --provider DETERMINISTIC_LOCAL --outcomes RealWorldPilot/Comparison/outcomes.json
npx tsx scripts/baseline.ts --report --json RealWorldPilot/Comparison/arm-a.json --markdown RealWorldPilot/Comparison/arm-a.md
# reset both again, then
npx tsx scripts/baseline.ts --generate "<corpus>" --provider OPENAI --outcomes RealWorldPilot/Comparison/outcomes.json
npx tsx scripts/baseline.ts --report --json RealWorldPilot/Comparison/arm-b.json --markdown RealWorldPilot/Comparison/arm-b.md
```

The recorded files from 2026-09-27 are `RealWorldPilot/Comparison/arm-a-deterministic.{json,md}`,
`arm-b-openai.{json,md}` and `outcomes.json`. Note that `arm-b-openai.*` describes the corpora
**after a reset with nothing generated**, because Arm B was refused. Those are its true contents,
not a result for OpenAI.
