# KNOWZY — screen inventory

**Produced:** 2026-09-26 from the repository. Updated as each screen lands; the columns are the
brief's (Part 21).

**Status vocabulary**

| Column         | Values                                                                                |
| -------------- | ------------------------------------------------------------------------------------- |
| Current status | `EXISTING` · `PARTIAL` · `BACKEND READY` · `BACKEND BLOCKED` · `NOT STARTED`          |
| Mockup         | `Complete` (a rendered 1920×1080 screenshot exists) · `Pending` · `N/A — real screen` |
| Implementation | `Complete` · `In progress` · `Pending`                                                |
| Responsive     | `Verified` at 1920/1600/1440/1280 · `Pending`                                         |
| Accessibility  | `Verified` (keyboard + axe + semantics) · `Pending`                                   |

**One rule about mockups, stated here because it shapes every row:** where the backend exists, the
"mockup" is a **screenshot of the real screen against real data** — building a picture of a screen
we are about to build for real is work thrown away, and a rendered real screen is stronger visual
acceptance evidence than a drawing. Where the backend is blocked, a design-preview screen with
clearly-labelled synthetic data is built instead, and it carries the pending state the real screen
will carry. See [`design-decisions.md`](design-decisions.md) §1.

---

## A. Existing screens — the visual baseline

| ID      | Screen                                       | Portal       | Audience          | Route                      | Backend | Current  | Mockup   | Impl     | Resp     | A11y     |
| ------- | -------------------------------------------- | ------------ | ----------------- | -------------------------- | ------- | -------- | -------- | -------- | -------- | -------- |
| AUT-001 | Authoring dashboard                          | Authoring    | Author, admin     | `/`                        | Real    | EXISTING | N/A      | Complete | Verified | Verified |
| AUT-002 | Knowledge sources                            | Authoring    | Source admin      | `/sources`                 | Real    | EXISTING | N/A      | Complete | Verified | Verified |
| AUT-003 | Document browser                             | Authoring    | Author            | `/sources/[id]`            | Real    | EXISTING | N/A      | Complete | Verified | Verified |
| AUT-004 | AI quiz generation                           | Authoring    | Author            | `/generate`                | Real    | EXISTING | N/A      | Complete | Verified | Verified |
| AUT-005 | Question import                              | Authoring    | Author            | `/import`                  | Real    | EXISTING | N/A      | Complete | Verified | Verified |
| AUT-006 | Draft review queue                           | Authoring    | Reviewer          | `/review`                  | Real    | EXISTING | N/A      | Complete | Verified | Verified |
| AUT-007 | Question approval (13 gates)                 | Authoring    | Approver          | `/review/[id]`             | Real    | EXISTING | N/A      | Complete | Verified | Verified |
| AUT-008 | Publish + bank inventory                     | Authoring    | Publisher         | `/publish`                 | Real    | EXISTING | N/A      | Complete | Verified | Verified |
| ADM-001 | Knowledge Domains, **Departments and Roles** | Authoring    | Admin             | `/administration/taxonomy` | Real    | EXISTING | Complete | Complete | Verified | Pending  |
| GOV-001 | AI Usage & Budgets                           | Authoring    | Leadership, admin | `/governance/ai-usage`     | Real    | EXISTING | Complete | Complete | Verified | Pending  |
| LRN-001 | Learner home                                 | Learner      | Learner           | `/`                        | Real    | EXISTING | N/A      | Complete | Verified | Verified |
| LRN-002 | Assessment detail / start                    | Learner      | Learner           | `/assessments/[id]`        | Real    | EXISTING | N/A      | Complete | Verified | Verified |
| LRN-003 | Quiz runner                                  | Learner      | Learner           | `/sessions/[id]`           | Real    | EXISTING | N/A      | Complete | Verified | Verified |
| LRN-004 | Result and gaps                              | Learner      | Learner           | `/results/[id]`            | Real    | EXISTING | N/A      | Complete | Verified | Verified |
| SYN-001 | SharePoint Sync Manager                      | Sync (:3002) | Source admin      | `/`                        | Real    | EXISTING | N/A      | Complete | Verified | Verified |

