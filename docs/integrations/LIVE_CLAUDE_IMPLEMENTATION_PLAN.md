# Live Claude Generation — Implementation Plan

**Status:** PLAN ONLY. No code written. No Anthropic SDK is a dependency of any workspace.
**Workstream:** Live Claude Generation, opened 2026-09-22 after PILOT-T1 completed.
**Blocked on:** **T-29** — approval to send question drafts and delimited source excerpts to
Anthropic, recorded as assumption **A-05, confidence *Unconfirmed***. Also **T-28** (an API key in
Key Vault) and **T-30** (model selection and per-environment budgets).

**Relationship to the existing plan.** [`docs/project/integration-plan-claude.md`](../project/integration-plan-claude.md)
is the *integration-level* plan produced in Phase 9.1: what the port is, why the deterministic
generator stays, and where Claude sits in the pilot order. This document is the *implementation-level*
plan: the configuration, the prompt, the money, the attack surface and the measurement. Where the two
touch, that document states the decision and this one states how it is built. Nothing here supersedes
it; §6.1–6.4 there remain the four open decisions and are answered concretely below.

**Companion:** [`LIVE_CLAUDE_EVALUATION_PLAN.md`](LIVE_CLAUDE_EVALUATION_PLAN.md) — the comparison
methodology, which is a separate document because it is a *measurement* commitment and should be
reviewable without reading the build plan.

---

## 1. What the bottleneck actually is

Before planning a replacement it is worth being exact about what the current generator does, because
the published question everyone has now seen is a good worked example.

`KNZ-SUPPORT_OPS-2026-000001` reads:

> **According to "5. Scenario 1 - Single Order Cancellation", which statement is correct?**
> A. Use this scenario when only one job/order needs to be cancelled.
> B. Use this scenario when only three job/order needs to be cancelled.
> C. Use this scenario when in addition to any other case one job/order needs to be cancelled.
> D. Use this scenario when in addition to any other case three job/order needs to be cancelled.

**No model wrote that, and no person wrote it either.** It was assembled by
`packages/claude-services/src/generator.ts`, mechanically, in this order:

| Element | How it was produced |
| --- | --- |
| The stem | A fixed template: `` `According to "${section.label}", which statement is correct?` `` |
| Option A (correct) | The section's own sentence, **copied verbatim** — which is why evidence verification passes exactly |
| Option B | `NUMERIC_SWAPS`: the first quantity, `one` → `three` |
| Option C | `MODAL_SWAPS`: the first modal, `only` → `in addition to any other case` |
| Option D | Both swaps applied to the same sentence |
| The explanation | A fixed template: *"The section … states this rule directly. The other options alter a threshold, a timeframe, or the obligation itself…"* |
| `modelConfidence` | The constant `0.6`, hardcoded, because the generator "has no basis for certainty" |
| Difficulty `RECALL` | Assigned because the sentence contains a quantity |

So the honest description is: **a sentence-matching template engine with a synonym table.** It is a
real generator over real text — it quotes the document and is put through the same gate chain as a
model response, which is why the gates are known to work — but it is not drafting questions in any
sense a subject-matter expert would recognise.

### 1.1 The specific quality defect, stated so it can be measured

Every distractor is a **mutation of the correct answer**, so the four options share almost all of
their words and differ by one substitution. Two consequences:

1. **The correct option is identifiable from form alone.** B says "only three job/order **needs**",
   C and D say "in addition to any other case", which no operational document says. A reader who has
   never seen the SOP can pick A by reading which option is ordinary English. A question that can be
   answered without the source material **does not test the source material**. §8.1 turns this into a
   measurement rather than an assertion.
2. **The platform already knows.** `optionDistinctness()` in `integrity.ts` scores pairwise option
   overlap and feeds 0.20 of the composite confidence. Mutation-built options score *badly* on it by
   construction. The signal exists on every draft and nobody has read it as a batch — §8.2.

### 1.2 And the quantitative limit

