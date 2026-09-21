# Transitional Knowledge Source — Implementation

**Status:** Implementation design. Planning artifact only — no code changed.
**Assessed at:** commit `c7468b5`
**Strategy and rationale:** [TRANSITIONAL_KNOWLEDGE_SOURCE_PLAN.md](TRANSITIONAL_KNOWLEDGE_SOURCE_PLAN.md).
This document is the *how*: module layout, interfaces, algorithms, and the test plan.
**Out of scope by instruction:** Entra, Microsoft Graph, `Sites.Selected`, SharePoint Graph adapters.

---

## 1. Step 1 — Review, and four findings that change the design

Reviewing the four pipelines produced two corrections to the strategy document and two facts that make
the work cheaper than it looked. These are the substance of the review, so they come first.

### 1.1 Correction — extractors never compute offsets. X2 is free.

The previous plan said *"X2 is the hard part, not the parsing … producing offsets that let a stored
evidence span be found again is the requirement."* **That is wrong, and wrong in the direction that
matters.**

`packages/content-extraction/src/structure.ts` splits the work so that this cannot be a problem:

> Extractors produce BLOCKS; the sectionizer renders the normalized text and its section offsets
> together. Splitting it this way is what makes X2 true by construction: the sectionizer owns the
> final string, so an offset can never disagree with it.
>
> **An extractor therefore never computes an offset and never sees the final text.** It answers one
> question: what are the headings and paragraphs?

So a new extractor's entire contract is:

```ts
type ExtractorFn = (raw: <bytes or text>) => StructuredDocument
// StructuredDocument = { documentType, blocks: Block[], hasHeadingStructure }
// Block = { kind: 'heading', level, text } | { kind: 'text', text, pageNumber?, slideNumber?, sheetName? }
```

A PDF extractor emits headings and paragraphs with page numbers. That is all. Offsets, section keys,
hashes, assessability, truncation and labels are the sectionizer's, already written and already
tested. **This is materially less work and less risk than the strategy document implied.**

### 1.2 Correction — `supportsPermissionCheck: false` makes the adapter unable to serve any document

The strategy document specified `supportsPermissionCheck: false`, on honesty grounds. Read against the
code, that declaration produces an adapter that **can never extract anything**.

The chain:

| Step | Code | Effect |
| --- | --- | --- |
| The contract's rule | `contract.ts`: *"false → `getEffectiveAccess` returns `UNKNOWN`, never `ALLOWED`"* | Every document is `UNKNOWN` |
| Extraction | `mock-knowledge-source.ts`: `if (access.decision !== 'ALLOWED') throw` — *"Extraction is refused on a non-ALLOWED decision, **including UNKNOWN**. Content is the thing worth protecting, so the cautious direction is the default"* | Every extraction throws |
| Synchronization | `.filter((d) => accessFor(ctx, d).decision === 'ALLOWED')` | Every sync discovers **zero** documents |

That safety posture is correct and should not be weakened. Its consequence is precise: **the contract
forbids a source that cannot answer a per-document access question from serving content at all.**

**Resolution — use `enforcement`, which is the field built for exactly this.** `AccessDecision`
carries `decision` *and* `enforcement: 'SOURCE' | 'PLATFORM' | 'NONE'`, and architecture.md §8.3
already uses `'PLATFORM'` for app-only mode so *"the UI can say so"*.

So the honest declaration is:

- `supportsPermissionCheck: **true**` — *"I can return a decision per document."* True: from the
  operator-declared sidecar (§2.5), which is a real source of truth, just not SharePoint's.
- `enforcement: 'PLATFORM'` on every decision — *"but I am not the source; the platform and the
  operator decided."*
- `supportsDelegatedAccess: **false**` — *"I cannot trim per user."* This is the capability that
  actually encodes the loss, and it stays `false`.

That is not emulating a capability. The capability is "can you answer"; `enforcement` answers "on
whose authority". P1 is satisfied because nothing claims SharePoint enforced anything.

**The alternative, for the record:** keep `supportsPermissionCheck: false` and change the
extraction-refusal rule to permit `UNKNOWN` when `enforcement === 'PLATFORM'`. That is a change to a
safety default in shared behaviour and should be escalated rather than made locally. **Recommendation:
do not.** The `enforcement` route needs no change to any existing rule.

