# KNOWZY — design decisions for the remaining screens

**Produced:** 2026-09-26. Every decision here is applied by the screens in
[`screen-inventory.md`](screen-inventory.md), and each one exists because the obvious alternative
would have produced a screen that looks finished and says something false.

---

## 1. Where the backend exists, the real screen IS the mockup

The brief asks for high-fidelity 16:9 mockups before implementation, and separately says not to
leave a page as a static mockup when the functionality can be implemented locally. Those pull in
opposite directions for the 19 unblocked screens, so:

- **Backend exists → build the real screen, then render it at 1920×1080.** The screenshot is the
  visual acceptance evidence, and it cannot drift from the product because it _is_ the product.
  Drawing a picture of a screen we are about to build for real is work thrown away twice: once to
  draw it, once when the real one disagrees with it.
- **Backend blocked → build a design-preview screen** under `/design-preview/*`, with synthetic
  data, carrying the same pending state the real screen will carry. These routes are **refused
  outside the `local` environment**, the same way the stub identity issuer is, so a preview can
  never reach a tenant.

Both kinds render into `design/approved/mockups/` with the same naming.

## 2. Synthetic data is labelled, always, and never in the product path

Demo data appears only on `/design-preview/*` screens, and every one of them carries a persistent
banner: **"Design preview — synthetic data. Not a product surface."** The figures use the brief's
own org vocabulary (Support-RXNET, Support-NG, Development-RXNET, Development-NG; Intern, Developer,
Senior Developer; Level 1–3; RxNet, MES 360, VisionStar, SAP Core Model, Azure, PowerShell) and
contain no personal data.

A real screen never falls back to demo data. If its read model returns nothing, it renders an
**empty state** (§5) — because "no data yet" and "here is some data" must not look the same.

## 3. Charts are SVG in the shared package, not a charting library

Every new analytics screen needs bars, stacked bars, a donut and a trend line. These are built in
`@knowzy/shared-ui` as small SVG components over data the screen already holds.

A library was considered and rejected: it adds a bundle to every page, a second theming system
beside the design tokens, and an accessibility story we would have to retrofit — while the existing
`Meter` shows that a labelled proportional bar is nine lines of CSS. Each chart component therefore:

- takes already-computed numbers (no aggregation in the component);
- renders a **table-equivalent** for assistive technology rather than an unlabelled `<svg>`;
- uses the declared palette tokens, so light and dark themes come free;
- distinguishes series by **label and pattern as well as colour** (§6).

## 4. No deltas, no trends against history that does not exist

The approved Learning & Skillset reference shows "↑ +6% vs last month" on every KPI. **Those are not
implemented, and the tiles omit them.**

No KPI history is stored anywhere in this platform — there is no snapshot table, no daily rollup and
no job that writes one. A "vs last month" figure would be computed from nothing. This is already a
standing rule in `CLAUDE.md` for exactly this reason, and it applies to the new dashboard even
though the reference image shows the deltas.

**What the screens show instead:** the current value, the window it covers ("last 30 days"), and —
where the underlying rows carry timestamps — a real trend line over those rows. Where a delta is
genuinely wanted later, the honest route is a snapshot table and a scheduled job, and that is
recorded as a follow-up rather than faked now.

The trend line on the executive overview is drawn **only** from `assessment_result.completedAt`,
`generation_job.createdAt` and `badge_award.awardedAt` — rows that exist and carry their own dates.

## 5. Four states on every screen, and the empty state says what to do

Loading, empty, error, normal. The shared `States` module already provides all four; the new
screens use it rather than inventing skeletons.

Empty states name the action, not the absence:

| Screen         | Empty state                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------- |
| Audit Explorer | "No audit events match these filters. Widen the date range or clear the action filter."                           |
| Reporting      | "No assessment has been completed yet. Figures appear here after the first learner attempt."                      |
| Knowledge gaps | "No knowledge gaps detected. A gap appears when a learner answers a topic incorrectly."                           |
| Badges         | "No badge has been awarded yet. Definitions are seeded; awards appear after an assessment result."                |
| SharePoint     | "SharePoint is not connected. This needs `Sites.Selected` read consent from a tenant administrator (T-09..T-12)." |
| Copilot        | "KNOWZY Copilot is awaiting a data-processing approval. No prompt is sent to any provider until it is recorded."  |

An error state carries the code and the plain reason, never a stack trace, and names the acting
identity where authorization is the cause.

## 6. One status vocabulary, icon plus label plus colour

Part 28's mapping, implemented once as `StatusBadge` tones so a status cannot be styled two ways on
two screens:

| Tone    | Statuses                                                                |
| ------- | ----------------------------------------------------------------------- |
| Success | Completed · Published · Connected · Ready · Passed · Approved · Healthy |
| Info    | In Progress · Ongoing · Processing · Scheduled · Submitted              |
| Warning | Planned · Needs Attention · Permission Required · Expiring · Partial    |
| Error   | Failed · Rejected · Not Taken · Critical · Unavailable · Refused        |
| Neutral | Draft · Archived · Not Configured · Unknown · Not Yet Recorded          |

**Never colour alone.** Every badge carries its word, and every chart series its label — a
red/green pass-fail chart read by a colour-blind reviewer must still be readable, and 8% of the male
population is the reason this is a rule rather than a preference.

## 7. Read models are service functions, not tables in a template

Each analytics screen reads through one named function with a view-model return type —
`getExecutiveOverview`, `getLearningAnalytics`, `getAssessmentAnalytics`, `getKnowledgeAnalytics`,
`getSkillsetAnalytics`, `getResourceReadiness`, `getAuditEvents`, `getReportCatalogue`,
`getExportHistory`. The UI never sees a Prisma row.

Two consequences, both deliberate: a screen can be rendered from a fixture when its backend is
absent (§1), and the aggregation is unit-testable without a browser.

`@knowzy/reporting` is the only package besides the similarity module permitted raw SQL
(repository-structure §5), so the aggregates live there rather than in the domain.

## 8. `RecordedNumber` everywhere, not zero

The control layer introduced a discriminated figure — `{ recorded: true, value }` or
`{ recorded: false }` — so a metric nothing has written renders **"Not Yet Recorded"** instead of a
confident `0`. Every new KPI uses it. A dashboard read by leadership deciding where to spend
training budget must not show 0% completion for a department that has simply never been measured.

## 9. Desktop-first at 1920, verified down to 1280

The analytics screens are composed for 1920×1080 and verified at 1600×900, 1440×900 and 1280×720.
Below 1280 they stay usable rather than pretty: tables scroll horizontally inside their card (the
existing `DataTable` already does this, with a keyboard-reachable scroll container), and KPI grids
reflow from four columns to two to one. **No analytics screen is claimed as a phone experience.**

## 10. The Learning & Skillset Dashboard needs a new domain, and it will be seeded synthetically

Its axes — level, skill, resource, readiness — are not in the schema. `User` has `department`,
`jobTitle` and `businessFunction`; `Team` exists and is empty. So the dashboard gets:

- a migration adding the skill and level model plus the assignment records it needs;
- a seed of **clearly synthetic** org data using the brief's vocabulary, in `local` only;
- a read model computing completion, status and readiness from those rows;
- then the screen, interactive, filtered by department / level / resource / role.

The reference image is the visual source of truth for layout and hierarchy. It is **not** embedded
as an image, and its per-tile deltas are omitted for the reason in §4.