`RULE_SIGNAL = /\b(must|may|requires?|never|only|shall|cannot|is refused|is issued)\b/i`

A section yields a question only if it contains a declarative sentence carrying one of those words
from which three distinct distractors can be built. Real support SOPs are **imperative** — *"Click
Retry"*, *"Run the query"*, *"Check the log"*. Measured on the real corpus: **3 accepted questions
from 28 documents, 234 sections, 115 of them assessable, with 106 recorded refusals**
([`PILOT-T1-CORPUS-SELECTION.md`](PILOT-T1-CORPUS-SELECTION.md) §4–5).

**Both problems are in the generator, not the corpus, and not the platform.** That is the whole case
for this workstream, and it is why the deliverable is a comparison and not a feature.

---

## 2. What already exists, and must not be rebuilt

The seam is smaller than it looks. Reading the code rather than the roadmap: the prompt layer, the
schema, the grounding, the scoring and the audit fields were all written *for a model* and are
exercised today by the deterministic generator standing in for one.

| Already built | Where | State |
| --- | --- | --- |
| `QuestionGenerator` port — one interface, one method, `kind: 'deterministic-local' \| 'anthropic'` | `claude-services/src/generator.ts` | `'anthropic'` has **no referent anywhere in the repository** |
| Injection point | `generation-service.ts:179` — `args.generator ?? createDeterministicGenerator()` | Never passed by any API route, so the API always runs deterministic |
| **The Claude system prompt** | `framing.ts` — nonce-delimited untrusted framing, six numbered rules, `GENERATION_TOOL_GRANT = []` | **Written, tested, and already invoked** by the deterministic generator for its token estimate |
| Strict output contract | `output-schema.ts` — Zod `.strict()`, `OUTPUT_SCHEMA_VERSION = '1.0.0'` | Enforced; unknown fields rejected |
| Evidence verification | `evidence.ts` — STRICT exact substring / STANDARD trigram ≥ 0.95 | Enforced, and fired for real once on the pilot corpus |
| Integrity gate | `integrity.ts` — duplicate options, prohibited distractor forms, explanation-restates-answer | Enforced |
| Composite confidence | `confidence.ts` — six weighted components, model self-report capped at 0.10 | Enforced |
| Scope enforcement | `generation-service.ts` rejects a candidate citing a `sectionKey` outside the pinned scope | Enforced |
| Per-question model provenance | `DraftQuestion.modelId`, `.promptVersionId`; `GenerationJob.modelId`; `BankItemWrite.claudeModel` | Columns exist and are written |
| Token accounting | `GenerateResult.inputTokens/outputTokens` → `GenerationJob`, surfaced on the generation screen in UI-M3 | Works; the screen already shows "3,237 in · 40 out" |
| Model knobs | `GenerationProfile.modelId` (seeded `claude-sonnet-5`), `.temperature` (0.2), `.maxOutputTokens` (8192) | **Stored and ignored** |
| Cost column | `GenerationJob.estimatedCost` `Decimal(12,6)` | **Exists and is never written** |

**The new code is one HTTP client and a budget layer.** Everything downstream of the response is
built. That is the good news in this plan, and the reason the risk sits in configuration, cost and
measurement rather than in the pipeline.

---

## 3. Required Anthropic configuration

### 3.1 The model comes from the profile, or the field is decoration

`GenerationProfile` already carries `modelId`, `temperature` and `maxOutputTokens`, and the seed sets
them to `claude-sonnet-5` / `0.2` / `8192`. The deterministic generator ignores all three and returns
its own constant, and `generation-service.ts` records **the value the generator returned** — so today
the job row honestly says `knowzy-deterministic-local-1` and audit is correct.

The trap is the obvious fix. An Anthropic generator with a module-level model constant would satisfy
the interface, produce plausible audit rows, and still ignore the profile — leaving three configured
fields that appear to control the model and do not. **T-30 requires model IDs to be configuration,
never hardcoded.**

