# Glossary

One term, one meaning, across all 26 documents. Where two terms are commonly confused, the entry says
what the difference is and why it matters.

Entries marked **normative** define behaviour; using the term loosely in code, UI copy, or
conversation causes real defects.

---

## A

**Adapter** — An implementation of `KnowledgeSourceAdapter` or `QuestionBankAdapter`. The only place
external vocabulary (Graph types, SharePoint internal field names) may appear.
[knowledge-source-adapters.md](knowledge-source-adapters.md)

**Answer key** *(normative)* — The correct answer for a question, plus its explanation, evidence, and
source location. Exists authoritatively in the Question Bank and in the per-session snapshot, nowhere
else. Never reaches a browser during an active session.
[security.md §8](security.md#8-answer-key-protection)

**Approval** — The audited transition `SUBMITTED_FOR_APPROVAL → APPROVED` by a user holding
`question.approve`, subject to all 13 gates and separation of duties. Not the same as **review**.

**Assessment** — A reusable definition (name, domain, selection strategy, rules, availability,
recognition). Versioned; only a `PUBLISHED` version is discoverable.

**Assessment version** — One immutable-once-published revision of an assessment. A result references
its version forever, so a historical result stays interpretable.

**Assessable section** — A `DocumentSection` with enough content to carry a question and not marked
`NON_ASSESSABLE`. Coverage denominators count only these.
[generation-governance.md §6.2](generation-governance.md#62-non-assessable-sections)

**Attempt** — One `QuizSession` and its result. Numbered per learner per assessment.

**Audit event** *(normative)* — An append-only record of an action's intent and outcome, written in the
same transaction as the state change it describes. Not telemetry.
[audit-model.md](audit-model.md)

**Authorization envelope** — The signed structure the API passes to every MCP tool call, carrying
subject, resolved roles, permissions, data scope, and correlation ID. Re-verified and re-resolved by
the MCP server. [mcp-tools.md §3](mcp-tools.md#3-authorization-envelope)

## B

**Badge** — A deterministic recognition award from a declarative rule. Append-only; revoked, never
deleted. [badges-and-certificates.md](badges-and-certificates.md)

**Break-glass** — An audited override of a separation-of-duties refusal by a Platform Administrator
with a written justification. Waives a **policy** check; never waives a **validation gate** and never
grants a permission. Disabled by default.

## C

**Candidate** — (1) A model-produced question before it passes the gates — a candidate is not a
question and is never persisted as one; (2) a retrieved document offered to a refresher, addressed by
an opaque, call-scoped `candidateId`.

**Certificate** — A verifiable PDF issued from a passing result, with a serial number and a
high-entropy verification code. Never deleted; expired or revoked states are shown, not hidden.

**Container** — The adapter-neutral term for a document grouping: a SharePoint document library, a
Confluence space, a blob container, a share. The contract never says "drive" or "library".

**Content hash** *(normative)* — SHA-256 of a document's **normalized extracted text**. The authority
for "did content change"; `eTag` alone is only a candidate signal.
[generation-governance.md §5](generation-governance.md#5-document-change-detection)

**Correlation ID** *(normative)* — One opaque identifier per user action, minted by the API and
propagated through MCP, Graph, Claude, jobs, notifications, and audit. Never accepted from a client.
[audit-model.md §4](audit-model.md#4-correlation-model)

**Coverage** *(normative)* — The proportion of a document's assessable target question capacity met by
**approved** questions. Drafts in review do not count. `N/A` when there are no assessable sections —
never 0 % or 100 %. [generation-governance.md §6.4](generation-governance.md#64-coverage-percentage)

## D

**Data scope** *(normative)* — The set of domains, teams, and sources a subject may act on, resolved
per request and passed to repositories as a query predicate. An **empty** set on a dimension means
*unrestricted* on that dimension, not *nothing*.
[access-control.md §5](access-control.md#5-scope-resolution)

**Delta generation** — Creating **new** drafts from changed or uncovered sections only. Distinct from
**revalidation**, which reviews existing questions. A content change produces both decisions, and
neither is automatic.

**Document** — An indexed source artifact (`KnowledgeDocument`): metadata, extracted text, sections,
and hashes. Never a stored copy of the file's bytes.

**Domain** — A top-level taxonomy unit with an **immutable code** used in every QuestionID.

**Draft question** — The working record for a question in any pre-bank state, and the local anchor for
a published one (`DraftQuestion`). The name is historical; it holds published questions' local state
too.

**Drift** — A detected difference between the local projection and the Question Bank item. Surfaced
for an operator decision; never auto-healed.
[sharepoint-question-bank.md §8](sharepoint-question-bank.md#8-reconciliation)

## E

**Eligibility snapshot** *(normative)* — The `(questionId, publishedVersion)` set and resolved
configuration pinned when an assessment version publishes. Session selection intersects the live pool
with it, so a release never acquires questions the approver never saw.

**Evidence span** *(normative)* — A verbatim passage from the source, verified against the extracted
section text, with stored character offsets so it re-locates later. A question without one cannot be
approved. [workflows.md §2.5](workflows.md#25-evidence-verification-normative)

**Extraction** — Converting a document into normalized text plus ordered, non-overlapping sections
with character offsets. Deterministic; unsupported documents return **no text**, never empty text with
a success status.

## F

**Feature flag** — A database-backed capability switch with an **environment ceiling**. Gates
capability, never authorization.
[environment-and-configuration.md §6](environment-and-configuration.md#6-feature-flags)

**Field mapping profile** — The per-environment translation from Knowzy semantic keys to a list's
actual internal column names, including legacy `field_n` names.
[sharepoint-field-mapping.md](sharepoint-field-mapping.md)

## G

**Gate** *(normative)* — One of the 13 server-side checks evaluated at a question transition. Gates
are evaluated **before** separation of duties, and the results are stored on the approval row.
[authoring-portal.md §5.7](authoring-portal.md#57-approval-blocking-gates)

**Generation job** — One reproducible generation run: pinned documents, pinned section keys, scope,
objectives, model, prompt version, reason code, and preflight decision.

**Generation scope** — Which sections a job may use: `ENTIRE_DOCUMENT`, `MODIFIED_SECTIONS_ONLY`,
`UNCOVERED_SECTIONS_ONLY`, `OBJECTIVES`, or `SELECTED_SECTIONS`.

**Grounding** — The property that a question's content is traceable to verified source text. Enforced
mechanically, not requested in a prompt.

## I

**Idempotency key** — A client-supplied header making a retried HTTP request safe, with a 24-hour
expiry. Distinct from an **operation key**, which is permanent. Both exist because neither alone
suffices. [error-handling.md §6.2](error-handling.md#62-why-two-layers)

**Insufficient evidence** *(normative)* — A model result meaning a section carries nothing reliably
testable. A **success**, not an error. The platform never pads a requested count.

## K

**Knowledge refresher** — A grounded, permission-aware summary produced for a weak topic, citing only
documents the platform itself retrieved. When nothing is found, the approved explanation is shown with
an explicit statement and **no invented source**.

**Knowledge source** — An administrator-configured, adapter-backed repository of documents. Data, never
code.

## L

**Learning objective** — A managed statement of competence with a cognitive level, mapped to sections
per document version. Objective-driven generation is the preferred method.

**Lineage** *(normative)* — The immutable record of where a question came from: source, site, library,
folder, document, version, section, offsets, excerpt, hashes, job, model, prompt version. Written once;
edits create versions that carry the same lineage.

## M

**MCP server** — The Model Context Protocol server: the only component holding Graph credentials, never
internet-reachable, and the only path to a knowledge source or the Question Bank.

**Mock adapter** — The fixture-backed adapter that makes the entire pipeline exercisable with **zero
tenant credentials**. A design requirement, not a convenience. Never registered outside `local`.

## N

**`NOT_ASSESSED`** *(normative)* — A learner with no scored result in the window. A **distinct value**,
never reported as `CRITICAL_KNOWLEDGE_GAP`. Conflating "we do not know" with "they scored badly" is the
single most damaging reporting error this design prevents.
[reporting.md §5.1](reporting.md#51-learner-proficiency-in-a-domain)

**Normalization** — The deterministic text transformation (NFKC, collapsed whitespace, unified
quotes/dashes/ligatures, de-hyphenated line breaks) applied before hashing, evidence verification, and
similarity scoring. One pipeline; divergence would break all three.

## O

**Operation key** *(normative)* — `sha256(targetListId + questionId + publishedVersion +
operationType)`, uniquely indexed. The permanent guarantee that a retried publish cannot create a
second bank item.

## P

**Permission** — A capability key (`question.approve`). Distinct from a **role** (a named bundle) and
from **data scope** (which rows).

**Permission mode** — Per source: `DELEGATED_OBO` (SharePoint enforces trimming) or
`APP_ONLY_SITES_SELECTED` (Knowzy enforces trimming, and says so).

**Policy** — A named server-side check `(subject, action, resource?) → allow | deny + dataScope`.
Every route and every tool declares exactly one.

**Preflight** *(normative)* — The six mandatory pre-generation checks and the recorded author decision.
A job without a valid, unexpired preflight is refused. There is no "proceed anyway" default.

**Proficiency band** — `EXPERT`, `PROFICIENT`, `DEVELOPING`, `NEEDS_IMPROVEMENT`,
`CRITICAL_KNOWLEDGE_GAP`, computed from the **stored, rounded** percentage using the threshold set
copied onto that result.

**Projection** — `PublishedQuestionReference`: the PostgreSQL row mirroring a bank item's identifiers,
status, version, taxonomy, lineage, and **content hashes** — never the answer key.

**Published version** — The question version written to the bank. Distinct from the draft `version`
(most never publish) and from the SharePoint **item version** (`1.0`, `2.0`, …).
[sharepoint-question-bank.md §7](sharepoint-question-bank.md#7-versioning)

**Purpose flag** — `usableForGeneration`, `usableForRefreshers`, `usableForExplanations`. Independent,
enforced in the MCP layer rather than the UI.

## Q

**Question Bank** — The SharePoint List **Knowzy Question Bank**: the authority for approved and
published question content (ADR-002).

**QuestionID** — `KNZ-{DOMAIN_CODE}-{YYYY}-{SEQ}`. *Proposed* at generation, *confirmed* at
publication. An identifier, not an access key; gaps are normal and never backfilled.

**Quiz session** — One attempt, with an immutable server-side question snapshot. The snapshot is
authoritative for the whole attempt (ADR-012).

## R

**Read model** — A table or materialized view in the `reporting` schema, carrying `asOf`, with scope
and suppression applied **inside** it. Reporting never joins transactional tables.

**Reconciliation** — Scheduled or on-demand comparison of the projection against the bank, producing
differences for operator decisions.

**Retirement** *(normative)* — Setting a bank item `IsActive = false` and `Status = Retired` with a
mandatory comment. **The item is never deleted.** Retired questions leave new selection and stay intact
in historical snapshots and results.

**Revalidation** *(normative)* — Flagging existing questions for **human** review after a source
content change. No approved question is ever automatically modified, retired, unpublished, or
deactivated (ADR-013). Distinct from **delta generation**.

**Review** — An advisory or blocking record of a quality or accuracy assessment (`QuestionReview`).
Distinct from **approval**, which is the authorizing transition. SME endorsement is version-bound: an
edit invalidates it.

**Role** — A named bundle of permissions, seeded and read-only in release 1. Authoritative in the
Knowzy database, not in token claims (ADR-011).

## S

**Section** — The coverage unit: a stable `sectionKey`, heading path, offsets, and content hash.
Documents without headings fall back to labelled windows — a heading is never invented.

**Section lineage** — How sections are matched across document versions (key, hash, similarity, new,
removed), so coverage history is continuous.

**Semantic key** — Knowzy's stable internal field name (`questionText`, `correctAnswer`). Translated to
an external column name only inside an adapter.

**Separation of duties** — Policies preventing the same person from authoring and approving, or
approving and publishing, where configured. Evaluated **after** validation gates.

**Similarity cluster** — The transitive closure of question pairs above the flag threshold. Selection
takes at most one member per cluster.

**Snapshot** — An immutable copy taken so a later change cannot rewrite history: a session's questions
and keys, a result's threshold set, an eligibility snapshot, a question version, a preflight result, a
badge's criteria.

**Source** — Shorthand for **knowledge source**. Never used to mean a source *document*.

**Suppression** *(normative)* — Withholding an aggregate below the minimum group size, rendered as an
explicit `SUPPRESSED` marker — never a blank or a zero. Complementary suppression prevents derivation
from a visible total. No override exists.

## T

**Test Connection** *(normative)* — The nine-check read-only diagnostic. `connectionStatus` changes
**only** as the result of an executed probe, is always displayed with its timestamp, and is never
inferred or defaulted to healthy.

**Topic** — A taxonomy unit within a domain. Renameable; merged via `mergedIntoTopicId`; never deleted
while referenced.

**Turnaround** — Elapsed time between lifecycle transitions (draft→submitted, submitted→decided,
approved→published). The leading indicator for risk R-04.

## U

**Untrusted content** *(normative)* — Retrieved document text and model output. Data, never
instructions. Delimited with a per-call nonce, schema-validated, evidence-verified, and rendered as
plain text. [security.md §5](security.md#5-untrusted-content-boundary)

## V

**Verification code** — The high-entropy, hash-stored code on a certificate, checkable through the
rate-limited public endpoint.

## W

**Weak topic** *(normative)* — A topic whose accuracy is below the gap threshold **and** which had at
least the minimum number of questions in the snapshot. Below that minimum it is
`INSUFFICIENT_EVIDENCE`, not a gap. Identified by deterministic backend code; Claude has no part in it.

---

## Terms this design deliberately avoids

| Avoided | Use instead | Why |
| --- | --- | --- |
| "AI-generated quiz" | "AI-drafted, human-approved question" | The approval is the product claim, not the generation |
| "Confidence score" as a quality measure | "Composite confidence indicator" | It is platform-computed, advisory, and authorizes nothing |
| "Item" | "Question" | `Item` means a SharePoint list item in this design; overloading it is how field-mapping bugs start |
| "Sync" for content copying | "Synchronize metadata and extracted text" | Documents are never copied; only metadata, text, and hashes are indexed |
| "Best score" for proficiency | "Latest scored result" | Proficiency is a claim about current knowledge (R-15) |
| "Average proficiency" | "Band distribution" or "mean latest score" | Averaging ordinal bands produces a meaningless number |
| "Healthy" as a default status | "Not yet tested" | Status is only ever observed, never assumed |
| "Verified" for an untested connection | "Configured" | Configuration is not verification |
| "Duplicate detection" as a guarantee | "Lexical duplicate detection" | It will miss paraphrases, and the reviewer is the backstop (ADR-008) |
| "Deleted" for a retired question or a revoked award | "Retired", "revoked" | Nothing with lineage is ever deleted |
