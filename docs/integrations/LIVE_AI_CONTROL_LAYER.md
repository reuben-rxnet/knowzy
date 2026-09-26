# The AI Generation Control Layer

**Built:** 2026-09-24, extended 2026-09-26
**Code:** `packages/domain/src/generation/control/`, `packages/claude-services/src/{registry,accounting,health,validation}.ts`
**Authority:** [architecture.md §9.0](../architecture.md#90-provider-independence--amended-2026-09-24).
Where this document and the code disagree, the code is right and this is stale.
**Companions:** [../governance/AI_USAGE_AND_BUDGETS.md](../governance/AI_USAGE_AND_BUDGETS.md)
(what is being spent), [../governance/AI_PROVIDER_ADMINISTRATION.md](../governance/AI_PROVIDER_ADMINISTRATION.md)
(how a provider is configured).

---

## 1. What it is, and what it is for

Everything between "an author asked for questions" and "a provider was called", and everything
recorded on the way back. It is **provider-independent** and enforced on **every** provider
including the deterministic one, which is how it was validated before any credential existed.

It exists early on purpose. The ceilings, the accounting and the refusals have been running against
a generator that costs nothing for weeks, so the day a paid provider arrives is a configuration
change and a comparison — not the week somebody writes a budget for the first time while an invoice
accrues.

`runGenerationJob` **requires** a `control` argument. Required, not optional: an optional control
layer is one a caller forgets, and the caller most likely to forget it is a future one adding a
provider that bills per token. A contract test asserts the generation service contains no direct
`provider.generate(` call.

---

## 2. The gate order

Every generation call passes these in this order. The order is the policy.

| # | Gate | Refusal reason | Reads |
| --- | --- | --- | --- |
| 1 | Provider state | `PROVIDER_BLOCKED_BY_*`, `PROVIDER_NOT_REGISTERED`, `EXECUTION_MODE_UNSUPPORTED` | the registry |
| 2 | Per-job token estimate | `PER_JOB_TOKEN_BUDGET_EXCEEDED` | configuration |
| 3 | Window budgets | `DAILY_`/`WEEKLY_`/`MONTHLY_TOKEN_BUDGET_EXHAUSTED` | `generation_provider_call` |
| 4 | Concurrency | `CONCURRENCY_LIMIT_REACHED` | `generation_job` where status = RUNNING |
| 5 | The call, with retries | `RETRY_LIMIT_EXHAUSTED` | — |

A refusal is recorded as `JobState.REFUSED` with a closed-enum `refusalReason`, **never** as
`FAILED`. A control decision is not an outage: recording one as a failure would count every working
budget as a defect in the metrics that exist to show the controls holding.

Each refusal names the limit, the limit's value and the observed value, so the audit row says which
control fired rather than that something was refused.

---

## 3. Budgets

| Window | Boundary | Configuration key |
| --- | --- | --- |
| Daily | midnight UTC | `llm.dailyTokenBudget` |
| Weekly | rolling 7 days | `llm.weeklyTokenBudget` |
| Monthly | rolling 30 days | `llm.monthlyTokenBudget` |
| Per job | — | `llm.perJobTokenBudget` |

Per-provider overrides live in one value, `llm.providerLimits`, keyed by provider id — not five key
names per provider. Two plans named the same ceilings differently and were corrected rather than
duplicated: a second family of names is how two budgets end up half-enforced, with the one nobody
is looking at being the one in force.

An absent override means the platform ceiling applies. It never means unlimited. Setting a ceiling
of **0 forbids generation**; clearing every field **removes the override**. Two different gestures,
deliberately, and the form keeps them apart.

States are `HEALTHY`, `WARNING` (past `llm.budgetWarningRatio`, default 0.8) and `EXHAUSTED`.

**Windows read call rows, activity reads job rows.** A budget window sums
`generation_provider_call`, one row per **attempt**, which is what makes "retries count against the
budget" true. Activity figures sum `generation_job` and therefore reach further back than
per-attempt accounting exists for. The page says so rather than back-filling rows nobody measured.

---

## 4. Concurrency — and the absence of a queue

`llm.concurrency`, default 4, with a per-provider override. The check counts `generation_job` rows
in `RUNNING` for that provider, and the AI Usage page reports the **same count** so the number on
screen is the number that is enforced.

**There is no queue, and that is stated rather than implied.** A job that would exceed the cap is
REFUSED with `CONCURRENCY_LIMIT_REACHED` and can be retried when one finishes. Generation runs
inside the request that asks for it, so there is nothing to park.

A queued figure was considered and deliberately not built: with synchronous generation it would be
**zero forever**, and a dashboard number that can only ever be zero is worse than no number — it
implies a mechanism that does not exist. Real queueing means moving generation to a job runner
consuming `JobState.QUEUED`, which changes what the generation screen can show (a result now, or a
job reference to come back to). That is a product decision and its own milestone, not a line item.
The Concurrent generation card on the AI Usage page says all of this in one sentence.

---

## 5. Retries

| Setting | Key | Default |
| --- | --- | --- |
| Attempts, including the first | `llm.maxAttempts`, or `llm.providerLimits.{id}.maxAttempts` | 3 |
| Base delay | `llm.retryBaseDelayMs` | 500 |
| Maximum delay | `llm.retryMaxDelayMs` | 30 000 |
| Jitter | `llm.retryJitterRatio` | 1.0 (full jitter) |

Per-provider attempts were added 2026-09-26: retry economics are not uniform, and a provider that
bills per attempt and rate-limits hard wants fewer attempts than one that does neither. A refusal
names **whichever limit actually bound** — `llm.maxAttempts` or
`llm.providerLimits.{id}.maxAttempts` — because naming the platform key when an override was what
stopped the run sends an administrator to change the wrong setting.

Retryable classes: `RATE_LIMIT`, `SERVER_ERROR`, `TIMEOUT`.

`MALFORMED_OUTPUT` is **not retryable**. A response that arrived and failed to parse is the bounded
single repair path: the tokens are already spent, and retrying could double-charge a partial
success. Anything unrecognised is treated as permanent.

Every retried attempt writes `AUTHORING.GENERATION.PROVIDER_CALL_RETRIED` with its class and delay,
so a retry storm is reconstructable after the fact rather than inferred from a token bill.

A retryable class that ran out of attempts is a **refusal**; anything else is the provider's own
failure and is rethrown untouched. The condition tests the CLASS, not just the attempt count — an
earlier version tested `attempt >= maxAttempts` alone and relabelled every HTTP 400 as
`RETRY_LIMIT_EXHAUSTED`, turning a provider rejecting our request into "the platform gave up".

---

## 6. Accounting

**The accounting unit is the ATTEMPT.** One `generation_provider_call` row per call, successful or
not, carrying tokens, cost, latency, error class and outcome.

### 6.1 Tokens

`TokenAccount` carries input, output, total and `reported`. `reported: false` marks an estimate —
`ceil(characters / 4) + 700` overhead — and every surface that shows an unreported figure labels it
"Estimated".

### 6.2 Cost

**An unobservable cost is `null`, never 0.** Zero is a claim that something was measured and found
to be nothing; null says it could not be known.

| Case | Result |
| --- | --- |
| `DETERMINISTIC_LOCAL` | `0.000000` — the one case where zero is a measurement |
| Provider does not report cost (a per-seat licence) | not observable, with the reason |
| `USER_MANAGED` execution | not observable — it bills an account the platform cannot read |
| No price configured for the provider or model | not observable |

`aggregateCost` **refuses a total** when any contributor is unobservable, because summing only the
observable part presents an undercount as a total. The KPI shows the refusal and its reason instead.

---

## 7. Provider health

`assessProviderHealth` over `generation_provider_call` rows in the last
`llm.healthWindowMinutes` (default 15):

| State | Condition |
| --- | --- |
| `UNKNOWN` | no calls in the window. Not "healthy" |
| `FAILING` | failures ≥ `llm.healthFailureThreshold` (default 3) |
| `DEGRADED` | at least one failure |
| `HEALTHY` | calls, no failures |

A failure is outcome `FAILED` or `RATE_LIMITED`. **A refusal is not a failure sample** — a budget
holding is the control working, and counting it as ill health would make a correctly configured
platform look broken.

---

## 8. Audit

| Action | Carries |
| --- | --- |
| `AUTHORING.GENERATION.JOB_REFUSED` | refusal reason, limit name, limit value, observed value, budget window |
| `AUTHORING.GENERATION.PROVIDER_CALL_RETRIED` | provider, attempt, max attempts, error class, delay |
| `AUTHORING.GENERATION.JOB_COMPLETED` / `JOB_FAILED` | tokens, cost, observability, attempt count, provider, version, mode |
| `ADMIN.CONFIGURATION.PROVIDER_*` | see [AI_PROVIDER_ADMINISTRATION.md](../governance/AI_PROVIDER_ADMINISTRATION.md) §2 |

Every `detail` key is declared in the allow-list in `packages/observability/src/audit.ts`. An
undeclared key is **dropped** and appears as `_droppedKeys` on the row — which is how it was found
that `JOB_FAILED` was silently discarding `estimatedCost` and `costObservable`. A family-wide test
now scans for `_droppedKeys`.

---

## 9. Validation without a credential

Every rule above is exercised against the deterministic provider, with no external credential
anywhere:

| Suite | Covers |
| --- | --- |
| `packages/domain/test/generation-control.test.ts` | budgets, concurrency, refusal recording, call rows |
| `packages/domain/src/generation/control/{budget,retry}.test.ts` | window arithmetic, backoff, classification |
| `packages/claude-services/src/registry.test.ts` | all state transitions, including the enabled gate |
| `packages/testing/contracts/generation-providers.test.ts` | capability declarations, no direct provider call |
| `tools/e2e/tests/authoring/ai-usage.spec.ts` | the page reports the API's own figures |
| `tools/e2e/tests/authoring/ai-providers.spec.ts` | the four writes and their refusals, in a browser |

---

## 10. What is not built

| Thing | Why not |
| --- | --- |
| Any external provider client | No credential and no recorded data-processing approval (T-29). `OPENAI` is declared, not registered |
| A live connection test | Follows from the above. See AI_PROVIDER_ADMINISTRATION.md §4 |
| A queue for over-cap jobs | §4. It would be zero forever under synchronous generation |
| A secret resolver | No Key Vault client. A recorded reference reports as "recorded, unresolvable here" |
| Cost forecasting | No price is configured and no live call has ever been made; a forecast would be a shape drawn through one point at zero |

---

## 11. Change log

| Date | Change |
| --- | --- |
| 2026-09-24 | Built. Five provider states, twelve refusal reasons, per-attempt accounting, budgets, concurrency, retries, health, the AI Usage page. |
| 2026-09-26 | `OVER_BUDGET` as a sixth provider state (read-model derived). Per-provider `maxAttempts`. An `enabled` gate in the registry. Concurrency made visible, with the absence of a queue stated. `validateProvider`. |