### 1.3 Finding — search reads files as UTF-8 too, not only extraction

`mock-knowledge-source.ts` line 408: `readFixtureContent(document).toLowerCase()` for
`searchDocuments`, and again for the snippet. `readFixtureContent` is
`readFileSync(path, 'utf8')`.

So binary support is **three** call sites, not one: extraction, search matching, and snippet
generation. A PDF read as UTF-8 and lowercased yields mojibake that would produce nonsense matches and
a snippet of binary garbage in the UI. The file-repository adapter must search **extracted text**, not
raw bytes.

### 1.4 Finding — section keys survive the migration by construction

`sectionize.ts`: `sectionKey` is *"sha256(heading path + ordinal within parent)"*, explicitly
*"stable across re-extraction"*. It is derived from **content**, not from the source or its path.

Because the adapter only supplies bytes and the extraction pipeline is source-agnostic, the same
document yields the same blocks, the same sections and the **same `sectionKey`** whether the bytes
arrived from a local mirror or from Graph.

**Consequence:** every evidence span, and every published question's `sourceSectionKey`, re-locates
after the migration without a data fix. That is a stronger guarantee than the strategy document
claimed, and it rests on one condition — §7.2.

### 1.5 What the review confirmed is already sound

| Pipeline | Finding |
| --- | --- |
| **Adapter contract** | Written for the general case. `AdapterContext` carries no database handle, so an adapter cannot corrupt platform state. `writeCapable: false` is a literal type. Nothing about it is SharePoint-specific |
| **Extraction** | X1–X6 invariants are **parameterized by document** in `extraction-invariants.test.ts` (`round-trips every section (${label})`). A new extractor added to that parameter set inherits every invariant test — round-trip offsets, per-section hashing, ordering, non-overlap, distinct keys, honest labels, no-invented-headings, and the five failure statuses |
| **Generation** | Consumes `FramedSection { sectionKey, label, text }` — format-agnostic. A PDF-derived section is indistinguishable from a Markdown-derived one, which is why real content needs no generation changes |
| **Evidence verification** | Operates on section text and offsets, both produced by the sectionizer. `EXTRACTION_STATUS` already includes `QUARANTINED`, which is the correct terminal state for a file that fails an upload safety check |

**Conclusion for Step 1.** The platform can ingest real enterprise documents with no Graph permission
by supplying bytes from a local directory and registering binary extractors. Nothing in the domain,
the generation pipeline or the evidence pipeline needs to change — rule P8 holds — and the work is
two extractors, one adapter, one signature change and a URL mapping.

---

## 2. File repository adapter design

### 2.1 Module layout

```
packages/knowledge-source-adapters/src/
├── contract.ts                     unchanged
├── tree/                           NEW — extracted from mock/fixture-tree.ts
│   ├── directory-tree.ts           scan, normalize, stable ids, sidecar parsing
│   └── sidecar.ts                  the {file}.meta.json schema
├── mock/
│   ├── fixture-tree.ts             now a thin wrapper over tree/ (local only)
│   └── mock-knowledge-source.ts    unchanged behaviour
└── file-repository/                NEW
    ├── file-repository-source.ts   the adapter
    ├── capabilities.ts             the declaration in §2.3
    ├── web-url.ts                  local path → SharePoint URL (§4)
    └── connection.ts               zod schema for KnowledgeSource.connection
```

**The adapter must be distinct from the mock, not the mock re-pointed.**
`packages/configuration/src/startup.ts` fails check `MOCK_ISOLATION` outside `local` when
`mockAdaptersRegistered()` is true — *"a mock adapter or mock question bank is registered outside
local"*. Re-pointing the mock would make every deployed environment fail startup, and that check is
right. Share the tree reader; keep the identities separate.

### 2.2 Connection schema

Validated with zod at configuration time, so a bad source fails when it is saved rather than when it
is synchronized.

