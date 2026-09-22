# Live Claude Generation — Evaluation Plan

**Status:** PLAN ONLY. No code written, no evaluation run.
**Purpose:** decide, on evidence, whether a live Claude generator produces questions good enough to
put in front of EssilorLuxottica support staff — and to have that decision be defensible afterwards.
**Evaluation corpus:** the **real approved SOP corpus**, already ingested and measured
([`CorpusManifest.md`](../../RealWorldPilot/CorpusManifest.md),
[`PILOT-T1-CORPUS-SELECTION.md`](PILOT-T1-CORPUS-SELECTION.md)). No synthetic content.
**Companion:** [`LIVE_CLAUDE_IMPLEMENTATION_PLAN.md`](LIVE_CLAUDE_IMPLEMENTATION_PLAN.md).

---

## 1. The question being answered

Not *"can we call Claude"* — that is a day's work. The question is:

> **Does a live model produce assessment questions that a support subject-matter expert will approve
> and put in front of staff, from documents written the way these documents are actually written?**

CLAUDE.md has been blunt about this for months: question quality *"has never been tested against
Claude, which is the product's actual purpose."* Everything else in the platform — ingestion,
grounding, review, separation of duties, publication, scoring — is built and demonstrated on real
documents. This is the last unverified assumption in the product thesis.

**A demo cannot answer it.** A demo shows that questions appear. This plan is designed to survive the
question a CIO will ask: *what does the AI actually add, and how do you know?*

---

## 2. The baseline, which already exists and is unusually good

Most evaluations start by having to build a control. This one does not: the deterministic generator
has already been run over the real corpus three times and every outcome is persisted.

### 2.1 The corpus

| | Value |
| --- | ---: |
| Files in the corpus folder | 29 |
| Documents ingested (1 CSV has no extractor) | **28** |
| Characters extracted | **122,106** |
| Sections extracted | **234** |
| Sections assessable by length (≥ 300 chars) | **115** |

### 2.2 Three deterministic runs, as recorded

| | Job A | Job B | Job C |
| --- | ---: | ---: | ---: |
| Selection rule | 10 richest by **section count** | 10 richest by **untried assessable sections** | Documents never processed |
| Sections in scope | 93 | 14 | 10 |
| Questions requested | 6 | 10 | 5 |
| **Questions accepted** | **3** | **0** | **0** |
| Refused — `EVIDENCE_UNVERIFIED` | 1 | 0 | 0 |
| Sections reporting insufficiency | 97 | 14 | 10 |
| Input / output tokens | 21,354 / 1,084 | — | 3,237 / 40 |

**Totals: 3 accepted questions, 1 evidence refusal, 106 recorded insufficiency reasons.** Three
questions were approved by a second identity and published as
`KNZ-SUPPORT_OPS-2026-000001…000003`.

### 2.3 Why the baseline is a fair control and not a straw man

It quotes the document verbatim, passes the identical gate chain, applies its own duplicate
suppression, refuses to pad a requested count, and distinguishes *"nothing testable here"* from
*"a question already covers this"*. It is a genuine attempt at the task within its technique. It is
also, per the implementation plan §1, a sentence-matching template engine — and the comparison is
precisely about whether that technique is sufficient.

**Job B is the important row.** It tests the hypothesis that a better document selection would fix
yield: 14 assessable sections that had never been attempted produced **zero** questions. So the
limit is the generator, not the selection and not the corpus. That is the finding this evaluation
exists to act on.


### 2.4 The deterministic baseline, measured on both corpora (2026-09-22)

Captured with `npx tsx scripts/baseline.ts`, through the real API with the full unmodified gate
chain. **This is Arm A.** Both runs used the same selection rule (documents ranked by ASSESSABLE
section count, the §5.1 rule), the same requested count (50), the same profile, and `STRICT`
evidence verification.

| | Original SOP corpus | Generation-ready corpus |
| --- | ---: | ---: |
| Documents | 28 | 7 |
| Sections | 234 | 78 |
| **Assessable** | **115** | **76** |
| Attempted | 109 | 76 |
| **Generated** | **4** | **16** |
| Refused | 105 | 60 |
| Unresolved | 6 | 0 |
| **Coverage** (generated / assessable) | **3.5%** | **21.1%** |

