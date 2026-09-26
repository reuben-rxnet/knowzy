# Reporting & Analytics UI Source of Truth

**Approved visual reference:** `design/approved/reporting-and-analytics/KNOWZY-reporting-and-analytics-dashboard.png`
**Status of this document:** planning and design artifact. **Nothing in this file is implemented.**
**Created:** 2026-09-26, before Phase 10 implementation, so the design is official before code exists.
**Phase:** 10 — Reporting and audit surfaces ([implementation-roadmap.md](../implementation-roadmap.md))
**Specified by:** [reporting.md](../reporting.md) is the authority on read models, the report
catalogue, proficiency semantics, suppression and the publication lifecycle. Where this document and
that one disagree, **reporting.md wins**. Where either and the running code disagree, the code is
right and the document is stale.

> **The image is the visual source of truth. This Markdown is the AI-readable source of truth. The
> repository is the functional source of truth.**
>
> The mockup is an approved design reference, not a placeholder and not a specification of behaviour.
> **A widget existing in the image is not permission to invent the data behind it.** Every widget
> below therefore carries a status, and four of them are `BLOCKED` on facts this platform cannot
> currently produce.

---

## 0. Read this first: four things in the image that cannot be built as drawn

This is at the top rather than in an appendix, because each one is a thing an implementer would
otherwise build, ship, and be believed about.

