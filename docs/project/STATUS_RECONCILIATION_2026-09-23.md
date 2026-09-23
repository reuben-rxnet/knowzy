# Status reconciliation — 2026-09-23

**What this is:** a record of every stale statement found in the status documentation, the
correction, and the reason. Work item A of the pre-Claude preparation.

**Why it exists as its own document:** the corrections are spread across four files, and a reader
who wants to know *what changed and whether to trust the new number* should not have to diff four
documents to find out. This is the audit trail for the edit, not a fifth status document — the
corrected files remain the source of truth.

**Method.** Every figure below was re-measured from the repository or the running stack on
2026-09-23, not carried forward:

| Figure | How it was obtained | Value |
| --- | --- | --- |
| Migrations | `ls packages/database/prisma/migrations` | **8** (`0001`–`0008`) |
| API routes | `grep -c 'defineRoute({' apps/api/src/routes/*.ts` | **55** |
| MCP tools registered | `grep -c 'registerTool({' apps/mcp-server/src/tools/*.ts` | **19** |
| Permission keys | `packages/shared-types/generated/registries.json` | **47** |
| Roles | same | **14** |
| Audit actions / families | same | **157** / **28** |
| Unit + contract + integration tests | `npm run verify` | **728 passed, 12 todo, 32 files** |
| Browser acceptance tests | `npm run test:e2e` | **10 passed, 2 projects** |
| Typecheck / lint tasks | `npm run verify` | **33** / **21** |
| Deterministic baseline | `scripts/baseline.ts` | SOP corpus 4 questions / 3.4% · GenerationReady 16 / 21.1% |

---

## 1. `CLAUDE.md`

| # | Stale statement | Correction | Reason |
| --- | --- | --- | --- |
| 1.1 | "tests 634 passing + 12 todo across 26 files" | **728 passing + 12 todo across 32 files** | Question import, taxonomy administration and the transition-availability helper each added suites |
| 1.2 | "typecheck 30/30, lint 19/19, build 19/19" | **typecheck 33/33, lint 21/21** | Two new workspaces since: `@knowzy/question-import` and `@knowzy/e2e` |
| 1.3 | "7 migrations apply from empty" | **8** — `0008_sync_skipped` | Added 2026-09-22 with the skipped-vs-failed split |
| 1.4 | "48 API routes" | **55** | +2 question import, +5 taxonomy |
| 1.5 | "No test drives the UI. A broken screen is found by a person, not the build." | **Removed.** Replaced with what the browser suite covers and what it does not | It is no longer true, and leaving it would understate the platform. The exclusions are named so the claim stays honest |
| 1.6 | "No automated end-to-end test … the equivalent has only ever been run by hand" | **Corrected**: the authoring and learner paths of the 36-step script are automated; steps needing unbuilt capability are named | Same reason |
| 1.7 | Next Immediate Task item 1, "Request T-29 … has no drafted request anywhere" | **Corrected**: the request is drafted at `docs/integrations/T29_PRIVACY_LEGAL_REQUEST.md` and **has not been sent** | The document exists as of `3a1488d`. Sending it is not an engineering action |
| 1.8 | Next Immediate Task item 2, "Measure the blind-stem baseline … and aggregate `confidenceComponents`" | **Split**: the component aggregate is **done** (§2.5 of the evaluation plan); blind-stem answerability is still outstanding | Only half of that item was completed, and saying "done" would be wrong |
| 1.9 | "CI first ran on 2026-09-21 … round 2 … failed" | **Corrected**: 11 commits were pushed on 2026-09-23 and **the outcome of that run has not been read from this machine** (`gh` is absent, the repository is private) | An unknown is not a pass. It is recorded as unknown |

## 2. `docs/project/ENTERPRISE_PILOT_READINESS.md`