#### The matched run, which is the cleanest statement of the finding

Same rule, same request, same generator, same day:

| | Original SOP corpus | Generation-ready corpus |
| --- | ---: | ---: |
| Assessable sections in scope | 93 | 76 |
| Questions requested | 50 | 50 |
| **Questions accepted** | **0** | **16** |
| Sections reporting insufficiency | 93 | 60 |
| Rejections (any reason) | 0 | 0 |
| Tokens in / out | 21,660 / 40 | 18,203 / 5,784 |

The original corpus accepted **zero** on this run because every assessable section had already been
attempted and refused; its cumulative 4 came from the sections that happen to contain a modal verb.
The restructured corpus accepted **16** from material with the same operational content.

#### Evidence quality

| | Original | Generation-ready |
| --- | ---: | ---: |
| Questions | 4 | 16 |
| Verified under `STRICT` | 4 of 4 | 16 of 16 |
| Exact quotation (similarity 1.000) | 4 | 16 |
| Mean evidence span | 108 chars | 170 chars |
| Mean composite confidence | 0.742 | 0.710 |
| Evidence refusals in these runs | 0 | 0 |

**Every accepted question in both arms is an exact, character-for-character quotation.** The one
`EVIDENCE_UNVERIFIED` refusal recorded in `CorpusManifest.md` §4.4 came from a pre-PILOT-T2 run and
its row was removed when `verify` truncated the database; the matched runs above refused nothing on
evidence.

Worth noting rather than glossing: mean confidence is slightly **lower** on the restructured corpus
(0.710 vs 0.742) even though it produced four times as many questions. More questions, marginally
less confident on average — and the confidence formula weights evidence span length, so the longer
spans should have pushed the other way. That is a small anomaly in the composite, not a quality
verdict, and §6.2 is where it should be examined.

#### Duplicate rate

| | Original | Generation-ready |
| --- | ---: | ---: |
| Accepted drafts with a duplicate disposition | 0 of 4 | 0 of 16 |
| Blocked as duplicates | 0 | 0 |
| Flagged | 0 | 0 |
| Highest composite similarity against the whole corpus | 0.594 | 0.483 |

Both sit below the 0.75 flag threshold and well below the 0.92 block threshold, so **the
deterministic generator's duplicate rate on this corpus is zero** — which is unsurprising, because
it emits at most one question per section and suppresses a stem it has already produced.

**One confound, stated because it will otherwise be quoted as a result.** Both corpora derive from
the same SOPs, so a question generated from one can legitimately duplicate one from the other. The
16 restructured questions were generated with the original corpus's 4 already present and none was
blocked, which is informative but is *not* a controlled measurement. **Arm A of the comparison must
run on a clean database** for the duplicate metric to mean anything, and §4.2's requirement to
re-run the control rather than quote these figures stands.

---

## 3. Three prerequisites, before any comparison is meaningful

These are not nice-to-haves. Each one silently corrupts a metric the brief asks for.

### 3.1 The coverage metric does not currently measure coverage — FIXED 2026-09-22

> **Closed by PILOT-T2**, migration `0004_grounding_integrity`. Coverage is now `generated /
> assessable`, and the five states are reported separately. On the pilot corpus the corrected figure
> is **2.6%** where 94.8% was reported. `scripts/coverage-report.ts` prints the accounting and the
> section-key collision count. The account below is kept because the defect explains what the metric
> used to mean, and any figure quoted from before this date carries it.

**This is a defect, and it is a residual of one I fixed on 2026-09-22 — the fix was incomplete.**

The earlier defect was generation writing `isAssessable: false` on any section it could not build a
question from. That is fixed. But the same run still writes:

```ts
coverageStatus: covered > 0 ? 'COVERED' : wasInsufficient ? 'NON_ASSESSABLE' : 'NOT_COVERED'
```

and preflight computes coverage as:

