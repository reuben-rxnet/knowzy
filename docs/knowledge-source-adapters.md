# Knowledge Source Adapters

**What this document adds:** the `KnowledgeSourceAdapter` contract, the SharePoint implementation's
responsibilities, the mock adapter, six extension templates, and the conformance suite that keeps
goal G8 honest. Source configuration and administration are in
[knowledge-source-administration.md](knowledge-source-administration.md); the tool surface that calls
adapters is in [mcp-tools.md](mcp-tools.md).

---

## 1. Why a port

Goal G8: *a second knowledge source type is added by implementing one adapter, with no change to
generation, review, approval, publishing, assessment, scoring, badge, certificate, or reporting logic.*

That is only true if the contract is narrow enough that a non-SharePoint source can satisfy it. The
contract below is deliberately shaped around **capabilities a document repository has**, not around
Graph:

| Kept out of the contract | Because |
| --- | --- |
| Site / drive / list vocabulary | Confluence has spaces, ServiceNow has tables, a filesystem has directories. The contract says `container` |
| Delta tokens | Not every source has one. The contract exposes `synchronize(mode)` and lets the adapter choose its own change-detection strategy, persisting opaque state |
| eTags | The contract says `sourceVersion` and `contentHash`; an adapter maps whatever it has |
| Permission objects | The contract returns an **effective access decision** plus an enforcement label, not an ACL |
| Field names | The adapter owns all external naming ([sharepoint-field-mapping.md](sharepoint-field-mapping.md)) |

### 1.1 Two independent ports

| Port | Direction | Implementations |
| --- | --- | --- |
| `KnowledgeSourceAdapter` | **Read-only** | `SharePointKnowledgeSourceAdapter`, `MockKnowledgeSourceAdapter` |
| `QuestionBankAdapter` | Read/write | `SharePointQuestionBankAdapter`, `MockQuestionBankAdapter` |

