# Multi-Provider Generation Architecture

**Status:** DESIGN, partly built. The port, catalogue, registry and control layer were built
2026-09-24 (architecture.md §9.0). **2026-09-27, OPENAI-CODEX-00:** OpenAI (Codex) — the first
provider in the agreed order (OpenAI Codex, then Claude, then Copilot, then Azure OpenAI) — is
registered with a **readiness** client (§9.0 rules 9 and 10), and since **OPENAI-CODEX-01** with a
**generation** client (rule 11) — refused until T-29 is recorded, and not yet run against a real
endpoint. Results: [OPENAI_CODEX_EVALUATION_RESULTS.md](OPENAI_CODEX_EVALUATION_RESULTS.md).
**Supersedes nothing.** [`LIVE_CLAUDE_IMPLEMENTATION_PLAN.md`](LIVE_CLAUDE_IMPLEMENTATION_PLAN.md)
remains the build plan for the Anthropic provider; this document is the frame it plugs into.
**Companion:** [`LIVE_CLAUDE_EVALUATION_PLAN.md`](LIVE_CLAUDE_EVALUATION_PLAN.md) §11 extends the
comparison to N arms.

---

## 0. Read this first: three findings that change the shape of the work

This design is not a neutral abstraction exercise. Grounding it in the repository turned up three
things that determine what is buildable, and one of them inverts the brief's assumption.

### 0.1 "User Managed" cannot mean the same thing for every provider

The brief gives two examples — *"Reuben's Claude account"* and *"Reuben's Microsoft Copilot
entitlement"* — and they are **not the same kind of thing**.

| Provider | Is there a delegated, per-user execution path? | What "user managed" can actually mean |
| --- | --- | --- |
| **Microsoft Copilot** | **Yes.** Microsoft 365 Copilot is licensed per user and its APIs are reached with **delegated** Entra tokens, so the platform can act *on behalf of* the signed-in author against that author's own entitlement | Genuine user-managed execution. The author's licence is consumed, the author's tenant policy applies |
| **Azure OpenAI** | **Yes**, via Entra on-behalf-of against a resource the user is entitled to | Genuine user-managed execution |
| **Anthropic Claude** | **No.** There is no on-behalf-of flow, and a **claude.ai subscription is not an API credential** | Only "the author supplies a personal API key", which is a *different entitlement* they must obtain separately — and which the platform would then have to store |
| **Gemini** | Partially, via Google identity federation; not available in this tenant | Deferred |

**So the naive expectation is backwards.** Copilot is the provider where user-managed is *native*;
Claude is the provider where it is *not possible* in the sense the brief means. Designing as though
"user managed" were a uniform switch would produce a UI offering something Anthropic cannot do.

**Recommendation: v1 supports user-managed execution ONLY where a delegated token flow exists.**
Anthropic is platform-managed only. §4.4 explains why holding per-user API keys is the wrong first
move rather than merely a later one.

### 0.2 A provider that does its own retrieval cannot be used for grounded generation

This is the hard capability constraint, and it is specifically about Copilot.

The platform's entire grounding guarantee is that a question is answerable from **one supplied
section** and cites a span verified character-by-character against **that section's text**
(`workflows.md` §2.5, enforced in `evidence.ts`). Microsoft 365 Copilot is designed to ground its
answers in the user's Microsoft Graph content — mail, files, chats, sites — which is the opposite
property.

Two failure modes follow, and only the first is safe:

1. **Copilot quotes something Graph supplied.** Evidence verification refuses the candidate, because
   the span is not in the section. Safe, and the batch yields nothing.
2. **Copilot writes a question shaped by Graph content while quoting the section.** The span verifies,
   scope enforcement passes because the `sectionKey` is in scope, and the question tests knowledge
   the author never selected — possibly from a document the learner has no right to see. **Nothing
   in the current gate chain detects this.**

The second is a confidentiality problem, not merely a quality one.

**Therefore: `retrievalFree` is a declared, asserted provider capability, and a provider that cannot
guarantee retrieval-free execution is not eligible for grounded generation at all.** This mirrors
adapter template rule **P1** — *"emulating a capability is a contract violation"* — and it is the
single most important control this architecture adds. If Copilot cannot be invoked in a mode that
disables Graph grounding, then **Copilot is not a generation provider for this platform**, and the
honest answer is to say so rather than ship it and hope.

That question is a **prerequisite investigation**, not an implementation detail. §12 puts it first.

