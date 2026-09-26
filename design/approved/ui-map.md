# KNOWZY — UI implementation map

**Produced:** 2026-09-26, by reading the repository rather than the status reports.
**Method:** every route enumerated from `apps/*/src/app/**/page.tsx`; every API route from the
registry in `apps/api/src/routes/index.ts`; every table's row count read from the running database;
the design system inventoried from `packages/shared-ui/src/components/`.
**Companion documents:** [`screen-inventory.md`](screen-inventory.md) (per-screen status) and
[`design-decisions.md`](design-decisions.md) (the rules every new screen obeys).

---

## 1. What the audit found that changes the plan

Four findings, each of which moves work from "build a backend" to "build a screen", or the reverse.

1. **The Phase 9 and Phase 10 TABLES ALREADY EXIST.** `badge_definition` (10 seeded rows),
   `badge_award`, `certificate_rule` (1 row), `certificate`, `report_definition`, `report_run`,
   `report_publication`, `report_schedule`, `report_export`, `audit_event`, `notification`, `team`,
   `assessment_result`, `topic_result`. Migration 0001 created them and nothing has written to most
   of them. **So Phase 9 and Phase 10 are services, read models and screens — not schema design.**
2. **The Audit Explorer is completely unblocked and has 64,479 real rows to show.** It needs no new
   table, no external permission and no demo data. It is the single highest-value unblocked screen
   in the remaining scope, and it was listed as "Phase 10, not started".
3. **The Learning & Skillset Management Dashboard is the one genuinely NEW domain.** Its axes —
   level, skill, resource, readiness — do not exist. `User` carries `department`, `jobTitle` and
   `businessFunction`; `Team` exists and holds **zero rows**. Everything else in the remaining
   scope reads data the platform already models.
4. **There is no per-learner results list endpoint** (`/learning/results/:resultId` is by-id only),
   which is gap G-13 and the reason learner My Progress cannot be built from the existing API
   without one new read.

---

## 2. Classification of every surface

Using the brief's vocabulary. **BACKEND BLOCKED** means an external permission, approval or
credential is missing — never "we have not written it yet".

### 2.1 EXISTING — built, real data, browser-verified

| Surface                              | Route                       | Portal       |
| ------------------------------------ | --------------------------- | ------------ |
| Authoring dashboard                  | `/`                         | authoring    |
| Knowledge sources + document browser | `/sources`, `/sources/[id]` | authoring    |
| AI quiz generation                   | `/generate`                 | authoring    |
| Question import                      | `/import`                   | authoring    |
| Draft review queue                   | `/review`                   | authoring    |
| Question approval (13 gates, 6 tabs) | `/review/[questionId]`      | authoring    |
| Publish + Question Bank inventory    | `/publish`                  | authoring    |
| Knowledge Domains (taxonomy)         | `/administration/taxonomy`  | authoring    |
| **AI Usage & Budgets**               | `/governance/ai-usage`      | authoring    |
| Learner home + assessment list       | `/`                         | learner      |
| Assessment detail / start            | `/assessments/[id]`         | learner      |
| Quiz runner                          | `/sessions/[id]`            | learner      |
| Result, per-topic, gaps              | `/results/[id]`             | learner      |
| SharePoint Sync Manager              | `/`                         | sync (:3002) |

### 2.2 PARTIALLY IMPLEMENTED — real, but not the specified experience

| Surface             | What exists                          | What is missing                                                                                      |
| ------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Assessment creation | One form at the bottom of `/publish` | The five-step builder: question selection from the bank, reorder, settings, preview, publish (UI-M8) |
| Governance          | One screen, AI Usage & Budgets       | Policies, controls, compliance, audit coverage, data/access/content governance                       |
| Administration      | One screen, Knowledge Domains        | Users, roles, permissions, levels, learning sources, notifications, system settings, integrations    |
| Learner progress    | The result screen for ONE attempt    | My Progress across attempts — needs the G-13 read                                                    |

### 2.3 BACKEND READY — tables and/or services exist, no screen

| Surface                                    | Backing that already exists                                                                                                               |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Audit Explorer**                         | `audit_event`, 64,479 rows, with actor, action, entity, outcome, correlation id, IP, previous/new value. Permission `audit.read` declared |
| Badge management                           | `badge_definition` (10 seeded), `badge_award`, `BadgeTrigger`, declarative `criteria` JSON                                                |
| Certificate management                     | `certificate_rule` (1 seeded), `certificate`, `validityMonths`, `renderedHash`                                                            |
| Report catalogue, runs, exports, schedules | `report_definition`, `report_run`, `report_export`, `report_schedule`, `report_publication`                                               |
| Knowledge analytics                        | `knowledge_source`, `knowledge_document`, `document_section` coverage, `generation_job`, `published_question_reference`                   |
| Assessment analytics                       | `assessment_result`, `topic_result`, `quiz_session`, `assessment_eligibility_snapshot`                                                    |
| Question Bank analytics                    | `published_question_reference`, `draft_question` lineage, `generation_job_rejection`                                                      |

