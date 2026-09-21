# Claude Integration Plan

**Roadmap phase:** 4 — Generation and governance. Recorded DONE *with the deterministic local
generator*; the live model is the deferred half.
**Status:** NOT STARTED. No Anthropic SDK is a dependency of any workspace.
**Blocked on:** **T-29** — approval to send question drafts and delimited source excerpts to
Anthropic. Recorded as assumption **A-05, confidence *Unconfirmed***.

---

## 1. Existing QuestionGenerator port

`packages/claude-services/src/generator.ts` declares:

```ts
export interface QuestionGenerator {
  readonly kind: 'deterministic-local' | 'anthropic';
  readonly modelId: string;
  generate(args: GenerateArgs): Promise<GenerateResult>;
}
```

`'anthropic'` has **no implementation and no other referent in the repository**. The seam is one
interface with one method.

`GenerateResult` already carries everything the platform records: the parsed `output`, the
per-section `insufficientSections`, the `modelId` that actually ran, and `inputTokens` /
`outputTokens`. The generation UI reads all of them — token usage and the rejection breakdown were
surfaced in UI-M3 — so a live generator's cost and refusal behaviour become visible on screen the
day it lands, with no UI work.

One design note in the port worth preserving: `GenerationOutput` is a union that can carry questions
**or** one insufficient-evidence result, never both, because that matches a single model call about
one section group. `insufficientSections` exists separately so a generator iterating several sections
reports every section that yielded nothing. The comment states the bug this prevents: collapsing them
would drop the reasons for four sections the moment a fifth succeeded.

---

## 2. Existing deterministic generator — and why it is not a fixture

`createDeterministicGenerator()` is a real generator over real section text. It:

- selects sentences that actually state a rule (`must`, `may`, `requires`, `never`, `only`, …),
  preferring those carrying a quantity, because a threshold yields one right answer and plausible
  wrong ones;
- builds distractors by swapping quantities, modals and actors, **fixing `a`/`an` agreement**
  afterwards so a broken article does not give the answer away;
- returns `null` rather than emitting a near-duplicate option, and reports the section as
  insufficient instead of padding to the requested count;
- applies stage-1 duplicate suppression itself;
- distinguishes *"no four distinct plausible options could be formed"* from *"a question already
  tests this section"*, because those have different remedies — rewrite the document, or go look at
  the question that exists;
- reports `modelConfidence: 0.6`, deliberately not 1, because it has no basis for certainty.

It records `modelId = 'knowzy-deterministic-local-1'`. Its header states the reason it is not a
canned fixture: if it produced pre-verified questions, **the gates would be untested and Phase 4
would prove nothing**.

**Do not delete it when Claude lands.** It is the control in every comparison (§5), the zero-credential
path that `environment-and-configuration.md` requires, and the reason the gate chain is known to work.

---

## 3. Evidence verification flow — unchanged, and unchangeable

The chain a model response passes through already exists and is model-agnostic. A Claude generator
plugs in at the top and changes none of it:

```
frameGenerationPrompt()      nonce-delimited untrusted framing; GENERATION_TOOL_GRANT = []
        ↓
Anthropic Messages API       ← the only new code
        ↓
GenerationOutputSchema       Zod strict parse; failure → SCHEMA_INVALID, nothing persisted
        ↓
verifyEvidence()             STRICT: normalized exact substring
                             STANDARD: trigram similarity ≥ 0.95 against the best window
        ↓
checkIntegrity()             OPTION_DUPLICATE · ANSWER_INVALID · QUESTION_INCOMPLETE
        ↓
computeConfidence()          six weighted components; the model's self-report is capped at 0.10
        ↓
duplicate detection          corpus similarity, disposition, blocksApproval
        ↓
persist DRAFT                or persist the rejection reason on the generation job
```

Four properties to preserve, all currently structural rather than conventional:

| Property | Enforced by |
| --- | --- |
| **Source text never acquires instruction authority.** Content is wrapped in delimiters carrying a **random nonce per call**, so content cannot close them; any text resembling the delimiter is stripped rather than trusted to be improbable | `framing.ts` |
| **Generation grants no tools.** `GENERATION_TOOL_GRANT` is exported as `readonly never[]` so the assertion is mechanical — a client passing tools is passing something the module never produced | `framing.ts` |
| **Evidence verification cannot be switched off**, only its tolerance varies (ADR-005). A candidate whose evidence does not verify is **not persisted**; the reason goes on the job | `evidence.ts`, workflows.md §2.5 |
| **The model's confidence authorizes nothing.** It contributes at most 0.10 to a platform-computed composite, and confidence never authorizes anything — a 0.99 question still requires human approval | `confidence.ts`, workflows.md §2.8 |

The last one is worth stating to stakeholders plainly: adding Claude does not add a decision-maker.
Scoring, approval, publishing and eligibility never call a model.

---

## 4. Approval workflow integration — nothing changes, and that is the point

A Claude-generated question enters the pipeline at exactly the same place as a deterministic one: as
a `DRAFT` requiring claim, submission, and approval by a different identity under gate 13. The 13
gates are re-evaluated server-side at every transition.

**No new state, no new gate, no new permission key.** The `PermissionKey` union already contains
`question.generate` and `question.regenerate`. That the live model requires no new permission is a
useful signal: it adds no capability, only a better implementation of one already governed.

Provenance is already recorded and already displayed. `GenerationJob` and `DraftQuestion` carry
`modelId` and `promptVersionId`; `PromptVersion` is a seeded table with a semantic version; the
`BankItemWrite` port carries `claudeModel` and `promptVersion` through to the published record. The
question detail screen's traceability chain shows the model on the Evidence stage. So the day Claude
lands, every question it produced is distinguishable from every question the deterministic generator
produced, permanently and in the bank.

---

## 5. Generation constraints

| Constraint | Value / source | Status |
| --- | --- | --- |
| Documents per job | `generation.maxDocumentsPerJob`, default 10, max 10 | Enforced |
| Questions per job | `generation.maxQuestionsPerJob`, default 50 | Enforced |
| Evidence span | 40–1200 characters. "Too short is not evidence; too long is not a citation" | Enforced |
| STANDARD similarity floor | 0.95, **not configurable below** — §2.5 fixes it | Enforced |
| Temperature, max output tokens | On the generation profile: `0.2`, `8192` | Stored, **unused by the local generator** |
| Model ID | On the generation profile. Seeded as `claude-sonnet-5` | **Stored and ignored — see §6.1** |
| Prompt version | `PromptVersion`, seeded `1.1.0`, referenced by profile and job | Enforced |
| Per-job token budget, per-tenant daily budget, concurrency cap, 429 backoff | architecture.md §9 | **Not implemented — see §6.2** |
| One bounded repair attempt on malformed output, then fail the item | architecture.md §9 | **Not implemented — see §6.3** |

---

## 6. Four things to get right, three of which are not yet written down

### 6.1 The profile's `modelId` is ignored, and the fix is not just plumbing

The seed sets the generation profile's `modelId` to `'claude-sonnet-5'`. The generator ignores it and
returns its own constant, and `generation-service.ts` records **the value the generator returned** —
so the job honestly says `knowzy-deterministic-local-1`. Audit is correct today.

The trap is in the fix. The obvious implementation gives the Anthropic generator a hardcoded model
constant, which would satisfy the interface, produce correct-looking audit rows, and **still ignore
the profile** — leaving a configured field that appears to control the model and does not. T-30
requires that model IDs are configuration and never hardcoded.

**Decision required:** the Anthropic generator is constructed **with** the profile's model, and
`modelId` on the returned result is that value. **Recommendation:** additionally assert that a job's
recorded `modelId` equals the profile's configured value, so a future hardcoded constant fails the
build. Worth noting: `QuestionGenerator.modelId` is currently a `readonly` property on a singleton,
so this is a small shape change — per-profile construction rather than a module-level instance.

### 6.2 Budgets and concurrency caps are specified and absent