**Decision.** `createAnthropicGenerator({ modelId, temperature, maxOutputTokens, … })` is constructed
**per profile, per job**, from the profile row. `QuestionGenerator.modelId` is currently a `readonly`
property on a module singleton, so this is a shape change: per-job construction rather than a shared
instance.

**Build gate.** Assert that a completed job's recorded `modelId` equals the profile's configured
`modelId`. A future hardcoded constant then fails the test suite rather than quietly producing
mislabelled provenance. This follows the house pattern: turn the prose rule into a gate.

### 3.2 The recorded prompt version is not the prompt that would be sent

A finding from reading the seed against `framing.ts`, and the one item in this plan that is a
**correctness** problem rather than a missing feature.

`PromptVersion` is immutable after creation, seeded as `1.1.0`, referenced by both the profile and
every job, and documented as the row that makes a job reproducible and lets yield analytics compare
versions. Its `body` column holds a **hand-written paraphrase** of the generation rules
(`packages/database/prisma/seed.ts`, ~line 222). The prompt that `framing.ts` actually builds is a
**different text** with the same intent, assembled in code at call time.

Two texts, one meaning, **no mechanical link between them.** Today this is harmless: the deterministic
generator never reads the prompt, so no question was produced by a body that disagrees with the
record. The moment a model reads the framed prompt, *"this question was generated under prompt
version 1.1.0"* becomes a claim about a body that was never sent — and the immutability of the table,
which exists to make the claim trustworthy, makes the wrong body permanent.

**Decision.** The recorded body must be **derived from the code that builds it**, not written
alongside it. Concretely: `frameGenerationPrompt` with a fixed test nonce (it already accepts one as a
declared test seam) is the single source; the seed records that output and its hash.

**Build gate.** A contract test that the seeded body's hash equals the framing output for the fixed
nonce — the same shape as the existing `outputSchemaHash` and the G6 codegen contract. Editing the
system prompt then *forces* a new `PromptVersion`, which is exactly the governance the immutable
table was designed for.

**Also required:** a new `PromptVersion` for the live generator regardless, because §5.1 adds
instructions the deterministic generator never needed. Same `promptKey`, bumped `semanticVersion`;
never an edit to `1.1.0`.

### 3.3 Anthropic request parameters

| Parameter | Value | Source |
| --- | --- | --- |
| `model` | Profile `modelId`. Seeded `claude-sonnet-5` | Configuration (T-30) |
| `max_tokens` | Profile `maxOutputTokens`, 8192 | Configuration |
| `temperature` | Profile `temperature`, 0.2 | Configuration. Low deliberately: question drafting is an extraction task, not a creative one, and a reproducible job is a governance requirement |
| `system` | `framedPrompt.system` | `framing.ts`, unchanged |
| `messages` | One user turn: `framedPrompt.user` | `framing.ts`, unchanged |
| `tools` | **Absent.** `GENERATION_TOOL_GRANT` is `readonly never[]` | `framing.ts` — see §7.2 |
| `stop_sequences` | None | Truncation is detected from `stop_reason`, not guessed |
| `stream` | No, for v1 | A generation job is already asynchronous with a job row; streaming adds partial-output handling for no user-visible gain |
| Retries | Bounded, idempotent, on 429/5xx only | §6.4 |

**`temperature: 0.2` is a claim the pilot should verify rather than assume.** It is the right default
for extraction, but if the observed failure mode is dull or repetitive questions, temperature is the
first knob — and because it is on the profile, changing it is a configuration change with an audit
trail, not a deployment.

---

## 4. Required environment variables

### 4.1 What exists, and the blocker inside it

`ANTHROPIC_API_KEY_REF` is **already declared** in `packages/configuration/src/env.ts`:

```ts
{
  name: 'ANTHROPIC_API_KEY_REF',
  deployables: ['api', 'jobs'],
  schema: secretRef,
  requiredIn: DEPLOYED,
  description: 'A Key Vault reference. With it absent, local uses a recorded-response stub.',
}
```