```ts
const uncovered = assessable.filter(
  (s) => s.coverageStatus === 'NOT_COVERED' || s.coverageStatus === 'PARTIALLY_COVERED',
);
coveragePercent = (assessable.length - uncovered.length) / assessable.length
```

A section marked `NON_ASSESSABLE` by the generator is **still in the denominator** (because
`isAssessable` is now correctly left alone) but is **excluded from `uncovered`**. So every section the
generator failed on is counted as covered.

This is visible on screen right now. `SOP - Order Cancellation RxNet.docx` reports **100% coverage,
0 uncovered sections** — with **2 questions across 8 assessable sections**. Six sections have no
question and the screen says the document is fully covered.

**Measured across the whole pilot corpus** (queried 2026-09-22):

| | Sections |
| --- | ---: |
| Assessable | **115** |
| `COVERED` — genuinely has a question | **3** |
| `NON_ASSESSABLE` — written by the generator on insufficiency, and excluded from `uncovered` | **106** |
| Counted as uncovered | **6** |

So preflight reports coverage of **(115 − 6) / 115 = 94.8%** for a corpus in which **3 of 115
assessable sections actually carry a question — 2.6%**. The 106 is not a coincidence: it is exactly
the 106 recorded insufficiency reasons. **Every refusal became a claim of coverage.**

The mock source in the same database shows the contrast: 17 assessable sections, 0 covered, **17
uncovered** — honest, because nothing has generated from it.

The conflation did not go away; it **moved** from `isAssessable` to `coverageStatus`. My earlier
account said the flag was left alone and the reason still recorded, which is true and was not the
whole story.

**Consequence for this plan:** coverage is one of the six metrics requested, and it is not currently
measurable. Worse, it is biased in the direction that flatters whichever generator fails more —
failing on a section marks it covered. **Fix before the comparison, not after.**

**Recommended fix:** an insufficiency outcome belongs on the generation job, where it already is, and
must not write a document-level coverage status at all. `NON_ASSESSABLE` should be reachable only by
author curation and by the length threshold, exactly as §6.2 of the generation specification says for
`isAssessable`.

### 3.2 The recorded prompt version is not the prompt that would be sent — FIXED 2026-09-22

> **Closed by PILOT-T2.** `PromptVersion.body` is now `canonicalPromptBody()` at version
> 1.2.0, pinned by `PROMPT_BODY_SHA256` and guarded by a contract test that fails if the
> prompt changes without the version.

Implementation plan §3.2. Every question records `promptVersionId`, and the seeded body is a
hand-written paraphrase of what `framing.ts` builds. For a comparison whose whole purpose is to
attribute quality to a prompt and a model, provenance that points at the wrong text makes the result
unciteable. Fix first.

### 3.3 The blind-stem baseline must be measured before Claude is called

§6.1 below. It needs no API key and no approval. Running it afterwards invites the suspicion that the
bar was set once the results were known.

---

## 4. Design

### 4.1 Held constant

| Held constant | Why |
| --- | --- |
| The corpus — the same 28 real SOP documents | The variable under test is the generator |
| The pinned scope — identical `resolvedSectionKeys` | Otherwise the comparison measures document selection |
| The generation profile — same thresholds, `maxQuestionsPerSection`, `evidenceMode: STRICT` | A model given looser grounding is not being compared, it is being flattered |
| The full gate chain, unmodified | Schema → evidence → integrity → confidence → duplicates → draft |
| `requestedQuestionCount` | Cost per accepted question is meaningless otherwise |
| The reviewer, and the review UI | Approval rate is a human measurement |

**If any threshold is moved to accommodate model output, the run is void and is re-run.** Writing that
down in advance is the point: the temptation to relax `STRICT` to STANDARD to raise the accepted count
will be real, and it would convert a quality measurement into a tolerance measurement.

### 4.2 The three arms

| Arm | Generator | Scope |
| --- | --- | --- |
| **A — control** | `deterministic-local` | Re-run on the §4.3 scope, on a clean database, so the baseline is produced under identical conditions rather than quoted from an earlier run |
| **B — treatment** | `anthropic`, profile model (`claude-sonnet-5`), `temperature` 0.2 | The same scope |
| **C — sensitivity**, optional | `anthropic`, one call per document (implementation plan §5.2) | The same scope, only if B's quality is marginal |

