# MCP Tool Design

The Knowzy MCP server is the **only** component that holds Microsoft Graph credentials and the only
path from the platform to a knowledge source or to the Question Bank. Every tool below is typed,
schema-validated, authorization-checked, audited, and idempotent where it writes.

Architecture context: [architecture.md §7.4](architecture.md#74-why-mcp-sits-between-the-api-and-sharepoint).
Adapter contract: [knowledge-source-adapters.md](knowledge-source-adapters.md).

---

## 1. Design position

| # | Rule | Consequence |
| --- | --- | --- |
| T1 | The MCP server re-checks authorization; it never trusts the caller | A compromised or buggy API handler cannot widen access |
| T2 | No tool accepts a site URL, site ID, drive ID, list ID, or field name from the caller | Every identifier is resolved server-side from `KnowledgeSource` / `ApplicationConfiguration` rows. A caller names a **source**, not a location. |
| T3 | Read and write tools are separate, and write tools are separately gated | `sharepoint.write.enabled` plus a role check plus a feature-flag check |
| T4 | Every tool input and output has a Zod schema shared with the API and with Claude output parsing | One schema, three consumers — no drift |
| T5 | Retrieved document content is returned as **untrusted data** with explicit provenance | Framing is applied by the caller; the tool never returns content that claims authority |
| T6 | Tools exposed to Claude are a strict read-only subset | §14 |
| T7 | Every invocation writes an audit event with the correlation ID from the envelope | [audit-model.md §4](audit-model.md#4-correlation-model) |
| T8 | A tool that cannot complete returns a typed error, never a partial success that looks whole | §4 |

### 1.1 What MCP is not used for

MCP does **not** front PostgreSQL for the API's own domain services. Scoring, approval, badge
eligibility, and configuration reads are ordinary in-process calls. MCP exists for external-system
access and for the tool surface Claude may touch. Using it as a generic internal RPC layer would add
latency and a second authorization surface for no benefit.

---

## 2. Tool catalogue

36 tools in eight families.

| § | Family | Tools | Writes |
| --- | --- | --- | --- |
| [5](#5-source-administration-tools) | Source administration | `list_knowledge_sources` · `get_knowledge_source` · `test_knowledge_source` · `synchronize_knowledge_source` · `get_synchronization_history` | Local only |
| [6](#6-source-navigation-tools) | Source navigation | `list_source_containers` · `list_source_items` · `search_source_documents` · `get_source_document` · `get_document_permissions` | No |
| [7](#7-authoring-tools) | Authoring | `extract_document_content` · `get_document_sections` · `get_source_evidence` · `get_similar_questions` | Local only |
| [8](#8-question-bank-tools) | Question Bank | `check_question_publish_status` · `publish_question_to_sharepoint` · `get_published_question` · `query_published_questions` · `retire_published_question` · `reconcile_question_bank` | **SharePoint** |
| [9](#9-generation-governance-tools) | Generation governance | `preflight_generation` · `get_document_generation_history` · `get_document_coverage` · `compare_document_versions` · `get_generation_history` · `compare_generations` · `get_objective_coverage` · `resolve_objective_sections` · `get_reuse_metrics` · `save_question_set` · `get_question_set` | Local only |
| [10](#10-assessment-tools) | Assessment | `evaluate_assessment_pool` · `get_assessment_eligibility_snapshot` | Local only |
| [11](#11-learning-tools) | Learning | `get_quiz_questions` · `search_enterprise_knowledge` | No |
| [12](#12-reporting-tools) | Reporting | `get_reporting_dataset` | No |

"Local only" means the tool may write to PostgreSQL (a sync run, a preflight record, a question set)
but never to an external system. Only the six Question Bank tools can write outside Knowzy, and only
two of those (`publish_question_to_sharepoint`, `retire_published_question`) actually do.

---

## 3. Authorization envelope

Every tool call carries an envelope constructed by the API **from the validated Entra token**, never
from request body fields.

```ts
const AuthorizationEnvelope = z.object({
  subject: z.object({
    userId:        z.string().uuid(),        // Knowzy User.id
    entraObjectId: z.string(),               // oid claim
    displayName:   z.string(),               // for audit readability only
  }),
  portal:          z.enum(['AUTHORING', 'LIVE', 'SYSTEM']),
  effectiveRoles:  z.array(z.string()),      // resolved from UserRole, not from token groups
  permissions:     z.array(z.string()),      // resolved permission keys
  dataScope: z.object({
    domainIds:  z.array(z.string().uuid()),  // empty = unrestricted on this dimension
    teamIds:    z.array(z.string().uuid()),
    sourceIds:  z.array(z.string().uuid()),
    denySourceIds: z.array(z.string().uuid()),
  }),
  delegation: z.object({                     // present only for DELEGATED_OBO sources
    mode:      z.enum(['NONE', 'ON_BEHALF_OF']),
    oboTokenRef: z.string().optional(),      // a broker handle, never a raw token
  }),
  correlationId: z.string(),
  requestId:     z.string(),
  issuedAt:      z.string().datetime(),
  expiresAt:     z.string().datetime(),      // short-lived; default 120 s
});
```

### 3.1 Envelope rules

| # | Rule |
| --- | --- |
| E1 | The envelope is **signed** by the API with a key held in Key Vault and verified by the MCP server. An unsigned or expired envelope is rejected with `ENVELOPE_INVALID`. |
| E2 | `effectiveRoles` and `permissions` are resolved from the Knowzy database. Entra group claims are a provisioning hint only — see [access-control.md §3](access-control.md#3-role-source-of-truth). |
| E3 | The MCP server **re-resolves** the subject's roles and scope from the database on every call and uses the intersection of the envelope and the fresh resolution. A stale envelope can never grant more than current state allows. |
| E4 | `oboTokenRef` is a handle into an in-memory credential broker, scoped to one call and one resource. The raw on-behalf-of token never appears in a tool argument, a log, or an audit record. |
| E5 | `portal = 'LIVE'` envelopes are structurally incapable of invoking any tool outside §11 and `get_published_question`. The tool registry is partitioned by portal, so the route does not exist rather than being refused. |
| E6 | `portal = 'SYSTEM'` is used by the job runner, carries a synthetic subject with an explicit service identity, and is the only portal permitted to call `synchronize_knowledge_source` on a schedule. System calls are audited with `actorType = SYSTEM`. |
| E7 | Every tool declares its required permission in the registry. A call whose envelope lacks it is refused with `FORBIDDEN` **before** argument validation, so error messages cannot be used to probe schemas. |

### 3.2 Per-tool authorization table

| Tool | Required permission | Extra gate |
| --- | --- | --- |
| `list_knowledge_sources`, `get_knowledge_source` | `source.read` | Source in `dataScope.sourceIds` (or unrestricted) and not in `denySourceIds` |
| `test_knowledge_source` | `source.test` | Rate limit 10/source/hour |
| `synchronize_knowledge_source` | `source.sync` | One concurrent run per source |
| `get_synchronization_history` | `source.read` | — |
| `list_source_containers`, `list_source_items`, `search_source_documents`, `get_source_document` | `document.browse` | Effective source access ([knowledge-source-administration.md §3.3](knowledge-source-administration.md#33-restriction-model)) |
| `get_document_permissions` | `document.browse` | Principal lists require `source.manage` |
| `extract_document_content` | `question.generate` | Source `usableForGeneration` |
| `get_document_sections`, `get_document_coverage` | `document.browse` | — |
| `get_source_evidence` | `question.read` | Domain scope on the question |
| `get_similar_questions` | `question.read` | — |
| `check_question_publish_status`, `get_published_question`, `query_published_questions` | `question.read` | — |
| `publish_question_to_sharepoint` | `question.publish` | `sharepoint.write.enabled` + question `APPROVED` + all 13 gates |
| `retire_published_question` | `question.retire` | `sharepoint.write.enabled` + mandatory comment |
| `reconcile_question_bank` | `questionbank.reconcile` | Read-only by default; corrective writes require an explicit operator decision |
| `preflight_generation` | `question.generate` | — |
| `get_document_generation_history`, `get_generation_history`, `compare_generations`, `compare_document_versions` | `question.read` | — |
| `get_objective_coverage`, `resolve_objective_sections` | `question.generate` | — |
| `get_reuse_metrics` | `report.read` | Minimum group size not applicable (no person-level data) |
| `save_question_set`, `get_question_set` | `question.read` / `assessment.manage` to save | — |
| `evaluate_assessment_pool`, `get_assessment_eligibility_snapshot` | `assessment.read` | — |
| `get_quiz_questions` | `learning.session.create` | `portal = 'LIVE'` or `'SYSTEM'`; session-bound (§11.1) |
| `search_enterprise_knowledge` | `learning.recommendation.own` | Source `usableForRefreshers`; call budget |
| `get_reporting_dataset` | `report.read` | Data scope + suppression applied inside the tool |

---

## 4. Error contract

Every failure returns the same shape, aligned with the API's problem+json taxonomy
([error-handling.md §2](error-handling.md#2-error-taxonomy)).

```jsonc
{
  "isError": true,
  "error": {
    "code": "SOURCE_FOLDER_NOT_FOUND",      // stable, documented, machine-readable
    "category": "CONFIGURATION",            // AUTHORIZATION | VALIDATION | CONFIGURATION |
                                            // NOT_FOUND | CONFLICT | UPSTREAM | THROTTLED |
                                            // TIMEOUT | INTERNAL
    "message": "The folder path was not found in this library.",   // safe for display
    "retryable": false,
    "retryAfterSeconds": null,
    "correlationId": "c-8f2a…",
    "details": { "sourceId": "…", "pathId": "…" }   // never secrets, never raw provider bodies
  }
}
```

| Rule | Detail |
| --- | --- |
| No provider passthrough | Graph error bodies are mapped to Knowzy codes. The raw body is logged at `debug` with the correlation ID and passes through the redactor. |
| No partial success | A tool that processed 7 of 10 documents returns a **success** envelope with a per-item outcome array, never a truncated list that looks complete. `extract_document_content` and `publish_question_to_sharepoint` both use per-item outcomes. |
| Retryability is explicit | `retryable` and `retryAfterSeconds` are set from the mapping table in [error-handling.md §5](error-handling.md#5-external-service-failures), so callers never guess. |
| Authorization first | `FORBIDDEN` is returned before schema validation, so error shape cannot be used to enumerate tool arguments. |
| Timeouts are errors | A tool that exceeds its declared budget returns `TIMEOUT`; it does not return whatever it had. |

---

## 5. Source administration tools

### `list_knowledge_sources`

| | |
| --- | --- |
| Input | `{ sourceTypes?: SourceType[], purpose?: 'GENERATION'\|'REFRESHERS'\|'EXPLANATIONS', activeOnly?: boolean, connectionStatus?: ConnectionStatus[] }` |
| Output | `{ sources: Array<{ sourceId, name, description, sourceType, isActive, connectionStatus, connectionStatusAt, permissionMode, purposes: {generation, refreshers, explanations}, pathCount, documentCount, lastSyncAt, lastSuccessfulSyncAt, ownerDisplayName }> }` |
| Notes | Returns only sources the caller may access. **Never returns `connection`** — no tenant hostname, site URL, site ID, or secret reference reaches the caller through this tool. |

### `get_knowledge_source`

| | |
| --- | --- |
| Input | `{ sourceId }` |
| Output | The above, plus `paths[]` (`pathId`, `containerName`, `folderPath`, file-type filters, included metadata, domain/topic mapping rules, `isActive`, `requiresFullSync`, `lastSuccessfulSyncAt`), `restrictions`, `syncSchedule`, and `secretConfigured: boolean` |
| Notes | `secretConfigured` is a boolean, never a value or a reference. Callers with `source.manage` additionally receive `connection.siteUrl` and `connection.tenant` for display in the editor; nobody receives the secret. |

### `test_knowledge_source`

| | |
| --- | --- |
| Input | `{ sourceId, pathId? }` |
| Output | The nine-check result contract in [knowledge-source-administration.md §5.2](knowledge-source-administration.md#52-result-contract) |
| Writes | `KnowledgeSource.connectionStatus` + `connectionStatusAt`, and an `ADMIN.SOURCE.CONNECTION_TESTED` audit event |
| Notes | **Read-only against SharePoint.** Never writes to the source. Status is set only from an executed probe; if credentials are absent the result is `FAILED` / `SOURCE_NOT_CONFIGURED`, never a fabricated success. |

### `synchronize_knowledge_source`

| | |
| --- | --- |
| Input | `{ sourceId, pathIds?, mode: 'INCREMENTAL'\|'FULL', reason? }` |
| Output | `{ syncId, accepted: true }` — the run is asynchronous |
| Writes | `KnowledgeSourceSync`, `KnowledgeDocument` upserts, `DocumentSection`, extraction records, revalidation flags, delta tokens |
| Notes | One concurrent run per source, enforced by an advisory lock. A second request returns the in-flight `syncId` rather than queuing a duplicate. Pipeline: [knowledge-source-administration.md §6.2](knowledge-source-administration.md#62-sync-run-pipeline). |

### `get_synchronization_history`

| | |
| --- | --- |
| Input | `{ sourceId, limit?, before?, outcomes? }` |
| Output | `{ runs: Array<KnowledgeSourceSync summary>, documentFailures?: Array<{ sourceDocumentId, documentName, phase, errorCode, safeMessage, attemptCount, nextRetryAt, state }> }` |
| Notes | `errorSummary` is already redacted at write time; this tool performs no additional filtering because there is nothing left to filter. |

---

## 6. Source navigation tools

These four tools are the **entire** source-browsing surface. Their signatures are adapter-shaped, not
SharePoint-shaped, which is what makes rule T2 and design goal G8 hold.

### `list_source_containers`

| | |
| --- | --- |
| Input | `{ sourceId }` |
| Output | `{ containers: Array<{ containerId, containerName, itemCount?, isConfigured: boolean }> }` |
| Notes | For SharePoint a container is a document library (`drive`). `isConfigured` marks containers already present as a `KnowledgeSourcePath`. |

### `list_source_items`

| | |
| --- | --- |
| Input | `{ sourceId, containerId, folderPath?, kind?: 'FOLDER'\|'DOCUMENT'\|'ALL', fileTypes?, modifiedAfter?, cursor?, pageSize? (≤200), mode?: 'INDEXED'\|'LIVE' }` |
| Output | `{ items: Array<{ kind, sourceDocumentId?, name, folderPath, fileType?, fileSizeBytes?, sourceModifiedAt?, extractionStatus?, indexingStatus?, coverageStatus?, generationStatus?, isExcludedFromGeneration?, origin: 'INDEXED'\|'LIVE' }>, nextCursor?, truncated: boolean }` |
| Notes | `mode` defaults to `INDEXED` (served from `KnowledgeDocument`, no Graph load). `LIVE` calls the adapter and is used when a path has not been synchronized or the user asks to refresh. `origin` is returned per item so the UI can label "indexed" vs "live from source" — see [knowledge-source-administration.md §7.3](knowledge-source-administration.md#73-browse-strategy-index-first-live-verified). Folder paths are normalized and validated; `..` is rejected with `VALIDATION`. |

### `search_source_documents`

| | |
| --- | --- |
| Input | `{ sourceId?, containerId?, folderPath?, query, fields?: ('NAME'\|'PATH'\|'METADATA'\|'TEXT')[], filters?: { domainId?, topicId?, fileTypes?, authors?, modifiedRange?, metadata?, coverageStatus?, generationStatus? }, mode?: 'INDEXED'\|'LIVE', limit? }` |
| Output | `{ results: Array<{ sourceDocumentId, name, folderPath, fileType, sourceModifiedAt, snippet?, score, origin }>, mode, truncated }` |
| Notes | Two layers as designed in [knowledge-source-administration.md §7.4](knowledge-source-administration.md#74-search): local full-text plus `pg_trgm` by default, adapter-delegated live search on request. `snippet` is drawn from indexed extracted text and is escaped, never rendered as markup. |

### `get_source_document`

| | |
| --- | --- |
| Input | `{ sourceId, sourceDocumentId, includeExtractionSummary?: boolean }` |
| Output | The `KnowledgeDocument` metadata set from [knowledge-source-administration.md §6.7](knowledge-source-administration.md#67-source-document-metadata-specification-33-complete), plus `existsNow`, `permissionCheck: 'ALLOWED'\|'DENIED'\|'UNKNOWN'`, `chunkCount`, `extractedCharCount`, `contentHashShort`, and `attachedQuestions: Array<{ questionId, status, domainName, topicName }>` |
| Notes | Returns **metadata and extraction status only**. It never returns document bytes and never returns the full extracted text — that is `extract_document_content`, which carries a different permission and a different audit action. |

### `get_document_permissions`

| | |
| --- | --- |
| Input | `{ sourceId, sourceDocumentId }` |
| Output | `{ enforcement: 'SHAREPOINT'\|'PLATFORM', callerEffectiveAccess: 'READ'\|'WRITE'\|'OWNER'\|'NONE', summary: { principalCount?, hasExternalSharing?, inheritsFromParent? }, principals?: Array<{ displayName, type, role }> }` |
| Notes | `principals` is populated only for callers with `source.manage`. Others receive `summary` only — an author browsing documents does not get a membership dump. `enforcement` states plainly whether trimming is SharePoint-enforced (`DELEGATED_OBO`) or Knowzy-enforced (`APP_ONLY_SITES_SELECTED`), per [knowledge-source-administration.md §7.6](knowledge-source-administration.md#76-permission-display). |

---

## 7. Authoring tools

### `extract_document_content`

The single most security-sensitive read tool: its output is what reaches Claude.

| | |
| --- | --- |
| Input | `{ sourceId, documentIds: string[] (1–10), sectionKeys?: string[], maxCharsPerDocument?, verifyFreshness?: boolean (default true) }` |
| Output | `{ documents: Array<{ documentId, sourceDocumentId, name, webUrl, sourceVersion, eTag, contentHash, verified: boolean, sections: Array<{ sectionKey, ordinal, heading, headingPath, pageNumber?, startOffset, endOffset, text, sectionContentHash, isAssessable }>, citation: { sourceName, documentName, webUrl, locationLabel } }>, perDocumentOutcomes: Array<{ documentId, outcome: 'OK'\|'NOT_FOUND'\|'FORBIDDEN'\|'STALE_REEXTRACTED'\|'UNSUPPORTED'\|'EXTRACTION_EMPTY', detail? }> }` |
| Notes | Four guarantees, in order: (1) the document must be in the caller's scope and its source `usableForGeneration`; (2) `verifyFreshness` re-checks existence, caller permission, and content hash against the live item and re-extracts on drift; (3) only `sectionKeys` supplied by the caller's **resolved generation scope** are returned — a section outside the pinned scope is refused, which is what makes evidence-section attribution enforceable; (4) `UNSUPPORTED` and `TOO_LARGE` documents return no text at all, so raw bytes and unextractable binaries structurally cannot reach Claude. Per-document failures do not fail the call. |

### `get_document_sections`

| | |
| --- | --- |
| Input | `{ documentId, versionCounter? }` |
| Output | `{ documentId, versionCounter, sections: Array<{ sectionKey, ordinal, heading, headingPath, pageNumber?, assessableCharCount, isAssessable, nonAssessableReason?, targetQuestionCount, coverageStatus, approvedQuestionCount, publishedQuestionCount, inReviewCount, attachedQuestionIds }>, lineage?: Array<DocumentSectionLineage> }` |
| Notes | Section **metadata** only, no text. Used by the coverage view, the scope selector, and the objective-mapping confirmation screen. |

### `get_source_evidence`

| | |
| --- | --- |
| Input | `{ questionId, reverifyAgainstCurrent?: boolean }` |
| Output | `{ questionId, lineage: { sourceName, siteName, libraryName, folderPath, documentName, sourceDocumentId, sourceUrl, sourceVersionAtGeneration, sectionKey, headingPath, pageNumber?, startOffset, endOffset }, storedEvidence: string, storedSectionText: string, verification: { mode, result: 'VERIFIED'\|'DRIFTED'\|'NOT_LOCATABLE'\|'DOCUMENT_DELETED'\|'FORBIDDEN', similarityScore?, currentSectionText?, diff? }, permissionCheck, openInSourceUrl? }` |
| Notes | Powers the review workspace evidence panel and "View Question Source" ([generation-governance.md §9.1](generation-governance.md#91-view-question-source)). When the document has changed it returns previous and current text plus a diff rather than a broken link. When the document is gone or inaccessible it says so and still returns the stored lineage and excerpt — which is exactly what an auditor needs. No lineage field is ever fabricated or backfilled. |

### `get_similar_questions`

| | |
| --- | --- |
| Input | `{ questionText, options?, domainId?, excludeQuestionIds?, corpus?: ('DRAFT'\|'APPROVED'\|'PUBLISHED')[], limit? }` |
| Output | `{ matches: Array<{ questionId, status, domainName, topicName, questionText, compositeScore, componentScores: { stemTrigram, stemJaccard, optionOverlap, sameSection, sameAnswerSemantics }, similarityClusterId? }>, thresholds: { flag, block } }` |
| Notes | Implements the composite scoring of [generation-governance.md §4.4](generation-governance.md#44-stage-2--post-generation-similarity-scoring). Detection spans **all domains**; `domainId` affects ranking only. Returns scores and matches — it makes no decision. Blocking and flagging are the generation service's job. |

---

## 8. Question Bank tools

The only tools that can write outside Knowzy. Column and governance semantics:
[sharepoint-question-bank.md](sharepoint-question-bank.md). Field naming:
[sharepoint-field-mapping.md](sharepoint-field-mapping.md).

### `check_question_publish_status`

| | |
| --- | --- |
| Input | `{ questionId, expectedVersion? }` |
| Output | `{ exists: boolean, sharePointItemId?, eTag?, currentVersion?, status?, isActive?, isPublished?, fieldHashes?: { questionText, answerPayload }, decision: 'CREATE'\|'UPDATE'\|'ALREADY_PUBLISHED'\|'CONFLICT' }` |
| Notes | The mandatory pre-write existence check. Queries by the indexed `QuestionID` column. `decision` is computed server-side so the publishing service cannot make a different judgement from the same facts. |

### `publish_question_to_sharepoint`

| | |
| --- | --- |
| Input | `{ questionId, publishedVersion, operationType: 'CREATE'\|'UPDATE', operationKey, ifMatch?, mappingProfileId, dryRun?: boolean }` |
| Output | `{ outcome: 'CREATED'\|'UPDATED'\|'ALREADY_PUBLISHED'\|'CONFLICT'\|'FAILED', sharePointItemId?, eTag?, writtenFields?: Record<string,string> (dry run only), error? }` |
| Gates | `question.publish` · `sharepoint.write.enabled` · question status `APPROVED` · all 13 approval gates re-evaluated · `operationKey` unique · `ifMatch` required for `UPDATE` |
| Notes | Idempotent by construction: the deterministic `operationKey` has a unique index, and the tool re-runs `check_question_publish_status` internally before acting, so a retry after a lost response becomes `ALREADY_PUBLISHED` rather than a duplicate item. A 412 on `ifMatch` returns `CONFLICT` with the current ETag — never a blind overwrite. `dryRun` returns the exact field set that would be written, with internal-to-SharePoint field names resolved, and touches nothing. |

### `get_published_question`

| | |
| --- | --- |
| Input | `{ questionId, version?, includeAnswerKey: boolean }` |
| Output | `{ questionId, version, questionText, options, topic, domain, sourceReferences, status, isActive, isPublished, sharePointItemId, eTag, correctAnswer? , explanation? }` |
| Notes | `includeAnswerKey` is honoured **only** for `portal = 'AUTHORING'` or `'SYSTEM'` envelopes carrying `question.read`. A `portal = 'LIVE'` envelope that sets it receives `FORBIDDEN`, and the `correctAnswer` / `explanation` fields are stripped by the response projection regardless. Two independent controls, because one is not enough for this field. |

### `query_published_questions`

| | |
| --- | --- |
| Input | `{ domainId?, topicIds?, objectiveIds?, isActive?, isPublished?, questionIds?, publishedAfter?, limit?, cursor? }` |
| Output | `{ questions: Array<{ questionId, publishedVersion, domainId, topicId, objectiveId?, isActive, isPublished, similarityClusterId?, sourceDocumentId, publishedAt }>, nextCursor? }` |
| Notes | Served from the PostgreSQL `PublishedQuestionReference` projection, **not** from SharePoint, because SharePoint is a weak query target and this query runs on every assessment pool evaluation. Returns no question text and no answer key. |

### `retire_published_question`

| | |
| --- | --- |
| Input | `{ questionId, comment (required, ≥10 chars), ifMatch }` |
| Output | `{ outcome: 'RETIRED'\|'ALREADY_RETIRED'\|'CONFLICT', eTag? }` |
| Notes | Sets `IsActive = false` and `Status = Retired` on the bank item via a conditional update. **The SharePoint item is never deleted.** Marks `PublishedQuestionReference.status = RETIRED`, requires a comment, and audits `AUTHORING.QUESTION.RETIRED`. Retired questions leave new assessment selection but remain intact in historical snapshots and results. |

### `reconcile_question_bank`

| | |
| --- | --- |
| Input | `{ scope: 'ALL'\|'DOMAIN'\|'QUESTION_IDS', domainId?, questionIds?, applyDecisions?: Array<{ questionId, decision: 'ADOPT_REMOTE'\|'REPUBLISH_LOCAL'\|'MARK_MISSING'\|'IGNORE', comment }> }` |
| Output | `{ differences: Array<{ questionId, state: ReconciliationState, local: {...}, remote: {...}, recommendedAction, appliedAction? }>, summary: Record<ReconciliationState, number> }` |
| Notes | Read-only unless `applyDecisions` is supplied, and each decision requires an explicit operator choice plus a comment — the tool never auto-heals. Full semantics: [sharepoint-question-bank.md §8](sharepoint-question-bank.md#8-reconciliation). |

---

## 9. Generation governance tools

These eleven tools implement [generation-governance.md](generation-governance.md). They are the reason
"generate once, reuse forever" is enforceable rather than aspirational.

### `preflight_generation`

| | |
| --- | --- |
| Input | `{ sourceId, documentIds: string[] (1–10), objectiveIds?, targetAssessmentId?, intendedScope? }` |
| Output | `{ preflightId, expiresAt, checks: { previouslyProcessed: { status: 'NEVER_PROCESSED'\|'PROCESSED', jobs[] }, approvedQuestionsExist: { status: 'NO_APPROVED'\|'HAS_APPROVED', count, questionIds[] }, contentChanged: { status: 'UNCHANGED'\|'METADATA_ONLY_CHANGE'\|'CONTENT_CHANGED'\|'CONTENT_CHANGED_UNVERSIONED'\|'UNKNOWN_BASELINE', baselineVersion?, currentVersion?, baselineHash?, currentHash? }, similarityRisk: { level: 'LOW'\|'MEDIUM'\|'HIGH', saturatedSections[] }, crossDomainDuplicates: { matches[] }, poolConflicts: { conflicts[] } }, coverage: { percentage?, sectionCounts }, recommendation: PreflightRecommendation, offeredActions: Array<{ action, permitted: boolean, requiredPermission, requiredReasonCode? }> }` |
| Writes | `GenerationPreflight` |
| Notes | The six mandatory checks of [generation-governance.md §4.1](generation-governance.md#41-stage-0--the-six-mandatory-pre-generation-checks). There is **no "proceed anyway" default** — `recommendation` is advice and `chosenAction` must be set by an explicit author action before a job can be created. A job request without a valid, unexpired `preflightId` is refused with `PREFLIGHT_REQUIRED`. |

### `get_document_generation_history`

| | |
| --- | --- |
| Input | `{ documentId, limit?, cursor? }` |
| Output | `{ document: { documentId, name, sourceName, folderPath, webUrl, sourceVersion, contentHash }, stats: DocumentGenerationStat, jobs: Array<{ jobId, generatedAt, generatedBy, scope, objectiveIds, reasonCode, modelId, promptVersion, requestedCount, acceptedCount, rejectionCounts, versionAtRun, hashAtRun, currentQuestionStates }> }` |

### `get_document_coverage`

| | |
| --- | --- |
| Input | `{ documentId, versionCounter? }` |
| Output | `{ coveragePercentage: number \| null, sections: Array<{ sectionKey, heading, coverageStatus, approvedQuestions, targetQuestions, inReviewQuestions, isAssessable, nonAssessableReason? }>, denominator: { assessableSections, totalTargetQuestions }, formula: string }` |
| Notes | Returns `null` coverage with `reason: 'NO_ASSESSABLE_SECTIONS'` rather than 0% or 100%, per [generation-governance.md §6.4](generation-governance.md#64-coverage-percentage). The `formula` string is returned so the UI can show how the number was computed — a coverage figure nobody can explain is a coverage figure nobody trusts. |

### `compare_document_versions`

| | |
| --- | --- |
| Input | `{ documentId, fromVersionCounter, toVersionCounter }` |
| Output | `{ sections: Array<{ state: 'ADDED'\|'MODIFIED'\|'REMOVED'\|'UNCHANGED'\|'MOVED', fromSectionKey?, toSectionKey?, heading, matchRule, headingSimilarity?, contentSimilarity?, attachedQuestions: Array<{ questionId, status, needsRevalidation }>, textDiff? }>, summary: Record<string, number> }` |
| Notes | Powers "Compare with Previous Version". Every changed section is annotated with the questions attached to it, which is what turns a diff into a work list. |

### `get_generation_history`

| | |
| --- | --- |
| Input | `{ sourceId?, documentId?, domainId?, generatedByUserId?, promptVersionId?, modelId?, dateRange?, outcomes?, limit?, cursor? }` |
| Output | `{ jobs: Array<GenerationJob summary>, aggregates: { totalRequested, totalAccepted, acceptanceRate, rejectionsByReason, approvalRate, medianReviewMinutes } }` |

### `compare_generations`

| | |
| --- | --- |
| Input | `{ jobIdA, jobIdB }` |
| Output | `{ a: JobSummary, b: JobSummary, differences: { scope, objectives, modelId, promptVersion, profile, requestedCount, acceptedCount, rejectionCounts }, questions: { onlyInA[], onlyInB[], equivalentPairs: Array<{ aQuestionId, bQuestionId, similarityScore }> }, yield: { a: YieldMetrics, b: YieldMetrics } }` |
| Notes | Requires both jobs to target the same document, else `VALIDATION`. This is how a prompt or model change is shown to have improved or degraded yield ([generation-governance.md §11.2](generation-governance.md#112-yield-analytics)). |

### `get_objective_coverage`

| | |
| --- | --- |
| Input | `{ domainId?, objectiveIds?, assessmentVersionId? }` |
| Output | `{ objectives: Array<{ objectiveId, title, cognitiveLevel, approvedQuestions, targetQuestions, coveragePercentage, contributingDocumentCount, lastGeneratedAt? }>, shortfalls: Array<{ objectiveId, shortBy }> }` |

### `resolve_objective_sections`

| | |
| --- | --- |
| Input | `{ objectiveIds: string[], documentIds: string[], useClaudeRanking?: boolean }` |
| Output | `{ mappings: Array<{ objectiveId, sections: Array<{ documentId, sectionKey, heading, deterministicScore, claudeScore?, rank }>, unmapped: boolean }>, rankingApplied: boolean }` |
| Notes | The deterministic keyword/trigram layer **always** runs and is sufficient alone. The optional Claude pass may only reorder and score section IDs the deterministic layer surfaced; it cannot introduce a section and cannot generate content in that call. An objective with no mapped section is returned `unmapped: true` and generation for it is refused — the platform never invents questions to satisfy a count. The author-confirmed mapping is pinned to the job. |

### `get_reuse_metrics`

| | |
| --- | --- |
| Input | `{ domainId?, dateRange? }` |
| Output | `{ publishedQuestions, reusedQuestions, reuseFactor, newlyGeneratedQuestions, duplicatesBlocked, duplicatesDispositioned, regenerationAvoided, estimatedSavings: { minutes, reviewMinutesPerQuestion, avgQuestionsPerJob, isEstimate: true } }` |
| Notes | `isEstimate: true` is a required field, not a flag the UI may drop. The component counts are exact; the savings figure is modelled and must be labelled as such wherever it appears. |

### `save_question_set` / `get_question_set`

| | |
| --- | --- |
| `save_question_set` input | `{ name, description?, domainId, questionIds: string[], originGenerationJobId? }` |
| `save_question_set` output | `{ setId, memberCount, skipped: Array<{ questionId, reason }> }` |
| `get_question_set` input | `{ setId }` |
| `get_question_set` output | `{ setId, name, domainId, members: Array<{ questionId, publishedVersion?, status, topicId, ordinal }>, staleMembers: Array<{ questionId, reason: 'RETIRED'\|'INACTIVE'\|'SUPERSEDED' }> }` |
| Notes | A set references questions by ID and version; it never copies content, so reuse can never fork the answer key. `staleMembers` is computed at read time, so a set assembled months ago tells the truth today. |

---

## 10. Assessment tools

### `evaluate_assessment_pool`

| | |
| --- | --- |
| Input | `{ domainId, topicIds?, objectiveIds?, selectionStrategy, selectionConfig, questionCount, minimumObjectiveCoverage? }` |
| Output | `{ feasible: boolean, poolSize, poolSizeByTopic, poolSizeByObjective, clusterCount, shortfalls: Array<{ dimension: 'TOTAL'\|'TOPIC'\|'OBJECTIVE', key?, required, available, shortBy }>, clusterConflicts: Array<{ clusterId, questionIds }> }` |
| Notes | Called by the Assessment Builder pool preview and again at publish. Counts the pool **after** collapsing similarity clusters to one representative, so the feasibility answer matches what session selection will actually be able to do. `feasible: false` blocks publication with the exact shortfall named — it never rounds down the question count silently. |

### `get_assessment_eligibility_snapshot`

| | |
| --- | --- |
| Input | `{ assessmentVersionId }` |
| Output | `{ snapshotId, snapshotAt, strategy, resolvedSelectionConfig, proficiencyThresholds, poolMembers: Array<{ questionId, publishedVersion, topicId, objectiveId?, similarityClusterId? }>, currentlyEligibleCount, droppedSinceSnapshot: Array<{ questionId, reason: 'RETIRED'\|'INACTIVE'\|'SUPERSEDED'\|'MISSING' }> }` |
| Notes | `droppedSinceSnapshot` is the early-warning signal for the authoring dashboard: it is how an assessment is known to be drifting toward `ASSESSMENT_POOL_INSUFFICIENT` **before** a learner hits it. |

---

## 11. Learning tools

Exactly two tools are reachable with a `portal = 'LIVE'` envelope, plus `get_published_question`
without the answer key. Everything else is absent from the live tool registry.

### `get_quiz_questions`

| | |
| --- | --- |
| Input | `{ sessionContext: { assessmentVersionId, eligibilitySnapshotId }, questionIds: string[], versions: number[] }` |
| Output | `{ questions: Array<{ questionId, publishedVersion, questionType, questionText, options, correctAnswer, explanation, domainId, topicId, objectiveId?, sourceReferences }>, missing: Array<{ questionId, reason }> }` |
| Notes | This tool **does** return answer keys — it is what populates the server-side session snapshot. Four constraints make that safe: (1) it is callable only during session creation, proven by a one-time session-creation token in the envelope that the API mints and immediately consumes; (2) its output goes into `QuizSessionQuestion` and is never projected to a response body on the same request; (3) a response-shape assertion on every `/api/v1/learning/**` route rejects payloads containing `correctAnswer`, `explanation`, `supportingEvidence`, or `sourceLocation`; (4) every call is audited as `LEARNING.SESSION.QUESTIONS_LOADED` with the session ID and question count. A call outside session creation is refused with `SESSION_TOKEN_REQUIRED`. See [security.md §8](security.md#8-answer-key-protection). |

### `search_enterprise_knowledge`

| | |
| --- | --- |
| Input | `{ topicId, domainId, objectiveIds?, keywords?, maxCandidates? (≤10) }` |
| Output | `{ candidates: Array<{ candidateId, excerpt, documentName, sourceType, webUrl, sourceId, documentId, permissionChecked: boolean }>, sourcesSearched: number, noCandidatesReason? }` |
| Notes | Only sources with `usableForRefreshers = true` are searched, enforced here rather than in the UI. Search runs under the learner's own permission context for `DELEGATED_OBO` sources; for app-only sources Knowzy's restriction layers apply and the result states which enforcement was used. The `candidateId` is **opaque and call-scoped**: Claude may cite only these IDs, and the platform attaches document names and URLs from its own retrieval records, never from model output. Empty results return `noCandidatesReason` and no fabricated candidate. See [workflows.md §7.4](workflows.md#74-anti-fabrication-controls). |

---

## 12. Reporting tools

### `get_reporting_dataset`

| | |
| --- | --- |
| Input | `{ datasetKey, parameters: Record<string, unknown>, filters?: { dateRange?, domainIds?, teamIds?, topicIds?, assessmentIds?, userIds?, roles?, statuses?, proficiencyBands?, sourceIds? }, page?, pageSize? }` |
| Output | `{ datasetKey, columns: Array<{ key, label, type, isAggregate }>, rows: Array<Record<string, unknown>>, rowCount, suppressedCellCount, appliedScope: { domainIds, teamIds }, minimumGroupSize, asOf, formulaNotes? }` |
| Notes | Data-level authorization and minimum-group-size suppression are applied **inside** the tool, not by the caller, so an on-screen dashboard, a CSV export, and a published report cannot diverge. Suppressed cells are returned as an explicit `SUPPRESSED` marker with `suppressedCellCount`, never as a blank or a zero. `asOf` is mandatory because every reporting read model has a refresh cadence and a stale panel must be labelled. Catalogue: [reporting.md §4](reporting.md#4-report-catalogue). |

---

## 13. Transport, versioning, and limits

| Concern | Design |
| --- | --- |
| Transport | Streamable HTTP in deployed environments (`ca-knowzy-mcp`, **internal ingress only**); stdio for local development |
| Reachability | The MCP server is never internet-reachable. It is the only component holding Graph credentials, so its network position is part of the control. |
| Authentication | Signed authorization envelope (§3) plus mutual service authentication via managed identity |
| Tool registry | Partitioned by `portal`. An `AUTHORING` registry, a `LIVE` registry, and a `SYSTEM` registry are constructed at startup from one declaration table; a tool absent from a registry cannot be named, let alone called. |
| Versioning | Tool names are stable. A breaking change ships as a new tool (`…_v2`) and the old tool is deprecated with a removal date recorded in [risks-and-decisions.md](risks-and-decisions.md). Additive optional fields are not breaking. |
| Schema publication | All input/output schemas live in `@knowzy/shared-types` and are exported as JSON Schema for the MCP manifest, so the manifest cannot drift from the validator. |
| Timeouts | Per-tool declared budget: navigation 10 s, `extract_document_content` 120 s, publish 30 s per item, search 15 s, reporting 30 s. Exceeding it returns `TIMEOUT`. |
| Concurrency | Per-source concurrency cap (default 4) and a token-bucket limiter per Graph resource, so one noisy source cannot throttle the tenant. |
| Pagination | Cursor-based on every list tool. `pageSize` is capped server-side; a caller asking for more receives the cap plus `truncated: true`. |
| Payload caps | 1 MB per tool response for metadata tools; `extract_document_content` is capped by `maxCharsPerDocument` (default 200,000) and reports truncation explicitly rather than silently cutting a section. |
| Retry | Idempotent read tools are retried by the client with jittered backoff; write tools are retried only through their `operationKey` path. |
| Observability | Every call emits a span with tool name, source ID, outcome, duration, and correlation ID; arguments are recorded with a redaction allow-list, never wholesale. |

---

## 14. Tools exposed to Claude

Claude is given tools in exactly one flow — the knowledge refresher — and the grant is deliberately
narrow.

| Flow | Tools granted | Budget |
| --- | --- | --- |
| Question generation | **none** | Content is pre-fetched by the job runner via `extract_document_content` and passed inside untrusted-content delimiters |
| Objective section ranking | **none** | Candidate section IDs are supplied in the prompt; the model returns IDs and scores only |
| Duplicate adjudication | **none** | Both questions are supplied in the prompt; the verdict is advisory |
| Knowledge refresher | `search_enterprise_knowledge`, `get_source_document` (metadata only) | Maximum 3 tool calls per recommendation, 10 candidates, 15 s per call |

Rules:

1. Claude never receives a write tool, a publish tool, a configuration tool, or a reporting tool.
2. Claude's tool calls carry the **same** authorization envelope as the API's own calls. There is no
   weaker path for the model.
3. Tool results returned to Claude are wrapped as untrusted data. Instructions appearing inside a
   document excerpt carry no authority — see [security.md §6](security.md#6-prompt-injection-controls).
4. The call budget is enforced by the caller, not requested in the prompt. Exceeding it terminates the
   flow and falls back to the approved explanation only.
5. Every model-initiated tool call is audited with `actorType = MODEL` and the initiating user's
   subject, so a refresher's retrieval trail is fully reconstructable.

---

## 15. Testing contract

Each tool ships with all five test classes. A tool without them is not considered implemented.

| Class | Asserts |
| --- | --- |
| Schema | Input and output round-trip through the Zod schema; unknown fields rejected; the published JSON Schema matches the validator |
| Authorization | Missing permission → `FORBIDDEN` before validation; out-of-scope source → refused; `portal = 'LIVE'` cannot resolve any authoring tool; `DENY` in `UserSourceAccess` beats `ALLOW` |
| Adapter contract | The tool behaves identically against `MockKnowledgeSourceAdapter` and a recorded SharePoint fixture — this is the test that keeps goal G8 honest ([knowledge-source-adapters.md §8](knowledge-source-adapters.md#8-adapter-conformance-suite)) |
| Idempotency | Write tools: same `operationKey` twice → one external item, second returns `ALREADY_PUBLISHED`; lost-response simulation → no duplicate |
| Leakage | Golden-file assertions that no tool output contains a token, secret reference value, raw provider body, or — for `LIVE` envelopes — `correctAnswer`, `explanation`, `supportingEvidence`, or `sourceLocation` |

The leakage suite runs against every tool in the registry by reflection, so adding a tool without
satisfying it fails the build rather than quietly shipping.
