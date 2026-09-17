# Error Handling, Resilience, and Caching

**What this document adds:** the error taxonomy and wire contract, the resilience policies for
external services, the idempotency and concurrency mechanisms, job failure handling, caching rules,
and the presentation contract. Individual error codes are defined where the behaviour they describe
is specified; this document owns the **registry rules**, not a second copy of the catalogue.

---

## 1. Principles

| # | Principle | Consequence |
| --- | --- | --- |
| F1 | Fail honestly | No fabricated success, no silent truncation, no empty result standing in for an error. A `FAILED` connection is reported as failed |
| F2 | Fail with attribution | Every error carries a stable code and a correlation ID; support starts from a trace, not a description |
| F3 | Fail partially, not wholly, where the unit of work allows | 47 of 50 questions published is a reportable outcome, not a rolled-back batch |
| F4 | Retryability is stated, never inferred | The caller and the UI are told whether retrying can help |
| F5 | Never lose learner progress | Every answer is persisted before its response returns; retries are idempotent |
| F6 | Never overwrite blindly | Conditional writes everywhere: row `version` locally, `If-Match` remotely |
| F7 | An error message is a product surface | Plain language, actionable, no stack trace, no internal identifier |
| F8 | Degrade a panel, not a page | Independent failure domains with independent retry |

---

## 2. Error taxonomy

Nine categories. Category determines the HTTP status, whether a retry can help, and how the UI
presents it.

| Category | HTTP | Retryable | Meaning | Presentation |
| --- | --- | --- | --- | --- |
| `AUTHENTICATION` | 401 | After re-auth | Token missing, invalid, expired, wrong audience | Re-authenticate silently, then prompt |
| `AUTHORIZATION` | 403 | No | Permission or scope insufficient; separation of duties | State what is not permitted, never why the resource exists |
| `VALIDATION` | 400 / 422 | After correction | Schema violation, or a domain rule such as a failed approval gate | Field-level messages; 422 carries the gate list |
| `NOT_FOUND` | 404 | No | Absent, or present but out of scope (deliberately indistinguishable) | "Not found or no longer available" |
| `CONFLICT` | 409 | Sometimes | Concurrency, state machine, uniqueness, sequence, pool insufficiency | Explain the conflict and offer reload-and-retry |
| `CONFIGURATION` | 422 / 503 | After administrator action | Source misconfigured, mapping incomplete, flag disabled, credential absent | Distinguish "you can fix this" from "an administrator must" |
| `THROTTLED` | 429 | **Yes**, after `Retry-After` | Knowzy rate limit, or an upstream 429 surfaced | Automatic backoff, visible countdown for long waits |
| `UPSTREAM` | 502 / 503 / 504 | **Yes** | Graph, Entra, Claude, or MCP failed or timed out | Name the dependency in plain terms, not the vendor error |
| `INTERNAL` | 500 | Maybe | A defect | Correlation ID and a support path; nothing else |

### 2.1 Code registry rules