### 0.3 Multi-provider contradicts the current architecture specification

`docs/architecture.md` is explicitly single-provider:

- §9 is titled **"Claude integration architecture"**
- the technology table names *"Claude via the Anthropic Messages API"* as **the** LLM
- the C4 container diagram has an **`Anthropic`** subgraph with a single `Claude API` node
- the data-flow table has one row for **`API → Claude`**
- the package is **`@knowzy/claude-services`**, and boundary rule B4 names it

CLAUDE.md is unambiguous that where it and `/docs` disagree, **`/docs` wins**. A design document in
`docs/integrations/` cannot quietly overrule the architecture specification.

**So this document is a proposal, and it has a precondition.** Before any provider code is written,
`architecture.md` must be amended — a deliberate decision with a visible diff, which is how this
project already treats role definitions and configuration. §12 step 0 lists exactly which sections
change. Writing the code first would leave the authoritative document describing a system that no
longer exists, which is the same class of error as `PromptVersion.body` holding a paraphrase.

---

## 1. Provider registry architecture

The pattern already exists twice in this codebase and should be followed rather than reinvented:
`createAdapterRegistry` for knowledge sources, and the Question Bank port. Both share four
properties worth copying exactly.

| Property | Why it matters here |
| --- | --- |
| **Registration is explicit and closed.** An unregistered id resolves to a refusal, never a fallback | A misconfigured provider must fail loudly. `NoAdapterRegisteredError` is the precedent: *"registering a stand-in that returned fixture data would make a misconfigured production source look like a working one"* |
| **Capabilities are declared, not inferred** | §0.2. A provider states what it can do and the platform refuses what it cannot |
| **Environment prohibitions are enforced at construction** | The mock adapters refuse to exist outside `local`; a provider whose credential is absent must not silently become a different provider |
| **One registry, resolved per job** | The generator is already constructed per job (implementation plan §3.1), so per-job provider resolution adds no new shape |

```
createGeneratorRegistry({ environment, credentials, repoRoot })
  ├── 'deterministic-local'   always registered, needs nothing
  ├── 'anthropic'             platform-managed only (§0.1)
  ├── 'microsoft-copilot'     eligible only if retrievalFree can be asserted (§0.2)
  ├── 'azure-openai'          declared, unregistered until Phase 9+
  └── 'gemini'                declared, unregistered
        ↓
  forJob(profile, executionMode, subject) → GenerationProvider
        ↓
  refuses with a NAMED error when the provider is unregistered, the mode is
  unsupported, the credential is missing, or the capability is absent
```

**The deterministic generator stays registered in every environment, forever.** It is the
zero-credential path `environment-and-configuration.md` requires, the control in every comparison,
and the reason the gate chain is known to work. Multi-provider must not make it optional.

---

## 2. Provider interfaces

### 2.1 What exists, and the minimum change

```ts
// packages/claude-services/src/generator.ts, today
export interface QuestionGenerator {
  readonly kind: 'deterministic-local' | 'anthropic';
  readonly modelId: string;
  generate(args: GenerateArgs): Promise<GenerateResult>;
}
```

`kind` has exactly **two referents in the whole repository** — the declaration and the deterministic
generator — so widening it is cheap. `GenerateResult` already carries `output`,
`insufficientSections`, `modelId`, `inputTokens` and `outputTokens`, which is most of what a
provider must report.

### 2.2 The proposed interface

```ts
export type ProviderId =
  | 'deterministic-local'
  | 'anthropic'
  | 'microsoft-copilot'
  | 'azure-openai'
  | 'gemini';

export type ExecutionMode = 'PLATFORM_MANAGED' | 'USER_MANAGED';

export interface ProviderCapabilities {
  /**
   * The provider performs NO retrieval of its own: it sees only what the
   * prompt contains. Declared honestly; a provider that cannot guarantee this
   * is ineligible for grounded generation (§0.2).
   */
  readonly retrievalFree: boolean;
  readonly supportedExecutionModes: readonly ExecutionMode[];
  /** Whether the provider returns real token counts, or they are estimated. */
  readonly reportsTokenUsage: boolean;
  /** Whether a per-call monetary cost is observable AT ALL (§6). */
  readonly reportsCost: boolean;
  /** Whether the provider can be constrained to emit only the output schema. */
  readonly supportsStructuredOutput: boolean;
  /** Tools granted. MUST be empty for generation — framing.ts asserts it. */
  readonly grantsTools: false;
  readonly maxInputTokens: number;
}

export interface GenerationProvider {
  readonly providerId: ProviderId;
  readonly capabilities: ProviderCapabilities;
  /** Resolved from the profile, never hardcoded (T-30). */
  readonly modelId: string;
  /** The provider's own version string, for provenance (§8). */
  readonly providerVersion: string;
  generate(args: GenerateArgs, context: ExecutionContext): Promise<GenerateResult>;
}

export interface ExecutionContext {
  readonly mode: ExecutionMode;
  /** WHOSE entitlement is consumed. Required in USER_MANAGED. */
  readonly onBehalfOfUserId: string | null;
  readonly correlationId: string;
  readonly signal: AbortSignal;
}
```