architecture.md §9 requires a per-job token budget, a per-tenant daily budget, a concurrency cap and
429 backoff. None exists, because the local generator costs nothing. `GenerateResult` already reports
`inputTokens` / `outputTokens`, so the measurement is there and the enforcement is not.

**Decision required:** the budget layer lands **with** the Anthropic generator, not after it. A pilot
that can generate without a daily cap is one loop away from a surprising invoice, and the loop does
not have to be malicious — a retry storm on a partially-failing batch is enough.

**Recommendation:** new configuration keys under the existing declared catalogue (`CONFIG_KEYS`, which
already refuses undeclared keys), enforced before the call, with the refusal recorded on the job like
any other rejection so it is visible on the generation screen rather than silent.

### 6.3 The bounded repair attempt is a re-injection surface

architecture.md §9 allows "one bounded repair attempt" on malformed output. Implemented naively — send
the model its own invalid output and ask it to fix it — the repair prompt contains model-generated
text that may itself contain instructions, and the framing guarantees in §3 apply to *source
content*, not to a model's prior turn.

**Decision required:** the repair attempt re-frames the prior output as untrusted data under the same
nonce-delimited discipline, grants no tools, and is **bounded to exactly one** with no recursion.

**Recommendation:** implement repair as a fresh framed call rather than a conversational turn, so
there is no growing transcript and the invariant "content inside the delimiters is data" covers the
model's own output too. Assert that a second repair never occurs.

### 6.4 A pilot needs the comparison, not just the capability

The central unknown is not whether Claude can be called — it is whether the questions are good enough
to put in front of staff. `CLAUDE.md` is blunt about this: question quality "has never been tested
against Claude, which is the product's actual purpose."

**Recommendation:** the first deliverable is a **comparison**, not a feature. Generate from the same
documents with both generators, put both batches in front of an SME **blind to which generator
produced which**, and record the judgement. Both batches pass the same gates, so the comparison
isolates question quality from platform behaviour — and the deterministic generator provides a
genuine baseline rather than a straw man.

This is also how the pilot answers a question it will certainly be asked: *what does the AI actually
add?* An unblinded demo cannot answer it.

---

## 7. Sequencing

[ENTERPRISE_PILOT_READINESS.md](ENTERPRISE_PILOT_READINESS.md) §10 places Claude **last** among the
four integrations: it is the only one gated on an unconfirmed approval, generation quality can only
be judged against real documents, and every gate it must pass already exists and is exercised — so it
is the lowest-risk of the four and benefits least from being early.

The counter-argument is real: quality is the central unknown and discovering it late wastes the
pilot's early months. The answer is **not** to reorder the workstream but to run a **time-boxed
quality spike** in parallel with Entra: implement the `anthropic` generator against the existing
fixtures, generate one batch, run the §6.4 blind comparison. That retires the quality risk in days
without making the pilot's dependency order hostage to a legal review.

The spike still needs T-29, which is why requesting it is a week-0 action.

---

## 8. What a pilot can do if T-29 is refused

Worth stating, because A-05 is *Unconfirmed* and this is the branch nobody plans for.

Every deterministic capability is unaffected: source synchronization, document browsing, **generation
via the deterministic local generator**, preflight governance, review, approval under separation of
duties, publication, assessment, scoring, and audit. The platform is a governed question-authoring
and assessment system without Claude; what it loses is question *quality* at scale and the
deterministic generator's narrow sentence-selection reach.

So the pilot is viable without T-29. It is just not the product. Saying that clearly now is better
than discovering mid-pilot that the business believed Claude was in scope.

---

## 9. Definition of done

The live generator is done when: the Anthropic generator is constructed from the profile's configured
model with the equality assertion in §6.1; budgets, concurrency caps and 429 backoff are enforced and
their refusals visible on the job; the repair attempt is single, re-framed and asserted
non-recursive; the whole existing gate chain passes **unmodified**; a real batch has been generated,
reviewed by a human, approved by a second identity and published; and the §6.4 blind comparison has
been run and recorded.

It is **not** done when Claude returns valid questions. Valid questions that cost an unbounded amount,
or that were produced by a hardcoded model the profile claims to control, would pass a demo and fail
a pilot.
