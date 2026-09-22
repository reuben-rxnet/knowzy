# KNOWZY Real-World Pilot Corpus Manifest

**This file is the authoritative pilot-corpus register.** It is updated in the same commit as every
real pilot-corpus change.

> **Real-corpus status: `EXECUTED`.** 2026-09-22.
>
> The approved pilot corpus is synchronized locally and has been processed end to end: **28 real
> SOP documents**, **122,106 characters extracted**, **234 sections**, questions generated, reviewed,
> approved by a second identity, published to the Question Bank, an assessment pinned, and a learner
> attempt scored. No fixture content took part; §4 is entirely real-corpus measurement.
>
> Nothing here read a SharePoint or OneDrive **web URL**. The documents were read from the local
> synchronized mirror; the SharePoint URL appears only as reconstructed provenance on each record.

---

## 1. Pilot Source

### 1.1 The approved source

| Field                              | Value                                                                                                                                                                       |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Site**                           | Central Rx Operations Support                                                                                                                                               |
| **Library**                        | Shared Documents                                                                                                                                                            |
| **Folder**                         | `Reuben / Projects / Knowzy`                                                                                                                                                |
| **Corpus folder**                  | `SOPs` (documents sit one level deeper, at `SOPs/SOPs/`)                                                                                                                    |
| **Canonical SharePoint URL**       | `https://{tenant}.sharepoint.com/sites/CentralRxOperationsSupport/Shared%20Documents/Reuben/Projects/Knowzy` — held in the source row, not in source code (content rule C2) |
| **Synchronization method**         | OneDrive shortcut, **pinned** (_Always keep on this device_). No Graph call, no app registration, no admin consent                                                          |
| **Named synchronization identity** | The project owner's corporate OneDrive account. **Transitional pilot decision** — §2.4                                                                                      |
| **Local synchronized root**        | Configured, and **machine-specific** — §1.3                                                                                                                                 |
| **Data classification**            | Internal. Operational support SOPs                                                                                                                                          |
| **Business owner**                 | Not yet assigned                                                                                                                                                            |
| **Technical owner**                | Not yet assigned                                                                                                                                                            |
| **Pilot status**                   | **`EXECUTED`** on the real corpus                                                                                                                                           |
| **Last validation date**           | 2026-09-22                                                                                                                                                                  |

The **sharing URL** is deliberately not recorded and never persisted: it carries a sharing token
(`?d=…&csf=1&e=…`) which is credential-shaped and expires, so storing it would leak a secret into
every document record and rot as provenance. `normalizeWebUrlBase()` refuses one at configuration
time.

### 1.2 Local availability, verified

| #   | Check                                       | Result                                                                                                                                                    |
| --- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Approved mirror root exists and is readable | **Yes**                                                                                                                                                   |
| 2   | `SOPs` corpus folder exists                 | **Yes** — documents are nested one level deeper, at `SOPs/SOPs/`                                                                                          |
| 3   | File count                                  | **29** files, 20.2 MB                                                                                                                                     |
| 4   | Placeholders                                | **None.** Zero zero-length files, and both folders carry the OneDrive _pinned_ attribute                                                                  |
| 5   | Local availability proven by reading        | **Yes** — Test Connection read a byte from a 10-document sample; every one had local content                                                              |
| 6   | Supported formats present                   | **Yes** — 27 DOCX, 1 PDF, 1 CSV                                                                                                                           |
| 7   | Unsupported formats                         | **1** — the CSV has no registered extractor and was skipped with that reason                                                                              |
| 8   | Canonical URL maps to relative paths        | **Yes** — every emitted `sourceUrl` is an `https://` SharePoint URL, asserted by a build-failing test that no provenance value matches a local-path shape |
| 9   | Container resolution                        | `SOPs` resolved as the one container, matching the configured path row                                                                                    |

**Two earlier diagnoses were wrong, and both are recorded so the reasoning is auditable.** The corpus
was first reported absent because the OneDrive web breadcrumb
(`Documents / Reuben / Projects / Knowzy / SOPs / SOPs`) showed a _shortcut_, so every path derived
from it was missing on disk. A filename search then found the documents under a **different** synced
library (`RepondeurAI-Sharepoint`), which led to a second wrong conclusion about which site owned
them. The approved root above settles it. The lesson, recorded: **search for a distinctive filename,
not for a folder name a breadcrumb implies.**

### 1.3 Operational configuration — machine-specific, not provenance

> **Restricted section.** Machine-specific operational configuration. Never persisted as authoritative
> provenance, never written to a document record, an audit detail, a citation, a published question or
> a Question Bank item, and never returned in a browser response.

| Field                               | Value                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------- |
| Approved mirror root (host)         | `…/OneDrive - {Org}/Shortcuts/Central Rx Operations Support - Knowzy`     |
| In-container path                   | `/corpus` — the host root is bind-mounted **read-only**                   |
| `PILOT_MIRROR_ROOT`                 | `/corpus` (compose default; always valid because the mount always exists) |
| `PILOT_CORPUS_HOST_PATH`            | The host root above. Supplied from the environment, **never committed**   |
| Fallback with no host configuration | `./fixtures/pilot-mirror`, the committed fixture                          |

The mount is **read-only by design**, not by convenience: a knowledge source is read-only to the
platform by contract (`writeCapable: false`), and mounting a customer's synchronized folder writable
would make that a promise rather than a property.

A build-failing test asserts that **no emitted `sourceUrl` or `webUrl` matches a local-path shape** —
drive letter, UNC prefix, `file://`, POSIX home or mount path, or a OneDrive folder name — across
`listItems`, `getDocument`, `searchDocuments` and `synchronize`. The detector itself is
mutation-tested.

### 1.4 Provenance, settled

The documents are in the **Central Rx Operations Support** site library, under
`Shared Documents / Reuben / Projects / Knowzy / SOPs / SOPs`, reached locally through a pinned
OneDrive shortcut. `provenance` is therefore `SHAREPOINT_MIRROR` and `webUrlBase` is that folder's
canonical URL.