`GenerateResult` gains three fields: `providerId`, `providerVersion`, and
`usage: { inputTokens, outputTokens, reported: boolean }` — where `reported: false` means the counts
are the platform's own estimate, so a cost computed from them is an estimate of an estimate and must
be labelled as one.

**`QuestionGenerator` should be retained as a deprecated alias** during the transition, because the
deterministic generator, its tests, and `generation-service.ts` all reference it and there is no
reason to break them in the same change that adds a provider.

### 2.3 The package name problem

`@knowzy/claude-services` becomes a misnomer the moment a second provider lands, and boundary rule
**B4** names it. Two options:

| Option | Assessment |
| --- | --- |
| Keep the name; add providers inside it | Cheapest. Leaves a package called `claude-services` containing a Copilot client, which is the kind of small dishonesty that compounds |
| Rename to `@knowzy/generation-services`, keep the boundary rule pointing at the new name | **Recommended.** One mechanical rename, done once, while the package has one real implementation. It gets harder every release |

---

## 3. Execution modes

### 3.1 The two modes, and what actually differs

| | Platform managed | User managed |
| --- | --- | --- |
| **Credential** | Platform-owned, from Key Vault via `*_API_KEY_REF` | Delegated Entra token for the signed-in author (OBO) |
| **Whose entitlement** | The platform's | **The author's licence or quota** |
| **Cost visibility** | Observable and attributable | **Not observable** (§6.2) |
| **Tenant policy** | The platform's configuration | The **author's** tenant policy, DLP and data-residency terms apply |
| **Availability** | Uniform for every author | Depends on the author holding a licence |
| **Audit** | Platform is the actor | Platform is the actor, the **author is the principal whose entitlement was spent** — both recorded |
| **Providers in v1** | Anthropic, deterministic | Copilot, Azure OpenAI (subject to §0.2) |

### 3.2 Mode resolution, and the refusals

Resolution order, each step refusing rather than falling back:

1. The generation profile names a `providerId` and a `defaultExecutionMode`.
2. An author may choose a different **registered** provider they are entitled to (§5).
3. The requested mode is checked against `capabilities.supportedExecutionModes`.
   → `PROVIDER_MODE_NOT_SUPPORTED`
4. `USER_MANAGED` requires a delegated token for the author.
   → `USER_ENTITLEMENT_UNAVAILABLE`
5. `PLATFORM_MANAGED` requires the platform credential to resolve.
   → `PROVIDER_CREDENTIAL_UNAVAILABLE`
6. Grounded generation requires `capabilities.retrievalFree`.
   → `PROVIDER_NOT_GROUNDING_SAFE`

**No step falls back to another provider or another mode.** A silent downgrade from user-managed to
platform-managed would spend the platform's money while the provenance says otherwise; a silent
downgrade to the deterministic generator would put a template-engine question in a batch an author
believes a model wrote. Both are worse than a refusal an author can read.

Each refusal is a declared `ErrorCode` — which requires `npm run codegen`, or the contract check
(G6) fails the build.

### 3.3 One thing user-managed mode does NOT change

**Authorization.** The author's provider entitlement decides *whose quota is spent*. It does not
decide what they may do in Knowzy. `question.generate` is still required, the domain scope still
applies, and holding a Copilot licence grants nothing in this platform. These are separate systems
and conflating them would be a privilege-escalation path.

---

## 4. Security model

### 4.1 What is unchanged, and must stay unchanged

Everything in `framing.ts` and `evidence.ts` is provider-agnostic and applies identically:

- **Nonce-delimited untrusted framing.** Random per call, stripped from content, with the
  system-prompt statement that content cannot alter rules, schema, role or tools.