`secretRef` requires the form `keyvault://{vault}/secrets/{name}` and its message is explicit — *"must
be a `keyvault://…` reference, never a secret value"*. Two tests in `startup.test.ts` assert that a
raw `sk-ant-…` value is **refused at startup**.

**So the key cannot simply be pasted into `.env` to try this out**, and that is the correct behaviour,
not an obstacle to remove. It does mean a decision is required before any code runs:

| Option | Assessment |
| --- | --- |
| Relax `secretRef` to accept a raw key in `local` | **Rejected.** It weakens the one control that keeps secrets out of environment variables and configuration dumps, for a convenience |
| A local secret **resolver** that reads `keyvault://local/secrets/{name}` from an operator-provided file outside the repository | **Recommended.** The reference stays a reference, the resolution strategy varies by environment, and the existing `keyVault()` startup probe already models exactly this |
| Run the spike against a real Key Vault | Correct for deployment; needs Azure access this project does not have (see [`ACCESS_DISCOVERY_REPORT.md`](ACCESS_DISCOVERY_REPORT.md)) |

The file-backed resolver must be `.gitignore`d, read at startup only, never logged, and never echoed
by the configuration endpoints. Content rule **C3** already confines `process.env` reads to
`@knowzy/configuration`, so there is exactly one place this can be implemented.

### 4.2 New variables and configuration keys

| Name | Kind | Deployables | Default | Purpose |
| --- | --- | --- | --- | --- |
| `ANTHROPIC_API_KEY_REF` | env, **exists** | api, jobs | — | Key reference |
| `ANTHROPIC_BASE_URL` | env, **new** | api, jobs | Anthropic default | Only for a tenant-mandated gateway or proxy. Declared rather than assumed, so a proxy is visible in configuration |
| `ANTHROPIC_LOCAL_SECRET_FILE` | env, **new**, local only | api, jobs | unset | The §4.1 resolver. Absent ⇒ deterministic generator |
| `llm.activeProvider` | config key, **implemented** | — | `DETERMINISTIC_LOCAL` | Which generator runs. The switch is **configuration with an audit trail**, not a build flag, so a pilot can be turned off without a deploy |
| `llm.perJobTokenBudget` | config key, **implemented** | — | 60000 | §6.1 |
| `generation.maxOutputTokensPerJob` | config key, **new** | — | 8192 | §6.1 |
| `llm.dailyTokenBudget` | config key, **implemented** | — | 500000 | §6.2 |
| `llm.concurrency` | config key, **implemented** | — | 1 | §6.3 |
| `generation.pricePerMillionInputTokens` | config key, **new** | — | 0 | §6.5 |
| `generation.pricePerMillionOutputTokens` | config key, **new** | — | 0 | §6.5 |

All configuration keys go in the declared catalogue `CONFIG_KEYS`
(`packages/configuration/src/keys.ts`), which refuses undeclared keys, with `layers` and `scopes` set
as the existing generation keys are — `PLATFORM_ONLY` for anything that bounds spend, so a profile
cannot raise its own budget.

**`llm.activeProvider` deserves emphasis.** The natural implementation is "if a key is present,
call Claude". That makes the presence of a credential the switch, which means a key rotation or a Key
Vault misconfiguration silently changes which generator produced a question. An explicit declared
key, resolved through the audited configuration layer, keeps *which generator ran* a deliberate
recorded decision — and `modelId` on the job is then a cross-check rather than the only record.

---

## 5. Prompt architecture

### 5.1 The prompt is written; this is what changes

`frameGenerationPrompt()` already produces the system prompt, the user turn, the nonce and the empty
tool grant. It needs three additions and no rewrites:

1. **Output shape instruction.** The system prompt says "Return JSON only, matching the provided
   schema" but no schema is transmitted. **Decision:** emit the JSON shape explicitly in the system
   prompt, generated from `GeneratedQuestionSchema` rather than hand-written, so the instruction and
   the validator cannot drift — the same principle as §3.2. A hand-copied shape in a prompt is a
   second source of truth for the contract.