Arm A is re-run rather than reused. The earlier runs happened across a defect fix and two database
resets, and a control produced under different conditions is not a control.

### 4.3 The scope, pinned in advance

**Ten documents selected by assessable-section count, descending, ties by name** — the
[`PILOT-T1-CORPUS-SELECTION.md`](PILOT-T1-CORPUS-SELECTION.md) §5.1 ranking, not the section-count
ranking that was actually used. Two reasons: it is the rule that document recommends, and it puts the
most assessable material in front of both generators, which is the fairest test of the treatment.

`requestedQuestionCount = 10`, the per-job ceiling that keeps a batch reviewable.

**Record the resolved section keys before either run.** They are the definition of the experiment.

### 4.4 Blinding

`modelId` is displayed on the review screen's traceability chain, so the live UI cannot blind the
reviewer.

**Protocol:** export both arms' accepted questions to a single shuffled review sheet — stem, four
options, the correct answer, the explanation, the evidence span and the document name, with **no
generator attribution and no confidence score**. The SME scores that sheet. Attribution is rejoined
afterwards from a key held separately.

Confidence is withheld deliberately: it is partly computed *from* option distinctness, so showing it
would leak the arm.

**Then, unblinded:** both batches go through the real review queue for the approval-rate metric
(§6.5), because approval is a workflow event with an audit record and cannot be simulated on a
spreadsheet. The blind sheet measures *judgement*; the queue measures *what actually happens*.

---

## 5. Metrics

Every metric names its source, so the numbers can be recomputed later from the database rather than
trusted.

| # | Metric | Definition | Source | Arm A baseline |
| --- | --- | --- | --- | --- |
| 1 | **Accepted questions** | Drafts persisted after the full gate chain | `GenerationJob.acceptedQuestionCount` | 3 over three jobs |
| 2 | **Yield per assessable section** | Accepted ÷ assessable sections in scope | Job + `DocumentSection` | 3 / 93 ≈ 0.03 |
| 3 | **Insufficiency rate** | Sections reporting nothing testable ÷ sections in scope | `insufficientSections` on the job | 97 / 93 (some sections reported twice across jobs) |
| 4 | **Evidence refusal rate** | `EVIDENCE_UNVERIFIED` ÷ candidates emitted | `GenerationJobRejection` | 1 of 4 candidates |
| 5 | **Evidence quality** | §6.3 | `DraftQuestion.evidenceSimilarityScore`, span length | 1.000 exact (verbatim by construction) |
| 6 | **Coverage** | Assessable sections with ≥ 1 accepted question ÷ assessable sections in scope. **Computed for this evaluation, not read from `coveragePercent`** — see §3.1 | Recomputed from `DraftQuestion.sectionKey` | 3 of 93 ≈ 3% |
| 7 | **Duplicate rate** | §6.4 | `GenerationJobRejection` reason `DUPLICATE`, `maxSimilarityScore` | 0 blocked; 2 suppressed pre-emptively |
| 8 | **Blind-stem answerability** | §6.1 | Manual | **Not yet measured — the §3.3 prerequisite** |
| 9 | **SME quality score** | §6.2 rubric | Blind review sheet | Not yet measured |
| 10 | **Approval rate** | Approved ÷ submitted, in the real queue | `QuestionApproval` | 3 of 3 (n too small to mean anything) |
| 11 | **Cost per accepted question** | §6.6 | Job tokens × price config | 21,354 in / 1,084 out for 3 questions |
| 12 | **Reviewer time per accepted question** | Wall clock, recorded by the SME | Manual | Not measured |

Metric 12 is not in the brief and matters commercially: a generator producing 40 questions of which 8
are approved may cost more reviewer time than one producing 5 of which 4 are approved. Governance
cost is a real cost.

---

## 6. How each qualitative metric is actually measured

### 6.1 Question quality, part 1 — the blind-stem test