- **`GENERATION_TOOL_GRANT` is empty**, and `capabilities.grantsTools` is typed `false` so a
  provider cannot declare otherwise.
- **Strict schema parse**; unknown fields rejected.
- **Scope enforcement**; a candidate citing a `sectionKey` outside the pinned scope is rejected.
- **Mechanical grounding**; every span verified character-by-character.
- **The model's confidence authorizes nothing** — capped at 0.10 of a platform-computed composite.

**Adding providers adds no decision-maker.** Scoring, approval, publishing and eligibility never
call a model, whichever provider produced the draft.

### 4.2 What is new

| Surface | Control |
| --- | --- |
| **Per-provider credentials** | One `*_API_KEY_REF` per provider, `secretRef`-shaped (`keyvault://` only), declared in the env catalogue. Readable only by the deployables that call the provider — the pattern **C6** already establishes for the Graph credential |
| **Delegated tokens** | Acquired per request, never persisted, never logged, never written to audit detail. Scoped to the minimum the provider requires |
| **Cross-provider prompt leakage** | A prompt built for one provider must not be replayed to another on failure. A retry is same-provider or it is a new job |
| **Provider response as untrusted input** | A provider's output is parsed, never executed, and never re-framed as instruction. The one-shot repair path (implementation plan §7.3) applies identically and stays bounded to one |
| **Content boundary in user-managed mode** | The author's provider sees document sections. The **author's tenant terms** then govern that content, which is a data-protection question per provider, not one answer for all — §11 risk R3 |

### 4.3 What must never be sent, to any provider

Unchanged from the single-provider plan and worth restating because a second provider is a second
chance to get it wrong: no permission or policy context, no local filesystem paths, no tenant
hostname (**C2**), no learner or author PII beyond what the prompt needs — which is nothing.

### 4.4 Why per-user API keys are refused in v1

The obvious way to give Anthropic a "user managed" mode is to let an author paste a personal API
key. It should not be built first, for four reasons:

1. **It collides with the secret model.** `secretRef` accepts only `keyvault://{vault}/secrets/{name}`
   and two tests assert a raw key is refused at startup. A per-user key means a secret per principal,
   with rotation, revocation on offboarding, and an audit trail for reads.
2. **The platform becomes custodian of personal credentials**, with a blast radius proportional to
   the number of authors.
3. **It is not the entitlement the author thinks it is.** A claude.ai seat is not an API key; the
   author must obtain and pay for a separate one, which makes "use my own Claude" misleading as a
   UI label.
4. **It buys little.** The delegated providers already give genuine user-managed execution, and the
   Anthropic platform-managed path already works.

**Recommendation:** support user-managed via **delegated tokens only**. Revisit per-user keys if a
concrete requirement survives §11 R4.

---

## 5. Provider selection UI

### 5.1 Where it goes

The generation screen, Step 3, beside Domain / Topic / Scope — the existing
`GenerateWizard` block where the job is configured. Nowhere else: a provider is a property of a
generation job, not a global setting, so the choice belongs where the job is described and is
recorded with it.

### 5.2 Rules the screen must follow

This project has a standing rule that the UI must not imply capability it does not have, enforced by
a contract test for fabricated metrics. The same discipline applies here:

1. **Only registered providers appear.** A declared-but-unregistered provider (Gemini today) is
   **absent**, not greyed out with a tooltip.
2. **A provider the author cannot use appears with the reason**, not as a dead control. *"Microsoft
   Copilot — unavailable: no Copilot licence on your account"* is useful; a disabled radio button is
   not.
3. **Execution mode is shown as a consequence, not a free choice.** Selecting Anthropic shows
   *"Platform managed — runs on Knowzy's credentials"* with no toggle, because there is no second
   option (§0.1). Selecting Copilot shows the mode that will be used and whose entitlement it spends.
4. **Cost visibility is stated before the run, not after.** *"Token usage is recorded. Cost is not
   observable in user-managed mode"* — because §6.2 means the screen would otherwise imply a number
   that will never appear.
5. **The deterministic generator is always offered and always honestly labelled.** Not "no AI" but
   *"Deterministic local generator — sentence matching, no model call, no cost"*.
6. **Every string goes in `copy.ts`** (content rule **C1**).

### 5.3 What the screen must not do

- **Not remember a provider across jobs as a hidden default.** The recorded provenance must match a
  choice someone made for *this* job.