| Field | Required | Purpose |
| --- | --- | --- |
| `rootPath` | yes | Absolute path to the mirror or drop directory |
| `provenance` | yes | `SHAREPOINT_MIRROR` \| `ONEDRIVE_MIRROR` \| `MANAGED_UPLOAD` — drives §4 and the UI statement |
| `webUrlBase` | **yes** when provenance is a mirror | e.g. `https://{tenant}.sharepoint.com/sites/{site}/{library}` |
| `mirrorAccountUpn` | **yes** when provenance is a mirror | Whose access defines the corpus (§5.2). Recorded, displayed, audited |
| `mirrorCapturedAt` | optional | When the sidecar metadata was captured |

`rootPath` **must** be validated against a declared, configured allow-list root — never accepted as an
arbitrary operator string, or a source definition becomes a filesystem-read primitive. See §5.4.

### 2.3 Capability declaration

| Capability | Value | Basis |
| --- | --- | --- |
| `supportsContainers` | `true` | Top-level directories under the root |
| `supportsFolderHierarchy` | `true` | Real directories |
| `supportsLiveSearch` | `false` | Indexed only; the UI already labels this |
| `supportsFullTextSearch` | `true` | Over **extracted text** (§1.3) |
| `supportsIncrementalSync` | `true` | `mtime` + size + hash scan |
| `supportsPermissionCheck` | **`true`** | Per §1.2 — a decision is returned, with `enforcement: 'PLATFORM'` |
| `supportsDelegatedAccess` | **`false`** | **The capability that carries the loss.** `DELEGATED_OBO` rejected at configuration time (P6) |
| `supportsVersionLabels` | **`false`** | `mtime` is unreliable — touch, copy, restore. Hash decides; preflight reports `CONTENT_CHANGED_UNVERSIONED` |
| `supportedDocumentTypes` | Exactly the registered extractors, computed not hardcoded | Declaring PDF before its extractor exists is the P1 violation to avoid |
| `writeCapable` | `false` | Literal type |

### 2.4 Method behaviour

| Method | Implementation |
| --- | --- |
| `listContainers` | Top-level directories under `rootPath` |
| `listItems` | Directory walk, honouring `folderPath` and `recursive`; paged with an opaque cursor; sidecar files (`*.meta.json`) and sync-client artifacts excluded (§3.3) |
| `getDocument` | Stat plus sidecar; `webUrl` from §4 |
| `getEffectiveAccess` | Sidecar `access` map if present, else the source default; **always** `enforcement: 'PLATFORM'` with a `summary` naming the basis and the mirror account |
| `extractContent` | Refuse on non-`ALLOWED` exactly as the mock does; size cap **before** read; stream bytes to the extractor; never persist or return bytes |
| `searchDocuments` | Match against **extracted text** from the document record — never raw bytes (§1.3). If a document is not yet extracted, it is not a search candidate, and that is reported rather than silently omitted |
| `synchronize` | §3.4 |
| `testConnection` | Nine checks, `NOT_RUN` where inapplicable, never `PASS` for a check not performed (P3) |

### 2.5 The sidecar

Reuse the mock's `{file}.meta.json` shape unchanged — `sourceVersion`, `sourceCreatedAt`,
`sourceModifiedAt`, `mimeType`, `metadata` (SharePoint column values), `access`
(`default` plus per-principal overrides, and a `summary`).

The sync client brings **bytes, not columns**, so the sidecar is how discovery output
([SHAREPOINT_DISCOVERY_PLAN.md](SHAREPOINT_DISCOVERY_PLAN.md) Phase D) reaches the platform. Two
honest limits, both to be stated in the UI rather than discovered: sidecars are hand-maintained and go
stale silently, and where none exists the adapter must fall back to filesystem facts and **declare the
metadata absent** — never synthesize a version label.

### 2.6 Test Connection — the nine checks

The nine have never been enumerated in one place, which
[integration-plan-sharepoint.md](../project/integration-plan-sharepoint.md) §5.1 flagged. Proposed
canonical set, with this adapter's outcomes:

| # | Check | File repository |
| --- | --- | --- |
| 1 | Credential resolves | `NOT_RUN` — none needed |
| 2 | Source reachable | Root exists and is readable |
| 3 | Container resolves | Configured containers exist |
| 4 | Configured paths resolve | Each `folderPath` exists and matches ≥1 document |
| 5 | Document types supported | Count matched documents **with a registered extractor**, and name those without |
| 6 | Permission check available | `PASS`, stated as platform-enforced |
| 7 | Delegated access available | `NOT_RUN` — declared unsupported |
| 8 | Change detection available | `PASS`, stated as hash-based with no version label |
| 9 | Write capability absent | `PASS` — asserts read-only |

