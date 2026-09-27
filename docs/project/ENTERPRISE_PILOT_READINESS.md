# Knowzy — Enterprise Pilot Readiness

**Status:** Assessment. Planning artifact only — no application code was changed to produce it.
**Assessed at:** commit `44749cb` (main, synchronized with `origin/main`), 2026-09-21
**Assessed by:** reading the repository, not the status reports. Where this document and
[MVP-READINESS.md](../MVP-READINESS.md) disagree, both were written from the same tree and the
**code is the authority** (`CLAUDE.md`).

---

## 0. Read this first: the phase numbering in the brief is wrong, and it matters

The instruction that commissioned this document called the work **"Phase 9.1"**. The authoritative
sequence is [implementation-roadmap.md](../implementation-roadmap.md), and by that sequence:

| The brief calls it | The roadmap calls it | Status |
| --- | --- | --- |
| Phase-9.1 SharePoint Adapter | **Phase 7** — SharePoint read integration | NOT STARTED |
| Phase-9.1 Question Bank | **Phase 8** — Question Bank write integration | Port + mock done; adapter NOT STARTED |
| Entra readiness | **Phase 2** — Identity and access | Done *with the local stub issuer*; Entra deferred |
| Claude readiness | **Phase 4** — Generation and governance | Done *with the deterministic local generator*; live model deferred |

**Roadmap Phase 9 is "Refreshers and recognition"** — badges, certificates, weak-topic analysis —
which the brief explicitly excludes. So "Phase 9.1" names, in the roadmap's vocabulary, the one
phase this work is *not*.

This is not pedantry about labels. Four consequences follow:

1. The four integrations are **not one phase**. They are three roadmap phases plus the deferred half
   of a fourth, with different owners, different tenant values, and different blocking approvals.
2. They have a **forced order** that the roadmap already encodes (§1 sequencing principles), and it
   is not the order the brief lists them in. See §10.
3. Calling them 9.1 would put enterprise integration *after* recognition in the roadmap, which
   inverts the dependency: badges and certificates are worth nothing in a pilot whose questions
   cannot be published to the tenant.
4. Renumbering the roadmap to match the brief would edit the source of truth to match a passing
   instruction. This document keeps the roadmap's numbers and uses **"Pilot Workstream"** for the
   grouping the brief is reaching for.

Throughout: **Pilot Workstream = roadmap Phases 2 (Entra), 7 (SharePoint read), 8 (Bank write), and
the live-generator half of 4 (Claude).**

---

## 1. Enterprise Pilot Readiness Report

### 1.1 The verdict in one paragraph

The platform is **architecturally ready and operationally unready**. Every external dependency sits
behind a port that was written for the real implementation rather than for the mock: the two adapter
contracts, the generator port, and the subject resolver all already express the production concerns —
delta checkpoints, permission trimming, ETag concurrency, idempotency keys, capability negotiation,
fail-closed identity. That is the expensive half and it is done. What is missing is every line of
code that speaks to an actual Microsoft or Anthropic endpoint, plus the tenant grants to speak to
them with. **No enterprise integration has ever been exercised against a live service from this
repository.**

### 1.2 Component-by-component

Ratings mean: **Production-ready** — would ship to a pilot as-is. **Ready behind a mock** — the
platform-side logic is complete and tested; only the external adapter is absent.
**Partially built** — real gaps in platform logic, not just the adapter. **Not built.**

| Component | Rating | What exists | What a pilot still needs |
| --- | --- | --- | --- |
| **Identity** | Partially built | `SubjectResolver` port; local stub issuer, which **throws if constructed outside `local`**; roles and scopes resolved from the database per request (ADR-011); account status re-checked per request | `createEntraResolver()` is a stub that throws. **Any non-local deployment fails every request today.** This is the single hardest gate in the workstream |
| **Authorization** | Production-ready | Closed `PermissionKey` union (**47 keys**); seeded role matrix (14 roles); ~~55~~ **68 API routes** each with a declared policy, asserted by a build-failing registry test; 13 approval gates re-evaluated server-side at every transition. **Taxonomy is now managed through the product** under `taxonomy.manage` — domains and topics were seed-only until 2026-09-22 | Nothing structural. Entra group → role *provisioning* is additive and never authorizes (ADR-011, T-06) |
| **Knowledge Sources** | Ready behind a mock | `KnowledgeSourceAdapter` contract written for SharePoint: containers, folder hierarchy, delta via opaque `STATE_CHECKPOINT`, `getEffectiveAccess` with a first-class `UNKNOWN`, capability negotiation, both permission modes, `writeCapable: false` as the literal type. Mock adapter runs the **real extractors over real files** and satisfies a reusable conformance suite | `SharePointKnowledgeSourceAdapter` — zero lines exist. Roadmap Phase 7 |
| **Question Bank** | Ready behind a mock | `QuestionBankAdapter` port with **required** `ifMatch`, `operationKey` idempotency, and **no delete method** — governance rule G7 enforced by the type system. Mock persists to JSON and is conformance-tested. `PublishedQuestionReference` projection populated | `SharePointQuestionBankAdapter`, field-mapping profile validation, list provisioning, reconciliation. Roadmap Phase 8 |
| **Question Generation** | Ready behind a mock | The **entire gate chain is model-agnostic and built**: nonce-delimited untrusted framing with a zero tool grant, Zod output schema, evidence verification (STRICT exact / STANDARD ≥0.95 trigram), option integrity, six-component composite confidence, rejection taxonomy, prompt-version records on jobs and questions | A `QuestionGenerator` whose `kind` is `'anthropic'`. The port already declares that variant. No Anthropic SDK is a dependency of any workspace |
| **Governance** | Production-ready | 13 gates, separation of duties (gate 13), evidence spans with character offsets, duplicate disposition, preflight with six checks and a recorded decision, append-only audit with a declared detail allow-list, idempotent publishing | Nothing for a pilot. Reconciliation drift handling arrives with Phase 8 |
| **Reporting** | **Not built** *(at the date of this assessment — see §12.9: R1 and R2 built a dashboard and twelve reports)* | `@knowzy/reporting` is an 18-line placeholder that exports its own `IMPLEMENTED_IN = 'Phase 10'`. `report_definition`/`_run`/`_export`/`_schedule` tables exist and are empty. No aggregate read model exists anywhere | Everything. Roadmap Phase 10. **A pilot that promises reports will not have them** |
| **Learner Experience** | Production-ready for assessment | Eligibility snapshots pin the pool at publication; one question at a time with every answer server-persisted; resume from the URL; deterministic scoring; per-topic results and gap states; answer-key protection asserted at runtime | No per-learner **results list** endpoint, so no progress history, proficiency trend or org-level gap view. Badges and certificates are Phase 9 and excluded from this workstream |