**Procedure.** Present stem + four options, **without the source document**, to two or three people
who have not read the SOP. Ask them to pick the answer and say why.

**Interpretation.**

| Result | Meaning |
| --- | --- |
| ~25%, guessing | The question requires the document. **Good.** |
| Well above chance | Answerable from form or general knowledge. **The question does not test the SOP**, whatever its evidence span says |

**This is the single most informative cheap measurement available**, and the implementation plan
predicts Arm A fails it: its distractors are mutations of the correct answer, so option A of
`KNZ-SUPPORT_OPS-2026-000001` is the only one written in ordinary English. **Measure it on the three
published questions before Claude is called** (§3.3) — three questions is a tiny sample, but a
result of 3/3 correct without the document is decisive enough on its own.

For Arm B the same test detects the opposite failure: a model drawing on general IT knowledge rather
than the document. Both failures are "answerable without the source", and both matter.

### 6.2 Question quality, part 2 — the SME rubric

Five dimensions, each 0–2 (0 fails, 1 acceptable, 2 good), scored on the blind sheet:

| Dimension | 0 | 2 |
| --- | --- | --- |
| **Operational relevance** — would a support engineer need to know this? | Tests document furniture, ownership, or a heading | Tests something that changes what the engineer does |
| **Single defensible answer** | Two options are arguably correct, or the right answer is debatable | Exactly one option is right and the SME would defend it |
| **Distractor plausibility** | Distractors are giveaways or nonsense | Distractors are things a half-trained person would believe |
| **Stem clarity** | Requires re-reading, or leans on a heading number | Reads as a question a trainer would ask |
| **Explanation value** | Restates the answer | Teaches why, and would help on review |

**Primary quality outcome: the proportion of questions scoring ≥ 8/10 with no dimension at 0.** A
question with a zero on any dimension is not usable regardless of its total — a beautifully worded
question with two correct answers is worse than useless.

Rubric limits worth stating: a single SME is a single rater, so **no inter-rater agreement is
measurable**. If a second SME can be found for even 20 questions, that subset gives an agreement
figure and the confidence interval on everything else improves. Treat a one-rater result as
indicative, not conclusive, and say so in the write-up.

### 6.3 Evidence quality

Grounding is already mechanical — a span that does not verify is never persisted — so "evidence
quality" among *accepted* questions is about whether the span is a good citation:

| Measure | Source | Note |
| --- | --- | --- |
| Verification mode and similarity | `evidenceVerificationMode`, `evidenceSimilarityScore` | Arm A is 1.000 by construction; a model paraphrasing scores lower or is refused |
| Span length distribution | `supportingEvidence` length | The bounds are 40–1200. Spans near the floor are technically evidence and weak; `confidence.ts` already ramps quality to full only at 3× the floor |
| **Span sufficiency** — does the span alone justify the answer? | SME, on the blind sheet | The interesting one. A model can quote a *verbatim but irrelevant* sentence and pass verification |
| **Evidence refusal rate** | `EVIDENCE_UNVERIFIED` count | The honest measure of how well grounding holds against a model |

**Span sufficiency is where a model can pass every mechanical gate and still be wrong**, so it is the
one evidence dimension that must be human-scored. Evidence verification proves the span is *in the
document*; only a person can say it *supports the answer*.

**Do not loosen `STRICT` to raise Arm B's accepted count.** If Arm B has a high evidence refusal rate,
that is the result, and it is a finding about prompt design. Report it.

### 6.4 Duplicate rate

Three stages already exist and all three are measured:

1. **Generator-level suppression** — the `doNotDuplicate` stem list, passed into the prompt. Arm A
   suppressed 2 sections this way; for Arm B, whether the model honours a list of ~100 stems is a real
   and untested question.
2. **Corpus similarity** — `assessDuplicate` against drafts, approved and published, with FLAG at
   0.75 and BLOCK at 0.92. Measure counts of each plus the `maxSimilarityScore` distribution.
3. **Cross-domain duplicates** — preflight check 5, never domain-filtered.