- **Not offer "best available" or an automatic fallback.** §3.2.
- **Not show a provider comparison or a recommendation.** Until the §10 evaluation has run, the
  platform has no basis for one, and inventing it is the fabrication the metrics gate exists to stop.

---

## 6. Cost tracking

### 6.1 What exists

`GenerationJob.estimatedCost` is `Decimal(12,6)` and **never written**. `inputTokens` and
`outputTokens` are written and are already displayed on the generation screen.

### 6.2 The finding that shapes this section: cost is often not observable

| Mode / provider | Is a per-call cost knowable by the platform? |
| --- | --- |
| Deterministic | **Zero**, and that is a fact, not an estimate |
| Anthropic, platform managed | **Yes, derivable** — reported token usage × configured price |
| Azure OpenAI, platform managed | Yes, derivable |
| Copilot, user managed | **No.** Microsoft 365 Copilot is a **per-seat licence**, not per-call billing. There is no marginal cost to compute |
| Anthropic / Azure OpenAI, user managed | **No.** The spend lands on the author's account and the platform cannot see the billed amount |

**So "cost per question" is a platform-managed metric only**, and for a licence-based provider it
does not exist at any granularity. Writing an inferred number would be exactly the fabrication
`no-fabricated-metrics.test.ts` was built to prevent.

**Design:**

- `estimatedCost` is written **only** when `capabilities.reportsCost` and the mode is
  `PLATFORM_MANAGED`. Otherwise **null**, never zero — zero is a claim, null is an absence.
- The UI renders a null cost as *"Not observable in this mode"*, never as `0.00`.
- `capabilities.reportsCost` is what the UI reads, so the screen cannot promise a number the provider
  will not produce.
- Price configuration is **per provider and per model**, in the declared `CONFIG_KEYS` catalogue,
  `PLATFORM_ONLY` so a profile cannot raise its own budget.

### 6.3 Budgets, which must land with the first provider

`architecture.md` §9 requires a per-job token budget, a per-tenant daily budget, a concurrency cap
and 429 backoff, and **none exists**. Multi-provider makes each **per provider and per mode**:

**Reconciled 2026-09-24 and implemented.** This table proposed five keys *per provider id*, which
would have been 25 declared keys for five providers and a second naming family beside the
`llm.perJobTokenBudget`, `llm.dailyTokenBudget` and `llm.concurrency` keys `CONFIG_KEYS` already
declared. What was built instead keeps one family and makes the per-provider part a value rather than
a key name:

| Key | Default | Scope | Purpose |
| --- | --- | --- | --- |
| `llm.activeProvider` | `DETERMINISTIC_LOCAL` | Platform, profile | Which provider the registry resolves. The kill switch: setting it back stops all model calls with no deployment, and the change is audited |
| `llm.approvedProviders` | `['DETERMINISTIC_LOCAL']` | Platform | Providers with a recorded data-processing approval. A provider absent from this list is `BLOCKED_BY_APPROVAL` **even with a working credential** — which is how T-29 becomes a control rather than a promise |
| `llm.perJobTokenBudget` | 250,000 | Platform, profile | §6.3 per-job ceiling, checked from the framed estimate **before** any call |
| `llm.dailyTokenBudget` | 2,000,000 | Platform | §6.3 daily ceiling, summed across jobs and **including retries** |
| `llm.concurrency` | 4 | Platform | Concurrent calls, counted from `RUNNING` jobs per provider |
| `llm.providerLimits` | `{}` | Platform | Per-provider **overrides** of the three ceilings above, keyed by provider id. Absent means "the platform ceiling applies", which is the safe default — an unlisted provider is not unlimited |
| `llm.tokenPrices` | `{}` | Platform | Prices per million tokens, keyed `PROVIDER` or `PROVIDER:modelId` (most specific wins). Absent means **cost is not computed**, and an uncomputed cost is recorded as null, never 0 |
| `llm.maxAttempts` · `llm.retryBaseDelayMs` · `llm.retryMaxDelayMs` · `llm.retryJitterRatio` | 3 · 500 · 30,000 · 1.0 | Platform | The retry policy. Full jitter by default |
| `llm.healthFailureThreshold` · `llm.healthWindowMinutes` | 3 · 15 | Platform | When consecutive failures in the window make a provider `FAILING` |

The original per-id form is recorded here because the reasoning behind it was right — limits and
prices **are** per provider — and only the encoding changed.