### 1.3 What the pilot can honestly claim today

Everything on mock adapters, in a browser, with no tenant credentials: source configuration and
synchronization, document browsing, governed generation with refusals, **question-bank import under
the same gates**, **taxonomy administration**, draft review, approval under separation of duties,
publication to a reusable bank with idempotency, assessment publication with a pinned pool, and a
scored learner attempt with resume.

`npm run verify` is green — typecheck 34/34, lint 22/22, boundaries 0 errors, codegen clean,
**876 tests passed and 12 todo across 42 files**. `npm run test:e2e` is green — **24 browser acceptance tests** driving all three applications
against the running stack: 23 pass and 1 skips for a stated precondition (no failed sync run is
within the activity feed's last 25 rows).

Re-counted 2026-09-24. The figures in §1.2 and §1.3 had drifted twice (55 routes, 728 tests, 10
browser tests) and are corrected here rather than left for the next reader to trust.

Figures re-counted on 2026-09-23;
[STATUS_RECONCILIATION_2026-09-23.md](STATUS_RECONCILIATION_2026-09-23.md) records what was stale
and why.

### 1.4 What the pilot cannot claim, and must not imply

- **Nothing in this repository has ever talked to SharePoint, Graph, Entra, or Anthropic.**
- **Question quality has never been tested against a model.** Generation is deterministic and
  records `modelId = knowzy-deterministic-local-1`. Quality is the product's actual purpose and it
  is the one thing the MVP did not evaluate.
- ~~**No automated test drives the UI.**~~ **Corrected 2026-09-23.** `tools/e2e` drives both
  portals in a browser: sources, generation, review, **gate 13**, publication, and a learner
  attempt including resume and scoring — steps 1–9, 11–18 and 21–29 of
  [initial-end-to-end-proof.md](../initial-end-to-end-proof.md) §3. What it still does **not**
  cover, because the platform does not implement it: refreshers (30–31), the revalidation queue
  (32–33), the audit surfaces (35–36), the second-tab sequence conflict (26), and forcing
  `SOURCE_NOT_CONFIGURED` by removing a credential (3). Those are named exclusions rather than
  skipped tests, because a skipped test reads like coverage.
- ~~**The container image vulnerability scan has never executed.**~~ **Corrected 2026-09-23.** It
  ran against all five images: 16 HIGH/CRITICAL, reduced to 0 by removing `npm` from the runtime
  stage, not by suppression. See §12.5.
- **Reporting does not exist**, with one exception as of 2026-09-24: **Governance → AI Usage &
  Budgets** reports token usage, cost accounting, budget consumption and provider health from
  records that exist (§12.6). Everything else in §1.2's Reporting row is unchanged.

---

## 2. Production Integration Gap Analysis

### 2.1 The shape of the gap

The gap is unusually clean, and that is the most important finding in this document. For three of
the four integrations, the work is **"implement one interface"** rather than "design and thread a
new concern through the platform". The ports were written against the production requirement:

- `KnowledgeSourceAdapter` already has `synchronize(): AsyncIterable<SyncEvent>` with an opaque
  `STATE_CHECKPOINT` the platform persists and replays — that *is* Graph delta tokens, expressed
  without naming them.
- `QuestionBankAdapter.updateItem()` takes `ifMatch` as a **required positional parameter** — that
  *is* the Graph `If-Match` header, and a blind overwrite is not expressible.
- `AdapterContext.permissionMode` is `'DELEGATED_OBO' | 'APP_ONLY_SITES_SELECTED'` — both Graph
  modes, already threaded to every adapter call with an `AbortSignal` and a correlation ID.
- `QuestionGenerator.kind` is `'deterministic-local' | 'anthropic'`. The second member has no
  implementation and no other referent.

The **reusable conformance suite** (`packages/testing/contracts/adapter-conformance.ts`) is the
mechanism that converts this from a claim into a plan: it takes any adapter and asserts the contract.
Its own header says the SharePoint adapter "will be handed this same function, and the groups it
cannot yet satisfy are the work it has left." Six assertions are declared `it.todo` — three of them
(`429` honouring `Retry-After`, circuit opening on repeated failure, metadata-only change yielding a
new `sourceVersion` with an unchanged hash) are **precisely the Graph behaviours Phase 7 must prove**,
and they are already written down as pending tests rather than as prose.

### 2.2 Gap register

| # | Gap | Severity | Phase | Evidence in the tree |
| --- | --- | --- | --- | --- |
| G-1 | Entra token validation unimplemented; deployed environments fail closed on every request | **Blocking for any deployment** | 2 | `createEntraResolver()` throws |
| G-2 | No SharePoint knowledge-source adapter | **Blocking for real content** | 7 | Only `mock/` exists under `knowledge-source-adapters/src` |
| G-3 | No Graph client: no token acquisition, OBO exchange, throttling, retry, or circuit breaker | **Blocking for G-2** | 7 | No `graph` module; three conformance `todo`s |
| G-4 | No SharePoint Question Bank adapter; no field-mapping profile validation; no list provisioning | **Blocking for publication to the tenant** | 8 | Only `mock/mock-question-bank.ts` |
| G-5 | `reconcile_question_bank` MCP tool unregistered — a Phase 8 exit criterion | High | 8 | Absent from the 19 registered tools |
| G-6 | No Anthropic generator; no SDK dependency in any workspace | High — it is the product's purpose | 4 | `grep anthropic package.json` → nothing |
| G-7 | Generation profile declares `modelId: 'claude-sonnet-5'` but the generator ignores it and reports its own constant | Medium — a correctness trap | 4 | `seed.ts` sets it; `generation-service.ts` records the value returned by `generate()` |
| G-8 | 17 of 36 specified MCP tools unregistered | Medium | 7–10 | 19 registered vs [mcp-tools.md](../mcp-tools.md) §§5–12 |
| G-9 | Reporting is a placeholder package; no aggregate read model | High *if* the pilot promises reports | 10 | `IMPLEMENTED_IN = 'Phase 10'` |
| G-10 | No automated end-to-end test; no UI test | High for pilot regression safety | 11 | Stated in `CLAUDE.md` |
| G-11 | ~~Container image scan never executed~~ **CLOSED 2026-09-23** | — | 11 | Ran against all five images: 16 HIGH/CRITICAL, reduced to 0 by removing `npm` from the runtime stage and applying distribution updates. The two remaining are EX-001, declared in `.trivyignore` with its expiry. See §12.5 |
| G-12 | `Team` model exists and nothing writes it, so every team-scoped report and permission is untestable | Medium | 10 | [full-solution-capability-matrix.md](../ui/full-solution-capability-matrix.md) §A1 |
| G-13 | No per-learner results list endpoint | Low for a pilot; blocks learner progress surfaces | 9/10 | 48 routes; `learning/results/:resultId` is by-id only |

### 2.3 Two gaps that are approvals, not code

These cannot be closed by engineering and are the longest-lead items in the workstream:

| # | Gap | Why it blocks | Owner |
| --- | --- | --- | --- |
| **A-05 / T-29** | Approval to send question drafts and delimited source excerpts to Anthropic is recorded as **Unconfirmed** | Without it, live generation cannot be enabled in production *at all*. Every deterministic capability still works, so the pilot is viable without it — but it is not the product | Privacy + Legal |
| **A-03 / T-22** | `Sites.Selected` **Write** on the governance site | Without it, publishing cannot function and the platform runs in dry-run indefinitely | Tenant M365 team |

Start both **now**, before any code. They are the critical path and neither is on it by choice.

---

## 3. SharePoint Integration Plan

→ [`integration-plan-sharepoint.md`](integration-plan-sharepoint.md)

Covers the seven capabilities the brief names — site discovery, library discovery, folder access,
file access, delta synchronization, metadata extraction, permission trimming — as a *delivery* plan
against the contract that already exists.

## 4. Microsoft Graph Integration Plan

→ [`integration-plan-microsoft-graph.md`](integration-plan-microsoft-graph.md)

Split from the above deliberately: SharePoint is **what we ask for**, Graph is **how we call it
safely**. The Graph client is a separate, independently testable concern (auth, throttling, retry,
circuit breaking, redaction, recorded fixtures) shared by the knowledge-source adapter and the
question-bank adapter.

## 5. Entra ID Integration Plan

→ [`integration-plan-entra-id.md`](integration-plan-entra-id.md)

## 6. Claude Integration Plan

→ [`integration-plan-claude.md`](integration-plan-claude.md)

---

## 7. Required Azure Resources

**These are already specified.** [environment-and-configuration.md](../environment-and-configuration.md)
§4 declares the environment contract and `packages/configuration/src/env.ts` **enforces it at
startup** — a deployed environment missing any of these fails its startup check rather than serving
a degraded request. This table consolidates what that contract implies; it does not add to it.

| Resource | Purpose | Enforced by | Per |
| --- | --- | --- | --- |
| Azure subscription + resource group + region | A-16, T-31 | — | environment |
| Azure Container Apps (×6) | `api`, `mcp-server`, `jobs`, `authoring-web`, `live-web`, `sync-web` — the six declared deployables (`sync-web` added 2026-09-26) | `DEPLOYABLES` | environment |
| PostgreSQL Flexible Server | Authoritative store for everything except approved question content | `DATABASE_URL`, managed identity in deployed environments | environment |
| Key Vault | Every secret. Configuration holds only `keyvault://{vault}/secrets/{name}` **references**, validated by regex — a literal secret in config fails schema validation | `KEY_VAULT_URI`, required in deployed, **forbidden in local** | environment |
| Blob Storage (private container) | Certificates and report exports. No public URL exists | `BLOB_ACCOUNT_URL`, `BLOB_CONTAINER` | environment |
| OpenTelemetry collector / Azure Monitor | Telemetry sink. **Audit is unaffected by its absence** — audit is a database write, not a trace | `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME` (distinct per deployable) | environment |
| Front Door / ingress | T-32 | — | environment |
| Managed identities | One per deployable. `GRAPH_CREDENTIAL_REF` is readable by **`mcp-server` only** — the API's identity cannot read it (C6), which is what keeps Graph credentials out of the request-handling process | `deployables` field per variable | deployable |
| SharePoint knowledge site(s) | Source documents, read-only to the platform | T-09..T-12 | source |
| SharePoint governance site | The Question Bank list. **Must be a different site** from any document site (A-03, T-21) | T-21 | environment |

Two resources are deliberately **not** required for a pilot: an OCR service (A-04 — scanned PDFs
yield `EXTRACTION_EMPTY` and OCR is out of scope, risk R-06) and any email or Teams delivery service
(A-17 — in-app notification only; Mailpit locally).

---

## 8. Required Application Registrations

Already enumerated as tenant values T-01..T-05 and T-15, and already consumed by name in
`env.ts`. Four registrations:

| Reg | Name | Type | Client ID variable | Carries |
| --- | --- | --- | --- | --- |
| T-02 | `knowzy-authoring-web` | Public client (SPA/auth-code + PKCE) | `ENTRA_AUTHORING_CLIENT_ID` | Redirect URIs per environment |
| T-03 | `knowzy-live-web` | Public client | `ENTRA_LIVE_CLIENT_ID` | Redirect URIs per environment |
| T-04 | `knowzy-api` | Confidential / resource server | `ENTRA_API_CLIENT_ID`, `ENTRA_API_AUDIENCE` | Application ID URI; **exposes scopes `knowzy.authoring` and `knowzy.learning`** |
| T-15 | Graph credential for `mcp-server` | Confidential, **certificate preferred** over secret | `GRAPH_CREDENTIAL_REF` (Key Vault reference) | The only registration holding SharePoint grants |

Plus **T-01** the tenant ID, **T-05** admin consent for the exposed scopes (required before either
portal can call the API), and **T-07** bootstrap administrator object IDs, consumed once per
environment.

Two separations are load-bearing and must survive the tenant conversation:

1. **Two portals, two registrations.** The learner portal must not be able to obtain an authoring
   scope. One registration serving both would make the separation a runtime check instead of a token
   boundary.
2. **The Graph credential belongs to `mcp-server`, not to the API.** Knowledge retrieval and bank
   writes happen behind MCP; the process that handles browser requests cannot read the credential
   that reaches SharePoint. Collapsing these to one registration for convenience would delete that
   property silently.

---

## 9. Required Permissions

### 9.1 Microsoft Graph — application permissions

| Permission | Grant | Why this and not more |
| --- | --- | --- |
| `Sites.Selected` | **Admin consent, then per-site grants** | The whole point. `Sites.Read.All` would grant every site in the tenant; `Sites.Selected` grants nothing until a named site is added, which makes the blast radius an administrative record rather than a promise |
| `Sites.Selected` → **Read** on each document site | T-16, per site, per environment | A-03. Without it, only the mock adapter works |
| `Sites.Selected` → **Write** on the governance site **only** | T-22, per environment | A-03. The single grant that enables publication. It must not be granted on a document site — "knowledge documents are read-only to the platform" is meant to be structural |
| `User.Read` (delegated) | Both portals | Sign-in |
| `Files.Read.All` (delegated) or OBO equivalent | Only if `DELEGATED_OBO` sources are used | T-14. Required for trimming that mirrors SharePoint exactly |

**Not requested, and the refusal is the design:** `Sites.FullControl.All`, `Sites.Manage.All`,
`Files.ReadWrite.All`, `Directory.Read.All`, any `.All` read of site content, and any write
permission on a knowledge document site. If a tenant administrator offers `Sites.Read.All` as
simpler, the honest answer is that it is simpler and materially worse, and the platform does not need
it.

### 9.2 Entra — directory permissions

`GroupMember.Read.All` or `Directory.Read.All` is required **only if** group → role provisioning
(T-06) is adopted. It is optional: ADR-011 resolves roles from the Knowzy database, never from token
claims, so provisioning is a convenience and authorization does not depend on it. **Recommendation
for the pilot: do not request it.** Seed roles directly (T-07) and defer the directory read.

### 9.3 Platform-internal permissions

No change needed. The `PermissionKey` union is closed and complete for the workstream, the 48 routes
each declare a policy, and a handler without one fails the build. The Pilot Workstream adds no new
permission key — which is itself a useful signal that it adds no new capability, only real
implementations of declared ones.

### 9.4 Anthropic

An API key per environment (T-28), Key Vault only, reachable by `api` and `jobs` only. Gated on the
T-29 legal approval, not on the key.

---

## 10. Recommended Phase-9 Implementation Order

The brief's order (SharePoint → Graph → Entra → Claude) is close, but two things must move. The
roadmap's own sequencing principle is that each phase ends in something demonstrable, and that
nothing depends on an untested assumption.

### 10.1 Start immediately, in parallel with everything (week 0)

| # | Action | Why first |
| --- | --- | --- |
| 0a | **SEND** the drafted **T-29** request ([T29_PRIVACY_LEGAL_REQUEST.md](../integrations/T29_PRIVACY_LEGAL_REQUEST.md), written 2026-09-22, **not yet sent**) and request **T-22** (`Sites.Selected` Write) | Both are approvals with external owners on the critical path. Neither is blocked by any code, and the T-29 request is now written — what remains is a person sending it. Every week these wait is a week added to the end |
| 0b | Request the T-01..T-05 registrations and per-site **Read** grants (T-16) | Lead time, not effort |
| 0c | Make CI's **trivy image scan actually execute** | It has never run. A base-image CVE found in week 1 is a patch; found at pilot launch it is a delay. Cheapest risk reduction available |
| 0d | Automate the 36-step acceptance script from `initial-end-to-end-proof.md` §3 | This is the regression net for everything that follows. Replacing a mock adapter with a real one is exactly the change a hand-run script will not catch reliably |

**0d is the recommendation this document would most defend.** Four integrations are about to be
swapped in underneath a platform whose only end-to-end verification is a person clicking. Build the
net before the trapeze.

### 10.2 Then, in this order

| Order | Work | Roadmap | Why here | Gate to pass |
| --- | --- | --- | --- | --- |
| **1** | **Entra ID** (identity) | Phase 2 | Not optional and not parallelizable: `createEntraResolver()` throws, so **no deployed environment works at all** until it lands. Nothing else can be demonstrated outside a laptop first | A real user signs in to both portals in `dev` and every route resolves roles from the database |
| **2** | **Graph client** (auth, throttle, retry, circuit, redaction, recorded fixtures) | Phase 7a | A separable, independently testable concern that both adapters need. Building it inside the SharePoint adapter would make its failure modes untestable without a tenant | The three conformance `it.todo`s for 429/circuit/eTag become real passing tests |
| **3** | **SharePoint knowledge-source adapter** | Phase 7b | Read before write. It is also the cheaper of the two adapters to verify, because reading a wrong document is recoverable and writing one is not | The **same conformance suite** passes with **no assertion relaxed**, plus all nine Test Connection checks against a real dev site |
| **4** | **Question Bank adapter** + field mapping + reconciliation | Phase 8 | Depends on the Graph client, and on real documents existing to generate real questions from. `sharepoint.write.enabled` defaults **off**; a reviewed dry run precedes turning it on | Idempotency proven three ways, stale `If-Match` returns CONFLICT, all six drift states detected, `reconcile_question_bank` registered |
| **5** | **Claude generator** | Phase 4 (live half) | Deliberately last among the four, and this is the substantive departure from the brief's order. Reasons below | A real batch generated, reviewed by a human, and compared against the deterministic generator's output on the same documents |

### 10.3 Why Claude goes last, when it is the most interesting

Three reasons, in order of weight:

1. **It is the only one gated on an unconfirmed approval.** A-05 is marked *Unconfirmed* and T-29 is
   owned by privacy and legal. Sequencing engineering behind an approval nobody has granted is how a
   plan slips; sequencing it last means the slip costs nothing.
2. **Generation quality can only be judged against real documents.** Evaluating Claude on the five
   fixture documents in `fixtures/knowledge/` would measure the fixtures. The question the pilot needs
   answered — *are these questions good enough to put in front of staff?* — requires Phase 7 content
   first.
3. **Every gate it must pass already exists and is exercised.** Framing, schema, evidence
   verification, integrity, confidence and the rejection taxonomy are model-agnostic and are run
   against the deterministic generator today. This is the lowest-risk of the four integrations, so it
   benefits least from being early.

The counter-argument deserves stating: question quality is the product's central unknown, and a pilot
that discovers in month three that the questions are poor has wasted the first two. If the business
wants that risk retired early, the right move is **not** to reorder the workstream — it is a
**time-boxed quality spike** in parallel with step 1: implement the `anthropic` generator against the
existing fixtures, generate one batch, and have an SME judge it. That answers the quality question in
days without putting the pilot's dependency order at the mercy of a legal review. It still needs
T-29, which is why 0a is week 0.

### 10.4 What is explicitly out of scope for this workstream

Roadmap Phases 9 (refreshers, badges, certificates), 10 (reporting and audit surfaces) and 11
(hardening and release), and every learner full-solution feature — catalog, discover, knowledge
library, my learnings. The brief excludes them and the dependency order agrees: all of them are worth
more after real content and real publication exist, and several are worth nothing before.

**One caveat to carry into the pilot conversation:** reporting is Phase 10 and genuinely unbuilt
(§1.2). If "enterprise pilot" has been described to stakeholders as including dashboards or reports,
that expectation is currently unmet and no amount of integration work in this workstream changes it.
Better to say so now than at the demo.

---

## 11. Traceability

| This document's section | Grounded in |
| --- | --- |
| Component ratings | The source files named in each row, read at `44749cb` |
| Tenant values T-01..T-38 | [assumptions-and-tenant-configuration.md](../assumptions-and-tenant-configuration.md) §3 — **not restated here**, referenced |
| Azure resources | [environment-and-configuration.md](../environment-and-configuration.md) §4, enforced by `packages/configuration/src/env.ts` |
| Graph resource paths, permission modes, extraction pipeline | [architecture.md](../architecture.md) §§8.2–8.4 |
| Adapter responsibilities | [knowledge-source-adapters.md](../knowledge-source-adapters.md) §3 |
| Claude controls | [architecture.md](../architecture.md) §9, [security.md](../security.md) §5 |
| Phase exit criteria | [implementation-roadmap.md](../implementation-roadmap.md) §3 |
| Capability classifications | [full-solution-capability-matrix.md](../ui/full-solution-capability-matrix.md) |

---

## 12. PILOT-T2 update (2026-09-22)

Three measurement and grounding defects are closed, and they matter to this assessment because two
of them would have corrupted any figure the pilot reported.

| Gap | Status |
| --- | --- |
| Coverage counted generation refusals as coverage | **Closed.** Five section states now reported separately; pilot coverage corrected from 94.8% to **2.6%** |
| `section_key` collided across heading-less documents (21 on one key) | **Closed.** Keys scoped by document; 251 sections, 251 distinct keys, 0 collisions |
| `PromptVersion.body` was a paraphrase, not the prompt | **Closed.** Derived from `framing.ts`, pinned by hash, version 1.2.0 |

**G-7 is now partly closed**: the profile's `modelId` is still ignored by the deterministic
generator, but the prompt-provenance half of that trap is gone. The rest lands with the Anthropic
client.

Nothing in section 10's ordering changes. The two approvals — **T-29** (Anthropic) and **T-22**
(`Sites.Selected` Write) — remain the critical path, and **T-29 still has no drafted request**.

### 12.1 Deterministic baseline captured (2026-09-22)

The control arm for the Claude comparison now exists as measured numbers rather than as a plan.
`npx tsx scripts/baseline.ts` reproduces it.

| | Original SOP corpus | Generation-ready corpus |
| --- | ---: | ---: |
| Assessable sections | 115 | 76 |
| Questions generated | **4** | **16** |
| Coverage | **3.5%** | **21.1%** |
| Exact-quotation evidence | 4 of 4 | 16 of 16 |
| Duplicates blocked | 0 | 0 |

**What this changes for the pilot.** The readiness assessment could previously say only that
question quality was untested. It can now say what the deterministic generator achieves on real
content — 4 questions from 28 documents, and 16 from the same content restructured — which is the
number any model has to beat, and the number a stakeholder should be shown before Claude is
discussed.

**What it does not change.** T-29 is still unrequested and still the critical path, and the
comparison still requires a clean database for its duplicate metric to be meaningful.

### 12.2 Multi-provider generation, designed not built (2026-09-22)

[`MULTI_PROVIDER_GENERATION_ARCHITECTURE.md`](../integrations/MULTI_PROVIDER_GENERATION_ARCHITECTURE.md)
designs a provider registry covering the deterministic generator, Claude, Microsoft Copilot and
future providers, in platform-managed and user-managed execution modes. **No provider integration is
implemented.**

Three findings change this readiness assessment:

| Finding | Effect on readiness |
| --- | --- |
| **"User managed" is not uniform.** Copilot and Azure OpenAI have delegated per-user execution; **Anthropic has no on-behalf-of flow and a claude.ai seat is not an API credential** | The user-managed story belongs to the Microsoft providers. Anthropic is platform-managed only, and a UI offering otherwise would promise what cannot be built |
| **A provider that performs its own retrieval cannot be used for grounded generation.** Copilot grounds in Microsoft Graph by design | **Copilot's eligibility is an open question, not a work item.** It must be answered before any Copilot work is scheduled |
| **`architecture.md` is explicitly single-provider** — §9, the technology table, the C4 diagram and boundary rule B4 all name Claude or Anthropic | The specification must be amended first. Multi-provider is currently a **proposal**, not an approved architecture |

**New blockers, in addition to T-29:**

| # | Blocker | Owner |
| --- | --- | --- |
| **P-1** | Amend `architecture.md` §9 and the technology table to describe a provider registry | Architecture |
| **P-2** | Document whether Microsoft 365 Copilot can be invoked retrieval-free | Platform + Microsoft |
| **P-3** | Data-processing assessment **per provider**. T-29 covers Anthropic only; Copilot and Azure OpenAI need their own | Privacy + legal |
| **P-4** | ~~Rename `BankItemWrite.claudeModel` before the SharePoint bank adapter ships~~ | **CLOSED 2026-09-26** |

**P-4 had a deadline the others do not, and it was met.** The Question Bank was still a mock, so
nothing had been written to a tenant list: a Copilot-generated question published then would have
landed in a field called `claudeModel`, in the customer's Question Bank, mapped to a real SharePoint
column. The field is `generatorModel` as of 2026-09-26, while the rename was still a port change
and five call sites rather than tenant data migration. `docs/sharepoint-question-bank.md` §3.4
records the old name and the date, because a column that was renamed before anyone saw it still
needs to be findable by the name in the older design documents.

**Recommendation carried from the architecture:** register two providers, declare the rest. Six
integrations before one measurement produces five untested providers and no answer to the question
the pilot exists to answer.

### 12.3 Question Acquisition Framework (2026-09-22)

The platform now supports two acquisition paths under one governance model.

| | Status |
| --- | --- |
| Provider-based generation | **Framework built.** Deterministic registered; Anthropic, Copilot, Azure OpenAI and Gemini declared and refused with specific reasons |
| Question import | **Built and proved end to end** on a real bank: 2 detected, 2 valid, 2 drafts, both verified under STRICT at similarity 1.000 |
| Import governance | **12 of 13 gates pass on an imported question and gate 13 refuses self-approval.** Re-importing the same file creates nothing — every question blocked as a duplicate |
| Browser file upload | **Not built.** Deliberate: traversal, size, type and a writable mount are four controls that need their own change |

**What this means for the pilot.** A customer with an existing question bank no longer has to choose
between importing it ungoverned and re-authoring it. The bank becomes a knowledge document, its
questions are grounded in it, and they pass the same gates as generated ones — so an imported
question and a generated one are equally defensible at approval, and a reviewer can tell them apart.

**No new blockers.** T-29 (Anthropic), P-2 (Copilot retrieval), P-3 (per-provider data processing)
and P-4 (`claudeModel` rename) are unchanged. Import needs none of them: it requires no provider, no
credential and no approval.

### 12.4 Source administration and scheduling (2026-09-23)

The SharePoint Sync Manager (`apps/sync-web`, port 3002) closes a pilot-operations gap that was not
in the register because it looked like a UI matter and was not: **a knowledge source could only be
seeded.** A pilot could not add a folder, correct a path, pause a source, retire one, or put any of
it on a schedule without a developer and a migration.

| | Status |
| --- | --- |
| Create, edit, activate, deactivate, archive, delete a source | **Built.** `source.manage`, eight routes, lineage-protected: a source anything references cannot be hard-deleted |
| Add and modify source folders | **Built.** Server-side allow-list validation on every local root |
| Scheduled synchronization | **Built.** Manual, hourly, daily, weekly, monthly, cron; pg-boss; singleton per due window; retries with backoff |
| Stuck-run recovery | **Built,** and needed: one `RUNNING` row from a killed container had already locked a source permanently, because the concurrency guard had no expiry |
| Operational visibility | **Built.** Connection health, five 30-day counts, derived workflow status, the last 25 runs with their trigger |
| Destination synchronization | **Not built, and not planned for this release.** There is no destination model. See below |

**What the pilot may claim:** that a source administrator can register and schedule a document
source, see whether it is working, and recover it when it is not, without engineering involvement.

**What the pilot must not imply.** The product is named after SharePoint and this release does not
replicate content between SharePoint locations in either direction. It synchronizes configured
sources **into** Knowzy. The header says so on every screen, and seven capabilities ship disabled
with **"Requires Microsoft Graph write integration and tenant approval."** — a destination
site/library/folder, two-way sync, syncing deletions back, writing metadata back, and a SharePoint
Graph source. The first four depend on **A-03 / T-22** (`Sites.Selected` Write); the fifth is
**G-2/G-3**, unchanged.

**No new tenant blockers.** Everything above runs on the file-repository adapter with no credential,
no consent and no approval. The dependencies that remain are the ones already registered: G-2 and
G-3 for a real SharePoint source, T-22 for anything written back, G-1 for any deployment at all.

### 12.5 G-11 closed: the image scan ran (2026-09-23)

The CI trivy step existed from 2026-09-21 and had **never executed** — an unresolvable action tag
killed the job in three seconds, which read as a configuration error rather than as an unscanned
image. With all five images building it ran and reported **16 HIGH/CRITICAL**.

Fourteen were in `npm`, which sits in the runtime image and is never invoked by it. The fix was to
**delete it from the runtime stage** and apply distribution security updates — not to suppress the
findings. The remaining two are the `postcss` advisories already classified as EX-001, and
`.trivyignore` declares exactly those two, each pointing at that classification and inheriting its
2026-12-31 expiry. A new advisory in any image still fails the build.

The lesson for the pilot's security posture is not the count. It is that **a control which has never
executed has produced no evidence**, and this one had been green on the dashboard for two days.

### 12.6 The AI Generation Control Layer (2026-09-24)

The pilot can now answer "what would this cost, and what stops it running away" **before** a paid
provider exists.

| | Status |
| --- | --- |
| Token accounting | **Built.** One row per ATTEMPT, so retries count against the budget |
| Cost accounting | **Built**, and honest: a cost is written only where it can be known. Null, never 0, where it cannot |
| Per-job / daily / weekly / monthly token budgets | **Built and enforced** on every provider, including the deterministic one |
| Concurrency cap and retry policy | **Built.** Jittered backoff, hard attempt cap, retries counted against the budget |
| Provider state model | **Built.** Five named states, each carrying its reason. `BLOCKED_BY_APPROVAL` is how T-29 becomes a control rather than a promise |
| Provider health and metrics | **Built.** Health is assessed separately from availability, and a control-layer refusal is not counted as a provider failure |
| Governance → AI Usage & Budgets | **Built.** Functional now, on deterministic activity |
| Administrator-set per-provider limits | **Built.** The first configuration WRITE path in the platform |
| Any external provider | **Not built, and not claimed.** OpenAI, Anthropic, Azure OpenAI and Gemini are declared and `UNAVAILABLE`; Copilot is `BLOCKED_BY_CAPABILITY` |

**What the pilot may claim:** that generation cannot exceed a stated token ceiling, that every
refusal is recorded with the control that fired and the numbers behind it, that cost is reported
only where it is observable, and that an administrator can cap a provider without a deployment.

**What it must not imply:** that any of this has been exercised against a real provider's rate
limits or billing. It has been exercised against a generator that cannot make a network call. The
arithmetic, the enforcement and the audit trail are proven; the provider's behaviour is not, because
no provider exists yet.

**No new tenant blockers.** T-29 is unchanged and now has a mechanism waiting for it: recording the
approval in `llm.approvedProviders` is what moves a provider out of `BLOCKED_BY_APPROVAL`.

### 12.7 G-11 note and a gate that was failing unnoticed

While building §12.6, the CI **schema drift gate** turned out to have been failing on `main` since
2026-09-22: migration 0006 created an index `schema.prisma` never declared, so `prisma migrate diff`
wanted to drop it. It reproduced nowhere locally because the gate needs a shadow database that only
CI creates. Fixed by declaring the index; the gate now exits 0.

The lesson is the same one §12.5 records about trivy, and it is worth stating twice: **a gate whose
output nobody reads is not a control.** Two CI runs were red for two days while every local check
was green.

---

### 12.8 AI provider administration (2026-09-26)

The control layer of §12.6 could measure and refuse. It could not turn anything on.

| | Status |
| --- | --- |
| Provider configuration through the UI | **Built.** Administration → AI Providers: enablement, endpoint, model, credential reference, sampling, ceilings, retry cap |
| Data-processing approval as a recorded act | **Built.** Its own dialog, its own audit action, and a **required reference** to where the approval is held |
| Switching the active provider | **Built**, and refused for any provider that is not `AVAILABLE` |
| Readiness validation | **Built.** Five checks, three outcomes, one row per attempt in `generation_provider_validation` |
| A live connection test | **Not built, and stated as not built** on the screen. No client exists to call |
| Credential storage | **References only.** A pasted key is refused; no read, screen, audit row or configuration-change row can reconstruct one |

**What this changes for the pilot.** The day a credential and an approval arrive, enabling a
provider is a configuration change made by an administrator in a browser, audited with previous and
new value — not a code change written under time pressure by whoever is available. What remains a
release is *writing a client* for a provider, which is honest: that is engineering work and the
screen says so, per provider, in words.

**It also makes T-29 harder to bypass rather than easier.** Before this, `llm.approvedProviders`
was a configuration value editable by anyone who could edit configuration. Now recording an approval
is a distinct, audited act that **requires a reference** to the record — and the question asked in
nine months, "who cleared this and on the strength of what", has an answer in the audit trail.

**Blockers, restated:**

| # | Blocker | Status |
| --- | --- | --- |
| **T-29** | Anthropic data-processing approval | **OPEN, and unchanged.** Still the longest lead time on the critical path, and still not an engineering action. The request is drafted at `docs/integrations/T29_PRIVACY_LEGAL_REQUEST.md` and nobody in Privacy, Legal, InfoSec or Data Governance has seen it |
| **P-1** | Amend `architecture.md` for a provider registry | **CLOSED 2026-09-24** — §9.0 |
| **P-2** | Whether Copilot can be invoked retrieval-free | **OPEN.** It is declared `BLOCKED_BY_CAPABILITY` in the meantime, and the screen refuses to record an approval for it, so the uncertainty cannot be resolved by accident |
| **P-3** | Data-processing assessment **per provider** | **OPEN**, and now enforced per provider: each one carries its own approval record with its own reference |
| **P-4** | `claudeModel` rename | **CLOSED 2026-09-26** — see §12.2 |

**One new blocker, and it is not engineering:**

| # | Blocker | Owner |
| --- | --- | --- |
| **P-5** | A **secret store**. The platform records a `keyvault://` reference and has no client to resolve one, so a validation reports "recorded, unresolvable here" rather than confirming a credential exists | Platform + InfoSec |

P-5 is deliberately small and deliberately not faked. Resolving a reference needs a Key Vault (or
equivalent) and a managed identity with read access to it — both listed in §7 — and until they
exist the honest report is that the reference is recorded and unverified. The alternative, treating
"a reference is recorded" as "a credential works", is the failure this whole screen is built to
avoid.

### 12.9 Reporting R1 and R2 (2026-09-26, 2026-09-27)

§1.2 rated Reporting **Not built** and §2.2 carried it as **G-9**. Both are now out of date.

| | Status |
| --- | --- |
| Aggregate read models | **Built.** Nine, in their own `reporting` schema: one maintained on write by a trigger, eight materialized views refreshed every fifteen minutes, each with a refresh ledger that supplies its `asOf` |
| A reporting surface | **Built.** `/reports`: a visual dashboard drawn to the approved design, and twelve catalogue reports, each with its formulas, export and snapshots |
| History of point-in-time figures | **Built (R-1).** One append-only coverage snapshot per UTC day, from 2026-09-27. **Not back-filled**, so comparisons of coverage, sources and lifecycle totals read "Not Yet Available" until a snapshot old enough exists |
| Privacy suppression | **Built.** Minimum group size 5, raisable only; complementary suppression, on both axes for the learner heatmap; withheld totals never shown as 0 |
| Learner reporting by organisation | **Built, by the department the QUESTIONS were filed under (D-1).** Learners carry no department and there is no team model |
| Export | **Built.** CSV with a header block and formula-injection guard, audited with user, report, time and the period covered |
| Proficiency, recognition, reuse and governance-activity reports | **Not built.** Most of `reporting.md` §4's catalogue |

**G-9 is narrowed rather than closed.** A pilot can now be promised a reporting dashboard over its
own questions, sources, assessments and AI usage. It cannot yet be promised proficiency or
recognition reports, and anything a pilot sponsor wants to see *trended* must be understood to
start on the day the snapshots started — the product will say "Not Yet Available" rather than draw a
line it cannot support.

**Two things for the pilot conversation:**

1. **Most learner cells will read "Suppressed" in a small pilot.** Five distinct learners per
   department × topic cell is the floor, and complementary suppression removes more. That is the
   control working. A pilot that wants a populated heatmap needs cohorts of that size, not a lower
   threshold — and the threshold cannot be lowered.
2. **"Department" on the learner heatmap is the questions' department.** If the organisation expects
   learners grouped by their own department, that is a person-to-department mapping the platform
   does not hold, and it is the team model D-1 deferred.