Why this needed settling, and why it matters more than it looks: the same 29 filenames also appear
under a second synced library (`RepondeurAI-Sharepoint`), and the OneDrive web breadcrumb showed the
corpus under _personal_ `Documents`. Three plausible owners, one correct answer. **Configuring the
wrong one would not have failed loudly** — synchronization and generation would both have succeeded,
and every published question would simply have carried a provenance link that resolves to nothing.
That is the failure `web-url.ts` exists to prevent, arriving by a route nobody had considered, and it
is why the canonical URL is a required field rather than an optional convenience.

## 2. Corpus Governance

### 2.1 Inclusion criteria

A document enters the corpus when all of these hold:

1. It sits beneath the configured root and the configured corpus subfolder.
2. Its extension has a **registered extractor** — `pdf`, `docx`, `pptx`, `xlsx`, `txt`, `md`, `html`.
3. It is not a sync-client or Office artifact (§2.2).
4. Its bytes are **locally available** — not a Files On-Demand placeholder.
5. Its access decision is `ALLOWED`.
6. **It states testable rules.** The binding criterion in practice, and the one no code can check: a
   narrative, a status deck or a minute states no procedure, threshold or decision rule, and yields an
   honest `insufficientEvidence` refusal rather than a question.

### 2.2 Exclusion criteria

| Excluded                                                             | Why                                                                                                                                                                                                |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `desktop.ini`                                                        | Written by the OneDrive client. **Readable text**, so without an explicit exclusion it extracts _successfully_ into a nonsense section — worse than failing, because nothing draws attention to it |
| `~$*`, `._*`, `*.tmp`, `*.partial`, `*.crdownload`, `*.lnk`, `*.url` | Office lock files, partial downloads and shortcuts                                                                                                                                                 |
| `.DS_Store`, `Thumbs.db`                                             | Platform artifacts                                                                                                                                                                                 |
| `*.meta.json`                                                        | Sidecars are metadata INPUT, not documents                                                                                                                                                         |
| Symbolic links and junctions                                         | Skipped, never followed. A link in a synced folder can point anywhere on the workstation                                                                                                           |
| Anything resolving outside the root                                  | Refused after normalization                                                                                                                                                                        |
| Unsupported formats (`.rtf`, `.doc`, `.xls`, `.ppt`, …)              | No registered extractor. Reported at configuration time by Test Connection check 5, not discovered after a sync                                                                                    |
| Documents declared not accessible by a sidecar                       | Absent from listing and search, and refused for extraction                                                                                                                                         |

### 2.3 Supported formats

| Format              | Extractor         | Notes                                                                                                                                                                                                                      |
| ------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PDF**             | pdf.js, text only | Page numbers preserved. No heading structure claimed (X4). Image-only PDFs report `EMPTY` — **no OCR** (risk R-06). Encrypted PDFs are refused, never guessed at. Two-column layouts are not reconstructed                 |
| **DOCX**            | own OOXML reader  | Real heading structure, tables as prose, multi-run sentences joined without inserting spaces. **Tracked deletions excluded; insertions included.** Comments, headers, footers, hidden text and field instructions excluded |
| **PPTX**            | own OOXML reader  | **Presentation order**, resolved from `presentation.xml`, not filename order. Speaker notes excluded. Slide text is the format least likely to state a complete rule                                                       |
| **XLSX**            | own OOXML reader  | Sheet names carried (they are what make a cell interpretable). Formula _results_ read, not formulas. Number formats not applied — a date serial reads as its stored number                                                 |
| **TXT / MD / HTML** | pre-existing      | Unchanged by this milestone                                                                                                                                                                                                |

**Not supported, deliberately:** `SHAREPOINT_PAGE` (no file exists in a document library — it is Graph
canvas content, roadmap Phase 7), and the legacy binary Office formats `.doc`, `.xls`, `.ppt` (OLE
compound files, an entirely different container sharing no code with OOXML).

### 2.4 Permission assumptions

> **This is a transitional pilot decision and is not equivalent to delegated per-user SharePoint
> permission trimming.**

|                                                                                       |                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The synchronized account defines the visible corpus.**                              | A mirror contains exactly what that person can see. The corpus boundary is therefore **a person**, which is not a governance boundary and cannot be audited from the data — which is why `mirrorAccountUpn` is a **required** field on the source |
| **Enforcement is `PLATFORM`, never `SOURCE`.**                                        | Every access decision says so. Access is governed by the configured corpus boundary, operating-system access to the mirror, and Knowzy's own server-side authorization                                                                            |
| **`supportsDelegatedAccess: false`.**                                                 | `DELEGATED_OBO` is **refused at configuration time**, not approximated                                                                                                                                                                            |
| **`UNKNOWN` never passes.**                                                           | Extraction and synchronization refuse any non-`ALLOWED` decision. The shared refusal rule was not weakened                                                                                                                                        |
| **Production rollout requires the approved Entra, Graph and SharePoint integration.** | See [`TENANT_ADMIN_REQUESTS.md`](../docs/integrations/TENANT_ADMIN_REQUESTS.md)                                                                                                                                                                   |

`restrictions` and `UserSourceAccess` must be configured **before** the first synchronization of a real
corpus. On this path they are not a convenience; they are the only access control over the content.

### 2.5 Synchronization limitations

| Limitation                                                               | Consequence                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No version labels.** `mtime` moves on touch, copy, restore and re-sync | The **content hash decides**, combined with any operator-declared sidecar version. Preflight reports a content change without a version                                                                                                                                                                                                                                           |
| **Files On-Demand placeholders**                                         | A placeholder lists at its real size with no local bytes. Folders must be marked _Always keep on this device_. Test Connection reports placeholder-only content; a read failure reports the OneDrive setting to change. **Placeholder detection is advisory and POSIX-only** — `Stats.blocks` is not populated on Windows, and denying on that heuristic denied the entire corpus |
| **Partial synchronization**                                              | A paused or mid-run client presents a half-populated directory. A run finding fewer than `partialSyncFloor` (default 0.8) of the previous run's documents **aborts and emits no delete events**                                                                                                                                                                                   |
| **No SharePoint column metadata**                                        | The sync client brings bytes, not columns. Columns arrive through hand-maintained `.meta.json` sidecars, which go stale silently                                                                                                                                                                                                                                                  |
| **Indexed search only**                                                  | `supportsLiveSearch: false`. Search runs over already-extracted text, so a document added since the last synchronization is not yet findable                                                                                                                                                                                                                                      |