**A model asked for 10 questions from 93 sections may well produce near-duplicates of each other
within one response**, which Arm A cannot do because it emits at most one question per section. Stage
2 compares against the corpus; within-batch similarity should be computed explicitly for this
evaluation using the same comparator.

### 6.5 Approval rate — the primary business outcome

Both batches go through the real review queue: claim, submit, approve or reject by a different
identity under gate 13. Measure approvals ÷ submissions, plus the **reason** for every rejection,
which is the qualitative gold in this evaluation.

Approval rate is the primary outcome because it is *the platform's own existing bar* and the one
number a stakeholder already understands. It is also the number most exposed to bias — the reviewer
knows a Claude pilot is being evaluated. Hence the blind sheet first (§4.4): if the blind rubric and
the unblinded approval rate disagree sharply, that gap is itself a finding about the review process.

### 6.6 Cost

| Measure | How |
| --- | --- |
| Tokens per job | Already recorded on `GenerationJob` |
| Cost per job | `estimatedCost`, once the price keys exist (implementation plan §6.5) |
| **Cost per accepted question** | Cost ÷ accepted. The only number worth quoting |
| **Cost per *approved* question** | Cost ÷ approved. The number that matters commercially |
| Cost of refusals | Tokens spent on candidates the gates rejected — the price of grounding, and worth knowing |

Arm A costs nothing, so the comparison is not a ratio; it is *"what does a question cost, and is it
worth it"*. On corpus size (~31,000 tokens of section text) a job is cents, so expect the answer to
be that cost is irrelevant next to reviewer time — but measure it rather than assert it, because
"the AI costs too much" is an objection that needs a number.

---

## 7. The decision rule, pre-registered

**Written before any Claude output is seen. Recorded here so it cannot be adjusted afterwards.**

Live Claude generation is **adopted for the pilot** when all of:

1. **Quality:** ≥ 60% of accepted Arm B questions score ≥ 8/10 on the §6.2 rubric with no dimension
   at 0, **and** Arm B's score distribution is materially better than Arm A's.
2. **Groundedness:** Arm B's blind-stem answerability is not materially above chance — the questions
   require the document.
3. **Yield:** Arm B produces **≥ 5× Arm A's accepted questions** from the same pinned scope. Arm A
   produced 3 from 93 sections; a generator that cannot clear 15 does not solve the bottleneck that
   opened this workstream.
4. **Evidence integrity:** every accepted question passes the unmodified gate chain, and the evidence
   refusal rate is **< 40%**. Higher means the prompt is not producing verbatim citation and is a
   prompt-engineering problem, not an adoption decision.
5. **Approval:** the SME approves **≥ 50%** of Arm B's submissions in the real queue.
6. **Duplicates:** no BLOCK-level duplicates within a single Arm B batch.
7. **Cost:** cost per approved question is below a figure the business states **in advance**.

**Rejected, or deferred pending prompt work, when:** yield improves but rubric quality does not
(more questions, no better — the worst outcome, because it raises reviewer cost with no gain);
groundedness fails; or evidence refusals exceed 40%.

**Explicitly not a criterion: "the questions look better."** They will. Fluent text reads better than
a template. Fluency is not correctness, and this whole plan exists because that difference is easy to
miss in a demo.

### 7.1 If the result is mixed — the most likely outcome

Expect Arm B to win clearly on quality and yield, and to be weaker on evidence verification, because
verbatim citation under `STRICT` is a genuinely hard instruction to follow. The right response is
prompt iteration with the criteria unchanged: **a second and third Arm B run under a new
`PromptVersion` each time**, which is exactly what the immutable prompt-version table exists to
support. Every iteration is comparable because the scope is pinned.

Iterating the prompt is legitimate. Iterating the decision rule is not.

---

## 8. Threats to validity, stated because a review will find them anyway