**A user-managed run must still be budgeted.** It costs the platform nothing and it can still
exhaust an author's quota, generate an unreviewable batch, or loop. The budget protects the author
and the reviewer, not only the invoice.

---

## 7. Token tracking and audit logging

### 7.1 Tokens

`GenerateResult.usage` gains `reported: boolean`. The deterministic generator estimates from prompt
length (it says so in its own comment); a real provider reports actual counts. Conflating the two
would make a comparison of "tokens per accepted question" meaningless, since one arm's denominator
is a guess.

### 7.2 Audit — and the gotcha that will cost someone an hour

Audit `detail` keys are **dropped unless declared** in the allow-list in
`packages/observability/src/audit.ts`, and a dropped key appears as `_droppedKeys`. Today
`AUTHORING.GENERATION.JOB_COMPLETED` declares `jobStatus`, `requestedQuestionCount`,
`acceptedQuestionCount`, `rejectionCounts`, `modelId`, `inputTokenCount`, `outputTokenCount` — and
**none of the new fields**.

These must be added to the allow-list or they will silently vanish:

`providerId` · `providerVersion` · `executionMode` · `onBehalfOfUserId` · `estimatedCost` ·
`tokenUsageReported` · `promptVersionId`

Two audit rules to keep:

- **`onBehalfOfUserId` is an identity, and identities are already audited** — it is the same class of
  value as an approver id, so it is in scope for audit and out of scope for a prompt.
- **A credential, a token, or any part of one, is never an audit detail.** Record *which* provider and
  *which* mode, never *what* authenticated.

New audit events: `AUTHORING.GENERATION.PROVIDER_SELECTED` (the recorded choice, with mode) and
`AUTHORING.GENERATION.PROVIDER_REFUSED` (the §3.2 refusals, with the reason code) — because a refusal
an author saw is part of the history of a batch.

---

## 8. Provenance recording

### 8.1 What the brief asks for, mapped to storage

| Required | Where | Status |
| --- | --- | --- |
| **Generated By** (Deterministic / Claude / Copilot) | `GenerationJob.providerId`, `DraftQuestion.providerId` | **New column** |
| **Execution Mode** | `GenerationJob.executionMode`, `DraftQuestion.executionMode` | **New column** |
| **Generated For** (user identity) | `GenerationJob.onBehalfOfUserId` | **New column**; `createdByUserId` already records who *ran* it, which is a different fact |
| **Generation Date** | `GenerationJob.createdAt`, `startedAt`, `completedAt` | Exists |
| **Provider Version** | `GenerationJob.providerVersion`, `DraftQuestion.providerVersion` | **New column** |
| **Prompt Version** | `promptVersionId` on both, immutable, hash-pinned since PILOT-T2 | Exists and is now trustworthy |
| Model id | `modelId` on both | Exists |

`providerId` and `executionMode` are **new Postgres enums**, so the values are closed and a typo is a
migration error rather than a free-text field that drifts.

**Why the columns go on `DraftQuestion` as well as on the job:** a question outlives its job in
practice and the lineage columns are immutable after insert (I15). Reading provenance through a join
would work until a job row is ever archived; the same reasoning already put `modelId` on both.

### 8.2 The published record, and a rename that must happen NOW

`BankItemWrite` — the payload written to the Question Bank — contains:

```ts
readonly claudeModel: string | null;
readonly promptVersion: string | null;
```

`publishing.ts:373` writes `claudeModel: question.modelId`.

**A Copilot-generated question would be published into a field named `claudeModel`.** That is wrong
in the most permanent place the platform writes: a reusable asset in the customer's Question Bank,
mapped to a real SharePoint list column.

**This is the one item in this document with a deadline.** The bank is still a **mock**; nothing has
been written to a tenant list. Renaming now is a port change plus five call sites. Renaming after
Phase 8 means migrating tenant data and a column an administrator has already seen.

**Recommended:** `claudeModel` → `generatorModel`, and add `generatorProvider` and `executionMode`
alongside it, before the SharePoint bank adapter is built.

### 8.3 What provenance must never claim

If `usage.reported` is false, the recorded token counts are an estimate and the row must say so. If
cost is not observable, the field is null (§6.2). A provenance record that cannot distinguish a
measured number from an inferred one is decoration — the lesson `PromptVersion.body` already taught.

---

## 9. Governance: what provider selection cannot touch

Stated as a list because it is the answer to the question a governance reviewer will ask.

