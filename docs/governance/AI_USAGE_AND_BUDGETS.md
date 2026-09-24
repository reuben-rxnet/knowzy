# AI Usage & Budgets

**Screen:** Governance → AI Usage & Budgets (`/governance/ai-usage`, authoring portal)
**Built:** 2026-09-24
**Status:** Implemented and functional **before any external provider is enabled**, which is the
point of it.
**Authority:** [architecture.md §9.0](../architecture.md#90-provider-independence--amended-2026-09-24)
is the specification. Where this document and the code disagree, the code is right and this is
stale.

---

## 1. Purpose

One page that answers, for a platform owner or an administrator:

- how much generation is happening, and who is doing it
- how many tokens it is consuming, and how close that is to a ceiling
- what it costs, **or why a cost cannot be known**
- which providers exist, which can be used, and what blocks the rest
- whether a provider is actually working

It exists before a paid provider does on purpose. The day a credential arrives, the accounting,
the ceilings and this page have already been running against the deterministic generator for
weeks — instead of being written in the same week the first invoice could appear.

**The one rule the page obeys:** every figure is a count or a sum of records that exist. Where
nothing has been recorded it says **"Not Yet Recorded"**. Where a cost cannot be observed it says
**"Not observable"** with the reason. It never shows a zero that nothing measured, and it shows no
trend, because **no KPI history is stored anywhere** and a computed delta would be invented.

---

## 2. Metrics

### 2.1 KPIs

| KPI | Source | When it reads "Not Yet Recorded" |
| --- | --- | --- |
| Providers registered | The registry: providers with a client in this build | Never — the registry is code, not activity |
| Providers available | Registered **and** approved **and** configured **and** grounding-safe | Never |
| Total generations | `generation_job` rows in the window | No job in the window |
| Questions generated | Sum of `accepted_question_count` | No job in the window |
| Estimated tokens | Sum of `input_tokens + output_tokens` on jobs | No job in the window |
| Remaining daily budget | The daily ceiling minus tokens recorded today | Never — a full budget is a fact |
| Budget utilization % | Today's usage over the daily ceiling | Never |
| Active authors | Distinct `created_by_user_id` on jobs in the window | No job in the window |

### 2.2 Two sources, and why they differ

- **Activity** — the KPIs, the timeline, the history, per-provider usage — reads `generation_job`.
  Those rows go back to the first generation this platform ever ran.
- **Budget windows** read `generation_provider_call`, the control layer's own accounting unit,
  which starts on 2026-09-24 and counts **attempts**.

So a job generated before that date appears in the activity totals and **not** in the budget
windows. The page says so under the budget cards. The alternative was back-filling per-attempt rows
for jobs nobody measured that way, which would have been fabrication with a tidier shape.

---

## 3. Token model

- The accounting unit is the **attempt**, not the job: one `generation_provider_call` row per call,
  with its own input and output counts. A retry is a row, so **retries count against the budget**.
  A budget that only saw successful jobs would be bypassed by a partly-failing batch.
- Every count carries `tokenUsageReported`. **False means the platform estimated it.** The
  deterministic generator estimates (four characters per token), so its counts are labelled
  "Estimated" on screen. Mixing an estimate into a total degrades the whole total to an estimate,
  because one measured call must not launder a batch of guessed ones.
- The **pre-call estimate** is `ceil(characters / 4) + 700`, deliberately conservative: an estimate
  that runs low admits jobs the budget should have refused, and the tokens are gone by the time
  anyone notices. A unit test asserts the 700-token framing overhead stays true against the real
  prompt, because a constant nothing checks silently becomes wrong.

---

## 4. Cost model

**A cost is written only where it can be known.** Four outcomes, decided in this order:

| Case | Result |
| --- | --- |
| The deterministic provider | **`0.000000`, and that is a measurement.** It runs in process; there is no marginal cost to estimate |
| A licence-based provider (Copilot) | **Not observable.** A per-seat licence has no per-call price at any granularity |
| Any user-managed run | **Not observable.** The spend lands on the author's own account, which the platform cannot read |
| No configured price for that provider and model | **Not observable.** A missing price is not a free provider |

Prices live in `llm.tokenPrices`, keyed `PROVIDER` or `PROVIDER:modelId` with the more specific
winning, quoted per million tokens as every provider quotes them.

**Aggregates refuse to mislead.** If any run contributing to a total has no observable cost, the
total is reported as not observable and says how many — because summing only the observable part
presents an undercount as a total, which is the arithmetic form of fabrication: every number in it
is real and the answer is wrong.

Storage: `generation_job.estimated_cost` and `measured_cost` are `Decimal(12,6)` and **nullable**,
with `cost_observable` beside them. A null cost with `cost_observable = false` is an honest absence.

---

## 5. Budget model

Four ceilings, all in **tokens** rather than money — tokens are the one quantity every provider
reports, and a budget denominated in something half of them cannot report is not a control.

| Ceiling | Key | Default | Checked |
| --- | --- | --- | --- |
| Per job | `llm.perJobTokenBudget` | 250,000 | From the prompt estimate, **before any call** |
| Daily | `llm.dailyTokenBudget` | 2,000,000 | Projected usage against a window anchored to midnight UTC |
| Weekly | `llm.weeklyTokenBudget` | 10,000,000 | Rolling 7 days |
| Monthly | `llm.monthlyTokenBudget` | 40,000,000 | Rolling 30 days |

Weekly and monthly are **rolling spans**, not calendar periods, and the screen says so. A calendar
month needs a timezone-aware anchor and an answer for February; an honest rolling window beats a
wrong calendar one.

**States:** `HEALTHY` below the warning ratio (`llm.budgetWarningRatio`, default 0.8), `WARNING` at
or above it, `EXHAUSTED` at or above the ceiling. A ceiling of **0 is EXHAUSTED**, not 0% used —
zero is a legitimate way to forbid generation for a provider.

**Windows check the PROJECTED total**, not just what is already spent: admitting a job that would
certainly breach the ceiling and stopping it half way is worse than refusing it, because the tokens
are spent either way.

### 5.1 Per-provider limits, set from the page

An administrator holding `platform.configure` can set any of the four ceilings, plus the
concurrency cap, **per provider**, from the provider table. The override is stored in
`llm.providerLimits` in `application_configuration` at PLATFORM scope, with a
`configuration_change` row and an `ADMIN.CONFIGURATION.UPDATED` audit event carrying previous and
new value.

Two rules worth knowing:

- **An absent override means the platform ceiling applies.** It never means unlimited — an unlisted
  provider is not an unbudgeted one, and a partial override (daily only) leaves the other windows
  at the platform value rather than uncapped.
- **Clearing every field REMOVES the override; setting 0 forbids generation.** Those are different
  gestures and the screen keeps them distinct, because there has to be a way back to the default.

A per-job ceiling above the daily ceiling is refused: no job could ever run, and the first attempt
would be refused by the daily budget with a confusing reason.

---

## 6. Provider model

### 6.1 Five states, and the order they are decided in

| State | Meaning | What changes it |
| --- | --- | --- |
| `AVAILABLE` | Registered, approved, configured, grounding-safe | — |
| `BLOCKED_BY_CAPABILITY` | Performs its own retrieval, so it cannot ground a question in the selected sections | Nothing available today. Copilot is here |
| `BLOCKED_BY_APPROVAL` | No data-processing approval recorded | A signature, then `llm.approvedProviders` |
| `UNAVAILABLE` | No client for it in this build | A milestone that writes one |
| `BLOCKED_BY_CONFIGURATION` | Credential reference does not resolve | Configuration |

**The order is the policy**, most-permanent first: capability, then approval, then implementation,
then credential. Reversing the first two would send somebody to get Copilot approved for a use it
can never satisfy.

`BLOCKED_BY_APPROVAL` is the one that exists for a legal reason rather than a technical one, and it
is how **T-29 becomes a control rather than a promise**: a provider with a working credential and no
recorded approval is still refused.

### 6.2 The declared catalogue

| Provider | Grounding-safe | Modes | Reports tokens | Reports cost | State today |
| --- | --- | --- | --- | --- | --- |
| `DETERMINISTIC_LOCAL` | Yes | Platform | No (estimates) | Yes — genuinely zero | **AVAILABLE** |
| `OPENAI` | Yes | Platform | Yes | Yes | UNAVAILABLE (no client) |
| `ANTHROPIC` | Yes | Platform | Yes | Yes | UNAVAILABLE (no client) |
| `AZURE_OPENAI` | Yes | Platform, user | Yes | Yes | UNAVAILABLE |
| `GEMINI` | Yes | Platform | Yes | Yes | UNAVAILABLE |
| `MICROSOFT_COPILOT` | **No** | User | No | No | **BLOCKED_BY_CAPABILITY** |

The deterministic provider is registered in **every** environment, forever: the zero-credential
path, the control arm of every quality comparison, and the reason the gate chain is known to work.

### 6.3 Health is not availability

A provider can be `AVAILABLE` and `FAILING` at once. Health is assessed over the last
`llm.healthWindowMinutes` (15) of calls:

- **UNKNOWN** — no calls in the window. A provider with no calls has not earned "healthy"; it has
  not been asked.
- **HEALTHY** — calls, none failed.
- **DEGRADED** — some failures, below `llm.healthFailureThreshold` (3).
- **FAILING** — at or above the threshold.

**A control-layer refusal is not a failure sample.** Counting refusals as failures would make a
working budget look like an outage, which is exactly backwards: the budget firing is the platform
working.

---

## 7. Refusals, and what gets audited

A refusal is a **decision**, not a failure. The job ends as `REFUSED` (a distinct `JobState`, added
in migration 0009) carrying a `generation_refusal_reason`, so refusals can be counted without
counting outages.

| Refusal | Raised when |
| --- | --- |
| `PER_JOB_TOKEN_BUDGET_EXCEEDED` | The estimate exceeds the per-job ceiling |
| `DAILY` / `WEEKLY` / `MONTHLY_TOKEN_BUDGET_EXHAUSTED` | The projected total exceeds that window |
| `CONCURRENCY_LIMIT_REACHED` | Running jobs for that provider are at the cap |
| `RETRY_LIMIT_EXHAUSTED` | A retryable failure ran out of attempts |
| `PROVIDER_BLOCKED_BY_APPROVAL` / `_CAPABILITY` / `_CONFIGURATION`, `PROVIDER_NOT_REGISTERED` | The provider's state is not `AVAILABLE` |
| `EXECUTION_MODE_UNSUPPORTED` | The provider does not support the requested mode |

**Audit actions added:**

- `AUTHORING.GENERATION.JOB_REFUSED` — outcome `DENIED`, with `refusalReason`, `refusalDetail`,
  `providerId`, `executionMode`, `limitName`, `limitValue`, `observedValue`, `budgetWindow`,
  `requestedQuestionCount`, `attemptCount`.
- `AUTHORING.GENERATION.PROVIDER_CALL_RETRIED` — one per retry, with `attempt`, `maxAttempts`,
  `errorClass`, `delayMs`, so a retry storm is reconstructable rather than inferred from a bill.
- `AUTHORING.GENERATION.JOB_COMPLETED` gains `estimatedCost`, `measuredCost`, `costObservable`,
  `attemptCount`.

Every key above is declared in the allow-list in `packages/observability/src/audit.ts`, and the
integration suite asserts **no generation audit row carries `_droppedKeys`** — an audit assertion
that only checks the row exists proves nothing, because the writer silently discards undeclared
keys.

---

## 8. Retry model

- Retryable: `RATE_LIMIT`, `SERVER_ERROR`, `TIMEOUT`.
- **Not** retryable: `MALFORMED_OUTPUT` (a response that arrived and failed to parse is the bounded
  single repair path — the tokens are already spent, and retrying could double-charge a partial
  success), `CLIENT_ERROR`, and `UNKNOWN`. Anything unrecognised is treated as permanent, because
  guessing that an unfamiliar error is transient is how a permanent failure gets paid for three
  times.
- Backoff doubles from `llm.retryBaseDelayMs` (500 ms), capped at `llm.retryMaxDelayMs` (30 s), with
  **full jitter** by default (`llm.retryJitterRatio` = 1) so a batch that hits one 429 does not
  retry in lockstep.
- A retryable class that exhausts `llm.maxAttempts` (3) is a **refusal**. A non-retryable failure is
  the provider's own failure and propagates as one — the distinction is what keeps "did the controls
  hold?" answerable.

---

## 9. Authorization

| Action | Policy | Permission | Who holds it |
| --- | --- | --- | --- |
| Read the page | `governance.ai.read` | `report.read` | Reporting User, Report Publisher, Manager, Auditor, Assessment Manager, Source Administrator, KNOWZY Administrator |
| Set a provider limit | `governance.ai.manage` | `platform.configure` | KNOWZY Administrator |

No new permission key was minted. `report.read` already means "read platform reporting", which is
what this page is; inventing `governance.read` would have meant a role migration for a read the
existing key already describes. The **write** is deliberately a much narrower grant: reading what a
provider has spent and raising what it may spend are not the same authority.

The API reports `canManageBudgets` in the payload, so the screen renders the control or not; the
`PUT` re-checks the policy regardless, and the page never becomes the authority.

---

## 10. What this page does not do

- **No trends or deltas.** No KPI history is stored, so none is computable.
- **No spend forecast.** It would be a projection of an estimate of an unobservable quantity.
- **No provider enablement.** Registering a provider is a code change plus an approval; this page
  reports state and sets ceilings.
- **No sorting or free-text search** on the tables yet.
- **No per-user quotas.** Budgets are per platform and per provider. A per-author ceiling is a
  plausible next step and is not built.