### 2.4 NOT STARTED — needs a new model as well as a screen

| Surface                                      | Why                                                                                                                                                              |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Learning & Skillset Management Dashboard** | Level, skill, resource and readiness are not modelled. `team` is empty. Needs schema, migration, seed of clearly synthetic org data, read model, then the screen |
| Refresher learning                           | Needs the recommendation record; generation of refresher content additionally needs a provider                                                                   |
| Weak-topic / knowledge-gap analysis          | Computable from `topic_result` + coverage today; the **department/role/level comparison** the brief asks for needs the same new org model                        |

### 2.5 BACKEND BLOCKED — build the UI, the contract and the pending state; never a fake success

| Surface                                                          | External dependency                                                                                                  |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| SharePoint knowledge sources, source configuration, delta status | `Sites.Selected` **read** (T-09..T-12) + app registrations. No Graph client exists                                   |
| Question Bank reconciliation, publish/sync detail                | `Sites.Selected` **Write** (T-22)                                                                                    |
| KNOWZY Copilot                                                   | An OpenAI data-processing approval, then `llm.approvedProviders`. The control layer, budgets and audit already exist |
| Any deployed environment                                         | G-1 Entra token validation + an Azure subscription                                                                   |

### 2.6 DEPRECATED / DUPLICATE

| Item                                                                                            | Disposition                                                                                              |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `docs/ui/live-portal-capability-matrix.md`                                                      | Superseded by `full-solution-capability-matrix.md`; kept for traceability only                           |
| `design/approved/Learning and Skillset Dashboard/learning-skillset-dashboard-reference.png.png` | Doubled extension. Renamed to `design/approved/learning-skillset-dashboard/reference.png` in this change |
| The assessment form on `/publish`                                                               | Superseded by the builder once UI-M8 lands. **Not removed** until the builder is real                    |

---

## 3. The design system, as it stands

`@knowzy/shared-ui` exports 17 component modules: `AppHeader`, `Asset`, `Badge`, `Brand`, `Button`,
`Card` (incl. `KpiCard`), `DataTable` (+ `THead`/`TBody`/`Tr`/`Th`/`Td`), `Field` (+ `TextInput`,
`Select`, `Textarea`, `CheckboxRow`), `Governance`, `Meter` (+ `BandScale`), `Overlay`
(`Modal`, `Drawer`), `Shells` (`AuthoringShell`, `LearnerShell`, nav), `SideNav`, `States`
(empty/loading/error), `TabNav` (+ `KeyValue`), `Traceability`, `WorkflowRibbon`.

**What every new screen needs and the package does not have:**

| Missing primitive                                  | Needed by                                                 |
| -------------------------------------------------- | --------------------------------------------------------- |
| Bar chart (vertical, labelled)                     | Learning completion by department, question difficulty    |
| Stacked bar (100%, horizontal)                     | Skillset status by level, pass/fail mix                   |
| Donut / ring                                       | Certification coverage, readiness split                   |
| Trend line / sparkline                             | Executive overview, learning activity over time           |
| Filter bar (label + control + reset)               | Every analytics screen                                    |
| Insight list (ranked, with a right-aligned figure) | Top skill gaps, upcoming learning                         |
| Delta indicator                                    | **Deliberately NOT built** — see `design-decisions.md` §4 |

These are built once, in the shared package, with no charting library: SVG and CSS over data the
screen already has. A library would add a bundle, a theming layer and an accessibility story that
the existing `Meter` already solves in nine lines.

---

## 4. Implementation order this audit implies

Unblocked and real first, because a screen fed by real rows cannot drift from its backend:

1. **Audit Explorer** — 64k real rows, no dependencies.
2. **Reporting read models + four analytics screens** — real numbers, small; no fabrication.
3. **Badge management and the award engine** — definitions are seeded.
4. **Assessment builder** (UI-M8) — the Question Bank is real.
5. **Learner My Progress** — plus the one missing read (G-13).
6. **Certificates** — `@knowzy/certificate-generator` is a placeholder; `pdf-lib` per ADR-009.
7. **Knowledge-gap analysis** — real, deepened once the org model exists.
8. **Learning & Skillset Dashboard** — new org domain, synthetic seed, then the screen.
9. **Administration and Governance** — real reads over existing registries.
10. **SharePoint, Question Bank write, Copilot** — UI + contract + pending state only.