| Control | Provider-dependent? |
| --- | --- |
| Evidence verification (STRICT / STANDARD, character-exact) | **No.** Model-agnostic, cannot be switched off (ADR-005) |
| Scope enforcement (`sectionKey` must be in the pinned scope) | **No** |
| Integrity gates (duplicate options, prohibited distractors) | **No** |
| Composite confidence (model self-report capped at 0.10) | **No** |
| Duplicate detection, disposition, `blocksApproval` | **No** |
| The 13 approval gates, re-evaluated server-side at every transition | **No** |
| Separation of duties, gate 13 | **No** |
| Publication to the Question Bank, idempotency, `If-Match` | **No** |
| Audit, append-only, allow-listed details | **No** |
| Preflight and the recorded decision | **No** |

**A provider choice selects who drafts. It selects nothing about what is accepted, approved or
published.** No new permission key is required: `question.generate` already governs generation, and
that a second provider needs no new permission is the useful signal — it adds no capability, only
another implementation of one already governed.

One addition is warranted: **`platform.configure` should gate which providers are *enabled* for a
tenant**, because enabling a provider is a data-processing decision (whose terms apply to customer
documents), not an authoring one.

---

## 10. Quality comparison framework

Extended in [`LIVE_CLAUDE_EVALUATION_PLAN.md`](LIVE_CLAUDE_EVALUATION_PLAN.md) §11. The framework
requirements, which the architecture must make possible:

1. **Provider is a job-level variable and is recorded**, so any batch can be attributed after the
   fact without a separate register.
2. **The pinned scope is reproducible** — `resolvedSectionKeys` already makes it so — so N arms can
   run over identical sections.
3. **Every arm passes the identical unmodified gate chain.** No per-provider thresholds, ever. A
   provider that needs a relaxed threshold has failed the comparison, not the threshold.
4. **Blinding is possible**, which means an export that omits `providerId` — the review screen shows
   it, so the live UI cannot blind a reviewer.
5. **Token usage is comparable**, which requires the `reported` flag (§7.1).
6. **Cost is comparable only where observable** (§6.2), so the cost metric is reported per arm with
   "not observable" as a legitimate value.

**The control is the deterministic generator, measured on 2026-09-22 and recorded in the evaluation
plan §2.4:** 4 questions from the original corpus (115 assessable, 3.5% coverage) and 16 from the
restructured corpus (76 assessable, 21.1%), every one an exact quotation, zero duplicates blocked.
Every provider is measured against those numbers.

---

## 11. Risks

| # | Risk | Severity | Response |
| --- | --- | --- | --- |
| **R1** | **Copilot cannot be made retrieval-free**, so it either yields nothing or contaminates questions with Graph content (§0.2) | **Critical — could remove a required provider** | Investigate before building anything (§12 step 1). If it cannot be guaranteed, Copilot is not a grounded-generation provider and the design says so |
| **R2** | "User managed" is promised for Anthropic and cannot be delivered as the brief describes (§0.1) | **High — expectation, not engineering** | Say so now. Anthropic is platform-managed; Copilot and Azure OpenAI carry the user-managed story |
| **R3** | In user-managed mode the **author's tenant terms** govern customer documents sent to a provider, and those terms differ per provider | **High — legal, not technical** | Per-provider data-processing assessment before enabling. **T-29 covers Anthropic only**; Copilot and Azure OpenAI need their own, and Microsoft-to-Microsoft is likely the easiest |
| **R4** | Per-user API keys get added "just for testing" and the platform becomes a credential custodian | Medium | §4.4 refuses them in v1 by design rather than by omission |
| **R5** | `claudeModel` reaches a real Question Bank before it is renamed | **Medium, and time-boxed** | Rename before Phase 8 (§8.2). The window closes when the SharePoint adapter ships |
| **R6** | Three providers, three prompt variants, and provenance stops being comparable | Medium | One `PromptVersion` per provider-and-prompt pairing, hash-pinned as PILOT-T2 established. A provider-specific prompt is a new version, never an edit |
| **R7** | A silent fallback makes a batch's provenance false | Medium | §3.2: every failure is a named refusal. No fallback exists to go wrong |
| **R8** | Budgets ship "after" the providers and an author exhausts their own quota | Medium | §6.3 lands with the first provider, per provider and per mode |
| **R9** | Three arms invite picking the winner after the fact | Medium | The evaluation plan pre-registers **pairwise comparisons against the deterministic control**, not "best of three" |
| **R10** | `architecture.md` still describes a single-provider system | **High — governance** | §12 step 0. Amend the specification first |
| **R11** | Scope creep: six providers designed, none measured | Medium | Register two (deterministic + one model). Declare the rest. §12 |