2. **A per-section budget.** The deterministic generator stops at `requestedQuestionCount`; a model
   given 93 sections will attempt many. The prompt must state `maxQuestionsPerSection` (a profile
   field, default 5) and the overall requested count, because a 40-question response to a 6-question
   request costs money and is then partly thrown away by the per-section cap in
   `generation-service.ts`.
3. **The insufficiency instruction, strengthened.** Rule 5 already forbids padding. For this corpus
   it is *the* rule that matters: an imperative runbook section genuinely has nothing testable, and a
   model that invents a plausible threshold will be caught by evidence verification and counted as a
   rejection. Worth stating in the prompt that returning `insufficientEvidence` is a **success**, not
   a failure — the schema already treats it that way.

### 5.2 Call granularity — a cost and quality decision

| Shape | Cost | Quality | Verdict |
| --- | --- | --- | --- |
| One call per job, all sections | Cheapest — one system prompt | Model chooses which sections are worth testing, which is arguably the point; but long inputs dilute attention and one malformed response loses the whole job | **Recommended for v1** |
| One call per section | ~93× the system-prompt overhead on the pilot corpus | Focused; a bad response loses one section | Fallback if v1 output quality is poor |
| One call per document | Middle | Natural coherence boundary; matches how `insufficientSections` is reported | Recommended if v1 is too diluted |

Start with one call per job, measure, and treat granularity as a tuning lever for the evaluation
rather than a decision to make in advance. The `insufficientSections` field on `GenerateResult`
already exists precisely so a generator that iterates can report per-section outcomes — the port
supports all three shapes without change.

### 5.3 What must not go in the prompt

- **No permission, policy or identity context.** Authorization is server-side and never delegated to
  a model.
- **No local filesystem paths.** PILOT-T1 established that no local path may reach any emitted
  artifact; a prompt is an emitted artifact.
- **No tenant hostname** (content rule **C2**).
- **No other learner's or author's data.** Generation reads document sections and existing question
  *stems* only.

---

## 6. Cost controls

> **Configuration naming reconciled 2026-09-24.** This section named four keys that did not exist
> (`generation.generatorKind`, `generation.maxInputTokensPerJob`, `generation.dailyTokenBudget`,
> `generation.maxConcurrentModelCalls`) while `CONFIG_KEYS` already declared
> `llm.perJobTokenBudget`, `llm.dailyTokenBudget` and `llm.concurrency`. **The declared keys win and
> the plan is corrected** — a second family of names for the same ceilings is how two budgets end up
> half-enforced. The provider switch is `llm.activeProvider`, in the same family. All are implemented
> and enforced as of the AI Generation Control Layer milestone.

`architecture.md` §9 requires a per-job token budget, a per-tenant daily budget, a concurrency cap and
429 backoff. ~~**None of it exists**, because the local generator costs nothing.~~ **All of it exists
as of 2026-09-24**, provider-independent, enforced on every provider including the deterministic one,
and validated against it — so the first real provider inherits its ceilings rather than introducing
them. What follows is the design as built; the sub-sections state where reality differs.

~~**These land with the generator, in the same milestone, not after it.**~~ **They landed BEFORE it**,
which is strictly better: the controls were validated against a provider that cannot send a request
anywhere, so the day a credential arrives the ceilings are already proven rather than newly written.
A pilot that can generate without a daily cap is one loop away from a surprising invoice, and the
loop need not be malicious — a retry storm on a partially-failing batch is enough.

### 6.1 Per-job budget — enforced before the call

Estimate input tokens from the framed prompt before sending (`framing.ts` already does this
arithmetic for its token estimate) and refuse the job if it exceeds
`llm.perJobTokenBudget`. **The refusal is recorded on the job like any other rejection**, so
it appears on the generation screen with a reason instead of failing silently — the screen already
renders rejection reasons and token usage, so this is visible with no UI work.

