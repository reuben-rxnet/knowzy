# Competency Administration

**Status:** Normative. Specified 2026-10-07 for COMPETENCY-M2, roadmap §3a, before any code, and
built the same day (migration `0016_competency_administration`).
**Screen:** Administration → Competencies (`/administration/competencies`).
**Governed by:** [COMPETENCY_PRIVACY_AND_GOVERNANCE.md](COMPETENCY_PRIVACY_AND_GOVERNANCE.md).
**Related:** [COMPETENCY_MODEL.md](COMPETENCY_MODEL.md) (the entities) ·
[COMPETENCY_IMPORT_PLAN.md](COMPETENCY_IMPORT_PLAN.md) (the structure-only import) ·
[KNOWLEDGE_PROFICIENCY_ARCHITECTURE.md](KNOWLEDGE_PROFICIENCY_ARCHITECTURE.md) (the gap rule these
targets feed).

---

## 1. What this is, and what it is not

Competency administration maintains the **reference catalogue**: which competencies an organization
recognizes, how they are grouped, which source labels mean the same thing, which version of the
framework is approved, and what level a role is **expected** to hold.

It holds **no information about any person**. There is no rating, observation, self-assessment,
manager assessment or imported baseline anywhere on this screen or behind it, and nothing here
ranks, scores or evaluates an employee. The privacy boundary (COMPETENCY_PRIVACY_AND_GOVERNANCE.md
§1) is unchanged by this milestone.

## 2. Decisions this milestone records

Taken by the product owner on 2026-10-07, in response to the conflicts listed against the
milestone brief.

| # | Decision | Effect |
| --- | --- | --- |
| A1 | **"Competency Domains" are the category kinds** (`PRODUCT_KNOWLEDGE`, `FUNCTIONAL_DOMAIN`, `TECHNICAL`, `PROCESS`, `AGILE_PRACTICE`, `POWER_SKILL`) | No new entity. The kinds are a closed list declared in code; the screen shows them, with counts, and a category's kind is editable |
| A2 | **`competency.manage` is held by `KNOWZY_ADMINISTRATOR` only** | No other role is granted it. Reading the catalogue needs `taxonomy.read`, as the taxonomy catalogue does |
| A3 | **Approval is separated from editing.** Whoever created or edited a framework version, or created or edited a role target, may not approve it | Enforced in the service **and** by a database CHECK. Two administrator identities exist for exactly this reason (CLAUDE.md, "Roles") |
| A4 | The structure-only import may populate the development database | Done with `scripts/competency-import.ts`, which reads header rows only |