### 2.6 Privacy requirements

- No customer document enters this repository. Every fixture is built from bytes the repository
  controls by `fixtures/build-pilot-mirror.mjs` and
  `packages/content-extraction/test/fixtures/build-fixtures.mjs`.
- Extracted **text** is persisted in Knowzy's database for indexing and evidence verification. **Raw
  bytes are never persisted and never served.**
- Sidecar `metadata` is an explicit allow-list per path. A column carrying personal data is not
  captured; a column with no stated use is not captured.
- No local path, username or machine name reaches a document record, an audit detail, a citation, a
  published question or a Question Bank item — asserted by a build-failing test.
- Retention (T-36) and the sensitivity exclusions must be confirmed **before** the first real
  synchronization. **Not yet confirmed.**

### 2.7 Retention and cleanup requirements

| Item                                    | Requirement                                                                      | Status                |
| --------------------------------------- | -------------------------------------------------------------------------------- | --------------------- |
| Extracted text                          | Per T-36, to be confirmed                                                        | **Not yet confirmed** |
| The local mirror                        | Operator-managed, outside Knowzy. Removing the shortcut removes the mirror       | n/a                   |
| Sidecars                                | Live beside the documents; carry a capture date so staleness is visible          | Fixture only          |
| Fixture mirror                          | Committed, regenerable, contains no customer content                             | Committed             |
| Draft questions from a retired document | Existing retention rules apply unchanged — this path adds no new lifecycle state | Unchanged             |

### 2.8 Migration path to Microsoft Graph

Full plan: [`TRANSITIONAL_KNOWLEDGE_SOURCE_IMPLEMENTATION.md` §7](../docs/integrations/TRANSITIONAL_KNOWLEDGE_SOURCE_IMPLEMENTATION.md).

What migrates without a data fix: the four binary extractors (they are format work, not source work,
and roadmap Phase 7 needs exactly them), the extraction measurements, the taxonomy, and — critically —
**every section key, evidence span and published question**, because `sectionKey` is
`sha256(heading path + ordinal)` over content and the extraction pipeline is source-agnostic. The same
bytes through the same extractor yield the same keys whether they arrived from a mirror or from Graph.

The one migration-critical mapping is local relative path → Graph item id, which the canonical URL
makes derivable. **That is why the canonical URL is implemented now rather than later**: skip it and
published questions carry a local path and do not migrate at all.

---

## 3. Document Register

> Populated from files that actually exist in the approved synchronized root, by
> `npx tsx scripts/corpus-report.ts <root>` and the platform's own synchronization. Never written by
> hand and never invented. **Relative paths only.**
>
> **Source: the REAL approved pilot corpus.** 28 of 29 files processed; the 29th is listed in §3.1.