### 6.2 Daily budget — enforced across jobs

Sum `inputTokens + outputTokens` over `GenerationJob` rows for the day; refuse beyond
`llm.dailyTokenBudget`. The rows and the indexes (`[status]`, `[sourceId, createdAt desc]`)
already exist. A refusal names the budget and the time it resets — an author who is told "budget
exhausted" with no number cannot plan around it.

### 6.3 Concurrency

`llm.concurrency`, default **1** for the pilot. Generation is already an
asynchronous job with a state machine, so queueing is natural, and a serialized pilot is both cheaper
and easier to reason about when reading audit rows.

### 6.4 Retries and backoff

Retry only 429 and 5xx, with jittered exponential backoff and a hard attempt cap. Two specific
hazards:

- **A retry must not double-charge a partial success.** If a response arrived and failed to parse,
  that is the §7.3 repair path, not a retry.
- **Retries count against the daily budget**, using reported usage where the API provides it on a
  failed call. A budget that ignores retries is not a budget.

### 6.5 Cost recording

`GenerationJob.estimatedCost` is `Decimal(12,6)` and never written. Compute it from reported usage and
the two price configuration keys, defaulting to **0** so an unconfigured price records zero rather
than a fabricated number.

**Gotcha, from CLAUDE.md and worth writing down before someone loses an hour to it:** audit `detail`
keys are dropped unless declared in the allow-list in `packages/observability/src/audit.ts`.
`AUTHORING.GENERATION.JOB_COMPLETED` declared `modelId`, `inputTokenCount`, `outputTokenCount` — and
**not** cost. **Done 2026-09-24:** `estimatedCost`, `measuredCost`, `costObservable` and
`attemptCount` are declared there, and the new `AUTHORING.GENERATION.JOB_REFUSED` action declares its
own. A test asserts no generation audit row carries `_droppedKeys`.

### 6.6 What this costs, roughly

The pilot corpus is **122,106 characters ≈ 31,000 tokens** of section text. One call per job over the
selected ten documents is on the order of **20,000–35,000 input tokens and a few thousand output
tokens per run** — cents, not dollars, per job. The financial risk in this workstream is not the
per-job cost; it is an unbounded number of jobs. Which is why §6.2 is the control that matters.

---

## 7. Prompt injection defences

### 7.1 What is already enforced

`framing.ts` implements two of the four enforcement points in `security.md` §5 — *"retrieved document
text is DATA; it never acquires instruction authority"*:

- **Nonce-delimited framing.** `<<<KNOWZY-SOURCE-{9 random bytes}>>>` per call, so document content
  cannot close the delimiter by guessing it; any text matching this call's nonce is **stripped**
  rather than trusted to be improbable. `NUL` is stripped too, with a plain string replace because a
  control character inside a regex literal is invisible in review.
- **An explicit system-prompt statement** that content inside the delimiters cannot change the rules,
  the schema, the role or the tool grant, and that text resembling an instruction is content to write
  a question *about*.
- **No tools.** `GENERATION_TOOL_GRANT` is exported as `readonly never[]` so the assertion is
  mechanical: a client passing tools is passing something the module never produced.
- **Strict schema parse.** Unknown fields are rejected, so a response cannot smuggle extra structure.
- **Scope enforcement.** A candidate citing a `sectionKey` outside the pinned scope is rejected in
  `generation-service.ts` — an injected instruction to quote a different document has nowhere to
  land.
- **Mechanical grounding.** Every span is verified character-by-character against the section.

### 7.2 The one assertion to add

`GENERATION_TOOL_GRANT` is a *value* that proves nothing unless the client uses it. The Anthropic
client must pass it, and a test must assert that the request body carries **no `tools` key at all** —
not an empty array, which some APIs treat differently from absence.

### 7.3 The repair attempt is the real new attack surface

