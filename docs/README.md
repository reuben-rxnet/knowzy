# Knowzy — Design Foundation

**Status:** Design baseline (no application code)
**Version:** 1.0
**Date:** 2026-09-17
**Storage decision:** Option A — approved and published questions live in a SharePoint List named **Knowzy Question Bank**; PostgreSQL holds application, workflow, session, security, and reporting data.

This directory is the authoritative design baseline for Knowzy. It contains architecture, workflows,
data models, MCP designs, SharePoint designs, security and audit models, repository structure, UX
direction, and a phased implementation roadmap.

No application code, scaffolding, or placeholder source files are produced at this stage.

---

## How to read this set

| Read this if you are… | Start here |
| --- | --- |
| Executive / sponsor | [executive-summary.md](executive-summary.md), [implementation-roadmap.md](implementation-roadmap.md) |
| Solution / enterprise architect | [architecture.md](architecture.md), [risks-and-decisions.md](risks-and-decisions.md) |
| M365 / SharePoint integration architect | [knowledge-source-administration.md](knowledge-source-administration.md), [sharepoint-question-bank.md](sharepoint-question-bank.md), [sharepoint-field-mapping.md](sharepoint-field-mapping.md) |
| Full-stack engineer | [repository-structure.md](repository-structure.md), [data-model.md](data-model.md), [workflows.md](workflows.md), [error-handling.md](error-handling.md) |
| MCP / AI engineer | [mcp-tools.md](mcp-tools.md), [knowledge-source-adapters.md](knowledge-source-adapters.md), [workflows.md](workflows.md) |
| Security architect | [security.md](security.md), [access-control.md](access-control.md), [audit-model.md](audit-model.md) |
| Data / reporting architect | [data-model.md](data-model.md), [reporting.md](reporting.md) |
| UX designer | [ux-design.md](ux-design.md), [authoring-portal.md](authoring-portal.md), [live-learning-portal.md](live-learning-portal.md) |
| Platform / release engineer | [environment-and-configuration.md](environment-and-configuration.md), [architecture.md](architecture.md#12-deployment-architecture) |
| Delivery lead planning sprint 1 | [initial-end-to-end-proof.md](initial-end-to-end-proof.md) |
| Using or demonstrating the running software | [USER-GUIDE.md](USER-GUIDE.md) |

---

## Document index

### Foundation
| Document | Covers |
| --- | --- |
| [executive-summary.md](executive-summary.md) | Executive summary, business goals, functional scope, non-goals |
| [architecture.md](architecture.md) | High-level solution architecture, portal architectures, shared backend, SharePoint knowledge-source architecture, deployment architecture |
| [ux-design.md](ux-design.md) | Information architecture, design-system foundations, interaction and accessibility standards, content and localization |
| [authoring-portal.md](authoring-portal.md) | Authoring and Administration Portal: modules, routes, dashboard, generation, review workspace, publishing, assessment builder, settings |
| [live-learning-portal.md](live-learning-portal.md) | Live Learning Portal: discovery, quiz execution, scoring, results, refreshers, recognition, privacy |

### Knowledge sources and SharePoint
| Document | Covers |
| --- | --- |
| [knowledge-source-administration.md](knowledge-source-administration.md) | Source registry, configuration fields, Test Connection, synchronization, document browser |
| [knowledge-source-adapters.md](knowledge-source-adapters.md) | `KnowledgeSourceAdapter` contract, SharePoint adapter, mock adapter, extension templates |
| [sharepoint-question-bank.md](sharepoint-question-bank.md) | Question Bank list design, column design, governance rules, idempotent publishing, reconciliation |
| [sharepoint-field-mapping.md](sharepoint-field-mapping.md) | Configurable internal-to-SharePoint field mapping, legacy `field_n` compatibility |

### Workflows and AI
| Document | Covers |
| --- | --- |
| [workflows.md](workflows.md) | Generation, review, approval, publishing, assessment publishing, live quiz, knowledge refresher |
| [generation-governance.md](generation-governance.md) | **Normative over `workflows.md`:** intentional selection, generation tracking, duplicate prevention, change detection, delta generation, coverage, objective-driven generation, traceability, reuse, generation history |
| [mcp-tools.md](mcp-tools.md) | All 36 MCP tool definitions, schemas, authorization envelope, error contract |
| [badges-and-certificates.md](badges-and-certificates.md) | Badge rules, certificate generation, verification, revocation |

### Data, security, operations
| Document | Covers |
| --- | --- |
| [data-model.md](data-model.md) | PostgreSQL / Prisma entity model, enumerations, indexing, retention |
| [access-control.md](access-control.md) | Roles, permissions, data scoping, separation of duties, user administration |
| [security.md](security.md) | Identity, authorization, secrets, prompt-injection and answer-key protection, hardening |
| [audit-model.md](audit-model.md) | Audit event taxonomy, record shape, retention, audit reporting |
| [reporting.md](reporting.md) | Reporting architecture, report catalogue, report lifecycle, export, privacy thresholds |
| [error-handling.md](error-handling.md) | Error taxonomy, problem+json contract, retries, throttling, job failure handling |

### Delivery
| Document | Covers |
| --- | --- |
| [repository-structure.md](repository-structure.md) | Monorepo layout, package boundaries, dependency rules |
| [environment-and-configuration.md](environment-and-configuration.md) | Environments, configuration precedence, secret storage, feature flags |
| [implementation-roadmap.md](implementation-roadmap.md) | Phases 1–11, exit criteria, sequencing |
| [initial-end-to-end-proof.md](initial-end-to-end-proof.md) | Smallest end-to-end slice and the recommended first milestone |
| [USER-GUIDE.md](USER-GUIDE.md) | **Describes the software, not the design.** How to drive both portals: identities, the authoring workflow screen by screen, taking an assessment, what each refusal means, and what is not real yet |
| [MVP-READINESS.md](MVP-READINESS.md) | **Status report, not a specification.** What of the MVP is built, how it was verified, what is not done, and the recorded deviations |
| [assumptions-and-tenant-configuration.md](assumptions-and-tenant-configuration.md) | Documented assumptions and the tenant-specific values still required |
| [risks-and-decisions.md](risks-and-decisions.md) | Risks, assumptions, dependencies, architecture decision records |
| [glossary.md](glossary.md) | Shared vocabulary |

---

## Conventions used in these documents

- **Example values are labelled.** Any tenant identifier, site ID, list ID, GUID, URL, or connection
  result that appears in this set is a clearly marked illustration. No real tenant value is asserted
  and no SharePoint or Microsoft Graph connection has been tested — no credentials exist in this
  workspace. See [assumptions-and-tenant-configuration.md](assumptions-and-tenant-configuration.md).
- **MUST / SHOULD / MAY** follow RFC 2119 meaning.
- **Mermaid diagrams** are embedded inline and render in GitHub, Azure DevOps, and VS Code.
- **Deliverable traceability.** The 30 requested deliverables map to documents in
  [assumptions-and-tenant-configuration.md](assumptions-and-tenant-configuration.md#5-deliverable-traceability-matrix).

## Ten design invariants

These hold across every document. A change to any one of them is an architecture change.

1. **Human approval is mandatory.** No AI-generated question reaches a learner without an
   authorized human approval transition.
2. **Claude never decides.** Claude drafts and summarizes. Scoring, approval, publishing, badge and
   certificate eligibility are deterministic backend decisions.
3. **Everything is grounded.** A question without verifiable source evidence cannot be approved.
4. **Two applications, one backend.** The Authoring Portal and Live Learning Portal are separately
   deployable applications with separate routes, navigation, authorization policies, configuration,
   audit categories, and telemetry identifiers.
5. **Sources are data, not code.** No site URL, site ID, library ID, or folder path is hardcoded.
6. **Answer keys never leave the server during an active quiz.**
7. **Retrieved documents are untrusted input.** Instructions inside a document never carry authority.
8. **Authorization is server-side.** Roles, scopes, user IDs, and team IDs from the browser are
   advisory display data only.
9. **Writes to SharePoint are server-side, role-gated, idempotent, and audited.**
10. **Adding a knowledge source adds an adapter, not a change to core logic.**