## B. Unblocked and being built — real data, real screens

**Delivered 2026-09-26:** AUD-001 (Audit Explorer, over 64,479 real events) and the two
organizational catalogues on ADM-001 (departments and roles, so a question is filed under
Department, Role, Domain and Topic — requested directly). Migration 0010 added `department`,
`job_role` and the nullable mapping columns on `draft_question`,
`published_question_reference` and `generation_job`.

| ID      | Screen                                       | Portal     | Audience            | Route                             | Backend                              | Current       | Mockup   | Impl     | Resp    | A11y    |
| ------- | -------------------------------------------- | ---------- | ------------------- | --------------------------------- | ------------------------------------ | ------------- | -------- | -------- | ------- | ------- |
| AUD-001 | Audit Explorer                               | Authoring  | Auditor, governance | `/governance/audit`               | `audit_event` (64,479 rows)          | **EXISTING**  | Complete | Complete | Pending | Pending |
| RPT-001 | Reporting executive overview                 | Authoring  | Leadership          | `/reports`                        | Phase 10 read model                  | BACKEND READY | Pending  | Pending  | Pending | Pending |
| RPT-002 | Learning analytics                           | Authoring  | Management          | `/reports/learning`               | Phase 10 read model                  | BACKEND READY | Pending  | Pending  | Pending | Pending |
| RPT-003 | Assessment analytics                         | Authoring  | Management          | `/reports/assessments`            | `assessment_result`, `topic_result`  | BACKEND READY | Pending  | Pending  | Pending | Pending |
| RPT-004 | Knowledge analytics                          | Authoring  | Knowledge manager   | `/reports/knowledge`              | sources, documents, coverage, jobs   | BACKEND READY | Pending  | Pending  | Pending | Pending |
| RPT-005 | Report catalogue and exports                 | Authoring  | Report publisher    | `/reports/catalogue`              | `report_definition`, `report_export` | BACKEND READY | Pending  | Pending  | Pending | Pending |
| BDG-001 | Badge management                             | Authoring  | Admin               | `/administration/badges`          | `badge_definition` (10)              | BACKEND READY | Pending  | Pending  | Pending | Pending |
| CRT-001 | Certificate management                       | Authoring  | Admin               | `/administration/certificates`    | `certificate_rule`, `certificate`    | BACKEND READY | Pending  | Pending  | Pending | Pending |
| GAP-001 | Weak topic / knowledge gap analysis          | Authoring  | Management          | `/reports/gaps`                   | `topic_result`, coverage             | BACKEND READY | Pending  | Pending  | Pending | Pending |
| ASB-001 | Assessment builder — Details                 | Authoring  | Assessment manager  | `/assessments/new`                | Real                                 | PARTIAL       | Pending  | Pending  | Pending | Pending |
| ASB-002 | Assessment builder — Questions               | Authoring  | Assessment manager  | `/assessments/new?step=questions` | Question Bank                        | PARTIAL       | Pending  | Pending  | Pending | Pending |
| ASB-003 | Question editor                              | Authoring  | Author              | `/review/[id]` (extend)           | Real                                 | PARTIAL       | Pending  | Pending  | Pending | Pending |
| ASB-004 | Assessment preview                           | Authoring  | Assessment manager  | `/assessments/new?step=preview`   | Real                                 | PARTIAL       | Pending  | Pending  | Pending | Pending |
| ASB-005 | Assessment settings                          | Authoring  | Assessment manager  | `/assessments/new?step=settings`  | Real                                 | PARTIAL       | Pending  | Pending  | Pending | Pending |
| LRN-005 | My Progress                                  | Learner    | Learner             | `/my-progress`                    | Needs G-13 read                      | PARTIAL       | Pending  | Pending  | Pending | Pending |
| ADM-002 | Administration home                          | Authoring  | Admin               | `/administration`                 | Real                                 | PARTIAL       | Pending  | Pending  | Pending | Pending |
| ADM-003 | Users, roles and permissions                 | Authoring  | Admin               | `/administration/access`          | `user`, `user_role`, registries      | BACKEND READY | Pending  | Pending  | Pending | Pending |
| GOV-002 | Governance overview                          | Authoring  | Leadership          | `/governance`                     | Policy + audit registries            | PARTIAL       | Pending  | Pending  | Pending | Pending |
| MGT-001 | **Learning & Skillset Management Dashboard** | Management | Leadership          | `/management/skillset`            | **New org domain**                   | NOT STARTED   | Pending  | Pending  | Pending | Pending |