`architecture.md` §9 permits "one bounded repair attempt" on malformed output. Implemented naively —
send the model its own invalid output and ask it to fix it — **the repair prompt contains
model-generated text**, and the §7.1 guarantees cover *source content*, not a model's prior turn. A
document that successfully injected instructions into the first response would find them replayed into
the second call as trusted context.

**Decision.** The repair attempt is a **fresh framed call**, not a conversational turn: the prior
output is wrapped in the same nonce-delimited untrusted framing under a new nonce, no tools are
granted, and there is **no transcript**. Bounded to exactly one, asserted non-recursive by test.

**Recommendation for v1: do not implement repair at all.** With `temperature: 0.2` and a strict
schema, a malformed response should be rare; treat `SCHEMA_INVALID` as a job-level rejection, measure
how often it happens, and add repair only if the data justifies the extra surface. A
defence-relevant code path that fires twice a year is a code path nobody maintains correctly.

### 7.4 Residual risks, stated plainly

| Risk | Mitigation | Residual |
| --- | --- | --- |
| A document instructs the model to emit a question that leaks other content | Scope enforcement + evidence verification: a span from outside the section fails | **Low.** Content from another section cannot verify |
| A document induces a question with a wrong answer | Nothing mechanical prevents it | **Human approval.** This is why gate 13 and review exist; also §7 of the evaluation plan |
| The response contains prompt-injection text as *question text* | Integrity gate does not scan for it | **Reviewer.** Worth adding a cheap scan for imperative meta-language in question text, but not a blocker |
| A model self-report inflates confidence | Capped at 0.10 of a platform-computed composite | **Structural.** Confidence authorizes nothing regardless |
| The pilot corpus contains injected content | Internal SOPs authored by the support team | **Low today, rises the day uploads are user-facing** |

---

## 8. Quality-evaluation strategy

Full protocol in [`LIVE_CLAUDE_EVALUATION_PLAN.md`](LIVE_CLAUDE_EVALUATION_PLAN.md). Two mechanical
measurements belong here because they are properties of the *implementation* and can be built as
gates.

### 8.1 The blind-stem test — the cheapest honest quality measure available

Present the question and its four options **without the source document** to someone who has not read
the SOP, and ask them to pick the answer.

- If they score at chance (25%), the question requires the document. Good.
- If they score well above chance, the question is answerable from form or general knowledge, and it
  **is not testing the SOP** whatever its evidence span says.

§1.1 predicts the deterministic generator fails this badly, because its distractors are mutations of
the correct answer. **That prediction should be tested before Claude is called**, so the baseline is a
measured number rather than an argument. It needs no API key, no approval and no code — it is the one
piece of this workstream that can run today.

### 8.2 Read the confidence components that already exist

Every draft stores `confidenceComponents` — the six weighted values behind its score.
`optionDistinctness` is 0.20 of it and is exactly the property §1.1 describes. Nobody has looked at
these as a batch.

**Recommendation:** aggregate the component breakdown across all existing drafts, published questions
included, and record it as the deterministic baseline. Two facts follow immediately: whether the
platform's own confidence signal already knew the questions were weak, and whether the signal is
trustworthy enough to use as a screening metric for Claude output. If the platform scored these
questions highly, that is a finding about the *confidence formula* and needs fixing before it is used
to judge anything.

---

## 9. Comparison methodology

Stated in full in the evaluation plan; the constraints the implementation must satisfy:

1. **Both generators run through the identical gate chain.** No special-casing, no relaxed
   thresholds, no separate code path. The comparison then isolates question quality from platform
   behaviour.
2. **The deterministic generator is the control and is never deleted.** It is the zero-credential path
   `environment-and-configuration.md` requires, the reason the gates are known to work, and a genuine
   baseline rather than a straw man.
3. **The same pinned scope.** `GenerationJob.resolvedSectionKeys` makes a job reproducible; both runs
   must cite the same section keys or the comparison is confounded by document selection.