| # | Rule |
| --- | --- |
| E1 | Codes are `SCREAMING_SNAKE_CASE`, stable forever, and declared in one closed union in `@knowzy/shared-types`. A typo is a compile error |
| E2 | Each code maps to exactly one category and one default HTTP status, in one table. A code cannot mean different things on different routes |
| E3 | Each code has exactly one safe, human-readable default message, externalized for localization ([ux-design.md §9](ux-design.md#9-content-and-localization)) |
| E4 | A code is never repurposed. Retired codes are kept in the union, marked deprecated |
| E5 | New behaviour introduces a new code rather than overloading `VALIDATION_FAILED`. The existing catalogue lives with the behaviour it describes — generation preconditions in [workflows.md §2.1](workflows.md#21-preconditions), approval gates in [authoring-portal.md §5.7](authoring-portal.md#57-approval-blocking-gates), source diagnostics in [knowledge-source-administration.md §5.3](knowledge-source-administration.md#53-redaction-rules), bank verification in [sharepoint-question-bank.md §9.1](sharepoint-question-bank.md#91-verification-before-first-write) |
| E6 | Upstream vendor codes are never surfaced. Mapping to a Knowzy code is mandatory, and an unmapped upstream condition becomes `UPSTREAM_UNEXPECTED` with the raw detail logged, never returned |
| E7 | Codes carry no dynamic content. Variable parts go in `details`, so codes stay matchable and translatable |

### 2.2 Codes owned by this document

| Code | Category | Meaning |
| --- | --- | --- |
| `UPSTREAM_UNEXPECTED` | `UPSTREAM` | An upstream condition with no mapping; logged for triage |
| `CIRCUIT_OPEN` | `UPSTREAM` | The circuit breaker for this dependency is open; `retryAfterSeconds` set |
| `REQUEST_TIMEOUT` | `UPSTREAM` | The operation exceeded its declared budget |
| `RATE_LIMITED` | `THROTTLED` | A Knowzy rate limit, as opposed to an upstream one |
| `IDEMPOTENCY_KEY_REUSED` | `CONFLICT` | The same key was presented with a different request body |
| `IDEMPOTENCY_IN_PROGRESS` | `CONFLICT` | The original request is still running; retry after the stated delay |
| `VERSION_CONFLICT` | `CONFLICT` | Optimistic concurrency failure on a local row |
| `REMOTE_PRECONDITION_FAILED` | `CONFLICT` | `If-Match` rejected by SharePoint (412) |
| `SESSION_SEQUENCE_CONFLICT` | `CONFLICT` | Out-of-order session write (two tabs) |
| `SESSION_NOT_ACTIVE` | `CONFLICT` | Write to a terminal session |
| `STATE_TRANSITION_INVALID` | `CONFLICT` | The requested transition is not legal from the current state |
| `DEPENDENCY_DEGRADED` | `UPSTREAM` | The operation succeeded with reduced fidelity; `details.degradation` explains what |

---

## 3. Wire contract

RFC 9457 problem+json on every error response, from every namespace.

```jsonc
{
  "type": "https://knowzy.internal/errors/SOURCE_FOLDER_NOT_FOUND",
  "title": "Folder not found",
  "status": 422,
  "code": "SOURCE_FOLDER_NOT_FOUND",
  "category": "CONFIGURATION",
  "detail": "The folder path was not found in this library.",
  "retryable": false,
  "retryAfterSeconds": null,
  "correlationId": "c-8f2a…",
  "instance": "/api/v1/admin/knowledge-sources/…/test",
  "details": { "sourceId": "…", "pathId": "…", "folderPath": "/SOPs/Network" },
  "fieldErrors": null,
  "gateFailures": null
}
```

| Field | Rule |
| --- | --- |
| `code` | The machine contract. Clients branch on this, never on `title` or `detail` |
| `retryable` / `retryAfterSeconds` | Always present; `retryAfterSeconds` is set for every `THROTTLED` and `CIRCUIT_OPEN` response and mirrors the `Retry-After` header |
| `correlationId` | Always present, always displayable, always the same value in logs and audit |
| `details` | Allow-listed keys per code. Never a token, secret, raw provider body, document content, or answer key |
| `fieldErrors` | Populated for schema `VALIDATION`: `[{ path, code, message }]` |
| `gateFailures` | Populated for domain `VALIDATION` (422) on a transition: the full gate list with pass/fail, so an approver sees every problem at once rather than one per attempt |
| `instance` | The route, never an internal service or class name |

Partial-success responses are **200 with a per-item outcome array**, never a 2xx with a truncated
list or a 4xx that discards completed work:

```jsonc
{
  "batchId": "…",
  "summary": { "succeeded": 47, "failed": 3, "skipped": 0 },
  "items": [
    { "questionId": "KNZ-NET-2026-000412", "outcome": "PUBLISHED", "sharePointItemId": "…" },
    { "questionId": "KNZ-NET-2026-000418", "outcome": "FAILED",
      "code": "REMOTE_PRECONDITION_FAILED", "retryable": true }
  ]
}
```

MCP tools use the equivalent shape in [mcp-tools.md §4](mcp-tools.md#4-error-contract); the category
and code vocabularies are shared, so a tool failure surfaces as an API failure without translation.

---

## 4. Domain failure semantics

Where a failure means something specific to the workflow, the workflow document owns the rule. This
document owns only how the failure travels.

| Domain failure | Behaviour | Specified in |
| --- | --- | --- |
| Generation precondition unmet | 422 with the specific precondition code before any job is created | [workflows.md §2.1](workflows.md#21-preconditions) |
| Per-document retrieval failure inside a job | Job continues with the remaining documents; the failure is recorded per document and reported | [workflows.md §2.3](workflows.md#23-stage-detail) |
| Candidate question fails a gate | Not persisted; the reason is recorded on the job; the job still succeeds if other candidates passed | [workflows.md §2.3](workflows.md#23-stage-detail) |
| `insufficientEvidence` | A **success** result, not an error. Never padded with unsupported questions | [workflows.md §2.7](workflows.md#27-insufficient-evidence) |
| Approval gate failure | 422 with all 13 gate results | [authoring-portal.md §5.7](authoring-portal.md#57-approval-blocking-gates) |
| Assessment pool insufficient at publish | Publication blocked, naming the short topic and the shortfall | [authoring-portal.md §7.2](authoring-portal.md#72-selection-strategy-configuration) |
| Assessment pool insufficient at session start | 409 `ASSESSMENT_POOL_INSUFFICIENT`; learner sees "temporarily unavailable", authoring dashboard sees the cause | [workflows.md §6.1](workflows.md#61-selection-algorithm) |
| Refresher retrieval finds nothing | Approved explanation only, with an explicit statement. No invented source | [workflows.md §7.4](workflows.md#74-anti-fabrication-controls) |
| Bank drift | Surfaced for operator decision; never auto-healed | [sharepoint-question-bank.md §8](sharepoint-question-bank.md#8-reconciliation) |
| Source document extraction failure | Per-document failure record with phase, retry schedule, then quarantine; the run completes `PARTIAL`, never `SUCCEEDED` | [knowledge-source-administration.md §6.5](knowledge-source-administration.md#65-failed-document-retry) |

---

## 5. External service failures

Four external dependencies, each with its own policy. All four share one implementation: a typed
resilience wrapper configured per dependency, so retry semantics cannot drift between call sites.

| Dependency | Timeout | Retries | Backoff | Circuit breaker | On open |
| --- | --- | --- | --- | --- | --- |
| Microsoft Graph (read) | 15 s | 4 | Exponential, full jitter, cap 60 s | 5 consecutive failures per source **or** sustained 429 | `CIRCUIT_OPEN`, source marked `DEGRADED`, half-open after 30 s |
| Microsoft Graph (write) | 30 s | 3, **only through the operation-key path** | Exponential, cap 30 s | Per target list | Publishing pauses; operations stay `PENDING` and resume |
| Microsoft Entra (JWKS / OBO) | 5 s | 2 | 200 ms, 1 s | 3 failures | Cached JWKS continues to serve within its TTL; OBO failures deny the request with `UPSTREAM` |
| Anthropic Claude | 120 s | 2 per call | Exponential, honour `retry-after` | Per model | Generation jobs pause and resume; refreshers fall back to the approved explanation |
| MCP server | Per-tool budget ([mcp-tools.md §13](mcp-tools.md#13-transport-versioning-and-limits)) | 2 for idempotent reads, 0 for writes outside the key path | 250 ms, 1 s | 5 failures | `MCP_UNAVAILABLE`, stated as a platform issue, not a configuration issue |
| PostgreSQL | 10 s statement, 5 s connection | 1 on transient connection error | 100 ms | Pool-level | 503 with `retryable: true` |

### 5.1 Retry rules

| # | Rule |
| --- | --- |
| Y1 | Only **idempotent** operations are retried automatically. Non-idempotent writes are retried solely through their deterministic operation key (§6) |
| Y2 | `Retry-After` is always honoured and never shortened. Graph's throttling guidance is authoritative over local policy |
| Y3 | Full jitter on every backoff, so a throttled tenant does not produce synchronized retry storms across workers |
| Y4 | A retry budget is per **operation**, not per call: a job that has consumed its budget fails and reports rather than retrying indefinitely |
| Y5 | Retries never extend a user-visible request beyond its route budget. A long retry becomes an asynchronous job with progress, not a hanging request |
| Y6 | Circuit state is per dependency **and** per source, so one misconfigured site cannot open the breaker for every other site |
| Y7 | A 401 from an upstream is never retried with the same credential; it triggers a single credential refresh, then fails as `CONFIGURATION` |

### 5.2 Degradation, stated

Where a feature can work with reduced fidelity, it does — and says so, rather than pretending to be
whole:

| Degradation | Behaviour | Marker |
| --- | --- | --- |
| Live document search unavailable | Indexed search still works; results labelled "indexed only — live search unavailable" | `DEPENDENCY_DEGRADED` |
| Graph permission read fails | Document listing still renders; the permission column shows "unknown", never "allowed" | Explicit `UNKNOWN` value |
| Claude unavailable during a refresher | Approved explanation shown alone, with the honest no-refresher statement | `noSourceFound` / no refresher text |
| Turnaround aggregates stale | Panel renders with "as of {timestamp}" | Staleness label |
| Bank unavailable at session creation | Session creation fails with a retryable error; **in-flight sessions are unaffected** because they hold snapshots | 503, `retryable: true` |
| Blob storage unavailable | Certificate row is issued and the render is queued; the download shows "preparing" rather than a broken link | Job state |

What never degrades: authorization, approval gates, evidence verification, scoring, idempotency, and
answer-key protection. If any of those cannot be evaluated correctly, the operation fails.

---

## 6. Idempotency

| Layer | Mechanism | Scope |
| --- | --- | --- |
| Client → API (mutating learner and publish routes) | `Idempotency-Key` header, required on `POST /sessions`, `POST /sessions/{id}/answers`, `POST /sessions/{id}/complete`, and `POST /question-bank/publish` | 24 h |
| API internal | `IdempotencyRecord`: key, route, request hash, response snapshot, state (`IN_PROGRESS`, `COMPLETED`), expiry | Per subject + route |
| API → external write | Deterministic `operationKey` with a unique index ([data-model.md §6.7](data-model.md#67-publishoperation)) | Forever |
| Pre-write verification | Existence check by indexed key before every create ([sharepoint-question-bank.md §5.3](sharepoint-question-bank.md#53-the-five-idempotency-controls)) | Per operation |
| Job level | `JobRun` claim with an advisory lock; `IN_FLIGHT` beyond a timeout is re-claimed after re-checking remote state | Per job |
| Session writes | Monotonic `writeSequence` plus a key per `(session, questionIndex, submissionAttempt)` | Per session |

### 6.1 Replay semantics

| Situation | Response |
| --- | --- |
| Same key, same request body, original completed | The **original** response, byte-identical, with `Idempotent-Replay: true` |
| Same key, same body, original still running | `409 IDEMPOTENCY_IN_PROGRESS` with `retryAfterSeconds` |
| Same key, **different** body | `409 IDEMPOTENCY_KEY_REUSED`. The second request is not executed — a client bug must not silently become a second operation |
| Key expired, operation already applied externally | The pre-write existence check returns `ALREADY_PUBLISHED`; no duplicate is created. This is why the deterministic key exists in addition to the header |
| No key on a route that requires one | `400 VALIDATION` naming the header |

### 6.2 Why two layers

The header protects against a retried HTTP request; the deterministic operation key protects against
everything else — a worker crash after the external write but before the local commit, a replayed
job message, a 24-hour-later manual retry. The header is a convenience with an expiry; the operation
key is a permanent uniqueness constraint in the database. Neither alone is sufficient.

---

## 7. Concurrency conflicts

### 7.1 Local optimistic concurrency

Mutable entities carry `version`. Every update is `WHERE id = ? AND version = ?` with `version + 1`;
zero rows affected means a conflict.

| Entity | Conflict response | Resolution |
| --- | --- | --- |
| `DraftQuestion` | `409 VERSION_CONFLICT` with the current version and the field-level diff between the caller's base and current | The review workspace shows what changed and who changed it, and offers "reload" or "reapply my edits onto the current version". It never merges silently |
| `AssessmentVersion` | `409 VERSION_CONFLICT` | Reload; a published version is immutable, so conflicts occur only on drafts |
| `KnowledgeSource` | `409 VERSION_CONFLICT` | Reload; configuration edits are short and re-entry is cheap |
| `FieldMappingProfile` | `409 VERSION_CONFLICT` | Reload; activation requires re-validation anyway |

### 7.2 Remote conditional writes

Every bank update carries `If-Match: {eTag}`. A 412 becomes `REMOTE_PRECONDITION_FAILED`, and the
handling is always the same three steps: re-read the item, re-evaluate the decision
(`check_question_publish_status`), then act. A blind overwrite is not implemented, so a manual
SharePoint edit can never be destroyed by a retry — it becomes reconciliation drift for a human to
resolve.

### 7.3 State machine conflicts

| Conflict | Code | Handling |
| --- | --- | --- |
| Transition illegal from the current state | `STATE_TRANSITION_INVALID` | The response states the current state and the legal transitions from it |
| Two approvers act simultaneously | First commits; second gets `STATE_TRANSITION_INVALID` and is shown the decision that landed, with its actor | No double approval is possible — the transition is guarded by the version check in the same transaction |
| Two publishers publish one question | The unique `operationKey` admits one; the other returns `ALREADY_PUBLISHED` | Idempotent, not an error |
| Learner opens two tabs | `SESSION_SEQUENCE_CONFLICT` on the out-of-order write; the client resynchronizes from server state | No answer is lost — the persisted state is authoritative |
| Answer submitted after expiry | `SESSION_NOT_ACTIVE`, after the configured grace period | The client is told to complete |
| Sync already running for a source | The in-flight `syncId` is returned rather than a duplicate queued | Not an error |

### 7.4 Lock discipline

| Rule | Detail |
| --- | --- |
| No long-held locks | Advisory locks are held for the duration of one claim, not one batch |
| Consistent acquisition order | Question → job → source, always, so deadlock is not possible between workers |
| No user-facing pessimistic locking | There is no "question checked out to you" state. Optimistic concurrency with a good conflict UI is sufficient and cannot strand a row when a reviewer closes their laptop |
| Transaction scope | One state change plus its audit event. Long transactions spanning external calls are prohibited: the external call happens outside, and its result is committed in a short transaction |

---

## 8. Job and worker failure handling

pg-boss owns the queue ([ADR-007](risks-and-decisions.md#adr-007-postgresql-backed-job-queue-pg-boss-over-redisbullmq)).
`JobRun` is the queryable operational record.

| Concern | Policy |
| --- | --- |
| Claiming | Advisory lock per job; `claimedBy` and `claimedAt` recorded |
| Crash recovery | A job `IN_FLIGHT` past its lease is re-claimed. Recovery **re-checks external state before acting**, never assumes the prior attempt did nothing |
| Retry | Per job type: sync 3, generation 2, publish 5 (through the operation key), export 3, certificate render 5 |
| Backoff | Exponential with jitter; per-type caps |
| Poison messages | After the retry budget, the job moves to `QUARANTINED` with the last error, notifies the owner, and never blocks the queue |
| Partial completion | Recorded at the item level (`GenerationJobDocument`, `PublishOperation`, `SyncDocumentFailure`) so a resumed job skips completed work |
| Cancellation | Cooperative: a cancel flag is checked between items. A cancelled job completes items already in flight and reports `CANCELLED` with counts, rather than abandoning half-written state |
| Progress | Determinate where the total is known (documents, questions, items), with the correlation ID displayed |
| Budget exhaustion | Token or cost budget exceeded ends the job as `PARTIAL` with `BUDGET_EXCEEDED` and the counts achieved |
| Scheduled overlap | A scheduled run skips if the previous run for that source is still active, and records the skip |
| Observability | Every job emits a span and a `PLATFORM.JOB.*` audit event; failures carry the error code and the item that failed |

---

## 9. Caching rules

Caching is the easiest way to leak an answer key, so the rules are restrictive by default.

| # | Rule |
| --- | --- |
| A1 | **No answer key, explanation, evidence, or source excerpt is ever placed in a shared cache.** The only permitted store for a key is the per-session snapshot row |
| A2 | Every cache entry is keyed by `(scope, subjectOrScopeHash, resourceKey, version)`. A cache key without a scope component is a defect the cache wrapper rejects at construction |
| A3 | Learner-facing reads are cached only from key-stripped projections, so a cache hit cannot contain more than the projection allows |
| A4 | HTTP responses on `/api/v1/learning/**` are `Cache-Control: no-store`. Quiz responses are never cached by a browser, a CDN, or Front Door |
| A5 | Authoring list responses may be cached **per user** for a short TTL. Nothing is cached per role or per tenant, because scope varies within a role |
| A6 | Source and document metadata is cached with a sync-run invalidation token, so a sync makes stale entries unreachable rather than waiting for a TTL |
| A7 | Published question **content** for authoring review is cached server-side with a 60 s TTL, invalidated on publish, retire, and reconciliation |
| A8 | Field mapping profiles, feature flags, and configuration are cached in process keyed by the row's `updatedAt`; any change invalidates immediately |
| A9 | JWKS is cached with a bounded TTL and forced refresh on an unknown `kid` |
| A10 | Reporting read models are materialized, not cached, and every response carries `asOf`. A stale panel is **labelled**, never silently stale |
| A11 | Negative caching is limited to 5 s and never applied to authorization decisions |
| A12 | No shared distributed cache in release 1. In-process caches only, so a cache cannot outlive a deployment or be read by another component ([ADR-007](risks-and-decisions.md#adr-007-postgresql-backed-job-queue-pg-boss-over-redisbullmq) removes the Redis dependency that would otherwise tempt this) |
| A13 | Every cache is instrumented with hit rate and staleness; a cache with no metrics is not permitted |

---

## 10. User-facing error presentation

### 10.1 The contract

Every error shown to a person answers four questions, in this order:

1. **What happened**, in plain language, without vendor names or internal identifiers.
2. **Whether it can be retried**, and by whom — the user, or an administrator.
3. **What to do next**, as a concrete action, ideally a button.
4. **The correlation ID**, so support starts from the trace.

Never shown: stack traces, class or service names, SQL, Graph or Anthropic error bodies, internal
IDs other than the correlation ID, or the phrase "an unexpected error occurred" with nothing else.

### 10.2 By category

| Category | Presentation | Example (illustrative) |
| --- | --- | --- |
| `AUTHENTICATION` | Silent re-auth, then a sign-in prompt. Never a raw 401 | "Your session expired. Sign in to continue." |
| `AUTHORIZATION` | State the boundary, not the resource's existence | "You do not have permission to approve questions in the Network domain. Ask a Network approver or a platform administrator." |
| `VALIDATION` (schema) | Inline, field-level, on the field | "Explanation is required." |
| `VALIDATION` (gates) | A checklist showing **all** failures at once, each linking to the field that fixes it | "This question cannot be approved yet: evidence not verified; duplicate not dispositioned." |
| `NOT_FOUND` | Non-committal, with a path back | "This question is not available. It may have been archived." |
| `CONFLICT` | Explain and offer the resolving action | "Someone else edited this question while you were working. Review their changes, then reapply yours." |
| `CONFIGURATION` (user-fixable) | Name the field and the fix | "No document library named 'Documents' exists on this site. Check the library name." |
| `CONFIGURATION` (admin-fixable) | Say plainly it is not the user's to fix | "Publishing is not enabled for this environment. A platform administrator must enable it." |
| `THROTTLED` | Automatic retry with a visible countdown for waits over 3 s | "SharePoint is busy. Retrying in 12 s." |
| `UPSTREAM` | Name the capability, not the vendor; state the impact | "The knowledge source is not responding. Browsing is unavailable; your drafts are unaffected." |
| `INTERNAL` | Apologize once, give the ID, give a support path | "Something went wrong on our side. Reference c-8f2a…" |

### 10.3 Placement

| Failure scope | Presentation |
| --- | --- |
| A field | Inline, adjacent to the field, announced to assistive technology |
| An action | Toast or inline banner adjacent to the control, with the retry action |
| A panel | The panel shows its own error and retry; the rest of the page renders. A failed panel **never blanks the page** ([authoring-portal.md §12](authoring-portal.md#12-empty-loading-and-error-states)) |
| A page | Full-page error with navigation intact |
| A long operation | Progress view carries the failure, the per-item outcomes, and per-item retry |

### 10.4 Learner-specific rules

| # | Rule |
| --- | --- |
| L1 | An error during a quiz never implies lost progress, because there is none: every answer is persisted before its response returns. The message says so explicitly |
| L2 | A failed answer submission retries automatically with its idempotency key; the learner is warned, never silently failed |
| L3 | An error message never reveals anything about correctness, the answer key, or the score |
| L4 | An eligibility failure states the specific reason (attempt limit, cooling-off with a date, availability window) rather than disabling the button silently |
| L5 | A pool-insufficiency failure is presented as "temporarily unavailable" — it is an authoring problem, and telling a learner about pool mechanics would be both confusing and an information leak |
| L6 | Timed assessments show remaining time from the server's authoritative value; on expiry the learner is told to complete, never told an answer was rejected without explanation |
| L7 | Every error state meets the accessibility contract: announced, keyboard-reachable retry, not colour-only ([ux-design.md §7](ux-design.md#7-accessibility-standards)) |

### 10.5 Copy standards

| Rule | Instead of | Write |
| --- | --- | --- |
| No blame | "You entered an invalid folder path" | "That folder path was not found in this library" |
| No vendor detail | "Graph returned 403 Forbidden" | "The platform does not have access to this site" |
| No jargon | "Optimistic concurrency violation" | "Someone else edited this while you were working" |
| No false certainty | "Connection healthy" (untested) | "Not yet tested" |
| No dead ends | "Contact your administrator" | "Ask a platform administrator to enable publishing for this environment" |
| One voice | — | All error copy is externalized in one catalogue, reviewed as product copy, and versioned with the code registry (E3) |