---

## 12. Recommended implementation order

**Step 0 and step 1 are both prerequisites, and neither is code.**

| # | Work | Gated on | Why here |
| --- | --- | --- | --- |
| **0** | **Amend `architecture.md`**: §9 becomes "Generation provider architecture", the technology table names a provider registry with Claude as one implementation, the C4 diagram gains a provider boundary rather than an `Anthropic` node, and B4's package name is settled (§2.3) | Nothing | `/docs` is authoritative. Code that contradicts it makes the specification wrong rather than the code right |
| **1** | **Investigate Copilot's retrieval behaviour.** Can Microsoft 365 Copilot be invoked so that it grounds *only* in supplied text? Get a documented answer | Nothing | **R1.** If the answer is no, Copilot leaves this architecture and the remaining work changes shape. Answer it before building for it |
| **2** | **Rename `claudeModel` → `generatorModel`** in `BankItemWrite`, add `generatorProvider` and `executionMode` | Nothing | **R5**, and the window closes when the bank adapter ships |
| **3** | **Provider registry, capabilities, execution-mode resolution, named refusals** — with only the deterministic generator registered | Nothing | Buildable and testable today. Proves the refusals with no credential and no approval |
| **4** | **Provenance columns and enums**, audit allow-list additions, UI provider block reading capabilities | Step 3 | Visible with one provider; adding a second then changes no schema |
| **5** | **Budgets, concurrency caps, cost recording** per provider and per mode | Step 3 | **R8.** Before any paid call, not after |
| **6** | **Anthropic provider, platform-managed only** | **T-29**, T-28 | The existing implementation plan, now plugged into the registry |
| **7** | **Run the two-arm comparison** (deterministic vs Claude) against the §2.4 baseline | Step 6 | Answers the product's central question with two arms before adding a third |
| **8** | **Copilot provider, user-managed** | Step 1 answered yes; a Copilot data-processing assessment; a licensed test author | Third arm |
| **9** | Azure OpenAI, Gemini, enterprise-managed | Demand | Declared and unregistered until someone needs them |

**Steps 0–5 need no provider approval, no credential and no tenant access.** That is most of this
architecture, and it is all buildable now — which is the useful shape of this plan: the parts blocked
on legal and licensing are at the end, and the parts that make provenance and refusals trustworthy
are at the front.

**One recommendation against the brief's framing.** The brief asks for three providers and lists
three more. Registering six providers before measuring one is how a platform acquires five untested
integrations and no answer to *"are the questions good enough?"*. **Register two, declare the rest,
and let the comparison decide what is worth building.**

---

## 13. Traceability

| Claim | Source |
| --- | --- |
| Existing port shape, `kind` has two referents | `packages/claude-services/src/generator.ts`, read 2026-09-22 |
| `claudeModel` in the published payload | `packages/shared-types/src/question-bank-port.ts:59`; `packages/domain/src/review/publishing.ts:373` |
| Architecture is single-provider | `docs/architecture.md` §9, technology table, C4 container diagram, data-flow table |
| Framing, tool grant, evidence invariants | `packages/claude-services/src/framing.ts`, `evidence.ts`; `security.md` §5; `workflows.md` §2.5 |
| Registry pattern and honest capabilities | `apps/mcp-server/src/adapters/registry.ts`; adapter template rule P1 |
| Audit allow-list drops undeclared keys | `packages/observability/src/audit.ts`; CLAUDE.md gotchas |
| Budgets specified and absent | `architecture.md` §9; [`LIVE_CLAUDE_IMPLEMENTATION_PLAN.md`](LIVE_CLAUDE_IMPLEMENTATION_PLAN.md) §6 |
| Deterministic control numbers | [`LIVE_CLAUDE_EVALUATION_PLAN.md`](LIVE_CLAUDE_EVALUATION_PLAN.md) §2.4; [`CorpusManifest.md` §9](../../RealWorldPilot/CorpusManifest.md) |
| T-28 / T-29 / T-30 | [`assumptions-and-tenant-configuration.md`](../assumptions-and-tenant-configuration.md) |
| No fabricated metrics, C1/C2/C3/C6 | `packages/testing/contracts/no-fabricated-metrics.test.ts`; CLAUDE.md content rules |