Check 5 is the useful one in practice: it reports *"140 of 200 matched documents have no registered
extractor"* at configuration time, before anyone waits for a sync to discover it.

---

## 3. OneDrive synchronization model

### 3.1 What is actually happening

```
SharePoint library ──► OneDrive sync client ──► local directory ──► FILE_REPOSITORY adapter
   (Microsoft)          (user's credentials)      (bytes on disk)      (Knowzy reads)
```

No app registration, no consent, no Graph call. Microsoft's client does the transport using the
signed-in user's existing SharePoint permissions. Knowzy reads a directory.

### 3.2 Files On-Demand is the first operational trap

By default the sync client creates **placeholders**: the file appears in the directory listing with its
real size, and the bytes are not local until something opens it. A server-side reader hitting a
placeholder either blocks on a network fetch or fails, depending on platform and policy.

**Required:** the mirrored folders must be pinned as *Always keep on this device*. Test Connection
check 2 should detect placeholder-only content and fail with that instruction, because the symptom
otherwise is an intermittent, slow, partially-successful sync that looks like a platform defect.

### 3.3 Artifacts to exclude

The mirror is not a clean corpus. Exclude, by name pattern:

- `~$*` Office lock files, and `*.tmp`
- `.DS_Store`, `Thumbs.db`, `desktop.ini`
- `*.meta.json` — sidecars, which are inputs not documents
- Anything matching `excludedFileTypes`

`desktop.ini` deserves a note: the sync client writes it into synced folders, and it is a `.ini` text
file that would otherwise be ingested as a document. It would extract successfully and produce a
nonsense section, which is worse than failing.

### 3.4 Change detection

The adapter owns its opaque sync state, exactly as the mock does — *"a map of id → sourceVersion from
the last run. The platform persists it verbatim and replays it."*

For a file repository the comparison is **size, then `mtime`, then hash**:

| Observation | Action |
| --- | --- |
| Size changed | Candidate → hash → `ITEM_MODIFIED` if the hash moved |
| Size same, `mtime` moved | **Candidate only.** Hash decides |
| Hash unchanged | No event. Not modified |
| Absent from the scan | `ITEM_DELETED` — but see §3.5 |

`mtime` moves on touch, copy, restore and re-sync, so treating it as a content change would trigger
mass re-extraction and regeneration candidacy. This is the same discipline the SharePoint plan requires
for eTag: **the hash decides.** It is worth noting that the trap is identical in both adapters, so
solving it here is direct preparation for Phase 7.

### 3.5 Partial-sync safety — the most dangerous failure mode

A paused, throttled or mid-run sync client presents a **partially populated directory**. A naive scan
reads that as mass deletion, and `ITEM_DELETED` events would retire documents that exist.

**Required guard:** if a scan finds a document count below a configured fraction of the previous run,
abort the run with a stated reason and emit **no** delete events. A sync that refuses is recoverable; a
sync that retires half the corpus is a cleanup job.

Recommendation: also require the mirror root to carry a marker file the operator creates, so an
unmounted or renamed drive presents as "root not found" rather than as an empty directory.

---

## 4. SharePoint mirror strategy and traceability

### 4.1 The requirement

`KnowledgeDocument.sourceUrl` is **non-nullable**, and `BankItemWrite.sourceUrl` carries it into the
published bank record — which is authoritative for published content and long-lived. The mock emits
`webUrl: mock://{relativePath}`, honest for a mock.

A local path must never appear there. It breaks traceability for every future reader, and it writes a
username and machine layout into a SharePoint list nobody is going to rewrite.

### 4.2 The mapping

```
rootPath        = D:\Mirror\Support Operations
webUrlBase      = https://contoso.sharepoint.com/sites/support-ops/Shared%20Documents
relative path   = SOPs\Billing\refunds-and-chargebacks.md
                                │
sourceUrl = webUrlBase + '/' + percent-encoded, forward-slashed relative path
          = https://contoso.sharepoint.com/sites/support-ops/Shared%20Documents/SOPs/Billing/refunds-and-chargebacks.md
```