| Document ID    | Relative Path                                                                            | Document Name                                                                | Format | Domain             | Topic                  | Knowledge Status | Content Hash   | Source Version | Extraction Status | Sections | Assessable | Generation Status       | Last Synchronized | Notes        |
| -------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------ | ------------------ | ---------------------- | ---------------- | -------------- | -------------- | ----------------- | -------: | ---------: | ----------------------- | ----------------- | ------------ |
| `569b27f8f5ff` | `SOPs/SOPs/Archive and Purge folders Doc.docx`                                           | Archive and Purge folders Doc.docx                                           | DOCX   | Support Operations | Escalation and Billing | INCLUDED         | `1b5810bc48f4` | None declared  | EXTRACTED         |        1 |          1 | Selected for generation | 2026-09-21        | 2,041 chars  |
| `a9ea72744ceb` | `SOPs/SOPs/azure RDR action steps.docx`                                                  | azure RDR action steps.docx                                                  | DOCX   | Support Operations | Escalation and Billing | INCLUDED         | `28bb920fc020` | None declared  | EXTRACTED         |        1 |          1 | Selected for generation | 2026-09-21        | 1,187 chars  |
| `718fafaa42eb` | `SOPs/SOPs/Daily Operational Check – AICHI Azure Central Queue Monitoring.docx`          | Daily Operational Check – AICHI Azure Central Queue Monitoring.docx          | DOCX   | Support Operations | Escalation and Billing | INCLUDED         | `8f3215957b30` | None declared  | EXTRACTED         |        1 |          1 | Selected for generation | 2026-09-21        | 1,022 chars  |
| `a6b7333d4647` | `SOPs/SOPs/ELTL_Lab_Orders_Stuck_in_Awaiting_Calculation_SOP.docx`                       | ELTL_Lab_Orders_Stuck_in_Awaiting_Calculation_SOP.docx                       | DOCX   | Support Operations | Escalation and Billing | INCLUDED         | `c5ddf5908283` | None declared  | EXTRACTED         |       10 |          0 | Selected for generation | 2026-09-21        | 3,788 chars  |
| `e4a6e6dd0647` | `SOPs/SOPs/EMEA SQL Server Patching – Implementation Plan.docx`                          | EMEA SQL Server Patching – Implementation Plan.docx                          | DOCX   | Support Operations | Escalation and Billing | INCLUDED         | `85df98190447` | None declared  | EXTRACTED         |        2 |          2 | Selected for generation | 2026-09-21        | 1,892 chars  |
| `b36679369858` | `SOPs/SOPs/EOLP RxNet Printing issue SOP.docx`                                           | EOLP RxNet Printing issue SOP.docx                                           | DOCX   | Support Operations | Escalation and Billing | INCLUDED         | `0c7d3af790fb` | None declared  | EXTRACTED         |        1 |          1 | Selected for generation | 2026-09-21        | 1,508 chars  |
| `ffbed67a7967` | `SOPs/SOPs/EOLP Support SOP.pdf`                                                         | EOLP Support SOP.pdf                                                         | PDF    | Support Operations | Escalation and Billing | INCLUDED         | `fa25a9a22f24` | None declared  | EXTRACTED         |       35 |          0 | Selected for generation | 2026-09-21        | 10,488 chars |
| `bca1daa6b468` | `SOPs/SOPs/EPROM Frame Sync SOP.docx`                                                    | EPROM Frame Sync SOP.docx                                                    | DOCX   | Support Operations | Escalation and Billing | INCLUDED         | `c9b131a755b8` | None declared  | EXTRACTED         |        7 |          0 | Selected for generation | 2026-09-21        | 1,670 chars  |
| `79e54d2f0958` | `SOPs/SOPs/Grafana User Access Guide.docx`                                               | Grafana User Access Guide.docx                                               | DOCX   | Support Operations | Escalation and Billing | INCLUDED         | `eec436daaf37` | None declared  | EXTRACTED         |        3 |          1 | Selected for generation | 2026-09-21        | 1,018 chars  |
| `ae7ab4970494` | `SOPs/SOPs/Handling TRTF Job Failures SAP and ESO Data Issues in EOLP.docx`              | Handling TRTF Job Failures SAP and ESO Data Issues in EOLP.docx              | DOCX   | Support Operations | Escalation and Billing | INCLUDED         | `9de37065ff65` | None declared  | EXTRACTED         |        2 |          2 | Selected for generation | 2026-09-21        | 2,011 chars  |
| `cb6107532b1e` | `SOPs/SOPs/HOW TO RESEND F6 (F3 Before F6).docx`                                         | HOW TO RESEND F6 (F3 Before F6).docx                                         | DOCX   | Support Operations | Escalation and Billing | INCLUDED         | `86d0368606e6` | None declared  | EXTRACTED         |        1 |          1 | Selected for generation | 2026-09-21        | 1,266 chars  |
| `e3e574938d52` | `SOPs/SOPs/Orders stuck in AWT Calculation - Process Selection Labs.docx`                | Orders stuck in AWT Calculation - Process Selection Labs.docx                | DOCX   | Support Operations | Escalation and Billing | INCLUDED         | `49ea39597878` | None declared  | EXTRACTED         |        1 |          1 | Selected for generation | 2026-09-21        | 1,170 chars  |
| `d14c448a5c48` | `SOPs/SOPs/Rxnet Eolp Database Connection Pool Exhaustion Sop.docx`                      | Rxnet Eolp Database Connection Pool Exhaustion Sop.docx                      | DOCX   | Support Operations | Escalation and Billing | INCLUDED         | `16ad25b4679a` | None declared  | EXTRACTED         |       49 |          0 | Selected for generation | 2026-09-21        | 11,584 chars |
| `7324df521b22` | `SOPs/SOPs/RxNet_L2_SSL_Certificate_Renewal_SOP.docx`                                    | RxNet_L2_SSL_Certificate_Renewal_SOP.docx                                    | DOCX   | Support Operations | Escalation and Billing | INCLUDED         | `b0478d4e9632` | None declared  | EXTRACTED         |       29 |          0 | Selected for generation | 2026-09-21        | 18,824 chars |
| `95048fb3b3cd` | `SOPs/SOPs/SOP – Azure DevOps Query for Total Support Requests Handled by Dev Team.docx` | SOP – Azure DevOps Query for Total Support Requests Handled by Dev Team.docx | DOCX   | Support Operations | Escalation and Billing | INCLUDED         | `bc1f3668e758` | None declared  | EXTRACTED         |        2 |          1 | Selected for generation | 2026-09-21        | 1,512 chars  |
| `c9febd5c4b54` | `SOPs/SOPs/SOP - Best Practices for Production Log Analysis Using Notepad.docx`          | SOP - Best Practices for Production Log Analysis Using Notepad.docx          | DOCX   | Support Operations | Escalation and Billing | INCLUDED         | `6c30f4e5975a` | None declared  | EXTRACTED         |        2 |          2 | Selected for generation | 2026-09-21        | 1,910 chars  |
| `b8d122923427` | `SOPs/SOPs/SOP_Check_Email_Recipients_Alerts.docx`                                       | SOP_Check_Email_Recipients_Alerts.docx                                       | DOCX   | Support Operations | Escalation and Billing | INCLUDED         | `7e28d759491c` | None declared  | EXTRACTED         |        9 |          0 | Selected for generation | 2026-09-21        | 2,461 chars  |
| `e9230fc5c19c` | `SOPs/SOPs/SOP for Handling TRTF Job Failure Alerts.docx`                                | SOP for Handling TRTF Job Failure Alerts.docx                                | DOCX   | Support Operations | Escalation and Billing | INCLUDED         | `a1981c95e382` | None declared  | EXTRACTED         |        5 |          0 | Selected for generation | 2026-09-21        | 6,242 chars  |
| `f88e047861f0` | `SOPs/SOPs/SOP - High Memory Usage.docx`                                                 | SOP - High Memory Usage.docx                                                 | DOCX   | Support Operations | Escalation and Billing | INCLUDED         | `fb6a4a1806c3` | None declared  | EXTRACTED         |        1 |          1 | Selected for generation | 2026-09-21        | 2,456 chars  |
| `dc7bd7b97400` | `SOPs/SOPs/SOP - Order Cancellation RxNet.docx`                                          | SOP - Order Cancellation RxNet.docx                                          | DOCX   | Support Operations | Escalation and Billing | INCLUDED         | `d344fe6bd5e4` | None declared  | EXTRACTED         |       13 |          0 | Selected for generation | 2026-09-21        | 5,440 chars  |
| `b991006a4beb` | `SOPs/SOPs/SOP - Printer Management.docx`                                                | SOP - Printer Management.docx                                                | DOCX   | Support Operations | Escalation and Billing | INCLUDED         | `1472b06c3fc0` | None declared  | EXTRACTED         |        1 |          1 | Selected for generation | 2026-09-21        | 3,053 chars  |
| `3be01f1cd30a` | `SOPs/SOPs/SOP_RELEASE_FLAG.docx`                                                        | SOP_RELEASE_FLAG.docx                                                        | DOCX   | Support Operations | Escalation and Billing | INCLUDED         | `0c8307b76094` | None declared  | EXTRACTED         |        1 |          1 | Selected for generation | 2026-09-21        | 895 chars    |
| `867918b9ef75` | `SOPs/SOPs/SOP Retriggering F8 Interface - SAP Core Model Labs.docx`                     | SOP Retriggering F8 Interface - SAP Core Model Labs.docx                     | DOCX   | Support Operations | Escalation and Billing | INCLUDED         | `17cb08b37031` | None declared  | EXTRACTED         |        2 |          2 | Selected for generation | 2026-09-21        | 1,997 chars  |
| `8407004b3861` | `SOPs/SOPs/SOP to Identify Replication Issues Between RxNet and Reporting Server.docx`   | SOP to Identify Replication Issues Between RxNet and Reporting Server.docx   | DOCX   | Support Operations | Escalation and Billing | INCLUDED         | `d52c95d4b543` | None declared  | EXTRACTED         |        2 |          1 | Selected for generation | 2026-09-21        | 1,575 chars  |
| `15b480ef8879` | `SOPs/SOPs/Tickets SOP's.docx`                                                           | Tickets SOP's.docx                                                           | DOCX   | Support Operations | Escalation and Billing | INCLUDED         | `f94a8d2eb265` | None declared  | EXTRACTED         |       18 |          0 | Selected for generation | 2026-09-21        | 25,647 chars |
| `c313794dbfa6` | `SOPs/SOPs/TRACELAB_Support_SOP.docx`                                                    | TRACELAB_Support_SOP.docx                                                    | DOCX   | Support Operations | Escalation and Billing | INCLUDED         | `bed789e68415` | None declared  | EXTRACTED         |       32 |          0 | Selected for generation | 2026-09-21        | 6,487 chars  |
| `ec3aa81b831d` | `SOPs/SOPs/TRTF - How to Verify whether the Order reprocessed with HeadCapeAngle.docx`   | TRTF - How to Verify whether the Order reprocessed with HeadCapeAngle.docx   | DOCX   | Support Operations | Escalation and Billing | INCLUDED         | `ae1fd76c8c67` | None declared  | EXTRACTED         |        2 |          1 | Selected for generation | 2026-09-21        | 1,546 chars  |
| `373b70f0c6dc` | `SOPs/SOPs/WCF - Retriggering jobs stuck in AWTCALCULATION.docx`                         | WCF - Retriggering jobs stuck in AWTCALCULATION.docx                         | DOCX   | Support Operations | Escalation and Billing | INCLUDED         | `824c04693ed8` | None declared  | EXTRACTED         |        1 |          1 | Selected for generation | 2026-09-21        | 1,416 chars  |

