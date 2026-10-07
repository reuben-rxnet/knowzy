# Competency Privacy and Governance

**Status:** Normative. Added 2026-09-29 with COMPETENCY-M0/M1.
**Owns:** the boundary between competency *reference definitions*, which this platform may hold,
and competency *observations about people*, which it may not hold until the decisions in §6 are
made. Every other document in `docs/competencies/` defers to this one on that boundary.
**Related:** [COMPETENCY_MODEL.md](COMPETENCY_MODEL.md) ·
[COMPETENCY_IMPORT_PLAN.md](COMPETENCY_IMPORT_PLAN.md) ·
[KNOWLEDGE_PROFICIENCY_ARCHITECTURE.md](KNOWLEDGE_PROFICIENCY_ARCHITECTURE.md) ·
[reporting.md §7](../reporting.md#7-privacy-and-suppression) ·
[security.md](../security.md)

---

## 1. What this expansion is, and what it is not

KNOWZY is being extended from an assessment platform towards **competency and knowledge-readiness
management**: a catalogue of what competencies an organization recognizes, what level a role is
expected to hold, and — later — aggregate views of whether a population is ready.

**This does not authorize employee performance evaluation.** In particular, nothing built under
this workstream may be used, presented, or designed to be used for:

- an automated or semi-automated employment decision (hiring, promotion, termination, pay,
  disciplinary action, allocation to or removal from work);
- ranking named people against each other;
- a score that combines different kinds of evidence (§3) into one unexplained number;
- inferring a trait the person did not state and that no evidence measures.

The intended use is **workforce planning and upskilling support**: which competencies a population
holds, where the gaps are against an *approved* target, and what learning would close them.

## 2. The reference workbook

`RealWorldPilot/CompetencyModels/07 RxSolutions Competency matrix - May 2024.xlsx` is the first
competency framework supplied. It is a **mixed** file:

| Part | Nature | Status in this platform |
| --- | --- | --- |
| Category bands, competency column headers, level vocabulary | Reference definitions | **May be imported** (structure-only) |
| Person rows: name, employee number, role, critical flag, internal/external status, vendor, project, experience, location, product/service | Identifiable personal data | **Never imported** |
| Individual ratings (`NI` / `R` / `A` / `G` per person per competency) | Personal data about competence | **Never imported** |
| Per-person Agile training status and per-person training *targets* | Personal data | **Never imported** |
| Summary and distribution sheets (counts and percentages per team and level) | Workbook-computed aggregates | **Not imported as authoritative** (§2.2) |
| Comments, threaded comments, the workbook `persons` part, document properties, custom XML | Author and commenter identities | **Never read** |

### 2.1 Handling rules for the file itself

1. **The file is never committed.** `RealWorldPilot/CompetencyModels/` is in `.gitignore`. No
   transformed copy containing person rows (CSV, JSON, Markdown, a fixture, a screenshot) may be
   committed either.
2. **The file is never sent to an external provider.** Not for normalization, not for summarization,
   not for a "quick look". Normalization is deterministic code (COMPETENCY_MODEL.md §5).
3. **Local inspection is permitted to understand structure**, and it was performed on 2026-09-29.
   Nothing learned about any person was written down; the only facts recorded are header labels,
   sheet names, row counts and vocabulary.
4. **Test fixtures are synthetic.** They are built in code with invented names planted
   specifically so a test can prove they do not escape (COMPETENCY_IMPORT_PLAN.md §7).

### 2.2 Why the workbook's own summaries are not imported

The summary and distribution sheets compute counts and percentages per team and level. They are
not imported as authoritative figures, for three reasons found by inspection:

- **The denominators disagree.** The distribution sheets divide by 118, the summary sheet totals 111,
  and the six team sheets hold 132 person rows between them. Which population each figure describes
  cannot be established from the file.
- **The formulas were not verified.** The importer reads cached cell values, never formulas, so a
  figure's derivation is unknown.
- **Small cells identify people.** Several cells are counts of 0, 1 or 2 for one team and one
  competency. Under [reporting.md §7 S1](../reporting.md#7-privacy-and-suppression) they could not
  be displayed anyway.

Their *text* — the level labels written beside the counts — is harvested as source labels for the
level vocabulary, because a label is a definition and not an observation.

## 3. Evidence sources are never merged

A statement about a person's competency comes from exactly one of these sources, and the source is
part of the statement:

| Source | Meaning | Who creates it | Status in this release |
| --- | --- | --- | --- |
| `SELF_ASSESSMENT` | The person's own rating of themselves | The person | Designed, not built |
| `ASSESSMENT_MEASURED` | Derived from scored assessment results in this platform | The scoring engine | Assessment proficiency exists (reporting.md §5); the mapping to a competency is designed, not built |
| `MANAGER_ASSESSMENT` | A line manager's rating | A manager | Designed, not built |
| `SME_ASSESSMENT` | A subject-matter expert's evaluation against the competency | An SME | Designed, not built |
| `CERTIFICATION_EVIDENCE` | A verified certificate mapped to a competency by an approved rule | A verifier plus a rule | Designed, not built |
| `IMPORTED_BASELINE` | A historical rating imported from an external matrix | An import | **Refused in this release** (§6, CP-1) |

**The rule:** sources are stored, displayed and reported **separately**. A self-rating never becomes
a verified rating by being read by somebody. A report may show two sources side by side; it may not
add, average or "blend" them. Any future combination rule is a normative change to this document,
with its formula displayed wherever its output is shown.

## 4. Aggregate reporting safeguards

When competency observations exist (a later milestone), every report over them must:

| # | Rule |
| --- | --- |
| G1 | Report **aggregates**, grouped by department, job role, functional area, or another *approved* organizational unit. **No dummy teams**: `Team` has no write path (reporting.md D-1) and none is invented to populate a view |
| G2 | Apply [reporting.md §7 S1](../reporting.md#7-privacy-and-suppression) (minimum group size, default 5, upward only) **and** S3 complementary suppression. A competency-specific threshold may be stricter, never looser |
| G3 | Never rank named people, and never offer a drill-through from an aggregate to a named row |
| G4 | Display, on every panel: **evidence source**, **effective date** (`asOf`), **confidence or verification state**, **suppressed-cell count**, and the **population definition** |
| G5 | Refuse a gap figure unless the gap rule in KNOWLEDGE_PROFICIENCY_ARCHITECTURE.md §4 is satisfied — the refusal is shown, never a zero |
| G6 | Carry the same scope, suppression and query path on the screen, the CSV and a snapshot (reporting.md B1/B2) |
| G7 | State its intended use — workforce planning and upskilling — in its header block |

## 5. Access, retention and audit

| Concern | Rule |
| --- | --- |
| Reference definitions | Readable with `taxonomy.read`; writable through the import path and, since COMPETENCY-M2, competency administration (`competency.manage`, held by `KNOWZY_ADMINISTRATOR` only). An approver of a version or role target may not be one of its editors (COMPETENCY_ADMINISTRATION.md §2 A3) |
| Person-level competency data | None is stored in this release. When it is, it is readable by the person, and by others only under a policy decided in §6 |
| Audit | Every import apply writes `ADMIN.COMPETENCY.IMPORT_APPLIED` in the same transaction, carrying counts only — never labels from person rows, because none are read |
| Retention | Reference definitions are never deleted; a definition is retired. Import findings and provenance are retained with their batch |
| Export | Not built. Any future export of competency data inherits reporting.md §8.1 (formula-injection defence, audited) |

## 6. Decisions that are not this platform's to make

Recorded, not chosen. Each blocks the capability named beside it.

| ID | Decision | Owner | Blocks |
| --- | --- | --- | --- |
| CP-1 | May historical per-person ratings be imported as an `IMPORTED_BASELINE`, and if so under what lawful basis, notice to the people rated, and retention? | Privacy, HR, Legal | Any person-level import |
| CP-2 | Who may see an individual's competency record other than the individual (manager? SME? nobody)? | HR, Privacy | My Competencies visibility settings; manager views |
| CP-3 | What is the minimum group size for competency aggregates? S1's 5 is the floor | Privacy, Data Governance | Knowledge Proficiency reports |
| CP-4 | Do works-council or employee-representation obligations apply to self-assessment or competency reporting in any jurisdiction the pilot covers? | Legal, HR | Self-assessment; any person-level data |
| CP-5 | Is sending document text to a model for **restructuring** (Document Studio) covered by the existing Codex approval? This document's position: **no** — it is a distinct processing purpose | Privacy, InfoSec | Document Studio (AI_DOCUMENT_STUDIO_ARCHITECTURE.md §7) |
| CP-6 | Are certificate files (which carry names, dates of birth, candidate numbers) in scope for storage at all, and where? | Privacy, InfoSec | My Certifications |

## 7. What enforces this today

| Rule | Enforced by |
| --- | --- |
| The workbook is not committed | `.gitignore` entry for `RealWorldPilot/CompetencyModels/` |
| The importer emits no person-level record | A unit test plants synthetic names, employee numbers, roles and ratings and asserts none appears anywhere in the plan (COMPETENCY_IMPORT_PLAN.md §7) |
| No rating, observation or self-assessment table exists | The schema: migration 0015 creates reference-definition tables only |
| A gap cannot be computed without an approved target | `evaluateCompetencyGap` returns `NOT_CALCULABLE` with the missing preconditions, and a unit test covers each one; a database CHECK refuses an `APPROVED` target without an approval record |
| Import is audited | `transactWithAudit` around the whole apply |
| Administration holds no person-level data | COMPETENCY-M2 adds catalogue writes, versions and role targets only; a role target names a **role**, never a person (COMPETENCY_ADMINISTRATION.md §5) |
