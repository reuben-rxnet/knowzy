# Assumptions and Tenant Configuration

**What this document adds:** the register of assumptions this design rests on, the exact tenant values
still required and who owns each, the decisions the customer must make, and the deliverable
traceability matrix.

---

## 1. Position

> **No SharePoint or Microsoft Graph connection has been tested. No credentials exist in this
> workspace. Every tenant identifier, site ID, drive ID, list ID, GUID, URL, and connection result
> appearing anywhere in this document set is a clearly labelled illustration.**

This is stated plainly because the alternative — a design document that reads as though integration has
been validated — would hand a delivery team false confidence about the riskiest part of the work.
Where an example value appears, it is marked as an example. Where a value is required, §3 names it and
names its owner.

The design is built so this costs nothing in progress: the mock adapter and mock question bank carry
phases 1–6 of [implementation-roadmap.md](implementation-roadmap.md) with **zero tenant values**, and
the [initial end-to-end proof](initial-end-to-end-proof.md) runs in full without them.

---

## 2. Assumption register

Each assumption states what the design does if it proves false. An assumption with no stated
consequence is a hidden dependency.

| ID | Assumption | Confidence | If false |
| --- | --- | --- | --- |
| A-01 | Single-tenant, single-region deployment on Azure | High | Multi-tenancy is not designed for; scope columns exist but a tenant discriminator does not. This would be a significant redesign |
| A-02 | Microsoft Entra ID is the sole identity provider for both portals | High | The `IdentityProvider` port exists; a second provider is an adapter plus a claims-mapping decision |
| A-03 | The tenant will grant `Sites.Selected` **Write** on one governance site and read access on document sites | Medium | Without the write grant, publishing cannot function; the platform runs in dry-run mode indefinitely. Without read grants, only the mock adapter works |
| A-04 | Knowledge documents are predominantly text-bearing PDF, DOCX, PPTX, XLSX, SharePoint Pages, and HTML | Medium | Scanned/image-only PDFs yield `EXTRACTION_EMPTY`. OCR is out of scope; this is risk R-06 and it is likelier than it looks |
| A-05 | Anthropic Claude may be used as a processor for question drafting and refresher summarization | **Unconfirmed** | Generation cannot be enabled in production. The platform still functions for manual authoring, review, approval, publishing, assessment, and scoring — every deterministic capability is unaffected |
| A-06 | A human review and approval step is acceptable to the business, and review capacity will be staffed | High | The platform's primary business goal (G1) assumes review is the constraint; unstaffed review makes generation worthless (R-04) |
| A-07 | Four-option multiple choice is sufficient for release 1 | Medium | The extension path is designed ([data-model.md §7](data-model.md#7-question-type-extensibility)); a new type is additive |
| A-08 | Learners access the platform through a browser on a managed device | High | No native app, no offline mode |
| A-09 | Proficiency data will be used for development, not performance management | **Unconfirmed** | This is risk R-16, and it is a cultural risk the platform can only partly mitigate (aggregate-only manager views, no leaderboards, minimum group size) |
| A-10 | Taxonomy (domains, topics, objectives) will be curated by a named owner | Medium | Uncurated free-text topics degrade coverage, gap reporting, and pool balancing into noise |
| A-11 | The Question Bank list will not be edited by hand | Medium | Manual edits become reconciliation drift requiring operator decisions (R-09). Detected, not prevented |
| A-12 | SharePoint throttling limits are typical for a tenant of this size | Medium | Throttling controls exist; severe limits would slow publishing and reconciliation, not break them |
| A-13 | English-only UI and content for release 1 | High | Localization constraints are honoured from day one; content is never machine-translated |
| A-14 | 500 concurrent learners in an active quiz is a sufficient release-1 target | Medium | Targets are explicitly "to be confirmed with the business" ([architecture.md §12.4](architecture.md#124-non-functional-targets-initial-to-be-confirmed-with-the-business)) |
| A-15 | Audit retention of 7 years satisfies the tenant's obligations | Medium | Configurable upward; a shorter requirement is also configurable, with a floor of 1 year |
| A-16 | Azure Container Apps, PostgreSQL Flexible Server, Key Vault, and Blob Storage are available and approved | Medium | The deployment topology assumes them; containers are portable, but the IaC and managed-identity model would change |
| A-17 | In-app notifications are sufficient for release 1 | Medium | `Notification.channel` exists; email and Teams delivery is deferred work, not a redesign |
| A-18 | No LMS interoperability is required in release 1 | Medium | Explicit non-goal; no SCORM, xAPI, or LTI surface is designed |

---

## 3. Tenant values required

Grouped by when they are needed. **Nothing in this table is known, assumed, or asserted anywhere in
this document set.**

### 3.1 Required for phase 2 (identity)

| # | Value | Owner | Notes |
| --- | --- | --- | --- |
| T-01 | Entra tenant ID | Tenant identity team | Per environment |
| T-02 | App registration: `knowzy-authoring-web` — client ID, redirect URIs | Tenant identity team | Public client value |
| T-03 | App registration: `knowzy-live-web` — client ID, redirect URIs | Tenant identity team | Public client value |
| T-04 | App registration: `knowzy-api` — client ID, application ID URI, exposed scopes `knowzy.authoring` and `knowzy.learning` | Tenant identity team | |
| T-05 | Admin consent for the exposed scopes | Tenant identity team | Required before either portal can call the API |
| T-06 | Entra group → Knowzy role mapping | Business + identity team | Optional; drives provisioning only, never authorization ([ADR-011](risks-and-decisions.md#adr-011-roles-resolved-from-the-knowzy-database-not-from-token-claims)) |
| T-07 | Bootstrap administrator object IDs | Business | Consumed once per environment |
| T-08 | Which user attributes may be provisioned (job title, department, business function) | Privacy owner | `businessFunction` participates in source restrictions |

### 3.2 Required for phase 7 (SharePoint read)

| # | Value | Owner | Notes |
| --- | --- | --- | --- |
| T-09 | SharePoint tenant hostname | Tenant M365 team | e.g. `{tenant}.sharepoint.com` |
| T-10 | Knowledge document site URL(s) — one per source | Knowledge owner | Site **ID** is resolved by Test Connection, never hand-entered |
| T-11 | Document library name(s) per site | Knowledge owner | Drive ID resolved by Test Connection |
| T-12 | Folder path(s) per library | Knowledge owner | Server-relative, normalized |
| T-13 | SharePoint columns to capture as `includedMetadata` | Knowledge owner | Drives domain/topic mapping rules |
| T-14 | Permission mode per source: `DELEGATED_OBO` or `APP_ONLY_SITES_SELECTED` | Security + M365 team | `DELEGATED_OBO` recommended for interactive paths (R-03) |
| T-15 | Graph app registration credential (certificate preferred) | Tenant M365 team | Stored in Key Vault; only a reference is configured |
| T-16 | `Sites.Selected` **Read** grant per document site | Tenant M365 team | Per site, per environment |
| T-17 | Source owner per source (accountable person) | Business | Receives health notifications |
| T-18 | Domain and topic taxonomy, with immutable domain codes | Business + taxonomy owner | Domain code appears in every QuestionID |
| T-19 | Learning objective catalogue | Business + SMEs | Objective-driven generation is the preferred method |
| T-20 | Sync schedule per source | Knowledge owner | |

### 3.3 Required for phase 8 (Question Bank write)

| # | Value | Owner | Notes |
| --- | --- | --- | --- |
| T-21 | Governance site URL for the Question Bank | Business + M365 team | Must be a **different site** from document sites |
| T-22 | `Sites.Selected` **Write** grant on that site only | Tenant M365 team | Per environment |
| T-23 | Whether the platform may create the list, or an existing list must be adopted | M365 team | Determines which provisioning path applies ([sharepoint-question-bank.md §9](sharepoint-question-bank.md#9-provisioning-the-list)) |
| T-24 | If adopting: the list title and its actual internal column names | M365 team | Generates the field-mapping profile; legacy `field_n` names are fully supported |
| T-25 | Whether humans will hold write access to the list | Business | If yes, accept drift as an operational reality (A-11, R-09) |
| T-26 | Whether list versioning and unique `QuestionID` enforcement can be enabled | M365 team | Both are warnings if absent, not blockers |
| T-27 | QuestionID sequence format confirmation | Business | Default `KNZ-{DOMAIN_CODE}-{YYYY}-{SEQ}` |

### 3.4 Required for phase 4 (Claude) and phase 11 (release)

| # | Value | Owner | Notes |
| --- | --- | --- | --- |
| T-28 | Anthropic API key, per environment | Platform team | Key Vault only |
| T-29 | **Approval to send question drafts and delimited source excerpts to Anthropic** | Privacy + legal | A-05. Blocking for production generation |
| T-30 | Model selection and per-environment token/cost budgets | Platform + finance | Model IDs are configuration, never hardcoded |
| T-31 | Azure subscription, resource group, region | Platform team | |
| T-32 | Key Vault, PostgreSQL, Blob, Front Door provisioning | Platform team | Per environment |
| T-33 | Certificate branding: issuer name, logo, and whether the learner's name appears | Business | Two disclosure flags ([badges-and-certificates.md §6](badges-and-certificates.md#6-verification) W1) |
| T-34 | Public verification URL base, and whether public verification is enabled at all | Business + security | |
| T-35 | Minimum group size for aggregate reporting | Privacy owner | Default 5, configurable upward only |
| T-36 | Retention periods: audit, session, result, draft, export | Privacy + compliance | Defaults in [data-model.md §14](data-model.md#14-retention-and-deletion) |
| T-37 | Tenant reporting time zone | Business | Used for date-only report boundaries |
| T-38 | Non-functional targets confirmation | Business | Currently provisional (A-14) |

---

## 4. Decisions the customer must make

Distinct from values: these are choices the design supports either way, where picking for the customer
would be presumptuous.

| # | Decision | Default | Consequence of the default |
| --- | --- | --- | --- |
| D-01 | May an author approve their own question? | **No** | Requires a distinct approver per question; slower, and the reason goal G2 holds |
| D-02 | May an approver publish their own approval? | **Yes** | Set false to force a distinct Publisher, which needs a staffed Publisher role |
| D-03 | Is SME sign-off required, per domain? | No | Enabling it adds a blocking gate (`SME_SIGNOFF_REQUIRED`) and needs staffed SMEs |
| D-04 | Is break-glass override enabled? | **No** | Enabling it allows a Platform Administrator to waive separation of duties, audited and reported as a standing exception |
| D-05 | Are two-person administrator grants required? | No | Recommended on in production |
| D-06 | Are answers shown to learners after completion? | Yes | Set false for small pools with multiple attempts, to protect pool integrity |
| D-07 | Is backward navigation allowed within an attempt? | Yes | |
| D-08 | Attempt limits and retake cooling-off, per assessment | Unlimited, no wait | Unlimited attempts on a small pool erodes the pool (R-16 adjacent) |
| D-09 | Proficiency band thresholds | 90 / 75 / 60 / 40 | Must be contiguous and cover 0–100; copied onto every result |
| D-10 | Gap threshold and minimum topic questions | 60.00 / 2 | The minimum prevents a single unlucky question being reported as a gap |
| D-11 | Duplicate flag and block thresholds | 0.75 / 0.92 | Lower blocks more aggressively and rejects more legitimate questions |
| D-12 | Is public certificate verification enabled? | Yes | Disabling it removes the platform's verifiability claim |
| D-13 | Does the learner's name appear on certificates and in verification? | Name on certificate: tenant choice; in verification: **off** | |
| D-14 | Who is notified on revalidation, approval requests, and publish failures? | Author, source owner, domain reviewers | |
| D-15 | May managers see individual learner results? | **No** — aggregates only | Changing this is a privacy decision requiring a documented basis (R-16) |
| D-16 | Is erasure handled as pseudonymization? | **Yes** | True deletion would destroy approval accountability and certificate verification ([security.md §13](security.md#13-privacy-and-data-subject-requests)) |

---

## 5. Deliverable traceability matrix

The 30 requested deliverables and where each is specified.

| # | Deliverable | Primary document | Supporting |
| --- | --- | --- | --- |
| 1 | Executive summary | [executive-summary.md §1](executive-summary.md#1-executive-summary) | [README.md](README.md) |
| 2 | Business goals | [executive-summary.md §2](executive-summary.md#2-business-goals) | [risks-and-decisions.md](risks-and-decisions.md) |
| 3 | Functional scope and non-goals | [executive-summary.md §3](executive-summary.md#3-functional-scope) | [authoring-portal.md](authoring-portal.md) · [live-learning-portal.md](live-learning-portal.md) |
| 4 | High-level solution architecture | [architecture.md §1–4](architecture.md#1-architectural-principles) | [repository-structure.md](repository-structure.md) |
| 5 | Authoring Portal architecture | [architecture.md §5](architecture.md#5-authoring-and-administration-portal-architecture) | [authoring-portal.md](authoring-portal.md) |
| 6 | Live Learning Portal architecture | [architecture.md §6](architecture.md#6-live-learning-portal-architecture) | [live-learning-portal.md](live-learning-portal.md) |
| 7 | Shared backend architecture | [architecture.md §7](architecture.md#7-shared-backend-architecture) | [mcp-tools.md](mcp-tools.md) · [error-handling.md](error-handling.md) |
| 8 | SharePoint knowledge-source architecture | [architecture.md §8](architecture.md#8-sharepoint-knowledge-source-architecture) | [knowledge-source-adapters.md §3](knowledge-source-adapters.md#3-sharepoint-adapter) |
| 9 | Knowledge source administration design | [knowledge-source-administration.md](knowledge-source-administration.md) | [access-control.md](access-control.md) |
| 10 | Knowledge source adapter framework | [knowledge-source-adapters.md](knowledge-source-adapters.md) | [architecture.md §3.1](architecture.md#31-layer-rules) |
| 11 | MCP tool design | [mcp-tools.md](mcp-tools.md) | [security.md §6](security.md#6-prompt-injection-controls) |
| 12 | Question generation workflow | [workflows.md §2](workflows.md#2-question-generation-workflow) | [generation-governance.md](generation-governance.md) — **normative** |
| 13 | Question review and approval workflow | [workflows.md §3](workflows.md#3-question-review-and-approval-workflow) | [authoring-portal.md §5](authoring-portal.md#5-question-review-workspace) |
| 14 | Question publishing workflow | [workflows.md §4](workflows.md#4-question-publishing-workflow) | [sharepoint-question-bank.md §5](sharepoint-question-bank.md#5-idempotent-publishing) |
| 15 | Assessment publishing workflow | [workflows.md §5](workflows.md#5-assessment-publishing-workflow) | [authoring-portal.md §7](authoring-portal.md#7-assessment-builder) |
| 16 | Live quiz execution workflow | [workflows.md §6](workflows.md#6-live-quiz-execution-workflow) | [live-learning-portal.md §4](live-learning-portal.md#4-quiz-execution) |
| 17 | Knowledge refresher workflow | [workflows.md §7](workflows.md#7-knowledge-refresher-workflow) | [live-learning-portal.md §7](live-learning-portal.md#7-knowledge-refreshers-learner-view) |
| 18 | Data model | [data-model.md](data-model.md) | [generation-governance.md §3](generation-governance.md#3-document-generation-tracking) |
| 19 | SharePoint Question Bank design | [sharepoint-question-bank.md](sharepoint-question-bank.md) | [ADR-002](risks-and-decisions.md#adr-002-option-a--sharepoint-list-as-the-question-bank-of-record) |
| 20 | Field mapping design | [sharepoint-field-mapping.md](sharepoint-field-mapping.md) | [sharepoint-question-bank.md §3](sharepoint-question-bank.md#3-column-design) |
| 21 | Access control and RBAC | [access-control.md](access-control.md) | [security.md §3](security.md#3-authorization) |
| 22 | Security design | [security.md](security.md) | [access-control.md](access-control.md) · [audit-model.md](audit-model.md) |
| 23 | Audit model | [audit-model.md](audit-model.md) | [authoring-portal.md §10](authoring-portal.md#10-audit-explorer) |
| 24 | Reporting design | [reporting.md](reporting.md) | [authoring-portal.md §9](authoring-portal.md#9-reports-and-dashboards-portal-view) |
| 25 | Badges and certificates | [badges-and-certificates.md](badges-and-certificates.md) | [live-learning-portal.md §8](live-learning-portal.md#8-badges-and-certificates-learner-view) |
| 26 | Error handling and resilience | [error-handling.md](error-handling.md) | [mcp-tools.md §4](mcp-tools.md#4-error-contract) |
| 27 | UX design and accessibility | [ux-design.md](ux-design.md) | [authoring-portal.md](authoring-portal.md) · [live-learning-portal.md](live-learning-portal.md) |
| 28 | Repository structure | [repository-structure.md](repository-structure.md) | [architecture.md §3.1](architecture.md#31-layer-rules) |
| 29 | Environment and configuration | [environment-and-configuration.md](environment-and-configuration.md) | [security.md §11](security.md#11-secrets-and-key-management) |
| 30 | Implementation roadmap | [implementation-roadmap.md](implementation-roadmap.md) | [initial-end-to-end-proof.md](initial-end-to-end-proof.md) |

### 5.1 Documents beyond the 30

| Document | Why it exists |
| --- | --- |
| [generation-governance.md](generation-governance.md) | The governance layer over deliverable 12 — intentional selection, duplicate prevention, coverage, delta generation, objective-driven generation, reuse. **Normative over `workflows.md`** where they differ |
| [initial-end-to-end-proof.md](initial-end-to-end-proof.md) | The smallest slice that proves the architecture, with an acceptance script |
| [assumptions-and-tenant-configuration.md](assumptions-and-tenant-configuration.md) | This document |
| [risks-and-decisions.md](risks-and-decisions.md) | ADRs, risk register, dependency register |
| [glossary.md](glossary.md) | Shared vocabulary, so one term means one thing across 26 documents |

---

## 6. Open items

Ordered by what blocks the most work.

| # | Open item | Blocks | Owner | Needed by |
| --- | --- | --- | --- | --- |
| O-01 | Anthropic processor approval (T-29 / A-05) | Production generation | Privacy + legal | Before phase 4 exits to production |
| O-02 | `Sites.Selected` grants, read and write (T-16, T-22) | Phases 7 and 8 entirely | Tenant M365 team | Start of phase 7 |
| O-03 | Entra app registrations and admin consent (T-01…T-05) | Phase 2 | Tenant identity team | Start of phase 2 |
| O-04 | Domain and topic taxonomy with immutable codes (T-18) | Generation, coverage, pool balancing | Business + taxonomy owner | Start of phase 4 |
| O-05 | Question Bank site and provisioning path (T-21, T-23, T-24) | Phase 8 | Business + M365 team | Start of phase 8 |
| O-06 | Document site, library, and folder inventory (T-10…T-12) | Phase 7 | Knowledge owner | Start of phase 7 |
| O-07 | Permission mode decision per source (T-14) | R-03 mitigation | Security + M365 team | Start of phase 7 |
| O-08 | Learning objective catalogue (T-19) | Objective-driven generation | Business + SMEs | Phase 4, or accept section-scoped generation initially |
| O-09 | Proficiency thresholds, gap threshold, minimum group size (D-09, D-10, T-35) | Phase 6 scoring and phase 10 reporting | Business + privacy owner | Start of phase 6 |
| O-10 | Separation-of-duties policy set (D-01…D-05) | Phase 5 | Business | Start of phase 5 |
| O-11 | Retention periods (T-36) | Phase 11 | Privacy + compliance | Before production |
| O-12 | Certificate branding and disclosure flags (T-33, D-13) | Phase 9 | Business | Start of phase 9 |
| O-13 | Non-functional target confirmation (T-38 / A-14) | Phase 11 exit | Business | Phase 11 |
| O-14 | Position on proficiency data use in performance management (A-09 / D-15) | Adoption, and R-16 | Business + HR | Before learner rollout |
| O-15 | Azure subscription and provisioning (T-31, T-32) | Any deployed environment | Platform team | Start of phase 2 |

None of O-01 through O-15 blocks phases 1–6, which is the deliberate consequence of the mock-first
design. O-03 and O-15 are the earliest real dependencies; O-14 is the one most likely to be
overlooked and most damaging if left unanswered until rollout.
