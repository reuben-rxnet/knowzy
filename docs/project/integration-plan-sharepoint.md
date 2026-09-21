# SharePoint Integration Plan

**Roadmap phase:** 7 — SharePoint read integration. (The commissioning brief called this "Phase
9.1"; see [ENTERPRISE_PILOT_READINESS.md](ENTERPRISE_PILOT_READINESS.md) §0.)
**Status:** Design complete before this document was written. Implementation NOT STARTED.
**Scope:** `SharePointKnowledgeSourceAdapter` — reading knowledge documents. The Question Bank
*list* is a different site, a different grant and a different adapter; it is Phase 8 and appears here
only where the two share the Graph client.

---

## 1. What this plan is, and what it deliberately is not

The brief asks for a design covering site discovery, library discovery, folder access, file access,
delta synchronization, metadata extraction and permission trimming.

**All seven are already specified**, normatively, in documents that outrank this one:

| Capability | Already specified in |
| --- | --- |
| Site discovery | [architecture.md §8.2](../architecture.md#82-graph-resource-path-strategy) — `GET /sites/{hostname}:/sites/{path}` |
| Library discovery | architecture.md §8.2 — `GET /sites/{site-id}/drives` |
| Folder access | architecture.md §8.2 — `GET /drives/{drive-id}/root:/{folder-path}:/children`, `@odata.nextLink` |
| File access | architecture.md §8.2 — metadata and `/content`, **streamed** to the extractor |
| Delta synchronization | architecture.md §8.2 + [knowledge-source-adapters.md §3](../knowledge-source-adapters.md#3-sharepoint-adapter) — `/root/delta`, checkpointed, invalid token falls back to full scan |
| Metadata extraction | [architecture.md §8.4](../architecture.md#84-content-extraction-pipeline), [sharepoint-field-mapping.md](../sharepoint-field-mapping.md) |
| Permission trimming | [architecture.md §8.3](../architecture.md#83-permission-modes), [security.md §7](../security.md#7-permission-aware-retrieval) |

So this document does not re-specify them. Re-specifying would fork the source of truth and produce
two documents that drift — and `/docs` wins over anything here by construction.

**What this adds** is the part that does not exist yet: the *delivery* plan. What to build in what
order, what proves each piece, which decisions are genuinely still open, and where the existing
design is thinner than it looks.

---

## 2. The contract is already the design

`packages/knowledge-source-adapters/src/contract.ts` was written for SharePoint and then had every
SharePoint word removed. That inversion is worth seeing, because it means implementing the adapter is
mostly *translation*, not design:

| Contract element | The SharePoint reality it encodes |
| --- | --- |
| `Container` / `containerId` | A site, or a drive within it. Generic so a non-SharePoint source fits (G8) |
| `SourceItem.sourceVersion` | `eTag` — but see §5.2, because eTag alone is a trap the contract already warns about |
| `SyncEvent.STATE_CHECKPOINT` with an **opaque** `state` string | The Graph delta token. Opaque means the platform persists and replays it without parsing, so a token format change is not a platform change |
| `getEffectiveAccess(): AccessDecision` with `'ALLOWED' \| 'DENIED' \| 'UNKNOWN'` | `GET /items/{id}/permissions`, **and** the case where the caller cannot read permissions. `UNKNOWN` is first-class: a source that cannot answer must say so rather than have the platform assume either answer |
| `AccessDecision.enforcement: 'SOURCE' \| 'PLATFORM' \| 'NONE'` | `DELEGATED_OBO` trims at the source; `APP_ONLY_SITES_SELECTED` trims at the platform — and the UI is required to say which |
| `AdapterCapabilities` | Capability negotiation. `supportsPermissionCheck: false` forces `UNKNOWN`, never `ALLOWED` |
| `writeCapable: false` — the **literal type**, not a boolean | A write-capable knowledge adapter is not expressible. "Documents are read-only to the platform" is a compile error, not a policy |
| `AdapterContext.signal: AbortSignal` | Every method must honour the calling tool's declared timeout |
| `AdapterContext` has **no database handle** | The adapter returns data; MCP persists. An adapter cannot corrupt platform state |

**Consequence for the plan:** the adapter has no latitude to invent behaviour. Its correctness is
defined by a suite that already exists (§7), which is why this is a tractable piece of work rather
than an open-ended one.

---

## 3. Build order

Five increments, each independently demonstrable. Steps 1–2 need no tenant.

| # | Increment | Needs a tenant? | Proves |
| --- | --- | --- | --- |
| 1 | Graph client — see [integration-plan-microsoft-graph.md](integration-plan-microsoft-graph.md) | No (recorded fixtures) | Auth, throttling, retry, circuit, redaction |
| 2 | `SharePointKnowledgeSourceAdapter` against **recorded Graph fixtures**: containers, items, document, extract | No | The conformance suite passes with no assertion relaxed |
| 3 | Test Connection — all nine checks, against a real dev site | Yes: T-09..T-12, T-15, T-16 | Identifier resolution and honest per-check reporting including `NOT_RUN` short-circuits |
| 4 | Delta synchronization against a real library | Yes | Checkpoint, resume, invalid-token fallback, deletion handling |
| 5 | Both permission modes | Yes: T-14 | `DELEGATED_OBO` trimming matches SharePoint's own; app-only labels enforcement as `PLATFORM` |

**Step 2 before step 3 is the load-bearing choice.** Recorded fixtures mean the adapter's contract
conformance is settled before any tenant variable enters, so a failure in step 3 is unambiguously a
*tenant or credential* problem rather than an adapter problem. Without that separation the first
real-site failure is a two-variable debug, and those are the ones that consume weeks.

---

## 4. Identifier resolution: resolve once, store, never on a hot path

Already specified in knowledge-source-adapters.md §3 and restated here because it is the most likely
thing to be implemented wrongly:

```
Administrator enters:   https://{tenant}.sharepoint.com/sites/{path}  +  library name  +  folder path
                                         │
                        Test Connection resolves ONCE
                                         │
                        site ID, drive ID  ──►  STORED on KnowledgeSource
                                         │
                        Every subsequent call uses the stored IDs
```

A site URL is human-facing configuration; a site ID is a machine identifier. Resolving on every
listing would add a Graph round trip per request and make throttling behaviour depend on traffic
shape. **Nothing hand-enters a site ID, and nothing re-resolves one outside Test Connection.**

---

## 5. Where the existing design is thinner than it looks

Four places where an implementer will need a decision that is not yet written down. This is the most
useful part of this document.

### 5.1 The nine Test Connection checks are named as an exit criterion but not enumerated in one place

Phase 7's exit criteria require "all nine Test Connection checks execute against a real dev site and
report per-check results honestly, including `NOT_RUN` short-circuits". The contract provides the
shape (`ConnectionTestCheck` with `PASS | FAIL | SKIP` and an administrator-actionable `detail`), and
[knowledge-source-administration.md](../knowledge-source-administration.md) describes the surface —
but **the canonical list of nine should be pinned before implementation**, because "nine" in an exit
criterion and an unenumerated list is how a suite ends up asserting seven.

**Action:** enumerate the nine in `knowledge-source-administration.md` (its document, not this one)
as the first task of step 3, and assert the count in the conformance suite so a missing check fails
the build.

### 5.2 eTag is not a content change, and the contract says so — but nothing enforces it yet

knowledge-source-adapters.md §3 is explicit: "`eTag` change alone is treated as a candidate, not a
content change. The content hash decides, because SharePoint bumps `eTag` for metadata and permission
events."

This is exactly the conformance suite's `it.todo('a metadata-only change yields a new sourceVersion
with an unchanged hash')`. **It is the single most consequential correctness rule in Phase 7**: get
it wrong and every permission change in a SharePoint library triggers a re-extraction and a
regeneration candidacy, which looks like the platform working hard and is in fact the platform
churning. Worse, it interacts with preflight check `SOURCE_CONTENT_CHANGED`, which would then report
a change that did not happen and recommend `REGENERATE` against unchanged content.

**Action:** implement that `todo` against a recorded fixture pair (same bytes, bumped eTag) in step
2, before any real site is connected.

### 5.3 `DELEGATED_OBO` trimming "matches SharePoint's own" — which needs a falsifiable test

The exit criterion is that delegated trimming matches SharePoint's trimming. That is only checkable
against a site where a document is deliberately denied to a test principal. The mock adapter already
models this (`deniedDocumentPath` is a first-class part of `ConformanceSubject`), so the test shape
exists — what is missing is the **tenant-side fixture**: a real document in the dev site that a named
test account cannot open.

**Action:** add to the tenant request (§8) a dev-site document with a restricted permission and a
test principal who cannot read it. Without it, the criterion is unfalsifiable and will be signed off
on inspection.

### 5.4 A-04 is likelier to bite than its confidence rating suggests

Assumption A-04 (documents are predominantly text-bearing) is rated Medium with the consequence
"scanned/image-only PDFs yield `EXTRACTION_EMPTY`; OCR is out of scope; this is risk R-06 and it is
likelier than it looks". That last clause is the honest one and it should drive an early
measurement, not a late discovery.

**Action:** in step 3, before building delta sync, run extraction across a **representative sample**
of the real library and report the `EXTRACTION_EMPTY` rate. If a material fraction of the corpus is
scanned, that is a scope conversation with the business (OCR, or excluding those documents, or
accepting reduced coverage) and it is far cheaper in week 3 than in month 3.

---

## 6. Permission trimming: the property to protect

security.md §7 and architecture.md §8.3 specify the modes. The rule that must survive
implementation, restated because it is easy to optimise away:

> A document discovered by a background job is **not** automatically visible to a user. Visibility is
> re-evaluated against the user at read time.

Background synchronization necessarily runs `APP_ONLY_SITES_SELECTED` — there is no interactive user.
So the sync sees everything the platform credential can see, which is broader than any one learner.
Caching that result as "visible" would leak document titles across a permission boundary. The
platform's own restriction layers (role, domain, team, business function, `UserSourceAccess`) plus a
read-time access decision are what close it.

**Test to write:** a document synchronized by a background job, then requested by a user who cannot
read it in SharePoint, is absent from listing, absent from search, refused for extraction, and
excluded from refresher candidacy — each with a stated reason. The exit criteria already require
this; it needs the denied-document tenant fixture from §5.3.

---

## 7. Verification strategy

**The conformance suite is the specification.** `packages/testing/contracts/adapter-conformance.ts`
takes any `KnowledgeSourceAdapter` plus a `ConformanceSubject` and asserts the contract. Its header
states the rule: "a behaviour asserted here is normative for every adapter; a behaviour absent here
is not guaranteed to any consumer."

Phase 7 therefore has an unusually crisp definition of done:

1. `runAdapterConformanceSuite` passes for the SharePoint adapter **with no assertion relaxed and no
   group skipped**. If an assertion has to be weakened to accommodate SharePoint, that is a contract
   finding to be discussed, not a test to be edited.
2. The three Graph-shaped `it.todo`s become real: `429`/`Retry-After`, circuit opening, and the
   metadata-only eTag case (§5.2).
3. Every Phase 7 exit criterion in [implementation-roadmap.md](../implementation-roadmap.md) §3 has
   a named test.

**Recorded Graph fixtures** are the mechanism that makes 1 and 2 runnable in CI with no tenant. They
must be captured from a real dev site and then **scrubbed**: no tokens, no tenant hostnames, no user
principal names, no site or drive GUIDs that identify the customer. A fixture that leaks a tenant
identifier into a public repository is a security incident produced by a test.

---

## 8. What the tenant must provide, and the two additions

Existing, from [assumptions-and-tenant-configuration.md](../assumptions-and-tenant-configuration.md)
§3.2: **T-09** tenant hostname · **T-10** site URLs · **T-11** library names · **T-12** folder paths ·
**T-13** columns to capture · **T-14** permission mode per source · **T-15** Graph credential
(certificate preferred) · **T-16** `Sites.Selected` **Read** per site · **T-17** source owner ·
**T-18** taxonomy with immutable domain codes · **T-19** objective catalogue · **T-20** sync schedule.

Two additions this plan recommends adding to that register, both justified above:

| New | Value | Why | For |
| --- | --- | --- | --- |
| **T-39** | A dev-site document with a restricted permission, plus a test principal who cannot read it | Makes the delegated-trimming and permission-exclusion exit criteria falsifiable rather than inspectable (§5.3, §6) | Step 5 |
| **T-40** | Permission to capture and scrub recorded Graph fixtures from the dev site | Without it, conformance cannot run in CI and every regression needs a live tenant (§7) | Step 2 |

Recommending a new tenant value is a change to another document's register, so it is proposed here
and **not written into** `assumptions-and-tenant-configuration.md` by this plan.

---

## 9. Risks specific to this phase

| Risk | Likelihood | Mitigation already designed | Residual |
| --- | --- | --- | --- |
| Scanned/image-only PDFs (A-04, R-06) | Medium-high | `EXTRACTION_EMPTY` is an honest outcome, not a crash | Coverage. Measure early (§5.4) |
| Throttling under a real corpus (A-12) | Medium | Token bucket per site, `Retry-After`, circuit breaker per source, source marked `DEGRADED` | Sync duration on first full scan of a large library |
| eTag churn misread as content change | **High if unaddressed** | Hash confirmation is specified | Implement and test it in step 2 (§5.2) |
| Delta token invalidation | Medium | Falls back to full scan, logged, **not** surfaced as a failure | A silent full scan is slow; ensure it is visible in sync history |
| Fixture scrubbing leaks a tenant identifier | Low, severe | — | Needs an explicit scrub step and a test that greps fixtures for tenant-shaped strings |

---

## 10. Definition of done

Phase 7 is complete when every exit criterion in
[implementation-roadmap.md §3](../implementation-roadmap.md) Phase 7 has a passing named test, the
conformance suite passes unrelaxed, the nine Test Connection checks are enumerated and asserted, and
the `EXTRACTION_EMPTY` rate across the real corpus has been measured and reported to the business.

It is **not** complete when documents merely appear in the browser. That is the demo; the exit
criteria are the deliverable.