4. **The SME is blind to which generator produced which question.** The review queue shows `modelId`
   on the traceability chain, so blinding requires an export, not the live UI. Unblinded, the
   evaluation cannot answer the question the pilot will certainly be asked: *what does the AI actually
   add?*
5. **The decision rule is pre-registered.** Written down before any Claude output is seen.

---

## 10. Sequencing, and what can start before T-29

| # | Step | Needs T-29 | Needs a key |
| --- | --- | --- | --- |
| 1 | §8.1 blind-stem test on the 3 published questions; §8.2 confidence-component aggregate | No | No |
| 2 | §3.2 prompt-version fix + contract gate | No | No |
| 3 | Budget, concurrency and cost layer (§6), with the deterministic generator reporting into it | No | No |
| 4 | Local secret resolver (§4.1) | No | No |
| 5 | The Anthropic client + per-profile construction (§3.1) behind `llm.activeProvider` | **Yes** | **Yes** |
| 6 | The blind comparison on the real corpus | **Yes** | **Yes** |

**Steps 1–4 are the majority of the work and none of them is blocked.** Step 1 is a morning's work and
produces the baseline everything else is measured against. Requesting T-29 and T-28 is a week-0
action, in parallel — [`TENANT_ADMIN_REQUESTS.md`](TENANT_ADMIN_REQUESTS.md) is the vehicle and does
not currently include them.

---

## 11. Definition of done

The live generator is done when **all** of these hold:

- [ ] The Anthropic generator is constructed from the profile's `modelId`, `temperature` and
      `maxOutputTokens`, with the §3.1 equality assertion in the test suite
- [ ] The recorded `PromptVersion.body` is derived from `framing.ts` and guarded by the §3.2 contract
      test; a new semantic version exists for the live prompt
- [ ] Per-job and daily token budgets, the concurrency cap and 429 backoff are enforced, and their
      refusals are visible on the generation screen as rejections
- [ ] `estimatedCost` is written, and its audit key is declared in the allow-list
- [ ] The request carries no `tools` key, asserted by test
- [ ] Repair is either absent or single, re-framed and asserted non-recursive
- [ ] The entire existing gate chain passes **unmodified** — no threshold moved to accommodate model
      output
- [ ] `llm.activeProvider` switches generators through configuration, with an audit record
- [ ] A real batch has been generated from the real corpus, reviewed by a human, approved by a second
      identity under gate 13, and published
- [ ] The blind comparison has been run and recorded against the pre-registered decision rule

It is **not** done when Claude returns valid questions. Valid questions that cost an unbounded amount,
or that were produced by a hardcoded model the profile claims to control, or whose recorded prompt
version points at a body that was never sent, would pass a demo and fail a pilot.

---

## 12. Traceability

| This document | Source |
| --- | --- |
| §1 generator behaviour | `packages/claude-services/src/generator.ts`, read 2026-09-22 |
| §1.2 yield | [`PILOT-T1-CORPUS-SELECTION.md`](PILOT-T1-CORPUS-SELECTION.md) §4–5, [`CorpusManifest.md`](../../RealWorldPilot/CorpusManifest.md) §4 |
| §2 existing surface | `claude-services/src/*`, `packages/domain/src/generation/generation-service.ts`, `packages/database/prisma/schema.prisma` §5 |
| §3.1 model configuration | `schema.prisma` `GenerationProfile`; T-30 |
| §3.2 prompt version | `schema.prisma` `PromptVersion`; `packages/database/prisma/seed.ts`; `framing.ts` |
| §4 environment | `packages/configuration/src/env.ts`, `keys.ts`, `startup.test.ts` |
| §6 cost | `architecture.md` §9; `schema.prisma` `GenerationJob`; `packages/observability/src/audit.ts` |
| §7 injection | `security.md` §5; `framing.ts` |
| T-28 / T-29 / T-30 / A-05 | [`assumptions-and-tenant-configuration.md`](../assumptions-and-tenant-configuration.md) |
| Integration-level decisions | [`integration-plan-claude.md`](../project/integration-plan-claude.md) §6 |
