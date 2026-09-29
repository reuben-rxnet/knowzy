# Future Learning Recommendation Architecture

**Status:** Design only. **Classification: `REQUIRES_BACKEND_EXTENSION`.** No recommendation logic,
route or screen is built by this document, and none may be shown as working.
**Governed by:** [COMPETENCY_PRIVACY_AND_GOVERNANCE.md](COMPETENCY_PRIVACY_AND_GOVERNANCE.md).
**Builds on:** `KnowledgeRecommendation` (data-model.md §8.6) and the knowledge-refresher workflow
(workflows.md §7, roadmap Phase 9).

---

## 1. What exists, and what this adds

`KnowledgeRecommendation` already exists as a model: a **topic-level refresher** after a scored
result, with the approved explanation verbatim, citations built from the platform's own retrieval
records, and a `noSourceFound` flag so a missing source is stated rather than invented. Nothing writes
it yet (Phase 9).

This document adds **competency-level** recommendations: "given evidence about you and a target for
your role, here is available learning that would close a gap". It extends the same principles rather
than defining a second recommendation system.

## 2. Inputs

| Input | Source | Available today |
| --- | --- | --- |
| Assessment results and topic gaps | `assessment_result`, `topic_result` | Yes |
| Assessment-derived competency proficiency | A declared mapping (CM-3) | No |
| Self-assessments | KNOWLEDGE_PROFICIENCY_ARCHITECTURE.md §7 | No |
| Verified certification evidence | CERTIFICATION_TRACKING_ARCHITECTURE.md | No |
| Approved role competency targets | `role_competency_expectation`, status `APPROVED` | Table exists; **zero rows** |
| Content taxonomy | Domain, topic, and competency catalogues | Yes |
| Available learning | **Published** assessments, and knowledge sources marked `usableForRefreshers` | Yes |

## 3. Requirements

| # | Requirement |
| --- | --- |
| LR1 | **Every recommendation shows why**: the evidence it used (by source, with asOf), the target it compared against, and the gap rule's result. A recommendation whose gap is `NOT_CALCULABLE` is not made |
| LR2 | **Only real, available content** is recommended: a published assessment the person may take, or a source they can open. No course, module or path is invented — none exists in the schema, and learner spec §7.2 forbids reinterpreting assessments as courses |
| LR3 | **The person may dismiss or challenge** a recommendation. A challenge is recorded with its reason and is visible to whoever owns the rule; dismissal is never read as a signal about the person |
| LR4 | **No sensitive trait is inferred** — from names, locations, languages, working patterns, or anything a person did not state |
| LR5 | **No ranking of employees**, and no recommendation output is an input to an employment decision |
| LR6 | **Ranking of the recommendations themselves is deterministic code** with a declared formula, never a model decision (architecture.md P2). A model may, later, *phrase* a recommendation from the platform's own records, as the refresher design already allows |
| LR7 | Self-assessment input is labelled as self-reported in the explanation shown |

## 4. Proposed shape

A deterministic `recommendLearning(person, evidence, targets, catalogue)` that returns, per
recommendation: the competency, the evidence summary, the target, the gap result, the recommended
item (by id), and the rule version. It is stored append-only beside `KnowledgeRecommendation` (or as
a kind of it — LR-2), with the same `NEW` → `VIEWED` → `COMPLETED` / `DISMISSED` disposition.

## 5. Open decisions

| ID | Decision |
| --- | --- |
| LR-1 | The ranking formula and its inputs' weights, declared and displayed |
| LR-2 | Extend `KnowledgeRecommendation` with a kind, or add a sibling table? |
| LR-3 | Whether a manager may see a report's recommendations (CP-2) |