## C. Backend blocked — UI, contract and pending state only

| ID      | Screen                              | Portal              | Audience     | Route                     | External dependency                                | Current         | Mockup  | Impl    | Resp    | A11y    |
| ------- | ----------------------------------- | ------------------- | ------------ | ------------------------- | -------------------------------------------------- | --------------- | ------- | ------- | ------- | ------- |
| SHP-001 | SharePoint knowledge sources        | Sync                | Source admin | `/sharepoint`             | `Sites.Selected` read, T-09..T-12                  | BACKEND BLOCKED | Pending | Pending | Pending | Pending |
| SHP-002 | SharePoint source configuration     | Sync                | Source admin | `/sharepoint/configure`   | Same                                               | BACKEND BLOCKED | Pending | Pending | Pending | Pending |
| SHP-003 | Sync / delta status                 | Sync                | Source admin | `/sharepoint/status`      | Same                                               | BACKEND BLOCKED | Pending | Pending | Pending | Pending |
| QBK-001 | Question Bank reconciliation        | Authoring           | Publisher    | `/publish/reconciliation` | `Sites.Selected` **Write** (T-22)                  | BACKEND BLOCKED | Pending | Pending | Pending | Pending |
| QBK-002 | Publishing / synchronisation detail | Authoring           | Publisher    | `/publish/[operationId]`  | T-22                                               | BACKEND BLOCKED | Pending | Pending | Pending | Pending |
| CPL-001 | KNOWZY Copilot                      | Learner + Authoring | All          | `/copilot`                | OpenAI data-processing approval                    | BACKEND BLOCKED | Pending | Pending | Pending | Pending |
| RFR-001 | Refresher learning                  | Learner             | Learner      | `/refreshers`             | Provider (for generation) + recommendation records | BACKEND BLOCKED | Pending | Pending | Pending | Pending |

## D. Operational surfaces — only where a product surface is genuinely required

Part 16 of the brief: no UI invented merely to represent a security task.

| ID      | Surface                                    | Decision                                                                                                                              |
| ------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| OPS-001 | Permission denied / authentication failure | **Already exists** as the `Problem` component with the acting identity and the missing permission named. No new screen                |
| OPS-002 | Service unavailable                        | **Already exists** — "API unreachable" panels state the cause and the fix                                                             |
| OPS-003 | System health                              | To build inside GOV-002 as a panel, not a screen: conditions that are true now, from the same startup checks the services already run |
| OPS-004 | Audit seal status                          | A panel on AUD-001. The seal job is Phase 11; the panel states "not yet run" rather than implying a seal                              |
| OPS-005 | Backup / restore status                    | **Not built.** Not operationally exposed in this release, and a screen that cannot trigger or verify a restore would be decoration    |

---

## E. Counts

|                                                |        |
| ---------------------------------------------- | ------ |
| Existing screens                               | 15     |
| Unblocked, to build                            | 19     |
| Backend blocked, UI-only                       | 7      |
| Operational panels rather than screens         | 3 of 5 |
| **Total screens in the product when complete** | **41** |
