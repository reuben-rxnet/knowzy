# Microsoft Graph Integration Plan

**Roadmap phase:** 7a — the Graph client, built before and separately from the adapters that use it.
**Status:** NOT STARTED. No `graph` module exists in any workspace.
**Scope:** the HTTP client that reaches Microsoft Graph, and nothing above it. Resource paths belong
to [architecture.md §8.2](../architecture.md#82-graph-resource-path-strategy); what to ask for belongs
to [integration-plan-sharepoint.md](integration-plan-sharepoint.md) and Phase 8.

---

## 1. Why this is a separate plan from SharePoint

SharePoint is *what we ask for*. Graph is *how we call it safely*. They are separated here because
the Graph concerns — token acquisition, on-behalf-of exchange, throttling, retry, circuit breaking,
error redaction — are:

- **Shared by two adapters.** The knowledge-source adapter (Phase 7) and the Question Bank adapter
  (Phase 8) both need every one of them. Building them inside the first adapter guarantees they are
  re-implemented or awkwardly extracted for the second.
- **Independently testable without a tenant.** Throttling, retry and circuit behaviour are testable
  by injecting responses. Folded into an adapter, they become reachable only through adapter methods
  and their failure modes stop being directly assertable.
- **Already written down as pending tests.** The conformance suite declares
  `it.todo('an injected 429 honours Retry-After')` and `it.todo('repeated failures open the
  circuit')`. Those are Graph-client assertions sitting in an adapter suite, which is the clearest
  possible signal that the concern wants its own home.

**Recommended placement:** a new internal module owned by `mcp-server`, or a package that only
`mcp-server` depends on. It must **not** be depended on by `@knowzy/domain` (boundary rule B3), and
the Graph credential is readable by `mcp-server` alone (C6) — so no other deployable has a reason to
link it.

---

## 2. Responsibilities

| Responsibility | Requirement | Specified in |
| --- | --- | --- |
| Token acquisition — app-only | Client credentials against T-04/T-15 registration, **certificate preferred over secret**. Token from Key Vault reference only; never a literal | env contract: `GRAPH_CREDENTIAL_REF` is a `keyvault://` reference validated by regex |
| Token acquisition — delegated | On-behalf-of exchange of the caller's token, per call | architecture.md §8.3 |
| Token caching | Per credential and per scope, with expiry honoured. A cache keyed only by scope would let a delegated token serve another user | §5.1 below |
| Paging | Follow `@odata.nextLink`; surface an **opaque** cursor upward | architecture.md §8.2; contract `Page<T>.nextCursor` |
| Throttling | Token bucket **per site**, honour `Retry-After` | [error-handling.md §5](../error-handling.md#5-external-service-failures) |
| Retry | Bounded, on retryable conditions only, with jitter | error-handling.md §5 |
| Circuit breaking | **Per source**; opens on repeated failure; source marked `DEGRADED` | error-handling.md §5, knowledge-source-adapters.md §3 |
| Streaming | Content streamed to the extractor with the size cap applied **before download completes**. Bytes never buffered whole, never persisted | knowledge-source-adapters.md §3 |
| Cancellation | Honour the `AbortSignal` from `AdapterContext` on every request | contract `AdapterContext.signal` |
| Error mapping and redaction | Graph conditions → Knowzy error codes. **No provider body, token, or secret in any response, audit event, or log line** | [knowledge-source-administration.md §5.3](../knowledge-source-administration.md#53-redaction-rules); Phase 7 exit criterion |
| Correlation | Propagate the correlation ID from `AdapterContext` into request headers so a Graph call is traceable to a user action | [audit-model.md §4](../audit-model.md#4-correlation-model) |

---

## 3. Build order

| # | Increment | Testable without a tenant? |
| --- | --- | --- |
| 1 | Credential resolution from a Key Vault reference; app-only token acquisition; token cache | Yes — fake the vault and the token endpoint |
| 2 | Request execution: correlation header, `AbortSignal`, paging, opaque cursor | Yes |
| 3 | Throttling, retry with jitter, circuit breaker per source | Yes — **this is where the two `it.todo`s land** |
| 4 | Error mapping and redaction | Yes — assert on a redaction test corpus (§5.2) |
| 5 | Streaming download with a pre-completion size cap | Yes |
| 6 | Delegated OBO exchange | Needs a tenant and two principals |
| 7 | Recorded-fixture capture and scrub tooling | Needs a tenant (T-40) |

Increments 1–5 are the majority of the value and need **no tenant at all**. That is the argument for
doing this before the adapter rather than alongside it: the client can be finished, tested and
merged while the tenant grants are still in a queue.

---

## 4. Verification

| Behaviour | Test |
| --- | --- |
| `429` with `Retry-After: n` | Waits ≥ n, then retries, and does not exceed the bounded attempt count. Promote the conformance `it.todo` |
| Repeated failure | Circuit opens; subsequent calls fail fast without a request; source transitions to `DEGRADED`. Promote the conformance `it.todo` |
| `503` / transient | Retried with jitter; **jitter is asserted as a range, not a value**, or the test is flaky by construction |
| `401` after token expiry | One re-acquisition, then propagate. Not an infinite refresh loop |
| `403` | Mapped to a permission-shaped Knowzy code; **not** retried; no Graph body leaked |
| `404` | `SourceDocumentNotFoundError`, which the contract already declares |
| Abort mid-request | The in-flight request is cancelled and the method rejects promptly |
| Size cap | A file exceeding `limits.maxBytes` is refused **without downloading it whole** — assert on bytes read, not on the outcome alone, or the test passes against a buffering implementation |
| Redaction | See §5.2 |

---

## 5. Three decisions that are not yet written down anywhere

### 5.1 Token cache keying — a correctness trap, not a performance choice

An app-only token cache keys naturally on credential + scope. A **delegated** token must not share
that shape: keyed on scope alone, principal A's token would be served to principal B, and the
platform's permission trimming would silently become "whoever warmed the cache". Every
`DELEGATED_OBO` guarantee in security.md §7 and every delegated exit criterion in Phase 7 would still
pass their tests while being false in production.

**Decision required:** delegated tokens are cached per **principal** + scope, or not cached at all.
**Recommendation:** per principal with a conservative TTL, and a test that two principals in the same
process receive different tokens. This is the highest-severity item in this plan because it fails
silently and its blast radius is cross-user data exposure.

### 5.2 Redaction needs a falsifiable test, not a code review

The Phase 7 exit criterion — "no Graph error body, token, or secret appears in any response, audit
event, or log line" — is a universal claim over all output. Universals are not verifiable by
inspection, and this repository has already learned that lesson the hard way: three "passing"
mechanisms in it were vacuous, which is why `CLAUDE.md` now requires mutating a suite to confirm it
fails.

**Decision required:** a redaction test corpus of realistic Graph error payloads — including a body
containing a bearer token, a tenant hostname, a user principal name and a site GUID — pushed through
the client with every emitted response, audit detail and log line asserted clean.

**Recommendation:** build it in increment 4 and plant each leak class to confirm the test fails
before trusting it. The audit `detail` allow-list in `packages/observability/src/audit.ts` already
drops undeclared keys, which helps — but it drops *keys*, not secrets inside declared values.

### 5.3 Per-site throttling with a stored site ID

The token bucket is specified "per site". Sites are identified by a resolved-and-stored site ID
(integration-plan-sharepoint.md §4). Two knowledge sources may point at the **same** site with
different folder paths, and two buckets for one site would let the platform exceed the tenant's limit
while each bucket believes itself compliant.

**Decision required:** the bucket is keyed on resolved site ID, not on `knowledgeSourceId`.
**Recommendation:** key on site ID, and assert it with two sources sharing a site.

---

## 6. Recorded fixtures

Fixtures are what make increments 1–5 and adapter conformance runnable in CI forever without a
tenant. They must be captured from a real dev site (T-40) and then **scrubbed**: no tokens, no tenant
hostname, no user principal names, no customer-identifying site, drive or item GUIDs.

**A fixture that leaks a tenant identifier into a repository is a security incident produced by a
test.** So scrubbing cannot be a manual step in a runbook.

**Recommendation:** a contract test that greps the fixture corpus for tenant-shaped strings — bearer
prefixes, `*.sharepoint.com`, UPN-shaped values, the tenant GUID — and fails the build on a match.
That is the same pattern already used successfully for design assets (byte-comparison against the
approved pack) and for fabricated metrics (a scan that fails the build), both of which caught real
problems that prose did not.

---

## 7. Definition of done

The client is done when increments 1–5 are merged with the tests in §4 passing, the two conformance
`it.todo`s are real and passing, the §5 decisions are recorded, and the fixture-leak guard is in the
build. Increments 6–7 complete with the tenant grants.

It is **not** done when a Graph call succeeds. One successful call proves the happy path, which is
the path least likely to cause a pilot incident.
