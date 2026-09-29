# Knowzy — Plan to Complete and Deploy

**Written:** 2026-09-24
**Status:** Plan. No application code was changed to produce it.
**Authority:** [implementation-roadmap.md](../implementation-roadmap.md) sequences the phases and
owns the exit criteria; this document only sequences the *remaining* work and names what blocks it.
Where the two disagree, the roadmap wins.

---

## 1. Where the project actually is

| | |
| --- | --- |
| Phases 1–6 | **Complete**, verified in a browser on mock adapters |
| Phase 7 (SharePoint read) · 8 (Bank write) · 9 (refreshers, recognition) · 10 (reporting, audit) · 11 (hardening) | **Not started** |
| Applications | Three portals run locally: authoring :3000, learner :3001, Sync Manager :3002 |
| Deployed environments | **None.** No subscription, resource group, App Service, Container App, hostname or pipeline exists |
| `main` in CI | **Red**, and has been since at least 2026-09-22 (runs #17 and #18 both failed) |

So "remaining to be deployed" is, honestly: **everything**. Nothing has ever run anywhere but this
laptop. What follows is what stands between here and a deployed pilot, in the order that respects the
dependencies.

---

## 2. What deployment actually requires

Three gates, and only one of them is about containers.

### 2.1 G-1 — Entra token validation is not implemented

`createEntraResolver()` throws. Every non-`local` environment therefore **fails closed on every
request**: the images would start and refuse all traffic. This is the single hard blocker on any
deployment, it is code we write, and it needs tenant values T-01..T-05 and T-07 before it can be
tested against anything real.

### 2.2 The Azure resource set

Already specified — [environment-and-configuration.md](../environment-and-configuration.md) §4 is
the contract and `packages/configuration/src/env.ts` **enforces it at startup**, so a deployed
environment missing a value fails its own startup check rather than serving a degraded request.
Consolidated in [ENTERPRISE_PILOT_READINESS.md](ENTERPRISE_PILOT_READINESS.md) §7: subscription and
resource group, Container Apps, PostgreSQL Flexible Server, Key Vault (config holds
`keyvault://` **references** only), private Blob Storage, an OTLP sink, ingress, and one managed
identity per deployable — with `GRAPH_CREDENTIAL_REF` readable by `mcp-server` **only**, which is
what keeps Graph credentials out of the request-handling process.

None of this is an engineering decision. It is a subscription, a budget and an owner.

### 2.3 A gap found while writing this plan: `sync-web` is not a declared deployable

`DEPLOYABLES = ['authoring-web', 'live-web', 'api', 'mcp-server', 'jobs']` — five. The Sync Manager
is a sixth application and the environment contract does not know it exists, so it has no
per-deployable variable targeting, no distinct `OTEL_SERVICE_NAME`, and no managed identity in the
resource table. It runs locally because compose supplies its environment directly.

**This is small and it is ours.** It belongs in Wave 0, before anybody plans a deployment around a
service the configuration validator would not recognise.

---

## 3. The plan, in four waves

Estimates are working days for one implementer with review, and they are estimates. Each wave's
items are independent unless stated.

### Wave 0 — unblock (1–2 days, mostly waiting on other people)

| # | Item | Blocked on | Size |
| --- | --- | --- | --- |
| 0.1 | **Fix CI.** Both recent runs are red and the cause is unknown from this machine | A `gh` login, or the job log pasted in | S once the log is in hand |
| 0.2 | **Send T-29** (Anthropic processor approval). Drafted at [T29_PRIVACY_LEGAL_REQUEST.md](../integrations/T29_PRIVACY_LEGAL_REQUEST.md) and nobody has seen it | A person sending it | — |
| 0.3 | **Send the tenant questionnaire** — T-09..T-12 (read sites), T-21..T-26 (governance site and the Bank list), T-22 (`Sites.Selected` **Write**), T-01..T-05 + T-07 (app registrations and consent) | A person sending it | — |
| 0.4 | **Add `sync-web` to the environment contract** and to §7's resource table | Nothing | S |

**0.1 is worth being precise about.** Every gate in `.github/workflows/ci.yml` reproduces green on
this machine as of today: `typecheck` 34/34, `lint` 22/22, `format:check` clean, `codegen:check`
clean, 795 tests, boundaries 0, all six images build, trivy exits 0 with `.trivyignore`,
`audit:gate` passes with 10 advisories all covered by documented exceptions, and the
`cyclonedx-npm` SBOM step produces a 475 KB SBOM. A failure that reproduces nowhere locally is
almost certainly a fresh-checkout, `npm ci`, service-container or buildx-cache difference — the
class of thing the log names in one line and guessing never finds.

**0.2 and 0.3 are the critical path and they are not engineering.** T-29 blocks the product's actual
purpose; T-22 blocks Phase 8 entirely. Every week they sit undelivered is a week those phases cannot
start, no matter how much code gets written meanwhile.

### Wave 1 — everything we can finish with no credential and no approval (the bulk of what is left)

This is where the project gets substantially more complete without waiting for anyone.

| # | Item | Roadmap | Size |
| --- | --- | --- | --- |
| 1.1 | **Phase 10 — reporting and audit surfaces.** Reporting schema and read models, refresh jobs, the report catalogue, dashboards and filters, suppression, exports, the publication lifecycle, the **Audit Explorer**, standing reports. 11 exit criteria, including complementary-suppression verification, `asOf` on every response, counter reconciliation that reports drift without correcting it, CSV formula-injection prevention, and audit reconstruction answering all seven questions in the audit model | Phase 10 | **L** — 10–15 days |
| 1.2 | **Phase 9, the deterministic half.** Weak-topic analysis (backend only, Claude has no input, verified by call-graph inspection), the badge rule engine and idempotent evaluation under concurrency, certificate issuance with byte-identical re-render against `renderedHash`, verification returning the four documented shapes with hashed codes and rate limiting, and revocation in one transaction | Phase 9 | **M** — 6–9 days |
| 1.3 | **UI-M8** — the real assessment builder. Today assessment creation is one form on the Publish page | ui-modernization-plan §16.1 | **M** — 3–5 days |
| 1.4 | **UI-M10 + LIVE-UI-M2** — Reports, Governance and Administration screens on the Phase 10 read models (replacing the honest *Planned* shells), and learner My Progress from the learner's own verified data | §16.1, §16.2 | **M** — 4–6 days, after 1.1 |
| 1.5 | **UI-M11 remainder** — axe accessibility audit, manual screen-reader and keyboard passes, three-breakpoint visual QA. The Playwright suite exists; the audit does not | §16.1 | **S** — 2–3 days |
| 1.6 | **Budget and cost layer** ([LIVE_CLAUDE_IMPLEMENTATION_PLAN.md](../integrations/LIVE_CLAUDE_IMPLEMENTATION_PLAN.md) §6). Must ship **with** the Claude client, not after it, and is fully buildable now against the deterministic generator | Phase 4 | **M** — 3–5 days |
| 1.7 | **Rename `BankItemWrite.claudeModel`** (P-4). A provider-specific name in a provider-agnostic port, written into the **published** record. A port change and five call sites today; after the Phase 8 adapter ships it is tenant data migration | Phase 8 prerequisite | **S** — 1 day |
| 1.8 | **Extend the acceptance suite** as each of the above lands, and automate the steps of the 36-step script that become reachable | Phase 11 | folded into each item |

**Not in Wave 1, deliberately:** refresher *generation* (it needs a provider), the Knowledge Library
and Discover (LIVE-FULL-M1..M4 need approved external source integrations and licensing), and the
learner Copilot (LIVE-FULL-M7 needs a Copilot backend). Building any of them now would mean
inventing data, which the standing rules forbid.

### Wave 2 — integrations, each starting the day its approval lands

| # | Item | Unblocked by | Size |
| --- | --- | --- | --- |
| 2.1 | **Phase 7 — SharePoint read.** Graph client with auth, throttling, retry and a circuit breaker; the SharePoint adapter passing the **same conformance suite with no assertion relaxed**; both permission modes with `DELEGATED_OBO` trimming matching SharePoint's own; delta sync with checkpointing and invalid-token fallback; a 429 proving `Retry-After` is honoured and the source marked `DEGRADED`; and no Graph error body, token or secret in any response, audit event or log line | T-09..T-12, app registrations, `Sites.Selected` **read** | **L** — 12–18 days |
| 2.2 | **Phase 8 — Question Bank write.** List provisioning and verification, mapping profiles validated against the real schema including a **legacy `field_n` profile**, a reviewed dry run before `sharepoint.write.enabled` is turned on, a **proven** idempotency story (duplicate `operationKey`, lost response, mid-operation crash), `If-Match` conflict handling with no blind overwrite, a 50-question partial batch, retirement with **no delete method on the adapter**, and reconciliation detecting all six drift states and applying nothing without a per-question decision plus comment | **T-22 write grant**, T-21, T-23..T-26. Do 1.7 first | **L** — 12–18 days |
| 2.3 | **Live Claude generation** behind the existing `QuestionGenerator` port, then the recorded comparison against the measured deterministic baseline | **T-29**, T-28, and 1.6 | **M** — 5–8 days |
| 2.4 | **A second provider (the Codex API)** — see §4 | An architecture amendment and its own approval | **M**, but gated |

### Wave 3 — Phase 11 and the deployment itself

| # | Item | Size |
| --- | --- | --- |
| 3.1 | **G-1: Entra token validation**, both portals' registrations, scope separation, bootstrap administrators | **M** — 4–6 days |
| 3.2 | **Provision the environment** — resource group, Container Apps (now six), PostgreSQL Flexible Server, Key Vault, Blob, OTLP, ingress, one managed identity per deployable | tenant/infra work |
| 3.3 | **Release pipeline** — build and push images **by digest**, a migration job that runs before rollout, configuration as `keyvault://` references, smoke checks, rollback | **M** — 3–5 days |
| 3.4 | **Security review** against every gate G-AUTH..G-DEP, plus a **penetration test focused on A1 (answer keys) and A2 (permission-aware retrieval)** | external |
| 3.5 | **WCAG 2.2 AA audit** including the manual screen-reader and keyboard gates — automated results alone do not satisfy it | **S–M** |
| 3.6 | **Resilience by induced failure** of each dependency, with the documented degradation *observed*; backup and restore rehearsed against RPO 15 min / RTO 4 h; retention jobs audited; the audit seal job run against a sealed partition | **M** |
| 3.7 | **Eight runbooks**: source failure, throttling storm, Claude outage, bank drift, answer-key incident, failed publish batch, stuck job, migration rollback | **S** |

---

## 4. Where the Codex API fits, and what it costs to use it

A second generation provider is attractive: the product's central open question is question
**quality**, and a comparison of two providers against the measured deterministic baseline answers
it better than one. Four things have to be true first, and none of them is optional.

1. **The specification has to be amended before any provider code is written.**
   [architecture.md](../architecture.md) is explicitly single-provider — §9, the technology table,
   the C4 diagram and boundary rule B4. `/docs` outranks both the code and any plan, so amending it
   is step 0. This is already recorded in
   [MULTI_PROVIDER_GENERATION_ARCHITECTURE.md](../integrations/MULTI_PROVIDER_GENERATION_ARCHITECTURE.md).
2. **It needs its own privacy and legal approval.** T-29 covers sending content to *Anthropic*. A
   different processor is a different data flow and a different approval — it does **not** inherit
   T-29, and T-29 does not become unnecessary if Anthropic stays in the picture.
3. **`retrievalFree` must be asserted, not assumed.** A provider that performs its own retrieval
   cannot be used for grounded generation: it either returns nothing or returns questions shaped by
   content the author never selected, and **the gate chain does not detect the second case.** A
   provider is registered only with that capability declared and asserted.
4. **The budget layer (1.6) should exist first.** Two providers with no cost ceiling is two ways to
   spend money nobody is measuring.

**Recommendation:** register two providers, declare the rest. Six integrations before one measurement
produces five untested providers and no answer to the question the pilot exists to answer.

---

## 5. What I would do in what order

1. **Wave 0** now — it is a day of work and two emails, and the emails are the critical path.
2. **Wave 1.1 (Phase 10)** as the main line, because it is the largest remaining product area with
   **zero external dependency**, and it is what turns the platform from "the pipeline works" into
   "the organization can see what the pipeline did".
3. **1.6 budget** and **1.7 rename** alongside it — both small, both must precede something bigger.
4. **Wave 2 items the day their approval lands**, interrupting Wave 1 rather than queueing behind
   it: T-22 and T-29 have the longest lead times and the least engineering control.
5. **Wave 3 last**, because hardening what is still changing is work done twice — with the one
   exception of **3.1 (Entra)**, which can start as soon as the app registrations exist and which
   nothing else can substitute for.

## 6. Two measurements still owed, neither needing a key

- **Blind-stem answerability** on the published questions. The confidence-component half is done and
  recorded in [LIVE_CLAUDE_EVALUATION_PLAN.md](../integrations/LIVE_CLAUDE_EVALUATION_PLAN.md) §2.5;
  the blind-stem half needs a person reading stems with the options hidden.
- **The CI result**, which is not a measurement anybody has taken yet. An unread run is not a pass,
  and two of them are outstanding.

---

## 7. Addendum 2026-09-26 — the Reporting & Analytics dashboard is now an approved design

`design/approved/reporting-and-analytics/KNOWZY-reporting-and-analytics-dashboard.png` was approved
and documented at [../ui/REPORTING_AND_ANALYTICS_UI_SOURCE_OF_TRUTH.md](../ui/REPORTING_AND_ANALYTICS_UI_SOURCE_OF_TRUTH.md)
**before** any Phase 10 code was written, which is the right order and worth noting because it is not
the order the last three UI milestones happened in.

It changes Wave 1.1 in four ways.

| # | Change | Effect on the estimate |
| --- | --- | --- |
| 1 | **`reporting.md` §4 needs a new catalogue entry: Filing coverage.** The four-axis filing postdates that section, and the dashboard makes it a first-class panel. `/docs` outranks the code, so amending §4 is step 0 | S — half a day, and it must come first |
| 2 | **The learner heatmap is out of R1.** It needs `rm_topic_gap` and `rm_learner_proficiency`, neither of which R1 builds, and it needs a decision about how learners are grouped | Removes ~2 days from R1; adds them to a later slice |
| 3 | **Suppression is on the critical path, not a polish item.** The heatmap made that obvious, but the assessment panel needs it in R1 regardless: an assessment taken by three people is an identifying aggregate, and complementary suppression (S3) is the part a plausible implementation gets wrong | No change to the estimate; changes the order. Build suppression before the panels, not after |
| 4 | **Nothing is duplicated.** AI Usage & Budgets and the Audit Explorer already exist under Governance and the mockup lists them under Reports. One screen, two entry points | Saves ~2 days of rebuilding two working screens |

**A fifth item that is not engineering.** The dashboard shows a "vs previous period" delta on all
eight KPI cards. Two of the eight — Coverage, and the source count — cannot be given one from
anything the platform stores, and no amount of Phase 10 changes that: `coverage_status` is a
current-state column with no history. Either those two cards lose their delta, or a dated coverage
snapshot becomes a requirement. **That is a product decision and it should be taken before the KPI
strip is built**, because retrofitting history is a migration and removing a number from a mockup is
a conversation.

### Decision D-1, restated because it blocks a panel

`Team` and `UserTeam` have existed since migration 0001 with **zero rows and no write path** — the
same shape the taxonomy had before it was fixed. Every learner-grouped report in `reporting.md` §4.4
is grained by team. Until that is resolved, learner reporting ships **without a person grouping**:
topic accuracy is real and answers "which topics are weak", which is most of the value and none of
the invention.

---

## 8. Addendum 2026-09-26 — Wave 1.1 R1 is done

Phase 10 **R1** shipped: six read models, five reports, suppression, an audited export, snapshots,
an on-demand refresh, and the `Reports` rail entry becoming a link.

| Wave 1.1 item | State |
| --- | --- |
| Reporting schema and read models | **R1 done** for the five reports it names. `rm_learner_proficiency`, `rm_topic_gap`, `rm_recognition`, `rm_reuse_metrics`, `rm_governance_activity` are not built |
| Refresh jobs | **Done.** 15-minute refresh, nightly reconciliation, and an on-demand route |
| The report catalogue | **Five of thirty-five entries.** `reporting.md` §4 gained a **Filing coverage** entry, which the four-axis filing needed |
| Dashboards and filters | **Done** for those five, with a window filter that prints the dates it resolved to |
| Suppression | **Done, including complementary suppression** (S3), which is the half that makes S1 mean anything |
| `asOf` on every response | **Done**, from a refresh ledger, with a failed refresh labelling rather than blanking |
| Counter reconciliation | **Done.** Reports drift, corrects nothing, raises a `PlatformConsistencyFinding` per discrepancy |
| Every metric displays its formula | **Done**, on the page and in the CSV header block |
| CSV formula injection prevented; exports audited | **Done** |
| The Audit Explorer | **Done** (2026-09-26, before R1) |
| Complementary-suppression verification | **Done**, as a table test that fails when the S3 loop is removed |
| Published reports, the publication lifecycle, standing reports | **Not built.** A snapshot is deliberately **not** a publication |
| Proficiency semantics (§5) | **Not built.** Needs the learner models, and a decision about grouping |
| Performance targets (§10) | **Not measured.** The dataset cache and the pre-aggregation are in place; no load test has been run |

### What this changes about the estimate

Wave 1.1 was sized at 10–15 days. R1 is roughly the first third, and it is the third everything else
sits on: the schema, the refresh machinery, the suppression engine, the export renderer and the
`asOf` discipline are all now in place and tested. The remaining thirty catalogue entries are mostly
*more of the same shape* — a matview, a dataset definition with formulas, a screen — except for the
five that need proficiency and recognition models, which are their own work.

### Two things now blocking the next slice, and neither is engineering

| # | Blocker | Owner |
| --- | --- | --- |
| **D-1** (restated, now consequential) | Learner reporting has **no person grouping**. `Team`/`UserTeam` still hold zero rows with no write path. Every §4.4 entry is grained by team | Product |
| **R-1 (new)** | Two headline figures — section coverage and the source count — **can never have a delta** from anything stored. Either they lose it permanently, or a dated coverage snapshot becomes a schema requirement | Product |

R-1 is worth deciding before the next reporting slice rather than after: retrofitting history is a
migration, and removing a number from a mockup is a conversation.


---

## 9. Addendum 2026-09-29 — scope widened: competency and knowledge readiness

The product owner asked for KNOWZY to grow from an assessment platform into a **knowledge-readiness
and competency platform**, in four parts: an AI Document Studio, a competency foundation, knowledge
proficiency and workforce readiness reporting, and learner-facing foundations (self-assessment,
certifications, recommendations). The combined brief was **not** built as one change. It conflicted
with five recorded rules (specification first, no browser upload, a distinct AI processing purpose,
person-level data needing privacy decisions, gaps needing a real target), so it was split and the
first slice chosen explicitly: **COMPETENCY-M0/M1, specifications plus the competency foundation and
a structure-only importer.**

**This does not change the deployment plan above.** Waves 0–3 stand. The workstream is recorded in
[implementation-roadmap.md §3a](../implementation-roadmap.md#3a-extension-workstream--competency-and-knowledge-readiness-added-2026-09-29)
as eight milestones after the core path; only M0/M1 is done.

| Delivered 2026-09-29 | State |
| --- | --- |
| Architecture amended first ([architecture.md §14](../architecture.md#14-competency-and-knowledge-readiness-architecture--added-2026-09-29)), with principle P11 | **Done** |
| Seven specifications in `docs/competencies/` | **Done** |
| Migration 0015: reference-definition tables only | **Done** |
| Structure-only importer with dry run and apply | **Done**, idempotent, audited |
| Gap rule as a pure function | **Done**; refuses without an approved target |
| Any screen, route or person-level table | **Not built, deliberately** |

### Decisions now blocking the workstream, none of them engineering

| # | Blocker | Owner |
| --- | --- | --- |
| CP-1..CP-4 | Whether and how person-level competency data may be held, seen and reported | Privacy, HR, Legal |
| CP-5 / DS-2 | Approval for sending whole documents to a model for restructuring. **Not covered by the Codex generation approval** | Privacy, InfoSec |
| CM-1, CM-6 | Whether the RxSolutions matrix is the official framework, and who approves a version | Competency owner |
| CM-9 | Where approved role targets come from — the workbook has none | Workforce planning |
| KP-1 | Where a *person's* department or role comes from; today a department is a label on a question | Product, HR |

These belong beside T-29 in the Wave 0 conversation with Privacy: CP-5 in particular is the same
reviewers, the same processor, and a different purpose.
