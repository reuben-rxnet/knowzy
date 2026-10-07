# Knowledge Proficiency Architecture

**Status:** Normative for §3–§4 (the concepts and the gap rule, which are implemented as pure code in
`packages/domain/src/competency/gap.ts`). **Design only** for §5–§8: nothing in those sections is
built, and no screen, route or table for them exists.
**Governed by:** [COMPETENCY_PRIVACY_AND_GOVERNANCE.md](COMPETENCY_PRIVACY_AND_GOVERNANCE.md).
**Related:** [COMPETENCY_MODEL.md](COMPETENCY_MODEL.md) · [reporting.md §5](../reporting.md#5-proficiency-semantics) ·
[CERTIFICATION_TRACKING_ARCHITECTURE.md](CERTIFICATION_TRACKING_ARCHITECTURE.md) ·
[FUTURE_LEARNING_RECOMMENDATION_ARCHITECTURE.md](FUTURE_LEARNING_RECOMMENDATION_ARCHITECTURE.md)

---

## 1. Purpose

Leadership wants to know which skills a population holds, which are missing, how ready a population
is for its work, and how expertise is distributed. This document defines what those words may mean
in this platform, and — more importantly — when a figure for them **may not be computed**.

## 2. Two things that already exist, and one that does not

| Concept | Exists? | Where |
| --- | --- | --- |
| **Assessment proficiency** — a learner's band in a domain, from scored attempts | Yes | reporting.md §5; `ProficiencyBand`, `GapState`, `topic_result`, `objective_result` |
| **Competency reference definitions** — what competencies and levels exist | Yes, since 0015 | COMPETENCY_MODEL.md |
| **Competency observations** — a statement that a person holds a competency at a level | **No** | Designed here, §3; stored nowhere |

The platform's existing `GapState` (`GAP` / `NO_GAP` / `INSUFFICIENT_EVIDENCE`) is about a learner's
**topic accuracy in an assessment**. A competency gap (§4) is a different comparison — an observation
against a role target — and uses its own vocabulary so the two cannot be confused in a report.

## 3. Evidence concepts

Five concepts, never merged into one score (privacy document §3).

| Concept | Definition | Required fields (when built) |
| --- | --- | --- |
| **Current competency observation** | "Person P holds competency C at level L on scale S, according to source X, as of date D" | subject, competency, level, scale, **source**, **observedAt**, recordedBy, verification state |
| **Role competency target** | "Role R is expected to hold competency C at level L" — `RoleCompetencyExpectation` | job role, competency, target level, status, **approval record**, effective from, source |
| **Assessment-derived proficiency** | An observation whose source is `ASSESSMENT_MEASURED`, produced by a declared mapping from assessment results (CM-3) | the mapping rule id and version, the results it used, asOf |
| **Learner self-assessment** | An observation whose source is `SELF_ASSESSMENT` (§7) | as observation, plus confidence statement, evidence note, review date, visibility |
| **Verified certification evidence** | A certificate that a verifier accepted, **and** an approved rule mapping it to a competency and level | see CERTIFICATION_TRACKING_ARCHITECTURE.md |

A self-assessment and an SME assessment of the same person and competency are **two observations**.
Neither overwrites the other, and there is no "current level" field that one of them wins.

## 4. The gap rule — implemented

A competency gap is **calculable only when all five preconditions hold**:

| # | Precondition | Refused as |
| --- | --- | --- |
| Q1 | An **approved population or role definition** — the target names an active job role | `NO_POPULATION` |
| Q2 | An **approved target level** — a `RoleCompetencyExpectation` with status `APPROVED` and an approval record | `NO_APPROVED_TARGET` |
| Q3 | A **valid current observation** — on the **same scale** as the target, not expired | `NO_VALID_OBSERVATION` / `SCALE_MISMATCH` |
| Q4 | A **declared observation source** — one of the §3 sources | `UNDECLARED_SOURCE` |
| Q5 | An **as-of date** on the observation | `NO_AS_OF_DATE` |

`evaluateCompetencyGap` is a pure function. It returns either
`{ state: 'NOT_CALCULABLE', missing: [...] }` — **every** missing precondition, not the first — or
`{ state: 'GAP' | 'MEETS_TARGET', shortfall, source, asOf }`, where `shortfall` is the ordinal
distance on the shared scale. It never returns a number when a precondition is missing, and the
screen that eventually renders it shows the refusal, never a zero or a blank.

**The reference workbook satisfies none of Q1–Q5 as imported.** It has no role targets (its Agile
"Target" block is per person), its version is `DRAFT`, and its ratings are not imported. So on this
release **no gap is calculable anywhere**, which is the honest state.

**Since COMPETENCY-M2 (2026-10-07) Q2 has a write path.** A role target is proposed with a required
source, approved by an administrator who neither proposed nor edited it, and only against an
`APPROVED` framework version ([COMPETENCY_ADMINISTRATION.md §5](COMPETENCY_ADMINISTRATION.md)).
Nothing has been approved: the imported version is still `DRAFT` (CM-1) and no target's source has
been supplied (CM-9). Q3–Q5 still have nothing to satisfy them, because no observation is stored, so
the release state is unchanged — **no gap is calculable anywhere**.

## 5. Readiness calculations — designed, not built

Each figure below is defined so that the first implementation has nothing to invent. Every one is an
aggregate over a population, suppressed under S1 and S3, and carries the G4 header (evidence source,
asOf, verification state, suppressed-cell count, population definition).

| Figure | Definition | Denominator | Refused when |
| --- | --- | --- | --- |
| **Competency coverage** | Share of a population with a valid observation (any level) for competency C, **per source** | Members of the population | The population is below the minimum group size |
| **Target attainment** | Share of a population whose observation meets the approved target for their role | Members **with both** a valid observation and an approved target | No approved target exists for the role (Q2) |
| **Gap count** | Members for whom `evaluateCompetencyGap` returns `GAP` | As above | As above |
| **Not calculable count** | Members for whom it returns `NOT_CALCULABLE`, shown **beside** every attainment figure | Members of the population | Never refused — it is the honesty figure, like `NOT_ASSESSED` beside readiness in reporting.md §5 |
| **Expertise distribution** | Count per level of scale S for competency C, per source | Members with a valid observation | Any cell below the minimum group size (then S3 applies to its siblings) |
| **Workforce readiness** | For a role: the share of its approved targets met, averaged over members, **per source**, with the not-calculable count beside it | Members of the role | Fewer than one approved target for the role |

**Never:** a readiness figure that mixes sources; a figure over a population drawn from `Team` (no
write path, reporting.md D-1); a "vs previous" delta without a stored history (the existing ban).

## 6. Management reporting — designed, not built

Target screens, under **Governance → Knowledge Proficiency** and **Reports → Competency Analytics**:

| Report | Grain | Notes |
| --- | --- | --- |
| Competency coverage | competency × population × source | |
| Competency gap analysis | competency × role, columns *Required · Available · Gap · Risk* | "Required" is the approved target, and a row without one reads **"No approved target"**, never a number. "Risk" needs a declared rule (open, KP-3) and is omitted until one exists |
| Workforce readiness | role × source | |
| Technology readiness | `TECHNICAL` competencies × population | |
| Functional area readiness | `FUNCTIONAL_DOMAIN` competencies × population | |
| Department capability | department × category | Requires a person-to-department assignment, which **does not exist** (a department is a label on a *question*) — KP-1 |
| Job role readiness | role × category | Requires a person-to-role assignment, which does not exist — KP-1 |
| Competency heatmap | rows: department / role / functional area; columns: competencies; red-amber-green | Colour thresholds must be declared and displayed; a suppressed cell is grey and labelled, never coloured |

No named-person row, ranking or drill-through appears in any of them (G3).

## 7. Self-assessment (Profile → My Competencies) — designed, not built

**Classification: `REQUIRES_BACKEND_EXTENSION`, blocked on CP-2 and CP-4.** No navigation item exists.

A learner may record, per competency in an **approved** framework version:

| Field | Rule |
| --- | --- |
| Competency | From the catalogue; never free text |
| Selected level | From that competency's scale. On the matrix scale: Not Involved · Limited Competency · Competency Improving · Competent |
| Confidence statement | Optional free text, the person's own words |
| Evidence note | Optional free text; **not** verification |
| Effective date | Defaults to today; required |
| Review date | Required; after it the observation is shown as due for review and is excluded from Q3 |
| Visibility | The person chooses from the options CP-2 permits; the default is **only me** |

**Storage:** its own table (`competency_self_assessment`), append-only per change, never a column on
a shared "competency level" row. **It never becomes verified**: an SME or manager assessment is a new
observation with its own source, even if it agrees. **It is never used for an automated decision**,
and reports that include it label every figure "Self-reported".

## 8. Open decisions

| ID | Decision | Blocks |
| --- | --- | --- |
| KP-1 | Where does a **person's** department, role or functional area come from — Entra attributes, an HR feed, or self-declaration? None exists today | Department capability; role readiness; every population except "everyone" |
| KP-2 | Which sources may a management report show at all? (For example, may self-assessment appear in a manager's view?) | Every §6 report |
| KP-3 | Is there a declared **risk** rule (for example, a competency with fewer than N competent people is "at risk")? | The Risk column |
| KP-4 | What colour thresholds does the heatmap use, and who approves them? | The heatmap |