| Threat | Severity | Mitigation |
| --- | --- | --- |
| **n = 3 in the control.** No distribution, no confidence interval, no percentages worth quoting | **High** | Report counts, never percentages, for Arm A. The comparison is "3 versus N", and if N is large the direction is unambiguous even without statistics |
| **One SME, who is also the product owner** | **High** | Blind sheet first; recruit a second rater for even a 20-question subset; publish the rubric so a later rater can re-score |
| **Coverage metric currently broken** (§3.1) | **High** | Fix first; recompute coverage from draft section keys for this evaluation regardless |
| **One corpus, one domain.** 28 support SOPs from one team | **Medium** | State the limit. A result on imperative runbooks does not transfer to policy documents — and the corpus-selection document already recommends policy and threshold documents as a better fit |
| **Order effects** on the review sheet | **Medium** | Shuffle; record presentation order and check for a position trend |
| **Arm A was tuned on this corpus** — `RULE_SIGNAL`, `minAssessableChars` | **Low, favours A** | Worth noting: the control has had the benefit of this corpus and the treatment has not |
| **Model version drift.** `claude-sonnet-5` today is not `claude-sonnet-5` in a year | **Medium** | `modelId` and `promptVersionId` are recorded per question, so any result is re-runnable and attributable. This is what those columns are for |
| **Reviewer fatigue** if Arm B is much larger | **Medium** | Cap the review sheet, sample if needed, and record metric 12 |

---

## 9. Execution sequence

| # | Step | Blocked on T-29 |
| --- | --- | --- |
| 1 | Fix §3.1 coverage, §3.2 prompt version. Add the contract gates | No |
| 2 | Measure the blind-stem baseline on the 3 published questions; aggregate `confidenceComponents` | No |
| 3 | Pin the §4.3 scope. Record the resolved section keys | No |
| 4 | Run Arm A on a clean database. Record every metric | No |
| 5 | Implement the Anthropic generator (implementation plan §3–7), including budgets | **Yes** |
| 6 | Run Arm B on the identical pinned scope | **Yes** |
| 7 | Build the blind sheet. SME scores it | **Yes** |
| 8 | Both batches through the real review queue. Record approvals and rejection reasons | **Yes** |
| 9 | Rejoin attribution. Evaluate against §7. Record the outcome | **Yes** |
| 10 | Write the result into `KNOWZY_PROJECT_HISTORY.md` — including if the answer is "no" | **Yes** |

**Steps 1–4 are unblocked and produce the control.** They are worth doing now: the baseline is
needed whatever Anthropic approval decides, and step 2 may on its own settle whether the current
questions are fit to show anybody.

---

## 10. Deliverable

`RealWorldPilot/GeneratorComparison.md` — a register in the same style as `CorpusManifest.md`: the
pinned scope, the per-arm metric table, the blind rubric scores with the key, the rejection reasons
verbatim, the cost, the §7 verdict, and **the conclusions withdrawn along the way**. Two conclusions
were already withdrawn in the corpus work and recorded rather than deleted; the same discipline
applies here.

The register must be readable by someone who was not present, and must let them recompute every
number from the database.

---

---

## 11. Extension: comparing more than two generators

**Added 2026-09-22**, alongside
[`MULTI_PROVIDER_GENERATION_ARCHITECTURE.md`](MULTI_PROVIDER_GENERATION_ARCHITECTURE.md). Sections
1–10 describe a two-arm comparison and remain correct; this section says what changes when there are
three or more, and what must not change.

### 11.1 The arms

| Arm | Provider | Execution mode | Status |
| --- | --- | --- | --- |
| **A — control** | `deterministic-local` | n/a | **Measured. §2.4** |
| **B** | `anthropic` | Platform managed | Blocked on **T-29** |
| **C** | `microsoft-copilot` | User managed | Blocked on **R1**: whether Copilot can be made retrieval-free at all |
| D, E | Azure OpenAI, Gemini | Either | Declared, not registered |

**Arm C may never exist, and that is a finding rather than a delay.** The architecture's §0.2 shows
that a provider grounding its answers in Microsoft Graph either yields nothing (evidence
verification refuses spans it did not take from the section) or produces questions shaped by content
the author never selected — which is a confidentiality problem, not a quality one. Until Copilot can
be invoked retrieval-free, it is not eligible, and the comparison has two arms.

### 11.2 What must not change with more arms

1. **One control, measured once, on a clean database.** Arm A is re-run per §4.2 and every other arm
   is compared against it. Arms are **not** compared against each other as a primary result.