Rules: forward-slash separators always, so ids and URLs match on Windows — the tree reader already
normalizes this way; percent-encode each segment; never emit a `file://` URL or a drive letter; for
`MANAGED_UPLOAD`, emit an explicit non-resolving scheme as the mock does, visibly provisional.

### 4.3 The test that must exist

**A build-failing assertion that no emitted `sourceUrl` or `webUrl` matches a local-path shape** — a
drive letter, a UNC prefix, a `file://` scheme, or a leading `/` filesystem path. Assert it over every
adapter method that emits one, not just `getDocument`.

This repository has learned that a universal claim needs a mechanical check: three "passing" mechanisms
in it were vacuous, and the design-asset and fabricated-metric gates both caught real problems that
prose did not. This is the same shape of rule and deserves the same treatment.

### 4.4 The traceability chain, end to end

Already built and already displayed (UI-M3's `TraceabilityChain`). On this path each stage is backed
as follows:

| Stage | Backed by | Real? |
| --- | --- | --- |
| **Knowledge** | `sourceUrl` (§4.2), `sourceDocumentId`, `sourceSectionKey`, `contentHash` | **Yes** |
| — version at generation | `sourceVersion` from the sidecar, else absent | **Declared absent** where there is none. Never synthesized |
| **Evidence** | Verbatim span, character offsets, verification mode, similarity | **Yes** — unchanged, and format-independent |
| **Review** | Reviews with outcome, version, timestamp | **Yes** |
| **Approval** | Approval decision, version, timestamp, gate 13 | **Yes** |
| **Publication** | Bank id, published version | **Yes** |

Only one link is weaker than with Graph: the source *version label*. Everything else is identical,
because the content hash and the section key are content-derived.

---

## 5. Security limitations

### 5.1 Trimming is platform-enforced, and the platform must say so

`enforcement: 'PLATFORM'` with `supportsDelegatedAccess: false`. Visibility is decided by Knowzy's
layers — role, domain, team, business function, `UserSourceAccess` — not by SharePoint. The existing
rule now carries the whole weight:

> A document discovered by a background job is not automatically visible to a user. Visibility is
> re-evaluated against the user at read time.

**Configure `restrictions` and `UserSourceAccess` before the first synchronization, not after.** They
are no longer a convenience; they are the only access control over this content.

Prefer libraries with **uniform inherited permissions**. A library with item-level restrictions is
exactly the case delegated trimming handles correctly and platform trimming approximates.

### 5.2 The corpus boundary is a person

A mirror contains exactly what `mirrorAccountUpn` can see. That boundary is an individual, which is not
a governance boundary and cannot be audited from the data — which is why §2.2 makes it a **required**
connection field: recorded, displayed on the source screen, and in the audit trail.

Use a **named, documented account** provisioned for the purpose, not whichever workstation had the
library synced already. This is the one decision that cannot be recovered after the fact.

### 5.3 Untrusted input (managed upload only)

If the upload control is built — recommended deferred — uploaded bytes are untrusted. Controls:
extension and content-sniff agreement; size cap applied before the file is fully read; decompression
bounds on the OOXML ZIP container formats, including entry-path traversal inside the archive; reject
archives, executables and macro-enabled formats; filename sanitization with the stored name never used
as a path; store outside any web root and never serve original bytes; a declared route policy requiring
an authoring permission; every upload audited with uploader, name, size and hash.

`EXTRACTION_STATUS` already declares **`QUARANTINED`**, which is the correct terminal state for a file
that fails these checks — better than `FAILED`, because it distinguishes "we refused this" from "we
could not parse it".

### 5.4 Path handling

`rootPath` must resolve within a configured allow-list root. Every resolved document path must be
re-checked to be inside it after normalization, so a symlink or a `..` segment in the mirror cannot
escape. Without that, a source definition is a filesystem-read primitive available to anyone who can
create a source.

### 5.5 First genuinely untrusted content

Framing is unchanged and sound — nonce-delimited per call, delimiter-like text stripped,
`GENERATION_TOOL_GRANT = []`. But real corporate documents are the **first untrusted content the
platform has processed**; every fixture so far was written in-house.

**Recommendation:** include a document containing instruction-shaped text in the first real corpus and
confirm the framing holds. The controls exist; this is the first chance to watch them work on text
nobody on the team wrote.

### 5.6 Mount identity

The sync client holds the user's credentials, so the mount is a user-context artifact. A service
reading a developer's synced folder is reading through that developer's identity. Anywhere but a
workstation, the mount belongs to a service-operated account — which is the same decision as §5.2.

---

## 6. Governance implications

### 6.1 What is unchanged, and why that is the point

Preflight's six checks, the 13 approval gates, separation of duties, evidence verification, duplicate
detection, confidence, idempotent publishing, and audit all operate on platform records that are
source-agnostic. **No new lifecycle state, no new question field, no change to any domain service** —
rule P8 holds, which is the main evidence this is an adapter rather than a parallel ingestion path.

### 6.2 What changes, and is declared

| Governance property | Effect | Declared by |
| --- | --- | --- |
| Per-user permission trimming | Platform-enforced | `supportsDelegatedAccess: false`, `enforcement: 'PLATFORM'` |
| Source version at generation | Absent unless a sidecar supplies it | `supportsVersionLabels: false`, and preflight's `CONTENT_CHANGED_UNVERSIONED` |
| SharePoint column metadata | Hand-captured, staleness-prone | Sidecar capture date |
| Corpus completeness | One account's view | `mirrorAccountUpn` |

### 6.3 Preflight check 3 becomes more honest, not less

`SOURCE_CONTENT_CHANGED` is a **dual** test — `versionChanged` and `hashChanged`, both nullable in the
domain type. On this path `versionChanged` is `null` where no sidecar version exists, and `hashChanged`
carries the signal. The UI already renders each check's own sentence and the facts behind it, so an
author sees *"content changed; no version label available"* rather than a bare badge. The type system
anticipated this case; no change is needed.

### 6.4 Published questions are real assets

Questions generated on this path are approved by a human under gate 13 and published to the bank as
reusable assets with real provenance. **This is not a sandbox.** Two consequences to accept
deliberately: the taxonomy and **immutable domain codes** must be settled before the first
publication, because a domain code appears in every QuestionID and cannot be changed afterwards; and
the mock question bank's JSON file survives a database teardown, so a publication demo and a real
publication should not share a fixture root.

### 6.5 Record it as transitional

The most likely long-term failure is not that this path breaks — it is that it works well enough that
Graph integration is never finished, and platform-trimmed access to real content becomes permanent.
The capability flags are the guard because they keep the loss visible on screen. Record the milestone
in the project history as transitional, with its migration trigger.

---

## 7. Migration path to Graph

### 7.1 What migrates, and what decides it

| Asset | Survives |
| --- | --- |
| Binary extractors | **Entirely.** Format work, not source work — Phase 7 needs exactly these |
| The extraction measurement | **Entirely.** A property of the corpus |
| Section keys, evidence spans, content hashes | **Entirely**, by construction (§1.4) |
| Published questions | **Entirely, if §4.2 is implemented** |
| Taxonomy and domain codes | **Entirely** |
| Claude quality evidence | **Entirely.** Judged on real content |
| The conformance suite | **Entirely.** The SharePoint adapter is handed the same function |

### 7.2 The one condition

Section keys are content-derived, so they survive **provided the same bytes reach the same
extractor**. The mirror is a byte-for-byte copy, so this holds — with one exception worth naming:
**SharePoint Pages**. A Page has no file in a synced library; it is Graph canvas content. So Pages are
out of scope here, will first extract under Phase 7, and have no keys to preserve. That is a clean
boundary rather than a migration problem.

### 7.3 Sequence when R3–R5 land

1. Implement the Graph client, then the SharePoint adapter.
2. Register it. Both coexist — `sourceType` is per source.
3. **Re-point the source; do not re-create it.** `KnowledgeSourcePath` rows already carry the folder
   paths; Test Connection resolves and stores site and drive IDs.
4. **Map `sourceDocumentId`.** The one migration-critical detail: local relative path → Graph item id.
   §4.2's deterministic path→URL mapping is what makes it derivable rather than guesswork — and it is
   the reason to implement §4.2 even though a local path would "work" for a demo.
5. Re-synchronize fully. Hashes re-derive; unchanged documents produce no events.
6. Capabilities become honest **upward**: `supportsDelegatedAccess` and `supportsVersionLabels` become
   `true`, `DELEGATED_OBO` becomes available, `enforcement` becomes `'SOURCE'`. **Nothing in the
   domain changes**, because the flags were truthful all along.
7. Retire the file-repository source, or keep it for genuinely non-SharePoint content.

Plan a **re-synchronization, not an in-place conversion**: it is cheap, re-derives every hash, and
tests the new adapter against content whose extraction is already known good — a far better first
test than an unknown library.

### 7.4 Entra is independent

Unaffected by all of the above. This path runs on the local stub issuer, which means `local` only —
and that is correct, because a deployed environment serving platform-trimmed real content with no
authentication should be impossible. It already is: `createEntraResolver()` throws.
**Entra before any deployment.** This path does not change that.

---

## 8. Step 3 — Recommended next milestone

### PILOT-T1 — Real documents through real extractors

Priority order as instructed: real ingestion, then evidence extraction, then generation quality —
ahead of Entra, Graph, badges, certificates and reporting.

| # | Step | Depends on | Done when |
| --- | --- | --- | --- |
| 1 | Binary-capable `ExtractInput`; **PDF** and **DOCX** extractors emitting `Block[]` with page numbers | Nothing | Both added to the **parameterized** invariant suite, inheriting X1–X6 |
| 2 | Extract `tree/` from `mock/fixture-tree.ts`; mock behaviour unchanged | Nothing | Mock conformance still passes unchanged |
| 3 | `FILE_REPOSITORY` adapter — distinct from the mock, capabilities per §2.3, nine checks with `NOT_RUN`, `DELEGATED_OBO` rejected at configuration time, search over extracted text | 1, 2 | Conformance suite passes **unrelaxed** |
| 4 | `webUrlBase` mapping **plus the local-path assertion** (§4.3) | 3 | Test fails on a planted local path |
| 5 | Sidecars; partial-sync guard (§3.5); artifact exclusions (§3.3); `RELEASE_1_SOURCE_TYPES` widened plus `npm run codegen` | 3 | Guard proven by a planted partial scan |
| 6 | Discovery Phases A–B on one library; **report the format distribution and `EXTRACTION_EMPTY` rate** | Business | Reported to the business |
| 7 | Mirror one library; `restrictions` and `UserSourceAccess` configured **first**; synchronize; generate; review; approve; publish | 4, 5, 6 | A published question whose `sourceUrl` opens the real document |
| 8 | Blind Claude quality comparison against the deterministic generator on real content | 7, T-29 | SME judgement recorded |

**Steps 1–5 are gated on nobody** — no tenant admin, no legal approval, no business decision.

**Explicitly not in PILOT-T1:** the upload UI (§5.3 — defer), PPTX and XLSX extractors (decide from
step 6's measurement — and first ask whether slide and spreadsheet content states testable rules at
all), `SHAREPOINT_PAGE` (§7.2), and anything touching Entra, Graph or `Sites.Selected`.

### 8.1 Two decisions needed before step 1

1. **Whose account defines the corpus** (§5.2). Governance, unrecoverable later, and the thing most
   likely to be settled by accident.
2. **Which library**, from the discovery criteria — content that states testable rules, with a named
   owner. The most likely way this pilot disappoints is a well-integrated source whose content states
   nothing worth testing.

### 8.2 Why this ordering

Against **waiting for Graph**: the extractor work is on the Phase 7 critical path regardless, and
waiting produces nothing.

Against **the Claude spike first**: it needs real documents to mean anything, and it is gated on T-29,
so it may not start. Steps 1–5 are gated on nobody.

Against **the upload UI first**: weakest provenance, most security work, worst documents.

### 8.3 Definition of done

Steps 1–5 merged with the conformance suite passing unrelaxed and the local-path assertion in the
build; step 6's measurement reported; step 7 end to end with a published question whose `sourceUrl`
opens the real SharePoint document; and the corpus boundary recorded on the source.

**Not** done when documents appear in the browser. The three things that make this path defensible
rather than expedient — the honest capability declaration, the real `sourceUrl`, and the partial-sync
guard — are all invisible in a demo.