| # | Stale statement | Correction | Reason |
| --- | --- | --- | --- |
| 2.1 | "Closed `PermissionKey` union (46 keys)" | **47** | `question.import` was added by the acquisition framework |
| 2.2 | "48 API routes each with a declared policy" | **55**, still each with a declared policy, still asserted by the registry test | Counted |
| 2.3 | "501 tests across 23 files" | **728 passed, 12 todo, across 32 files**, plus **10 browser acceptance tests** | Counted |
| 2.4 | "typecheck 30/30, lint 19/19 … build 19/19" | **typecheck 33/33, lint 21/21** | Two new workspaces |
| 2.5 | §1.4 "No automated test drives the UI. A broken screen is found by a person." | **Corrected**, with the covered paths and the named exclusions | It was true when written and is not now |
| 2.6 | §1.2 Authorization row, and the gap register: no mention of taxonomy | **Added**: domains and topics are now managed through the product under `taxonomy.manage` | The gap was real and is closed; a readiness report that omits it understates the platform |
| 2.7 | §1.2 Question Generation row: "A `QuestionGenerator` whose `kind` is `'anthropic'`" | **Unchanged**, and confirmed still true | No Anthropic code exists. Re-verified rather than assumed |
| 2.8 | §10.1 week-0 actions: "Request T-29" | **Corrected** to "send the drafted request", with the path | See 1.7 |
| 2.9 | §1.4 "The container image vulnerability scan has never executed" | **Unchanged**, and still true | Nothing in this work ran it |

## 3. `docs/integrations/LIVE_CLAUDE_EVALUATION_PLAN.md`

| # | Stale statement | Correction | Reason |
| --- | --- | --- | --- |
| 3.1 | §2.4 presented as the control arm | **Kept, marked as the first capture, superseded by the new §2.5** | Its "matched run" accepted **0** questions from the SOP corpus because the sections had already been attempted by earlier runs. That is a property of accumulated state, not of the corpus, and quoting it as the baseline would understate the control |
| 3.2 | §9 metric table, Arm A column: "3 over three jobs", "3 / 93 ≈ 0.03", "1 of 4 candidates" | **Re-measured**: 4 (SOP) and 16 (GenerationReady); evidence refusal **0 of 4** and **0 of 16**; coverage 3.4% / 21.1%; duplicate rate 0% both | The old figures predated PILOT-T2's coverage correction |
| 3.3 | §9 had no confidence-component row | **Added 11a**, with `optionDistinctness` 0.256 / 0.168 against `evidenceMatchQuality` 0.936 / 0.945 | This is the §8.2 prediction, now measured, and it is the finding that matters most for the comparison |
| 3.4 | §10 sequencing step 2, "Measure the blind-stem baseline … aggregate `confidenceComponents`" | **Marked done for the aggregate**, outstanding for blind-stem | See 1.8 |

## 4. `RealWorldPilot/CorpusManifest.md`

| # | Stale statement | Correction | Reason |
| --- | --- | --- | --- |
| 4.1 | §8 figures presented as the control arm | **New §9** points at the re-measured baseline and explains every delta | Same as 3.1 |
| 4.2 | "28 documents … 115 assessable sections" | **30 documents, 118 assessable** | Two question-bank files were dropped into the mirrored SOP folder and are now synchronized as documents. **They are not SOPs**, and §9.1 records moving them as an action |

---

## 5. Two things found while reconciling, which are defects rather than stale prose

### 5.1 `coverage_status` outlives the question it refers to

Before the baseline was re-measured, the two corpora reported **20 covered sections while the
database held zero generated questions.** `document_section.coverage_status` is a denormalized
claim, and deleting a draft does not clear it — the integration suites delete `draft_question` rows,
and the flag stayed behind.

- **Consequence today:** a baseline or a preflight taken after any deletion overstates coverage.
- **Handled by:** `scripts/baseline.ts --reset`, which clears the state as a documented measurement
  precondition and refuses to touch published lineage.
- **Not fixed:** nothing recomputes the flag when a question disappears. Retention deletes
  `REJECTED`/`ARCHIVED` drafts after two years, which do not contribute coverage, so the production
  exposure is narrow — but it is real and it is recorded here rather than closed quietly.

### 5.2 The duplicate-rate metric was wrong in its first form

`maxSimilarityScore` is written on **every** draft, whatever the score, so counting non-null values
reported a **100% duplicate rate** on a corpus whose highest match was 0.483. The metric now applies
the active profile's flag threshold (0.750), giving **0%** — and the report prints the highest
observed score next to the rate, because a rate with no maximum cannot be sanity-checked.

Worth recording because the wrong version looked plausible: a metric that reports 100% and a metric
that reports 0% are equally easy to publish.