### 3.1 Not processed, with the reason

| Relative Path              | Reason                                                                                                                                                               |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SOPs/SOPs/*.csv` (1 file) | **UNSUPPORTED_TYPE** — no registered extractor. Reported at configuration time by Test Connection check 5, before synchronization, rather than discovered afterwards |
| `desktop.ini`              | ARTIFACT — written by the OneDrive client. Readable text, so without an explicit exclusion it would extract _successfully_ into a nonsense section                   |

**Every other file was processed.** No file was unavailable, so no file is marked unavailable.

## 4. Pilot Results

**Executed 2026-09-22 against the REAL approved SOP corpus**, through the real `FILE_REPOSITORY`
adapter. Every figure was read back from the API or the database after the step ran. Nothing is
estimated and no fixture content took part.

### 4.1 The run

| Step                      | Result                                                                                                                                                                                                           |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Test Connection**       | `ok: true` — **11 checks**: 8 PASS, 3 SKIP, 0 FAIL. Local availability proven by reading a byte from a 10-document sample                                                                                        |
| **Synchronize** (FULL)    | `SUCCEEDED` · scanned **28** · added **28** · failed **0** · **122,106 characters** extracted                                                                                                                    |
| **Extraction**            | **28 of 28 succeeded.** 0 failures, 0 empty. **234 sections**, of which **22 assessable**                                                                                                                        |
| **Unsupported**           | **1** file — a CSV, reported at configuration time rather than after synchronization                                                                                                                             |
| **Document selection**    | 28 selectable, capped to the **10 richest** by section count (`generation.maxDocumentsPerJob` = 10). Passing all 28 is refused with `GENERATION_SELECTION_REQUIRED` — the cap exists so a batch stays reviewable |
| **Preflight**             | `GENERATE_NEW` (`NEW_KNOWLEDGE`). 93 sections in scope across the 10 selected                                                                                                                                    |
| **Generate**              | **3 accepted** of 6 requested. Tokens **21,354 in / 1,084 out**                                                                                                                                                  |
| **Evidence verification** | **3 verified, 1 refused.** The refusal is recorded as `EVIDENCE_UNVERIFIED` — a real candidate whose quoted span did not verify against the source text, refused rather than persisted                           |
| **Insufficient evidence** | **97 sections** reported, each with its own reason (§4.3)                                                                                                                                                        |
| **Drafts**                | 3 created, claimed and submitted by the author identity                                                                                                                                                          |
| **Separation of duties**  | The author's attempt to approve their own draft was **refused with HTTP 403** before any approval was recorded. Gate 13, demonstrated                                                                            |
| **Approval**              | **3 approved** by a different identity                                                                                                                                                                           |
| **Publication**           | **3 published**, 0 failed → `KNZ-SUPPORT_OPS-2026-000001…000003`                                                                                                                                                 |
| **Assessment**            | Created, validated (pool **3**, valid), submitted, approved, published with a pinned eligibility snapshot                                                                                                        |
| **Learner attempt**       | 3 of 3 answered, **3 correct**, **100%**, **PASSED**, band **EXPERT**                                                                                                                                            |
| **Answer-key protection** | Asserted in the run: the served question payload carried no correct-option field at any point                                                                                                                    |

### 4.2 The metrics requested, with actual values

| Metric                                      | Value                                                                                                                        |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Documents discovered                        | **29** files in the corpus folder                                                                                            |
| Documents included                          | **28**                                                                                                                       |
| Documents unsupported                       | **1** (CSV — no registered extractor)                                                                                        |
| Documents unavailable                       | **0** — no file was a placeholder, so none is marked unavailable                                                             |
| Documents successfully extracted            | **28 of 28**                                                                                                                 |
| Extraction failures                         | **0**                                                                                                                        |
| Empty-content documents                     | **0**                                                                                                                        |
| Characters extracted                        | **122,106**                                                                                                                  |
| Sections generated                          | **234**                                                                                                                      |
| — of which assessable                       | **22** (9.4%)                                                                                                                |
| Questions generated                         | **3**                                                                                                                        |
| Questions rejected by evidence verification | **1** (`EVIDENCE_UNVERIFIED`)                                                                                                |
| Sections reporting insufficient evidence    | **97**                                                                                                                       |
| Questions submitted for review              | **3**                                                                                                                        |
| Questions approved                          | **3**                                                                                                                        |
| Questions published                         | **3**                                                                                                                        |
| Assessments created                         | **1**, published with a pinned pool of 3                                                                                     |
| Learner attempts                            | **1**, scored **100%**, PASSED, EXPERT                                                                                       |
| Generation-quality findings                 | §4.3. Not measured against a model — generation used the deterministic local generator; a Claude comparison still needs T-29 |

### 4.3 Two findings, and the first one I got wrong twice

This section is written with its own corrections visible, because the reasoning matters more than the
conclusion.

#### 4.3.1 A real defect: generation was mutating the curated assessability flag

After the first run only **22 of 234** sections were flagged assessable, and every document the job
had selected showed **zero**. The tempting reading was that long procedural SOPs contain nothing
assessable. Checking against section _length_ rather than the flag refuted it:

| Documents                          | Sections | Flagged `is_assessable` |          Actually ≥ 300 chars |
| ---------------------------------- | -------: | ----------------------: | ----------------------------: |
| **Never** in a generation job (17) |       24 |                      21 | **21** — flag matched reality |
| **Were** in a generation job (11)  |      210 |                   **0** |                        **95** |

`Rxnet Eolp Database Connection Pool Exhaustion Sop.docx` had 7 sections over 300 characters, one of
2,513, and 0 flagged. The 94 flipped rows all carried one reason string —
_"Insufficient assessable content: no testable rule stated."_ — and every one was over the threshold.

`generation-service.ts` was writing `isAssessable: false` whenever a generator reported
insufficiency, citing §6. **The spec does not say that.** §6.2 reserves `NON_ASSESSABLE` for the
document's own structure — contents pages, revision histories, approval tables, legal notices,
glossaries, reference lists — plus sections below `minAssessableChars`, and makes the flag
author-curated, flippable only "with an audited reason". A generator's inability to build four
plausible options is a fact about **that generator**, not about whether content can be assessed.

Three measured consequences:

1. **The coverage denominator shrank silently.** Every coverage percentage afterwards was computed
   against a smaller assessable set, so coverage read artificially complete.
2. **A second run over the same documents failed with `GENERATION_SCOPE_EMPTY`** — not because the
   corpus was exhausted, but because the flags had been cleared. This is what blocked generation from
   the UI.
3. **It destroys the baseline for comparing generators.** A model asked to work this corpus after the
   deterministic pass would be handed one claiming almost nothing is assessable. That makes it a
   blocker for the T-29 comparison rather than a cosmetic issue.

**Fixed.** Generation still records the insufficiency on the job and still sets
`coverageStatus = NON_ASSESSABLE` with the reason — the documentation-quality signal the code
intended — but no longer touches `isAssessable`. The 101 affected rows were restored from their
stored character counts, which is safe because the reason string is unique to that path and every
restored row is over the threshold. Assessable sections went from 21 back to **115**.

#### 4.3.2 The finding that survived: this corpus needs a model, not a sentence matcher

Restoring the flags did **not** produce questions. With 115 assessable sections available and 93 in
scope, a fresh run accepted **0** and reported 92 insufficient. A second job aimed specifically at the
17 documents whose assessable sections had never been tried accepted **0 of 10 requested**, with all
14 sections reporting insufficient evidence.

So low yield was never caused by the defect. The cause is in the generator's selection rule:

```
RULE_SIGNAL = /\b(must|may|requires?|never|only|shall|cannot|is refused|is issued)\b/i
```

The deterministic generator needs a **declarative sentence containing a modal**, ideally with a
quantity, from which three distinct plausible distractors can be formed. Real support SOPs are
**imperative**: _"Click Retry"_, _"Run the query"_, _"Check the log"_, _"Navigate to the dashboard"_.
They tell a reader what to do next, which is exactly right for their purpose and structurally
invisible to this generator.

The three questions that do exist prove the rule rather than break it. They came from
`SOP - Order Cancellation RxNet.docx` (2) and `Tickets SOP's.docx` (1) — sections that happen to
contain a modal, such as a decision matrix stating what _must_ happen in a scenario.

**The honest yield for this corpus and this generator is 3 questions from 28 documents.** The platform
declines to fabricate the rest, with a reason recorded per section, which is the behaviour the whole
governance design exists to produce.

**This is now the strongest available argument for T-29.** A model can read a procedure and ask what a
technician must know to follow it; sentence matching cannot. The **106 recorded refusals across the
two jobs are the baseline** to measure a model against — and that baseline only survives because the
defect in §4.3.1 is fixed.

Until that comparison runs, low yield is a property of **the generator**, not of the documents, and
the two must not be conflated when reporting to stakeholders.

### 4.4 One genuine evidence-verification refusal

`EVIDENCE_UNVERIFIED` fired once on real content: a candidate question whose quoted span did not
verify against the extracted section text, so **it was not persisted**. That is the grounding control
doing its job on real documents for the first time, and it is worth more than the three accepted
questions as evidence that the pipeline is sound.

## 5. Verification

| Gate                                                                          | Result                                                      |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Real-corpus run, end to end                                                   | **EXECUTED** — synchronize to a scored learner attempt (§4) |
| Adapter conformance suite, unrelaxed, against `FileRepositoryKnowledgeSource` | 59 passed, 6 todo                                           |
| Extraction invariants X1–X8, parameterized over PDF/DOCX/PPTX/XLSX            | Passing                                                     |
| No emitted `sourceUrl`/`webUrl` is a local path (mutation-tested detector)    | Passing                                                     |
| Partial-sync guard refuses a run and emits no deletions                       | Passing                                                     |
| Symlink, traversal and root-containment refusals                              | Passing                                                     |
| `desktop.ini` and lock files excluded                                         | Passing, and exercised by the real corpus                   |
| Answer-key protection during the learner attempt                              | Asserted in the run                                         |
| Separation of duties (gate 13)                                                | Demonstrated: author self-approval refused 403              |

## 6. Re-running and maintaining the corpus

```bash
# 1. Point at the approved mirror (machine-specific; never committed)
export PILOT_CORPUS_HOST_PATH="…/OneDrive - {Org}/Shortcuts/Central Rx Operations Support - Knowzy"
docker compose -f infrastructure/compose/docker-compose.yml up -d mcp

# 2. Rebuild the whole demonstration: Test Connection → … → learner attempt
npx tsx scripts/pilot-demo.ts

# 3. Re-measure the corpus for this register
npx tsx scripts/corpus-report.ts "<mirror root>/SOPs"
```

`npm run verify` truncates the development database, so the demonstration must be rebuilt after it.
That is what `scripts/pilot-demo.ts` is for, and it is re-runnable: on a populated database
generation legitimately refuses with `GENERATION_SCOPE_EMPTY` or recommends `VIEW_EXISTING`, and the
run reports that and carries on.

**Still open:** the business and technical owners of this corpus are unassigned; retention (T-36) and
the sensitivity exclusions are unconfirmed; and the corpus boundary is still one person's OneDrive
account (§2.4), which is a transitional position and not a governance boundary.

---

## 7. Generation-Ready Corpus (derived assets)

**Created 2026-09-22.** Location: `RealWorldPilot/GenerationReady/`. Full rationale:
[`GENERATION_READY_CORPUS_SUMMARY.md`](../docs/integrations/GENERATION_READY_CORPUS_SUMMARY.md).

### 7.1 What these files are, and what they are not

Seven Markdown documents restructured from the pilot corpus so that generation quality can be
evaluated against well-formed source material. They are **pilot, evaluation, demonstration and
comparison assets only**.

**They are not authoritative.** The `.docx` and `.pdf` files in the SharePoint library remain the
documents of record, are unmodified, and are not replaced by these. No original file was touched:
every derived document was produced by reading the platform's own `extracted_text`, and the register
in §3 still describes the authoritative corpus.

Content was consolidated, reorganised, re-headed and clarified. **No operational rule was added,
removed or altered.** Where the standard format called for a section the source did not support —
thresholds in a document that states none, exceptions in a conceptual reference — the section was
**omitted rather than filled**, because filling it would have created knowledge the source does not
contain. Each file records its own omissions in its header block.

Named individuals, mailbox addresses, internal server FQDNs, an AWS instance IP, customer order
identifiers and real job numbers were redacted or excluded. This changes no rule.

### 7.2 The register

Measured with the platform's own extraction pipeline (`extractContent` + sectionizer) and its own
deterministic generator with evidence verification in STRICT mode and the integrity gate applied.
"Original" figures are from §3, measured through the DOCX and PDF extractors.

| Original source                                                              | Generated file                                          | Sections | Assessable | Assessable before |      Chars | Generation status | Suitability   |
| ---------------------------------------------------------------------------- | ------------------------------------------------------- | -------: | ---------: | ----------------: | ---------: | ----------------- | ------------- |
| `SOP - Order Cancellation RxNet.docx`                                        | `SOP - Order Cancellation RxNet.md`                     |       13 |     **13** |                 8 |      8,508 | EXTRACTED         | **Excellent** |
| `Rxnet Eolp Database Connection Pool Exhaustion Sop.docx`                    | `Rxnet Eolp Database Connection Pool Exhaustion Sop.md` |       13 |     **13** |                 7 |     12,371 | EXTRACTED         | **Excellent** |
| `RxNet_L2_SSL_Certificate_Renewal_SOP.docx`                                  | `RxNet_L2_SSL_Certificate_Renewal_SOP.md`               |       12 |     **12** |                26 |     11,581 | EXTRACTED         | **Good**      |
| `TRACELAB_Support_SOP.docx`                                                  | `TRACELAB_Support_SOP.md`                               |       12 |     **11** |                 6 |      9,274 | EXTRACTED         | **Excellent** |
| `SOP - Printer Management.docx`                                              | `SOP - Printer Management.md`                           |       12 |     **11** |                 1 |      6,517 | EXTRACTED         | **Excellent** |
| `Tickets SOP's.docx` (one section only)                                      | `Tickets SOP's (SAP Rx-MES Interface Reference).md`     |        9 |      **9** |                18 |      6,292 | EXTRACTED         | **Good**      |
| `TRTF - How to Verify whether the Order reprocessed with HeadCapeAngle.docx` | same name, `.md`                                        |        7 |      **7** |                 1 |      4,667 | EXTRACTED         | **Fair**      |
| **Totals**                                                                   | **7 files**                                             |   **78** |     **76** |            **67** | **59,210** | 7 EXTRACTED       | —             |

Every one of the 78 sections carries a heading, and 76 of 78 are assessable — **97.4%**, against
46.5% for the same seven documents in their original form.

### 7.3 Coverage improvement — measured, not estimated

The honest measure of improvement is not assessable-section count. It is how many questions the
generator actually produces. Both columns below were produced by the same generator, with evidence
verification in STRICT mode and the integrity gate applied.

| Document                                             | Questions before | Questions after |
| ---------------------------------------------------- | ---------------: | --------------: |
| `SOP - Order Cancellation RxNet`                     |                2 |           **5** |
| `TRACELAB_Support_SOP`                               |                0 |           **5** |
| `SOP - Printer Management`                           |                0 |           **3** |
| `Rxnet Eolp Database Connection Pool Exhaustion Sop` |                0 |           **1** |
| `TRTF - HeadCapeAngle verification`                  |                0 |           **1** |
| `Tickets SOP's` (partial derivation)                 |                2 |               1 |
| `RxNet_L2_SSL_Certificate_Renewal_SOP`               |                0 |           **0** |
| **Totals**                                           |            **4** |          **16** |

**A 4× increase, all sixteen evidence-verified and integrity-passing.** Method caveat: the "before"
column re-runs the generator over the stored normalized text through the plain-text extractor, so its
sectioning differs from the DOCX path and its section counts are lower than §3. It is a proxy, and it
agrees closely with the authoritative run, which accepted 3 questions with 2 from Order Cancellation
and 1 from `Tickets SOP's`.

### 7.4 Two results that contradict what was expected

**Restructuring a well-structured document made it worse by the count metric.**
`RxNet_L2_SSL_Certificate_Renewal_SOP` went from 26 assessable sections to 12, because consolidation
replaces many small sections with fewer large ones. It also produced **zero questions before and
zero after**, despite twelve rule-dense sections averaging 950 characters. That document did not need
converting, and the conversion is recorded as **Good** rather than Excellent for that reason.

**Yield tracks quantities in rule sentences, not structural quality.** The generator needs three
distinct distractors, which it builds by swapping a quantity, a modal or a known actor noun. A
sentence with one modal, no number and no recognised actor yields one distractor and is refused. That
is precisely the SSL document's prose style — _"L2 must not wait for business impact"_ — and precisely
why TRACELAB (version `1.6.0.2`, `HTTP 200`, "seven situations", "thirteen checks") and Order
Cancellation (`NO = 1`, one versus three jobs) produced five each.

So the measured requirement is narrower than the authoring guide's advice implies: **headings and
section size make a document assessable; a stated quantity makes it generate.** Both findings are
about this generator, and the comparison in
[`LIVE_CLAUDE_EVALUATION_PLAN.md`](../docs/integrations/LIVE_CLAUDE_EVALUATION_PLAN.md) is what will
show whether a model has the same constraint. It very likely does not, which is the point.

### 7.5 Governance

These files live in the repository rather than in the SharePoint library, so they are **not** covered
by §2's inclusion criteria, permission assumptions or retention requirements — those govern the
authoritative corpus. If a generation job is ever run against them, every question it produces will
carry provenance pointing at a derived asset rather than at the document of record. **That is
acceptable for evaluation and not acceptable for publication**, and any question generated from this
corpus must not be published to the Question Bank.

---

## 8. Corrected corpus metrics (PILOT-T2, 2026-09-22)

Every coverage figure recorded above section 7 was computed against a denominator that counted
refusals as coverage. Migration `0004_grounding_integrity` separated the two, and these are the
figures the platform now reports. Reproduce with `npx tsx scripts/coverage-report.ts`.

| Section state                          |   Count | Share of assessable |
| -------------------------------------- | ------: | ------------------: |
| **Assessable**                         | **115** |                100% |
| Attempted (has been in a job's scope)  |     109 |               94.8% |
| **Generated** (a question cites it)    |   **3** |            **2.6%** |
| Refused (a run found nothing testable) |     106 |               92.2% |
| Unresolved (no question, no refusal)   |       6 |                5.2% |

**Coverage is 2.6%, not the 94.8% previously reported.** The two numbers are the same arithmetic
with the 106 refusals moved from the numerator's side to their own column, which is where they
belong: a refusal is a fact about a generation run, not about the document.

Per document, the corrected picture is blunter than the aggregate:

| Document                                                  | Assessable | Generated | Refused | Coverage |
| --------------------------------------------------------- | ---------: | --------: | ------: | -------: |
| `SOP - Order Cancellation RxNet.docx`                     |          8 |         2 |       6 |    25.0% |
| `Tickets SOP's.docx`                                      |         18 |         1 |      17 |     5.6% |
| `RxNet_L2_SSL_Certificate_Renewal_SOP.docx`               |         26 |         0 |      26 |     0.0% |
| `EOLP Support SOP.pdf`                                    |         12 |         0 |      12 |     0.0% |
| `Rxnet Eolp Database Connection Pool Exhaustion Sop.docx` |          7 |         0 |       7 |     0.0% |
| `TRACELAB_Support_SOP.docx`                               |          6 |         0 |       6 |     0.0% |

### 8.1 Section-key integrity

|                                      |  Before |   After |
| ------------------------------------ | ------: | ------: |
| Sections                             |     251 |     251 |
| Distinct section keys                | **198** | **251** |
| Keys shared by two or more documents |  **53** |   **0** |

The largest collision group was **21 documents sharing one key** — every heading-less document whose
first section hashed `segment:1#1`. `scripts/verify-section-keys.ts` confirms all 251 stored keys
match the TypeScript derivation, and `scripts/coverage-report.ts` reports the collision count on
every run so a regression is visible rather than dormant.

**Questions published before the migration keep their v1 keys** — `KNZ-SUPPORT_OPS-2026-000001..003`
are unchanged, because `draft_question` lineage is immutable (I15) and rewriting it would falsify
what was published. `document_section.section_key_v1` keeps those keys resolvable, and coverage
matches on either.

---

## 9. Deterministic baseline, both corpora (2026-09-22)

Full table and method: [`LIVE_CLAUDE_EVALUATION_PLAN.md` §2.4](../docs/integrations/LIVE_CLAUDE_EVALUATION_PLAN.md).
Reproduce with `npx tsx scripts/baseline.ts`.

|                               | Original SOP corpus | Generation-ready corpus |
| ----------------------------- | ------------------: | ----------------------: |
| Documents · sections          |            28 · 234 |                  7 · 78 |
| Assessable                    |                 115 |                      76 |
| Generated                     |               **4** |                  **16** |
| Refused                       |                 105 |                      60 |
| Unresolved                    |                   6 |                       0 |
| **Coverage**                  |            **3.5%** |               **21.1%** |
| Verified exactly under STRICT |              4 of 4 |                16 of 16 |
| Duplicates blocked or flagged |                   0 |                       0 |

Matched run, same selection rule and same 50-question request: the original corpus accepted **0**
from 93 assessable sections in scope, the restructured corpus **16** from 76. The original's
cumulative 4 came from earlier runs over the sections that contain a modal verb.

**These figures supersede every coverage percentage recorded above §8** and are the control arm the
Claude comparison will be measured against.