These resolve **CM-6** (who approves a framework version, and through what screen): a holder of
`competency.manage` who did not edit it, through this screen. **CM-1** (whether the matrix is the
organization's official framework) and **CM-9** (where role targets come from) remain open, and the
screen cannot answer them: an approval must name a reference to where the decision is held, and a
target must name its source.

## 3. The catalogue

| Record | Create | Edit | Deactivate | Notes |
| --- | --- | --- | --- | --- |
| **Domain** (category kind) | — | — | — | A closed list (A1). Shown with its category and competency counts |
| **Category** | Yes | Name, kind | Yes, and reactivate | The **code** is permanent from creation: it prefixes every competency code in it and appears in import provenance |
| **Competency** | Yes, in an active category | Name, description | Yes, and reactivate | Code is `CATEGORY.SEGMENT`, permanent from creation. The level scale is fixed at creation, because a target is a level on that scale |
| **Alias** | Yes | Decision, note | Yes, and reactivate | Maps a source label to a category or competency. `UNDECLARED` cannot be chosen: an alias created by a person is, by definition, declared |
| **Level scale and levels** | — | — | — | Read-only here. They come from the import profile, and a level change would silently change the meaning of every target on it |

**Nothing is deleted.** Deactivation sets the definition's status to `RETIRED`; existing aliases,
targets and provenance keep pointing at it. A retired category accepts no new competency, and a
retired competency accepts no new target and cannot have a target approved.

**Near matches are refused.** A new competency whose folded name is within edit distance 2 of an
existing competency in the same category is refused unless the administrator confirms it is
distinct — the importer's rule (COMPETENCY_IMPORT_PLAN.md) applied to a person typing.

**Aliases on this screen are catalogue records.** The importer's normalization is still the
declared table in code (COMPETENCY_MODEL.md §5.3) and does not read aliases created here. That keeps
an import deterministic and reviewable in code; a screen-created alias documents a decision, it does
not change the next import's outcome.

## 4. Framework versions

A **version** is a content-hashed snapshot of the framework's definitions. It has one of two
origins:

| Origin | Created by | `sourceContentSha256` | `definitionsSha256` |
| --- | --- | --- | --- |
| `IMPORT` | `scripts/competency-import.ts --apply` | The source file's hash | The definitions after the apply |
| `ADMINISTRATION` | **Create version** on this screen | Equal to `definitionsSha256` | The definitions at that moment |

`definitionsSha256` is SHA-256 over a canonical, code-sorted serialization of every scale, level,
category, competency and alias of the framework, including status. Two versions with the same
definitions cannot both exist: the second is refused and names the first.

### 4.1 Approval

Approval is a **separate, recorded act**: approver, time and a reference to where the decision is
held (a document, a ticket, a message), the same shape as a provider approval (architecture.md §9.0
rule 7). It is refused when:

| Refusal | Code |
| --- | --- |
| The approver created the version, or edited any definition the snapshot covers | `SEPARATION_OF_DUTIES` |
| The framework's definitions have changed since the snapshot (the current hash differs) | `COMPETENCY_VERSION_STALE` |
| The version is not `DRAFT` | `STATE_TRANSITION_INVALID` |
| No reference is given | `VALIDATION_FAILED` |

**An approval covers one hash, never "the latest".** Editing any definition after a snapshot makes
that snapshot stale; the administrator creates a new version, and a *different* administrator
approves it. Approving a version moves the previously approved version to `SUPERSEDED`.

**Who counts as an editor.** Every definition write is recorded in `competency_definition_change`
(append-only; a trigger refuses UPDATE and DELETE). A version's `editorUserIds` are the creator plus
every user who wrote a change after the previous version was created. An imported version has no
verified creator — the command runs without an identity provider — so its editors are only the
people who changed definitions on screen before it.

## 5. Role targets — Role → Competency Requirements

A target says "role R is expected to hold competency C at level L". It is a statement about a
**role**, never about a person.

| Step | Rule |
| --- | --- |
| **Propose** | Choose an active job role (the existing `JobRole` catalogue, never a second one), an active competency, and a level **on that competency's scale**. A **source** is required — where the requirement comes from — and a rationale is optional. Nothing is suggested, defaulted or bulk-created: the platform does not invent requirements |
| **Edit** | Only while `PROPOSED`. Each editor is recorded |
| **Approve** | A different administrator (A3), with a reference. Refused unless the framework has an `APPROVED` version (`COMPETENCY_FRAMEWORK_NOT_APPROVED`) and the competency is active. The approved version is recorded on the target |
| **Revise** | An approved target is never edited. A revision is a new proposal; approving it retires the one it replaces |
| **Retire** | `PROPOSED` or `APPROVED` → `RETIRED`, recorded with who and when |

At most one `PROPOSED` and one `APPROVED` target exist per role and competency (partial unique
indexes).

**On this release no target can be approved yet**: the only framework version is the imported
`DRAFT`, and approving it is CM-1's decision. That is the honest state, and the screen says so.

## 6. Audit

Every write runs in the same transaction as its audit event and its change-log row.

| Action (`ADMIN.COMPETENCY.*`) | Detail keys |
| --- | --- |
| `CATEGORY_CREATED`, `CATEGORY_UPDATED` | `frameworkCode`, `code`, `name`, `kind`, `status`, `changedFields` |
| `COMPETENCY_CREATED`, `COMPETENCY_UPDATED` | `frameworkCode`, `code`, `name`, `status`, `changedFields` |
| `ALIAS_CREATED`, `ALIAS_UPDATED` | `frameworkCode`, `subject`, `contextCode`, `alias`, `decision`, `status`, `changedFields` |
| `VERSION_CREATED`, `VERSION_APPROVED` | `frameworkCode`, `versionLabel`, `origin`, `definitionsSha256`, `editorCount`, `supersededVersionLabel` |
| `TARGET_PROPOSED`, `TARGET_UPDATED`, `TARGET_APPROVED`, `TARGET_RETIRED` | `jobRoleCode`, `competencyCode`, `targetLevelCode`, `status`, `frameworkVersionLabel`, `changedFields` |

An update carries the previous and new value. No detail key carries a person's name: the only people
an audit row names are the administrators acting, in the actor fields.

## 7. What enforces this

| Rule | Enforced by |
| --- | --- |
| Only `KNOWZY_ADMINISTRATOR` writes | The permission matrix (`competency.manage` granted to no other role) and a contract test |
| An approver is not an editor | The service, and CHECKs on `competency_framework_version` and `role_competency_expectation` |
| An approval has approver, time and reference | The 0015 CHECKs, unchanged |
| An approval covers one hash | The service recomputes `definitionsSha256` before approving |
| The change log cannot be rewritten | A trigger refusing UPDATE and DELETE on `competency_definition_change` |
| No person-level record | No table for one; the import's planted-value test (COMPETENCY_IMPORT_PLAN.md §7) |