| # | What the image shows | Why it cannot be built as drawn | What to do instead |
| --- | --- | --- | --- |
| **H1** | **"vs previous period" on all eight KPI cards** — `+12.4%`, `↓ -4.8%` | The platform stores **no KPI history**. Three documents already forbid this, and it is the first item on the "must not" list in CLAUDE.md. A delta shown today would be computed against a number nobody recorded | Phase 10's **day-grained read models** make a delta computable *for metrics derived from dated rows* (generations, publications, assessments completed). They do **not** make it computable for point-in-time states (Coverage, Knowledge Sources). §3 marks each KPI individually |
| **H2** | **AI Usage table with OpenAI Codex `842,000` tokens / `$312.80`, Claude `620,500` / `$128.31`, Copilot `98,200` / `$28.52`** | **No client for any external provider exists in this build.** OpenAI and Claude are `BLOCKED_BY_APPROVAL`; Copilot is `BLOCKED_BY_CAPABILITY` and **has no observable cost at all** (a per-seat licence — it records `null`, never a figure). Deterministic's cost is `0.000000`, not `$12.54` | Render the providers the registry declares, with their real state and their real figures. A provider with no calls shows **"Not Yet Recorded"**; Copilot's cost shows **"Not observable"** with the reason. See [AI_USAGE_AND_BUDGETS.md](../governance/AI_USAGE_AND_BUDGETS.md) §4 |
| **H3** | **Recent Activity: "AI provider validated — Claude connection verified"** | Nothing in this build can verify a connection. A provider validation reports the configuration chain and marks the live call `NOT_ATTEMPTED`, stating that authentication and reachability are **unverified** | The feed may show `ADMIN.CONFIGURATION.PROVIDER_VALIDATED` with its **recorded outcome** — which for Claude today is `FAILED` (no client) or `INCOMPLETE`. Never the word "verified" |
| **H4** | **Learner Performance heatmap: average scores by department × topic** | This is precisely the aggregate [reporting.md §7](../reporting.md#7-privacy-and-suppression) S1 governs. A department–topic cell covering three learners identifies them, and the mockup shows 30 cells with no suppression anywhere | Every cell must pass through suppression, including **complementary suppression** (S3), and the panel must carry the `suppressedCellCount`. A cell below `minimumGroupSize` renders **`SUPPRESSED`** — never a blank, never a zero (S2) |

Two further notes, smaller but real:

- **The sidebar in the image is not this platform's shell.** It shows a KNOWZY cube logo with the
  tagline **"LEARN · ASSESS · GROW"** and no EssilorLuxottica mark. The shipped header is
  `EssilorLuxottica | KNOWZY — Knowledge Today. Brighter Tomorrow.`, built to
  `design/approved/*.png` and asserted by a contract test against the approved asset pack. **The
  shipped shell wins**; this screen is a route inside it, not a second application.
- **The numbers in the image are illustrative** (14,582 questions, 42 sources, 5,421 assessments).
  The instance they were drawn for does not exist. No figure here is a target.

---

## 1. Header

| | |
| --- | --- |
| **Name** | Reporting header |
| **Purpose** | Name the screen, state its scope in one line, and carry the four global controls: date range, Export, Refresh, and the identity block |
| **Data source** | None for the title. The date range is a **query parameter**, not stored state |
| **Status** | `PARTIALLY_IMPLEMENTED` |

Visible in the image: title **"Reporting & Analytics"**, subtitle **"Insights across questions,
assessments, knowledge sources and AI usage"**, a date-range control reading
**"Sep 1, 2026 – Sep 16, 2026"**, an **Export** button (primary), a **Refresh** button (secondary),
a notification bell with a **`3`** badge, and an identity chip reading **"Reuben Dsouza / Admin"**.

| Control | Status | Note |
| --- | --- | --- |
| Title and subtitle | `PLANNED` | Copy goes in `copy.ts` (rule C1); no literal in a component |
| Date range picker | `PLANNED` | [reporting.md §3.1](../reporting.md) D9: a **half-open UTC interval** resolved at query construction, and **the resolved interval is displayed with the report**. The image shows an absolute range; a relative preset ("Last 30 days") must still print the dates it resolved to |
| Export | `PLANNED` | §8.1. CSV first. **Header block mandatory**: report name, parameters, resolved interval, effective scope, `asOf`, minimum group size, suppressed-cell count, exporter, timestamp. Formula-injection guard on every cell. Both the export and each download are audited |
| Refresh | `PARTIALLY_IMPLEMENTED` | It must mean **"re-read the read models"**, not "recompute them". A user-triggered `REFRESH MATERIALIZED VIEW` is a button that can cost minutes and lock nothing usefully. If a recompute is ever offered it needs its own permission and its own audit action |
| Notification bell with count | `BLOCKED` | There is **no notification producer**. The shipped header renders the bell disabled with no count, deliberately — a red `3` would be invented. Unblocked by a notification read model, not by Phase 10 |
| Identity chip | `IMPLEMENTED` | The shell already carries it, including the identity switcher and the §34 "Local Development Identity" disclosure that the mockup omits |

---

## 2. Navigation

| | |
| --- | --- |
| **Name** | Reporting section navigation |
| **Purpose** | Move between the eight reporting destinations |
| **Data source** | Static |
| **Status** | `PARTIALLY_IMPLEMENTED` |

The image shows eight items plus a footer link:

| # | Item in the image | Maps to | Status |
| --- | --- | --- | --- |
| 1 | **Dashboard** | This screen | `PLANNED` |
| 2 | **Question Pipeline** | [reporting.md §4.1](../reporting.md#41-authoring) Question pipeline | `PLANNED` |
| 3 | **Assessments** | §4.3 Assessment performance | `PLANNED` |
| 4 | **Knowledge Sources** | §4.2 Source coverage | `PLANNED` |
| 5 | **Filing Analytics** | **New.** Not in §4 — the four-axis filing postdates it | `PLANNED`, and reporting.md §4 needs an entry adding for it |
| 6 | **AI Usage & Budgets** | **Exists today** at `/governance/ai-usage` | `IMPLEMENTED` |
| 7 | **Governance** | The Governance section | `PARTIALLY_IMPLEMENTED` |
| 8 | **Audit Explorer** | **Exists today** at `/governance/audit` | `IMPLEMENTED` |
| — | **Help & Support** | — | `BLOCKED` — no help content exists |

**Two navigation decisions this raises, and neither is cosmetic.**

1. **AI Usage & Budgets and Audit Explorer already exist under Governance.** The image lists them as
   reporting destinations. They must not be **duplicated**: one screen, reachable from both places,
   or moved. A second copy of the AI Usage page reading the same data through a different route is
   two screens that will disagree within a month.
2. **The shipped rail has one entry per section** (`Reports`, `Governance`, `Administration`), with
   a tab strip inside a section — that is why `governance/tabs.ts` and `administration/tabs.ts`
   exist. Eight top-level reporting entries contradicts it. **Recommended:** `Reports` stays one
   rail entry, and these eight become its tab strip, exactly as Governance and Administration do.

---

## 3. KPI cards

| | |
| --- | --- |
| **Name** | Reporting KPI strip |
| **Purpose** | Eight headline figures across the whole platform |
| **Data source** | Phase 10 read models, per row below |
| **Status** | `PARTIALLY_IMPLEMENTED` — the figures are buildable; **the deltas mostly are not** (H1) |

| # | Card in the image | Value shown | Data source | Figure status | Delta status |
| --- | --- | --- | --- | --- | --- |
| 1 | Total Questions | `14,582` | `rm_question_pipeline`, summed | `PLANNED` | `PLANNED` — derivable from `draft_question.created_at`, so a prior-period count is honest |
| 2 | Published Questions | `9,847` | `rm_question_pipeline` where status = `PUBLISHED` | `PLANNED` | `PLANNED` — `published_question_reference.published_at` is dated |
| 3 | Assessments Completed | `5,421` | `rm_assessment_performance`, attempts | `PLANNED` | `PLANNED` — `assessment_result.completed_at` is dated |
| 4 | Pass Rate | `84.6%` | `rm_assessment_performance` | `PLANNED` | `PLANNED` — computable per window |
| 5 | Knowledge Sources | `42` | `knowledge_source` count | `PLANNED` | `BLOCKED` — a source's *current* count has no history. `+4` would need a dated membership record |
| 6 | Coverage | `78.4%` | `rm_source_coverage` | `PLANNED` | **`BLOCKED`** — `coverage_status` is a **current-state column with no history**. A coverage delta is not computable from anything stored, and this is the clearest case in the image of a number that would have to be invented |
| 7 | AI Generations | `1,278` | `rm_generation_yield` | `PLANNED` | `PLANNED` — `generation_job.created_at` is dated |
| 8 | Estimated AI Cost | `$482.17` | `rm_generation_yield`, observable cost only | `PARTIALLY_IMPLEMENTED` | `PLANNED` |

**Card 8 has a rule of its own.** Cost is `null`, never `0`, where it cannot be observed, and
`aggregateCost` **refuses a total** when any contributor is unobservable. So this card shows either a
figure, **"Not Yet Recorded"**, or **"Not observable"** with the reason — and today, with only the
deterministic provider, the honest value is `$0.000000`, which is a *measurement* rather than an
absence. A `$482.17` here would require a provider that has never run.

**Every card must carry its formula** (B3), reachable from the card.

---

## 4. Question Generation Trend

| | |
| --- | --- |
| **Name** | Question generation trend |
| **Purpose** | Monthly generated vs published questions over 12 months |
| **Data source** | `rm_question_activity` (publications, day grain) + `rm_generation_yield` (generation, day grain), rolled up to month |
| **Status** | `PLANNED` |

The image shows a two-series line chart, **Generated Questions** and **Published Questions**, over
`Oct 2025 – Sep 2026`, a `Last 12 Months` selector, and end-of-series callouts `1,842` / `1,276`.

| Aspect | Decision |
| --- | --- |
| **This is the one trend in the image that is honest** | Both series come from dated rows, so a monthly series is a `GROUP BY date_trunc('month', …)` over records that exist. It needs no stored history at all — which is exactly why the *KPI deltas* are the problem and this chart is not |
| Months with no activity | Drawn as **0**, because zero generations in a month is a measurement. This is the one place a zero is correct, and it differs from a KPI with no record, which says "Not Yet Recorded" |
| Partial current month | **Must be labelled.** September 2026 in the image is a partial month drawn level with twelve complete ones; without a label it reads as a decline |
| Chart implementation | `packages/shared-ui/src/components/Charts.tsx` — SVG, no charting library, with a visually-hidden data table carrying the same numbers |
| Phase 10 mapping | §4.1 **Generation yield** |

---

## 5. Question Status Distribution

| | |
| --- | --- |
| **Name** | Questions by status |
| **Purpose** | The lifecycle distribution of the whole bank |
| **Data source** | `rm_question_pipeline` — the **on-write** model, so this panel is exact and instant (D1) |
| **Status** | `PLANNED` |

The image shows a donut with `14,582` in the centre and a five-item legend with counts and
percentages: Published `67.5%`, Approved `19.4%`, In Review `6.6%`, Draft `4.4%`, Rejected `2.1%`.
Filter: `All Domains`.

**The five buckets are a grouping of ten real states, and the mapping must be declared rather than
improvised.** Proposed:

| Bucket in the image | Lifecycle states it covers |
| --- | --- |
| Draft | `GENERATED`, `DRAFT` |
| In Review | `AUTHOR_REVIEW`, `SUBMITTED_FOR_APPROVAL`, `CHANGES_REQUESTED` |
| Approved | `APPROVED` |
| Published | `PUBLISHED` |
| Rejected | `REJECTED` |

**`RETIRED` and `ARCHIVED` are absent from the image.** They are real states holding real questions,
so either the donut gains a sixth and seventh segment or the centre total states that it counts
**active** questions only. It must not silently exclude them from a figure labelled "Total
Questions" — the sum of the legend would then not equal the centre, which is the first thing a
reader checks.

Phase 10 mapping: §4.1 **Question pipeline**.

---

## 6. Department and Job Role Analytics

| | |
| --- | --- |
| **Name** | Questions by department and job role |
| **Purpose** | How the bank is distributed across the two organizational axes |
| **Data source** | `rm_filing_coverage` (domain × topic × department × role) |
| **Status** | `PLANNED` |

The image shows a stacked bar chart: departments as series (**Support Operations, Development-NG,
Infrastructure, VisionStar, Service Management**) over job roles as categories (**Support Engineer,
Developer, System Admin, Business Analyst, Project Manager, IT Operations, Service Desk, Other**).
Filter: `All Departments`.

| Aspect | Decision |
| --- | --- |
| **"Other" is doing real work** | Most questions today carry **no** department and **no** role. That population is the single most useful thing this panel can show, and it must be labelled **"Not filed"** rather than "Other" — "Other" implies a residual category, "Not filed" is an instruction |
| Suppression | **Does not apply.** A question is not a person. Suppressing question counts by department would protect nobody and make the panel useless (§7 S1 covers aggregates that identify an *individual*) |
| The department and role lists | Come from the **catalogues**, not from a fixed list. The seed ships one domain and one topic; departments and roles are a tenant decision |
| Phase 10 mapping | **New entry needed in reporting.md §4.** The four-axis filing postdates that section, so "Filing coverage" must be added to the catalogue with its grain, permission and drill-through before this ships |

---

## 7. Learner Performance Heatmap

| | |
| --- | --- |
| **Name** | Learner performance |
| **Purpose** | Average assessment score by department × topic, to find where knowledge is weak |
| **Data source** | `rm_topic_gap` / `rm_learner_proficiency` (**neither exists yet**) joined to the filing axes |
| **Status** | **`BLOCKED`** |

The image shows a 5 × 6 grid — departments (**Support Operations, Development-NG, Infrastructure,
VisionStar, Service Management**) × topics (**RxNet, MES 360, VisionStar, SAP, Azure, PowerShell**) —
with a percentage in every cell and a five-band colour legend (`< 60%`, `60–70%`, `70–80%`,
`80–90%`, `> 90%`).

**Why `BLOCKED`, and it is three separate blocks:**

1. **Suppression is mandatory and absent from the design** (H4). Thirty cells of learner averages
   is the textbook identifying aggregate. Every cell needs S1, S3 must run across each row and
   column, and the panel needs a `suppressedCellCount`. **A heatmap with suppressed cells looks
   different from this image** — some cells will read `SUPPRESSED` — and the design must accept that
   before it is built.
2. **A learner has no department.** The image groups learners by department, and `department` is a
   label on a **question**, not on a person. The platform's person-grouping model is `Team` /
   `UserTeam` — which exist in the schema since migration 0001 with **zero rows and no write path**,
   the same shape the taxonomy had before it was fixed. Grouping learners therefore needs either a
   team administration surface or a decision to group by something that exists.
3. **The read models do not exist.** `rm_topic_gap` and `rm_learner_proficiency` are specified in
   [reporting.md §3.1](../reporting.md) and are **not** in Phase 10 R1's five reports.

**What is buildable now instead**, and worth building: topic accuracy **without a person grouping** —
`topic_result` rolled up by topic, which is real, needs no team model, and answers "which topics are
weak" if not "weak for whom". That is §4.4 **Topic gap analysis** minus its team dimension, and it
should be drawn as a bar chart rather than a heatmap, because a one-dimensional heatmap is a bar
chart with the numbers hidden.

Phase 10 mapping: §4.4 **Topic gap analysis**, §4.4 **Domain proficiency**. Not R1.

---

## 8. Knowledge Source Health

| | |
| --- | --- |
| **Name** | Knowledge source health |
| **Purpose** | Per source: documents, sections, coverage, questions produced, last sync, health |
| **Data source** | `rm_source_coverage` + `knowledge_source_sync` |
| **Status** | `PARTIALLY_IMPLEMENTED` |

The image shows a table — **Source · Documents · Sections · Coverage (bar) · Questions · Last Sync ·
Status** — with six rows (`SOP Corpus`, `GenerationReady`, `VisionStar Bank`, `RxNet Documentation`,
`MES 360 Guides` at **Warning**, `SAP Knowledge Hub`) and an `All Sources` filter.

| Column | Status | Note |
| --- | --- | --- |
| Source, Documents, Sections | `PLANNED` | Counts of rows that exist |
| Coverage | `PLANNED` | `sections_covered ÷ sections_assessable`. **Coverage and generation outcome are different fields** and conflating them once reported 94.8% where the truth was 2.6% — a refusal is not coverage |
| Questions | `PLANNED` | Drafts traced to the document |
| Last Sync | `IMPLEMENTED` | Already on the Sync Manager |
| Status (Healthy / Warning) | `PARTIALLY_IMPLEMENTED` | The **derivation must be declared**, not eyeballed. The Sync Manager already derives a status from state rather than storing one; this panel must reuse that derivation rather than invent a second one that disagrees |

**This panel overlaps the SharePoint Sync Manager**, which is a separate application on port 3002 and
owns source operations. The reporting version must be **read-only** — no Sync Now, no Pause — or the
two applications' responsibilities blur. §4.2's own entry is `Source coverage`, scoped by
`report.read`; `Source health` is scoped by `source.read` and belongs to the operator.

Phase 10 mapping: §4.2 **Source coverage**, §4.2 **Document usage**.

---

## 9. AI Usage & Budgets

| | |
| --- | --- |
| **Name** | AI usage and budgets (reporting view) |
| **Purpose** | Per provider: tokens, cost, budget remaining, health |
| **Data source** | `generation_provider_call`, `generation_job`, `llm.*` configuration |
| **Status** | `IMPLEMENTED` as a screen; **`BLOCKED` as drawn** (H2) |

The image shows four providers with figures: `Deterministic 125,430 / $12.54 / 87% / Healthy`,
`OpenAi Codex 842,000 / $312.80 / 42% / Healthy`, `Claude 620,500 / $128.31 / 61% / Healthy`,
`Copilot 98,200 / $28.52 / 78% / Healthy`. Filter: `Last 30 Days`.

**This screen already exists** at `/governance/ai-usage` with ten KPIs, budget windows for three
window lengths, a provider breakdown, a concurrency card, a usage heatmap and generation history.
Its documentation is [AI_USAGE_AND_BUDGETS.md](../governance/AI_USAGE_AND_BUDGETS.md).

**Four differences between the image and the shipped screen, all of which the shipped screen is right
about:**

| The image | The platform |
| --- | --- |
| Deterministic costs `$12.54` | It costs **`0.000000`** — and that zero is a *measurement*, the one case where zero is a fact |
| Codex and Claude have token usage and cost | **No client exists for either.** Both are `BLOCKED_BY_APPROVAL` and have never run. Their figures read **"Not Yet Recorded"** |
| Copilot has an estimated cost of `$28.52` | Copilot is a **per-seat licence** with **no observable marginal cost**, and it is `BLOCKED_BY_CAPABILITY` besides. It records `null` with a reason and renders **"Not observable"** |
| All four are `Healthy` | Health is `UNKNOWN` with no calls in the window — and `UNKNOWN` is not `Healthy`. Three of these four have never been called at all |

**What the reporting view should add** over the governance screen: a **windowed, dated** view for
trend (the governance screen is a current-state page), and the export. It must not restate the same
figures through a second read path.

Phase 10 mapping: §4.5 **Reuse and savings**, plus the existing AI usage read model.

---

## 10. Recent Activity Feed

| | |
| --- | --- |
| **Name** | Recent activity |
| **Purpose** | The last N platform events, as a narrative of what changed |
| **Data source** | `audit_event` — which already holds **64,479 real events** |
| **Status** | `PARTIALLY_IMPLEMENTED` |

The image shows seven entries with an icon, a title, a subtitle and a timestamp, and a **View All →**
link. The entries are: *Assessment published · Question approved · Source synchronized · AI provider
validated · Assessment completed · Questions generated · Knowledge source added.*

| Aspect | Status | Note |
| --- | --- | --- |
| The events | `IMPLEMENTED` | Every one maps to a real audit action, checked against the generated registry rather than recalled: `AUTHORING.ASSESSMENT.PUBLISHED`, `AUTHORING.QUESTION.APPROVED`, `ADMIN.SOURCE.SYNC_COMPLETED`, `ADMIN.CONFIGURATION.PROVIDER_VALIDATED`, `LEARNING.SESSION.COMPLETED`, `AUTHORING.GENERATION.JOB_COMPLETED`, `ADMIN.SOURCE.CREATED`. Note the first one's family: publishing an assessment is an **authoring** act, not a learning one |
| The feed itself | `PLANNED` | A scoped, suppressed projection of `audit_event`, not a raw tail. The **Audit Explorer** is the drill-through and is already built |
| **"Claude connection verified"** | **`BLOCKED`** | See H3. The recorded outcome for a Claude validation today is a **failure with a reason**, and the feed must show that rather than a verification |
| `View All →` | `PLANNED` | Links to `/governance/audit` with the filter pre-applied |
| Actor names | `PARTIALLY_IMPLEMENTED` | The audit trail records the actor. **§4.1 exposes reviewer and approver identity only under `audit.read`** — the traceability panel on a question deliberately does *not* name them. The feed must obey the same rule, so entries are actor-less at `report.read` |
| Suppression | `PLANNED` | "5 learners completed VisionStar Assessment" is a **learner count**, so S1 applies to it |

Phase 10 mapping: [audit-model.md §7](../audit-model.md), §4.5 **Governance activity**.

---

## 11. Phase 10 mapping, consolidated

| Section | reporting.md §4 catalogue entry | Read model | In Phase 10 **R1**? |
| --- | --- | --- | --- |
| 3. KPI cards | Several, aggregated | All five R1 models | Yes, **without most deltas** |
| 4. Generation trend | §4.1 Generation yield | `rm_generation_yield`, `rm_question_activity` | Yes |
| 5. Status distribution | §4.1 Question pipeline | `rm_question_pipeline` | Yes |
| 6. Department & role | **New entry required** | `rm_filing_coverage` | Yes |
| 7. Learner heatmap | §4.4 Topic gap, Domain proficiency | `rm_topic_gap`, `rm_learner_proficiency` | **No** |
| 8. Source health | §4.2 Source coverage, Document usage | `rm_source_coverage` | Yes |
| 9. AI usage | §4.5 Reuse and savings | existing AI usage read model | Screen exists |
| 10. Activity feed | §4.5 Governance activity, audit-model §7 | `rm_governance_activity` | Feed **no**, Audit Explorer **yes** |

**Phase 10 R1 therefore delivers sections 3 (partly), 4, 5, 6 and 8.** Sections 7 and 10's feed need
read models and, for section 7, a decision about how learners are grouped.

---

## 12. Rules any implementation of this screen must not break

Carried from the standing rules and from what this screen specifically invites.

1. **No fabricated delta.** No "vs previous period" for a metric with no dated source (H1).
2. **No fabricated provider figure.** "Not Yet Recorded" and "Not observable" are the two honest
   answers, and they are different from each other and from zero (H2).
3. **No claimed connection.** A validation reports what it checked (H3).
4. **Suppression is not optional and has no override** (S9). It is applied **inside** the read model
   so the dashboard, the CSV and a snapshot are identically constrained (S6/B2).
5. **`asOf` on every panel**, from `refresh_state.refreshed_at` and never `now()`. A failed refresh
   **labels** the panel and leaves the previous data in place — it never blanks it (D2/D4).
6. **Every metric shows its formula** (B3).
7. **A suppressed row never contributes to a visible total** (S4).
8. **No question text, answer key, explanation, evidence or learner answer value in any read model
   or export, at any permission level** (D8/S7).
9. **One query path.** The panel, the export and a snapshot read the same dataset function (B1).
10. **Exports carry the header block** — scope, suppression, `asOf`, interval — so a file that leaves
    the platform still states what it does and does not contain (S8).
11. **No route without a declared policy.** The registry test fails the build on a handler without
    one.

---

## 13. Open decisions for the product owner

Neither is an engineering choice, and both change what gets built.

| # | Decision | Recommendation |
| --- | --- | --- |
| **D-1** | **How are learners grouped for §7?** `Team`/`UserTeam` exist with zero rows and no write path. The options are: build team administration, group by the **department** a learner's *assessment* was filed under (indirect and arguably wrong), or ship topic accuracy with **no** person grouping | **Ship without a person grouping in R1**, and treat team administration as its own milestone. A heatmap axis that needs a data model nobody maintains is the row of the report that is always empty |
| **D-2** | **One AI Usage screen or two?** The image lists it under Reports; it exists under Governance | **One screen, two entry points.** Two screens reading the same data through different paths will disagree, and the one nobody opens will be the wrong one |

---

## 14. Change log

| Date | Change |
| --- | --- |
| 2026-09-26 | Created from the approved reference `KNOWZY-reporting-and-analytics-dashboard.png`, before any Phase 10 implementation. Ten sections documented; four widgets classified `BLOCKED` with the reason and the condition for unblocking; two decisions raised for the product owner. |