They are separate ports with separate credentials and separate permission grants, which is what makes
"knowledge documents are read-only to the platform" a structural statement rather than a convention
([architecture.md §8.1](architecture.md#81-two-distinct-sharepoint-roles)).

---

## 2. `KnowledgeSourceAdapter` contract

```ts
interface KnowledgeSourceAdapter {
  readonly sourceType: SourceType;
  readonly capabilities: AdapterCapabilities;

  // Diagnostics
  testConnection(ctx: AdapterContext): Promise<ConnectionTestResult>;

  // Navigation
  listContainers(ctx: AdapterContext): Promise<Container[]>;
  listItems(ctx: AdapterContext, q: ListItemsQuery): Promise<Page<SourceItem>>;
  searchDocuments(ctx: AdapterContext, q: SearchQuery): Promise<Page<SearchHit>>;
  getDocument(ctx: AdapterContext, id: SourceDocumentId): Promise<SourceDocument | null>;
  getEffectiveAccess(ctx: AdapterContext, id: SourceDocumentId): Promise<AccessDecision>;

  // Content
  extractContent(ctx: AdapterContext, id: SourceDocumentId,
                 opts: ExtractOptions): Promise<ExtractedContent>;

  // Change detection
  synchronize(ctx: AdapterContext, req: SyncRequest): AsyncIterable<SyncEvent>;
}
```

### 2.1 `AdapterContext`

Everything the adapter needs, and nothing it does not:

```ts
interface AdapterContext {
  source:        KnowledgeSourceConfig;       // connection + paths, secrets unresolved
  paths:         KnowledgeSourcePathConfig[];
  credential:    CredentialHandle;            // opaque; resolve(scope) returns a token, never a secret value
  permissionMode:'DELEGATED_OBO' | 'APP_ONLY_SITES_SELECTED';
  onBehalfOf?:   OboHandle;                   // present only in DELEGATED_OBO
  correlationId: string;
  limits:        { maxBytes: number; maxCharsPerDocument: number; pageSize: number };
  clock:         Clock;
  signal:        AbortSignal;                 // honours the tool's declared timeout
}
```

| Rule | Detail |
| --- | --- |
| No database access | An adapter receives configuration and returns data. It does not read or write PostgreSQL — the MCP layer persists. This keeps adapters pure, testable, and unable to corrupt platform state |
| No secret values | `CredentialHandle.resolve(scope)` returns a short-lived token from the broker. The adapter never sees a client secret, certificate, or Key Vault value ([security.md §11](security.md#11-secrets-and-key-management)) |
| No logging of content | Adapters log identifiers, counts, and durations. Content logging is prohibited and enforced by the redactor |
| Cancellation | Every method honours `signal`; a timed-out call stops work rather than completing in the background |

### 2.2 `AdapterCapabilities`

Declared, not assumed. The platform adapts its behaviour and its UI to what a source can actually do.

```ts
interface AdapterCapabilities {
  supportsContainers:      boolean;   // false → a flat source; the tree renders one level
  supportsFolderHierarchy: boolean;
  supportsLiveSearch:      boolean;   // false → indexed search only, labelled as such
  supportsFullTextSearch:  boolean;
  supportsIncrementalSync: boolean;   // false → every sync is FULL, and the UI says so
  supportsPermissionCheck: boolean;   // false → getEffectiveAccess returns UNKNOWN, never ALLOWED
  supportsDelegatedAccess: boolean;   // false → DELEGATED_OBO is rejected at configuration time
  supportsVersionLabels:   boolean;   // false → change detection relies on contentHash alone
  supportedDocumentTypes:  DocumentType[];
  writeCapable:            false;     // literal false — this port never writes
}
```

Honesty rules:

1. A capability a source lacks is declared `false`, and the UI states the consequence. It is never
   emulated with a guess.
2. `supportsPermissionCheck: false` means `getEffectiveAccess` returns `UNKNOWN` — never `ALLOWED`.
   The permission column shows "unknown", and platform-enforced trimming is labelled as such.
3. `supportsVersionLabels: false` degrades the dual change test in
   [generation-governance.md §5](generation-governance.md#5-document-change-detection) to
   hash-only, which is stated in the coverage and preflight UI rather than silently assumed
   equivalent.
4. `supportsIncrementalSync: false` makes every run full; the sync screen shows the cost implication.
5. `writeCapable` is typed as the literal `false`, so a write-capable knowledge adapter cannot be
   written. Writing is the other port's job.

### 2.3 Core types

| Type | Fields |
| --- | --- |
| `Container` | `containerId`, `containerName`, `itemCount?` |
| `SourceItem` | `kind: 'FOLDER' \| 'DOCUMENT'`, `sourceDocumentId?`, `name`, `folderPath`, `fileType?`, `sizeBytes?`, `sourceModifiedAt?`, `sourceVersion?`, `webUrl?` |
| `SourceDocument` | `SourceItem` plus `sourceCreatedAt`, `mimeType`, `sourceMetadata` (only the requested columns), `containerSiteName?`, `containerSiteId?` |
| `AccessDecision` | `decision: 'ALLOWED' \| 'DENIED' \| 'UNKNOWN'`, `enforcement: 'SOURCE' \| 'PLATFORM' \| 'NONE'`, `callerRole?`, `summary?` |
| `ExtractedContent` | `status: ExtractionStatus`, `normalizedText?`, `charCount`, `sections: ExtractedSection[]`, `contentHash?`, `truncated: boolean`, `reason?` |
| `ExtractedSection` | `ordinal`, `heading?`, `headingPath?`, `pageNumber?`, `slideNumber?`, `sheetName?`, `startOffset`, `endOffset`, `sectionContentHash` |
| `SyncEvent` | Discriminated: `ITEM_DISCOVERED`, `ITEM_MODIFIED`, `ITEM_DELETED`, `ITEM_FAILED`, `PAGE_COMPLETED`, `STATE_CHECKPOINT` (opaque `state` the platform persists), `RUN_COMPLETED` |

### 2.4 Normative extraction requirements

Because extraction output is what evidence verification operates on, the contract constrains it:

| # | Requirement |
| --- | --- |
| X1 | `normalizedText` uses the normalization pipeline in [architecture.md §8.4](architecture.md#84-content-extraction-pipeline): NFKC, collapsed whitespace, unified quotes/dashes/ligatures, de-hyphenated line breaks |
| X2 | `startOffset` / `endOffset` are character offsets **into `normalizedText`** and must satisfy `text.slice(start, end)` equalling the section's content exactly. This is what makes an evidence span re-locatable years later |
| X3 | Sections are ordered, non-overlapping, and cover the document with no gaps other than discarded non-content (headers, footers, page furniture) |
| X4 | A document with no heading structure falls back to fixed-size windows with stable ordinals, and `heading` is `null` — the adapter never invents a heading |
| X5 | An unsupported or unextractable document returns `status` with a `reason` and **no text**. Returning empty text with a success status is prohibited: it would appear as a legitimately empty document |
| X6 | Truncation at `maxCharsPerDocument` sets `truncated: true` and ends at a section boundary. A silently cut section would produce unverifiable evidence |
| X7 | `contentHash` is SHA-256 of `normalizedText`, so two adapters reading the same bytes agree |
| X8 | Extraction is deterministic: the same input produces byte-identical output, including section keys. Non-determinism would make change detection meaningless |

---

## 3. SharePoint adapter

Implements the contract over Microsoft Graph v1.0. Graph resource paths and permission modes are
specified in [architecture.md §8.2–8.3](architecture.md#82-graph-resource-path-strategy); extractors
per type in [architecture.md §8.4](architecture.md#84-content-extraction-pipeline). Adapter-specific
responsibilities not covered there:

| Responsibility | Implementation |
| --- | --- |
| Capability declaration | All capabilities `true` except that `supportsPermissionCheck` degrades to `UNKNOWN` when the caller lacks permission to read permissions |
| Identifier resolution | Site URL → site ID and library name → drive ID, resolved by Test Connection and **stored**. Resolution never happens on a hot path |
| Change detection | `/root/delta` per path, checkpointed via `STATE_CHECKPOINT`. An invalid token falls back to a full scan, logged, **not** surfaced as a failure |
| Hash confirmation | `eTag` change alone is treated as a candidate, not a content change. The content hash decides, because SharePoint bumps `eTag` for metadata and permission events |
| Throttling | Token bucket per site, `Retry-After` honoured, circuit breaker per source ([error-handling.md §5](error-handling.md#5-external-service-failures)) |
| Streaming | Content is streamed to the extractor with a size cap applied **before** download completes; bytes are never buffered whole and never persisted |
| Pages | SharePoint Pages extracted from the canvas layout with web-part/section titles as headings |
| Permission mode | `DELEGATED_OBO` exchanges per call via the broker; `APP_ONLY_SITES_SELECTED` uses the platform credential and returns `enforcement: 'PLATFORM'` so the UI can say so |
| Error mapping | Graph conditions mapped to Knowzy codes per [knowledge-source-administration.md §5.3](knowledge-source-administration.md#53-redaction-rules); no provider body escapes |

---

## 4. `QuestionBankAdapter` contract

```ts
interface QuestionBankAdapter {
  readonly capabilities: { supportsConditionalUpdate: boolean;
                           supportsNativeVersioning: boolean;
                           supportsIndexedFilter: boolean };

  findByQuestionId(ctx: BankContext, questionId: string): Promise<BankItem | null>;
  queryItems(ctx: BankContext, q: BankQuery): Promise<Page<BankItem>>;
  createItem(ctx: BankContext, item: BankItemWrite, operationKey: string): Promise<BankWriteResult>;
  updateItem(ctx: BankContext, itemId: string, patch: Partial<BankItemWrite>,
             ifMatch: string, operationKey: string): Promise<BankWriteResult>;
  retireItem(ctx: BankContext, itemId: string, ifMatch: string,
             comment: string, operationKey: string): Promise<BankWriteResult>;
  // No deleteItem. The method does not exist.
}
```

| Rule | Detail |
| --- | --- |
| No delete | The contract has no delete method, so governance rule G7 is enforced by the type system rather than by policy ([sharepoint-question-bank.md §4](sharepoint-question-bank.md#4-governance-rules)) |
| Semantic keys in, external names out | `BankItemWrite` is keyed by semantic key; the adapter resolves internal names through the active mapping profile |
| `operationKey` on every write | Passed through for idempotency and recorded on the result |
| Conditional update required | `ifMatch` is a required parameter on update and retire, not an option |
| `supportsConditionalUpdate: false` | Publishing is refused for that bank. Blind overwrite is never an acceptable fallback |

---

## 5. Registration

```ts
// Registry is built at startup from configuration; nothing is imported by a domain service.
adapterRegistry.register(new SharePointKnowledgeSourceAdapter(graphClientFactory, extractorRegistry));
adapterRegistry.register(new MockKnowledgeSourceAdapter(fixtureRoot));
bankRegistry.register(new SharePointQuestionBankAdapter(graphClientFactory, mappingProfileResolver));
bankRegistry.register(new MockQuestionBankAdapter(fixtureRoot));
```

| Rule | Detail |
| --- | --- |
| Resolution by `sourceType` | `adapterRegistry.for(source.sourceType)` — the only lookup path |
| Unregistered type | `SOURCE_TYPE_NOT_AVAILABLE`; the UI marks it "coming soon" rather than hiding it, so the roadmap is visible ([knowledge-source-administration.md §4.2](knowledge-source-administration.md#42-source-type-roadmap)) |
| Enum completeness | Every planned `SourceType` exists in the database enum from the first migration, so shipping an adapter needs no migration |
| Package boundary | Adapters live in `@knowzy/knowledge-source-adapters` and are imported **only** by the MCP server. A layer test enforces it ([repository-structure.md §5](repository-structure.md#5-dependency-rules)) |

---

## 6. Mock adapter

> **Design requirement, not a convenience:** the entire pipeline — browse, select, preflight,
> generate, review, approve, publish, assess, take a quiz, score, refresh, badge, certify — must be
> exercisable with **no tenant credentials at all**.

| Aspect | Design |
| --- | --- |
| Fixture format | A directory tree under `fixtures/knowledge/{sourceKey}/`. Folder structure maps to containers and folder paths; files are real PDFs, DOCX, PPTX, XLSX, HTML, and TXT so the **real extractors** run |
| Metadata | An optional sidecar `{file}.meta.json` supplies `sourceVersion`, `sourceModifiedAt`, captured metadata columns, and a per-principal access map |
| Determinism | `sourceDocumentId` is `sha256(relativePath)`; timestamps come from the sidecar or a fixed base date, never from the filesystem. Identical fixtures produce identical IDs, hashes, and section keys on every machine and in CI |
| Capabilities | All `true` except `supportsLiveSearch` (indexed only, so the "indexed vs live" labelling path is exercised) |
| Change detection | A fixture set can declare `versions/v1`, `versions/v2`, …; switching the active version simulates a document change, which is how revalidation, delta generation, and section lineage are testable without a tenant |
| Permission simulation | The sidecar's access map lets a test assert that a `DENIED` document is excluded with a stated reason under both permission modes |
| Fault injection | `MOCK_FAULTS` configuration injects throttling, timeouts, 403s, extraction failures, and delta-token invalidation at chosen items, so resilience paths are testable deterministically |
| Question bank | `MockQuestionBankAdapter` persists items as JSON under `fixtures/bank/`, with real `operationKey` uniqueness, real ETag semantics (a monotonic counter), and real 412 behaviour on a stale `ifMatch` |
| Local default | `local` environment defaults to the mock source and mock bank ([environment-and-configuration.md](environment-and-configuration.md)) |
| Prohibition | The mock adapter is **never registered** in `test` or `prod`. A startup assertion fails the process if it is, so a mock cannot silently serve production traffic |

The mock adapter is also the substrate for the conformance suite (§8): every behaviour the suite
asserts must hold for both implementations, which is how a contract violation in the SharePoint
adapter is caught by a test that needs no tenant.

---

## 7. Extension templates

Each template states the mapping onto the contract and, more usefully, the **non-obvious problem** an
implementer will hit. None is implemented in release 1.

### 7.1 `CONFLUENCE`

| Contract element | Mapping |
| --- | --- |
| Container | Space |
| Folder hierarchy | Page ancestry (`supportsFolderHierarchy: true`) |
| Document | Page or blog post |
| `sourceVersion` | Page version number (native, monotonic) |
| Incremental sync | CQL query on `lastModified` (no delta API) |
| Permission check | Content restrictions API |
| Extraction | Storage-format XHTML → sanitized, heading-anchored sections |

**The hard part:** Confluence macros. An `{include}` or `{excerpt-include}` macro means the rendered
page contains text that is not in this page's storage format. Options are to expand macros (evidence
spans then reference text that does not exist at the cited location) or not to expand them (the
question may be generated from incomplete content). The template mandates **not expanding**, marking
pages with transclusion macros as `PARTIAL_EXTRACTION` and excluding the macro regions from
assessable sections, because a citation that cannot be re-located breaks X2 and therefore breaks
evidence verification.

### 7.2 `SERVICENOW`

| Contract element | Mapping |
| --- | --- |
| Container | Knowledge base |
| Folder hierarchy | Category tree |
| Document | `kb_knowledge` article |
| `sourceVersion` | `sys_mod_count` + `sys_updated_on` |
| Incremental sync | Table API filtered on `sys_updated_on` |
| Permission check | User criteria evaluation |
| Extraction | Article HTML → sanitized sections |

**The hard part:** article versioning and retirement. ServiceNow keeps `published`, `draft`, and
`retired` versions with distinct `sys_id`s. The template requires indexing only `published` articles
and treating a retirement as `ITEM_DELETED`, which flags dependent questions
`SOURCE_DELETED` — deliberately the same path as a deleted SharePoint document, so no new lifecycle
state is introduced.

### 7.3 `SQL_DATABASE`

| Contract element | Mapping |
| --- | --- |
| Container | Configured query set |
| Document | One row, or a grouped set of rows, per a configured key |
| `sourceVersion` | A configured version or timestamp column |
| Incremental sync | Watermark column |
| Permission check | `UNKNOWN`, `enforcement: 'PLATFORM'` |
| Extraction | A configured row-to-text template |

**The hard part:** there is no natural document, so there is no natural section, and coverage becomes
meaningless. The template requires a declared `documentKey` and a declared section strategy
(one section per row, or per grouped column), and it requires read-only credentials with a query
allow-list — no free-form SQL from configuration, ever, since that would be an injection surface
administered through a UI.

### 7.4 `REST_API`

| Contract element | Mapping |
| --- | --- |
| Container | Configured endpoint group |
| Document | One resource, addressed by a configured ID path |
| `sourceVersion` | Response `ETag`, or a configured version field |
| Incremental sync | Configured `since` parameter, else full |
| Permission check | `UNKNOWN` unless the API exposes an access check |
| Extraction | JSONPath field selection → text, in configured order |

**The hard part:** pagination and rate limits vary per API, so the template requires a declared
pagination strategy (cursor, page number, or link header) and a declared rate-limit policy, both
validated by Test Connection rather than discovered in production.

### 7.5 `AZURE_BLOB`

| Contract element | Mapping |
| --- | --- |
| Container | Blob container |
| Folder hierarchy | Prefix segments |
| Document | Blob |
| `sourceVersion` | Blob `ETag` + version ID |
| Incremental sync | Change feed, else prefix listing by `lastModified` |
| Permission check | `UNKNOWN`, `enforcement: 'PLATFORM'` (blob ACLs are not per-user) |
| Extraction | Same extractor registry as SharePoint |

**The hard part:** blob storage has no per-user permission model, so `DELEGATED_OBO` must be rejected
at configuration time (`supportsDelegatedAccess: false`) and every blob source is platform-trimmed
with that stated in the UI. Silently accepting a delegated configuration would misrepresent who is
enforcing access.

### 7.6 `FILE_REPOSITORY`

| Contract element | Mapping |
| --- | --- |
| Container | Mounted share or root |
| Folder hierarchy | Directories |
| Document | File |
| `sourceVersion` | `mtime` + size (no native version) |
| Incremental sync | `mtime` scan (`supportsIncrementalSync: false` where the mount is slow) |
| Permission check | `UNKNOWN` or a share-level check |
| Extraction | Same extractor registry |

**The hard part:** `mtime` is unreliable (touch, copy, restore), so `supportsVersionLabels: false` and
change detection relies on `contentHash` alone. The template requires declaring that, so preflight can
report `CONTENT_CHANGED_UNVERSIONED` honestly instead of implying a version signal exists.

### 7.7 What every template must supply

| # | Requirement |
| --- | --- |
| P1 | Honest `AdapterCapabilities`. Emulating a capability is a contract violation |
| P2 | An extractor producing offsets satisfying X2, or a declared `supportedDocumentTypes` that excludes what it cannot handle |
| P3 | A Test Connection implementation mapping onto the nine checks, returning `NOT_RUN` for checks that do not apply — never `PASS` |
| P4 | Error mapping to Knowzy codes, with no provider body escaping |
| P5 | A fixture set and a passing conformance suite (§8) |
| P6 | A documented permission-mode position, and rejection at configuration time of modes it cannot honour |
| P7 | A throttling and retry policy declared to the resilience wrapper |
| P8 | No new lifecycle state, no new question field, no change to any domain service. If a source cannot be integrated without one, that is a finding to escalate — not a local workaround |

---

## 8. Adapter conformance suite

One executable suite, run against every registered adapter with its own fixtures. This is the test
that makes G8 verifiable instead of aspirational: *if the suite passes for a new adapter, generation,
review, approval, publishing, assessment, scoring, and reporting work unchanged.*

| Group | Assertions |
| --- | --- |
| Capability honesty | Every declared capability is exercised and observed; every `false` capability's degraded path produces the documented result (`UNKNOWN`, not `ALLOWED`; full sync, not silent incremental) |
| Navigation | Containers listed; folder traversal; pagination completes with a stable total; `..` and absolute paths rejected; an empty folder returns an empty page, not an error |
| Determinism | Two runs over identical fixtures produce identical `sourceDocumentId`, `contentHash`, section keys, and offsets |
| Extraction invariants | X1–X8 asserted per supported type, including the round-trip `text.slice(start,end) === section.text` and full non-overlapping coverage |
| Unsupported handling | Image-only PDF → `EMPTY`; encrypted/macro binary → `UNSUPPORTED`; oversize → `TOO_LARGE` **before** full download; each with no text returned |
| Truncation | Over-cap document sets `truncated: true` and ends at a section boundary |
| Change detection | v1 → v2 fixture switch yields `ITEM_MODIFIED` with a changed hash; a metadata-only change yields a changed `sourceVersion` with an **unchanged** hash (the platform must see `METADATA_ONLY_CHANGE`); a removed file yields `ITEM_DELETED` |
| Section lineage | Moving a section preserves coverage via hash match; renaming a heading yields `MODIFIED` via similarity; a deleted section yields `REMOVED` ([generation-governance.md §6.6](generation-governance.md#66-section-lineage-across-document-versions)) |
| Permission | A `DENIED` document is excluded from listing, search, extraction, and refresher candidates, each with a stated reason; `UNKNOWN` never behaves as `ALLOWED` |
| Resilience | Injected 429 honours `Retry-After`; injected timeout returns `REQUEST_TIMEOUT`, not a partial document; repeated failures open the circuit; an invalid sync checkpoint falls back to full and completes |
| Failure isolation | One failing document in a ten-document extraction leaves the other nine `OK` with a per-item outcome |
| Leakage | No adapter output or log line contains a token, secret, credential shape, or raw provider body |
| Bank (bank adapters only) | `operationKey` reuse creates one item; stale `ifMatch` returns a conditional failure; retire sets inactive without deleting; **no delete method exists** |
| End-to-end | The full pipeline runs against the adapter's fixtures and produces an approved, published, assessable, scoreable question with a verified evidence span and a grounded refresher |

Suite rules:

1. The suite is the **contract**. A behaviour asserted here is normative; a behaviour absent here is
   not guaranteed to any consumer.
2. It runs in CI for the mock adapter on every commit, and for the SharePoint adapter against
   recorded Graph fixtures — so it needs no tenant credentials and cannot be skipped for lack of them.
3. A live-tenant smoke run against the SharePoint adapter is a separate, optional job, gated on
   credentials being present, and its absence never turns the suite green by default.
4. Adding an assertion to the suite is a contract change, reviewed as such and recorded in
   [risks-and-decisions.md](risks-and-decisions.md).