2. **The identical unmodified gate chain for every arm.** A provider needing a relaxed threshold has
   failed the comparison; the threshold has not failed the provider.
3. **The same pinned scope**, from `resolvedSectionKeys`.
4. **Blinding.** The review screen shows the provider, so the blind sheet must be an export with
   `providerId`, `modelId` and confidence withheld — confidence partly derives from option
   distinctness and would leak the arm.
5. **The pre-registered decision rule in §7 is unchanged and applies per arm.**

### 11.3 The one methodological addition: pairwise, pre-registered

Three arms invite choosing the winner after the results are in. The rule, fixed now:

> **Each provider is evaluated against the deterministic control on the §7 criteria, independently.
> There is no "best of three".** A provider either clears the bar or it does not, and two providers
> clearing it is a procurement question rather than an experimental result.

Reporting a provider as best-of-N over seven metrics with no correction is how a null result becomes
a recommendation. If a genuine head-to-head is wanted later, it needs its own pre-registration,
its own sample-size argument and a second rater — none of which exist today.

### 11.4 Metrics, extended

Every metric in §5 applies per arm. Four need provider-specific handling:

| Metric | Extension |
| --- | --- |
| **Token usage** | Reported per arm with the `usage.reported` flag. The deterministic arm ESTIMATES from prompt length, so "tokens per accepted question" is not comparable across a reported and an estimated arm without saying which is which |
| **Cost** | **"Not observable" is a legitimate value.** Licence-based (Copilot) and user-managed runs have no per-call cost the platform can see. Architecture §6.2. A zero would be a fabrication |
| **Refusal rate** | Split by cause: insufficiency (the generator found nothing), evidence refusal (a span did not verify), schema invalid, duplicate blocked. A model failing differently from a sentence matcher is the interesting part |
| **Duplicate rate** | Within-batch **and** against the corpus. A model asked for 50 questions from 76 sections can duplicate itself in one response; the deterministic generator structurally cannot, emitting at most one question per section |

### 11.5 Two things the control arm has already settled

Recorded so no provider evaluation re-litigates them:

- **Structure dominates yield for the deterministic generator.** Same rule, same request: 0 accepted
  from 93 assessable sections of the original corpus, 16 from 76 of the restructured corpus. Any
  provider must be measured on **both** corpora or the result confounds provider with document
  structure.
- **Grounding holds.** All 20 accepted questions across both corpora verified as exact quotations
  under `STRICT`. A provider whose evidence refusal rate is high is failing at citation, not being
  held to an unusual standard.

## 12. Traceability

| This document | Source |
| --- | --- |
| §2 baseline figures | [`CorpusManifest.md`](../../RealWorldPilot/CorpusManifest.md) §4, [`PILOT-T1-CORPUS-SELECTION.md`](PILOT-T1-CORPUS-SELECTION.md) §4–5 |
| §3.1 coverage defect | `packages/domain/src/generation/preflight.ts` (lines ~166–172, ~268), `packages/domain/src/generation/generation-service.ts` (~line 541), read 2026-09-22 |
| §3.2 prompt version | [`LIVE_CLAUDE_IMPLEMENTATION_PLAN.md`](LIVE_CLAUDE_IMPLEMENTATION_PLAN.md) §3.2 |
| §4.3 selection rule | [`PILOT-T1-CORPUS-SELECTION.md`](PILOT-T1-CORPUS-SELECTION.md) §5.1 |
| §5 metric sources | `schema.prisma` §5 — `GenerationJob`, `GenerationJobRejection`, `DraftQuestion` |
| §6.3 evidence bounds | `packages/claude-services/src/evidence.ts`; `workflows.md` §2.5 |
| §6.4 duplicate thresholds | `GenerationProfile.duplicateFlagThreshold` 0.75, `duplicateBlockThreshold` 0.92 |
| §6.5 approval | `workflows.md` gate 13; `QuestionApproval` |
| T-29 / A-05 | [`assumptions-and-tenant-configuration.md`](../assumptions-and-tenant-configuration.md) |
