# SharePoint Discovery Plan

**Status:** Plan and checklist. Planning artifact only — no code changed.
**Premise:** Graph SharePoint access returns 403 and will until an administrator consents
([ACCESS_DISCOVERY_REPORT.md](ACCESS_DISCOVERY_REPORT.md) §4). A signed-in user **can** browse the
sites. So this discovery is **human-driven through the SharePoint UI**, and its output is designed to
be directly loadable once the API opens.
**Does not cover:** the adapter itself — that is
[integration-plan-sharepoint.md](../project/integration-plan-sharepoint.md).

---

## 1. Design principle: discover into the platform's own shape

The temptation is to produce a survey document. Resist it. **The discovery output should be the
platform's configuration, recorded early.**

Knowzy's data model already states exactly what a knowledge source needs, and every column below is
a question this discovery must answer:

| `KnowledgeSource` column | The discovery question |
| --- | --- |
| `name`, `description` | What do we call this source, and what is it for? |
| `sourceType` | `SHAREPOINT` |
| `connection` (JSONB) | Site URL, library name — **the human-facing values**. Site and drive IDs are resolved by Test Connection and never hand-entered |
| `permissionMode` | `DELEGATED_OBO` or `APP_ONLY_SITES_SELECTED` (T-14) |
| `ownerUserId` | Who is accountable for this source (T-17)? |
| `usableForGeneration` / `usableForRefreshers` / `usableForExplanations` | What may this content be used *for*? Three separate decisions |
| `restrictions` (JSONB) | Which roles, domains, teams or business functions may read it? |
| `syncSchedule` | How often (T-20)? |

| `KnowledgeSourcePath` column | The discovery question |
| --- | --- |
| `containerId` / `containerName` | Which library? (`containerId` resolved, `containerName` recorded) |
| `folderPath` | Which folder, server-relative? |
| `includedFileTypes` / `excludedFileTypes` | Which formats are in scope? |
| `includedMetadata` | **Which SharePoint columns to capture** (T-13) |
| `domainMapping` / `topicMapping` | How do column values map to the Knowzy taxonomy? |

A discovery that answers these is configuration. A discovery that answers something else is a
document someone has to re-interpret later.

**Deliverable format:** one row per candidate path in a spreadsheet or CSV whose columns are the two
tables above. Not prose.

---

## 2. What information is needed from SharePoint sites

### 2.1 Per site

| # | Item | Why Knowzy needs it | Source |
| --- | --- | --- | --- |
| S1 | Site URL (`https://{tenant}.sharepoint.com/sites/{path}`) | Resolved to a site ID by Test Connection and stored (T-10) | Browser address bar |
| S2 | Site display name | Recorded as `containerSiteName` on every document | Site home |
| S3 | Site owner / accountable business contact | Becomes the source owner (T-17), receives health notifications | Site permissions or the business |
| S4 | Approximate document count and total size | Sizes the first full sync and the throttling risk (A-12) | Library view |
| S5 | Is this site a **document** site or a candidate **governance** site? | The Question Bank must live on a **different site** from document sites (A-03) | Judgement |

### 2.2 Per library

| # | Item | Why | Source |
| --- | --- | --- | --- |
| L1 | Library display name | Resolved to a drive ID and stored (T-11) | Site contents |
| L2 | Folder structure, and its depth | `folderPath` per path, and whether `recursive` is appropriate (T-12) | Library navigation |
| L3 | **Custom column names and their types** | Candidate `includedMetadata` (T-13) | Library settings → Columns |
| L4 | Whether versioning is enabled | Whether `sourceVersion` carries a real version label | Library settings |
| L5 | File-type distribution — **count by extension** | **The critical one. See §6** | Library view grouped by type |
| L6 | Content types in use | Whether a content type distinguishes document kinds usefully | Library settings |

### 2.3 Per candidate document set

| # | Item | Why |
| --- | --- | --- |
| D1 | A representative sample, downloaded | Extraction measurement (§6) |
| D2 | Each sample's column values | Populates fixture `metadata` faithfully |
| D3 | Each sample's version label and modified date | Populates `sourceVersion`, `sourceModifiedAt` |
| D4 | At least one document restricted from a named test principal | Makes permission trimming falsifiable (T-39) |

---

## 3. How sites, libraries and folders should be cataloged

### 3.1 The hierarchy, and how it maps

```
SharePoint site            →  KnowledgeSource.connection.siteUrl
  └── document library     →  KnowledgeSourcePath.containerId / containerName
        └── folder         →  KnowledgeSourcePath.folderPath   (one path row per folder in scope)
              └── file     →  KnowledgeDocument
```

Two rules that follow from the model and are easy to get wrong:

1. **One `KnowledgeSourcePath` row per folder in scope, not per library.** The unique constraint is
   `(sourceId, containerId, folderPath)`, and `includedMetadata`, `domainMapping` and `topicMapping`
   are **per path**. So two folders in one library needing different domain mappings are two rows.
   This is the mechanism for mapping folder structure onto taxonomy.
2. **Never record a site ID or drive ID.** They are resolved once by Test Connection and stored, and
   resolution never happens on a hot path
   ([integration-plan-sharepoint.md](../project/integration-plan-sharepoint.md) §4). Hand-entering
   one creates a value nobody can re-derive and that breaks silently if the library is moved.

### 3.2 Recursive or explicit?

`KnowledgeSourcePathConfig.recursive` is a boolean per path. Prefer **explicit folder paths** for the
pilot even where recursion would be shorter:

- a recursive root picks up folders added later **without a governance decision**, which is how an
  unreviewed document becomes a question;
- `domainMapping` is per path, so a recursive root forces one mapping across heterogeneous content;
- the blast radius of a misconfiguration is the whole library rather than one folder.

Use `recursive: true` only where a folder tree is genuinely homogeneous and owned by one person.

---

## 4. Which SharePoint locations should become knowledge sources

### 4.1 Selection criteria

A location is a good candidate when **all five** hold. These are ranked by how often the criterion is
the one that disqualifies a site.

| # | Criterion | Why |
| --- | --- | --- |
| 1 | **The content states testable rules** — procedures, thresholds, obligations, decision rules | This is the binding constraint in practice. The generator needs a sentence stating a rule; narrative, minutes, org charts and status decks state none, and yield honest `insufficientEvidence` refusals. A site full of unassessable content produces an empty source and looks like a platform failure |
| 2 | **A named owner exists** who is accountable for accuracy | T-17. Questions inherit their document's authority; an unowned document has none |
| 3 | **The content is current and maintained** | A stale procedure generates confidently wrong questions that pass every gate, because the gates verify *grounding*, not *truth* |
| 4 | **The formats are extractable** | §6. A library of scanned PDFs cannot be read at all today |
| 5 | **The audience is broad enough to be worth assessing** | A document three people use is not worth a governed question |

### 4.2 Recommended pilot shape

**Two to four paths, one domain, one accountable owner.** Deliberately small:

- preflight's duplicate and saturation checks need a bounded corpus to say anything useful;
- review capacity is the real constraint (A-06), and an unstaffed review queue makes generation
  worthless (R-04);
- every new source multiplies the discovery, mapping and permission work.

**Best pilot candidates, in order:** standard operating procedures · policies with explicit
obligations · compliance and safety procedures · product or service specifications with stated
limits.

**Explicitly avoid for the pilot:** meeting minutes · project status reports · org charts ·
presentation decks (PPTX is unextractable today and slide text states few complete rules) ·
anything HR-sensitive or personally identifying · anything under legal privilege.

### 4.3 The governance site is a separate decision

The Question Bank list **must** live on a different site from any document site (A-03), because the
`Sites.Selected` **Write** grant is scoped to it and knowledge documents must stay read-only to the
platform. Identify a candidate governance site during discovery (S5) — it is a different
conversation with IT (T-21..T-27) and a different grant (T-22).

---

## 5. What metadata should be captured

### 5.1 Structural metadata — automatic, no decision needed

`KnowledgeDocument` already declares these, and the adapter populates them: `sourceDocumentId`,
`name`, `containerSiteName`, `containerSiteId`, `containerName`, `containerId`, `folderPath`,
`sourceUrl`, `fileType`, `fileSizeBytes`, `sourceCreatedAt`, `sourceModifiedAt`, `sourceVersion`,
`sourceETag`, `contentHash`.

Note `sourceVersion` **and** `sourceETag` are separate columns. That is deliberate: eTag alone is not
a content change, because SharePoint bumps it for metadata and permission events, so the content hash
decides
([integration-plan-sharepoint.md](../project/integration-plan-sharepoint.md) §5.2). Discovery should
record whether library versioning is on (L4), because without it there is no meaningful version label
and preflight must report change without one.

### 5.2 SharePoint columns — a decision, per path (T-13)

`includedMetadata` is an explicit allow-list. **Capture only what has a use**, because every captured
column is data copied out of SharePoint into Knowzy and has to be justified.

| Capture when | Example columns | Used for |
| --- | --- | --- |
| It maps to the taxonomy | `Department`, `Category`, `ProcessArea` | `domainMapping` / `topicMapping` |
| It signals authority or currency | `Owner`, `ApprovedBy`, `ReviewCycle`, `EffectiveDate` | Review context; staleness judgement |
| It signals sensitivity | `Classification`, `Confidentiality` | A restriction decision, and an exclusion trigger |

**Do not capture** free-text descriptions, columns containing personal data, or columns nobody can
name a use for. A column captured "in case it is useful later" is unreviewed personal-data risk with
no owner.

### 5.3 Taxonomy mapping is a business decision to make during discovery

`domainMapping` and `topicMapping` translate column values into Knowzy domains and topics. Two
prerequisites, both business-owned and both easy to defer too long:

- **T-18** — the domain and topic taxonomy, with **immutable domain codes**. A domain code appears in
  every published QuestionID (`KNZ-{DOMAIN_CODE}-{YYYY}-{SEQ}`), so it cannot be changed after the
  first publication. Get it right before publishing, not after.
- **T-10 / A-10** — a named taxonomy owner. Uncurated free-text topics degrade coverage, gap
  reporting and pool balancing into noise.

If the taxonomy is not ready, the pilot can run with a single domain and a small topic set. That is a
legitimate simplification. Inventing domain codes that later need changing is not.

---

## 6. How to interpret formats — the measurement that should happen first

**Only three extractors are registered: plain text, Markdown and HTML.** PDF, DOCX, PPTX, XLSX and
SharePoint Pages have none
([ACCESS_DISCOVERY_REPORT.md](ACCESS_DISCOVERY_REPORT.md) §5.1). An unregistered type returns
`UNSUPPORTED` with a reason — honestly, but it returns no text.

So **L5, the file-type distribution, is the highest-value single data point in this entire
discovery.** It tells you what fraction of a candidate library the platform can read today, and
therefore how much extractor work stands between discovery and a working pilot.

### 6.1 The measurement

For each candidate library, record:

| Extension | Count | Extractable today | Needs |
| --- | --- | --- | --- |
| `.txt`, `.md` | | **Yes** | — |
| `.html`, `.htm`, `.aspx` | | **Yes** | — |
| `.pdf` | | **No** | A PDF extractor. Text-bearing only; scanned PDFs need OCR, which is out of scope (R-06) |
| `.docx` | | **No** | A DOCX extractor |
| `.pptx` | | **No** | A PPTX extractor |
| `.xlsx` | | **No** | An XLSX extractor |
| SharePoint Pages | | **No** | Canvas-layout extraction |
| anything else | | **No** | Excluded via `excludedFileTypes` |

Then, on the downloaded sample (D1), record how many PDFs are **text-bearing versus scanned**. A
scanned PDF yields `EXTRACTION_EMPTY` even once a PDF extractor exists. Assumption A-04 rates this
Medium and says plainly that it is "likelier than it looks" — which makes it a thing to measure now,
cheaply, rather than discover in month three.

### 6.2 What the result decides

| Finding | Consequence |
| --- | --- |
| Mostly text/HTML/Markdown | Rare, but the pilot can proceed with no extractor work |
| Mostly DOCX and text-bearing PDF | Expected. Two extractors are the critical path |
| Significant PPTX or XLSX | Question whether that content states testable rules at all before building an extractor for it |
| Significant scanned PDF | **A scope conversation with the business**, now: OCR, or exclude those documents, or accept reduced coverage |

---

## 7. How document ownership and permissions should be interpreted

### 7.1 Ownership is a business fact, not a SharePoint field

SharePoint's `Author` and `Editor` are *who touched the file*. Knowzy's `ownerUserId` is *who is
accountable for the content being correct* (T-17). They are frequently different people and
conflating them puts health notifications in the wrong inbox.

**Capture both**: the SharePoint `Owner`-style column as `includedMetadata` (review context), and the
accountable person as the source owner — confirmed with the business, not inferred.

### 7.2 Permissions: record observations, decide the mode deliberately

Discovery cannot query permissions through Graph (403). It **can** observe them in the browser. What
to record per candidate path:

| Observation | Why it matters |
| --- | --- |
| Does the whole library inherit site permissions? | Uniform permissions make either mode safe. Broken inheritance is where trimming becomes load-bearing |
| Any item-level or folder-level unique permissions? | These are exactly the cases `DELEGATED_OBO` handles correctly and platform trimming approximates |
| Anything shared externally, or via anonymous links? | A candidate exclusion, and a security conversation |
| Any restricted subfolder? | Candidate for T-39, the denied-document fixture |

### 7.3 Choosing the permission mode (T-14)

| Mode | Trimming | `AccessDecision.enforcement` | Choose when |
| --- | --- | --- | --- |
| `DELEGATED_OBO` | SharePoint's own, per user | `'SOURCE'` | Interactive browsing, and any library with non-uniform permissions. **Recommended default** (R-03) |
| `APP_ONLY_SITES_SELECTED` | Knowzy's own layers: role, domain, team, business function, `UserSourceAccess` | `'PLATFORM'` | Background sync and jobs, where there is no interactive user |

The rule that must be understood before choosing, because it is counter-intuitive and the platform
enforces it:

> A document discovered by a background job is **not** automatically visible to a user. Visibility is
> re-evaluated against the user at read time.

Background sync necessarily runs app-only and therefore sees more than any one learner. That is why
read-time re-evaluation exists, and why `getEffectiveAccess` treats `UNKNOWN` as a first-class answer
rather than defaulting either way.

**For the pilot:** prefer `DELEGATED_OBO` for anything interactive. Where app-only is unavoidable,
the UI is required to state that trimming is platform-enforced rather than SharePoint-enforced — say
so to stakeholders up front rather than having it discovered in the interface.

---

## 8. Discovery checklist

Ordered so that a disqualifying finding appears as early as possible. **Stop and reconsider at any
STOP marker** rather than completing the checklist for a site that will not work.

### Phase A — Candidate identification (business conversation)

- [ ] A1 List candidate sites with the business
- [ ] A2 For each, name the **accountable owner** and confirm they accept it (T-17)
- [ ] A3 Confirm the content **states testable rules** — sample three documents and read them (§4.1 criterion 1)
- [ ] A4 **STOP** if no owner, or if the content states no testable rules. Do not proceed to survey it
- [ ] A5 Confirm the content is current, and record when it was last reviewed
- [ ] A6 Exclude anything HR-sensitive, personally identifying, or legally privileged
- [ ] A7 Identify a candidate **governance site** for the Question Bank, separate from all document sites (S5, T-21)

### Phase B — Format measurement (do this before any other survey work)

- [ ] B1 For each candidate library, record **count by file extension** (L5)
- [ ] B2 Compute the fraction extractable **today** — text, Markdown, HTML only
- [ ] B3 Download a representative sample of 10–20 documents (D1)
- [ ] B4 For each sampled PDF, record **text-bearing or scanned**
- [ ] B5 **STOP** if the library is predominantly scanned: this is a scope conversation with the business, not an engineering task (§6.2)
- [ ] B6 Record the extractor work the distribution implies, and feed it into the milestone

### Phase C — Structure

- [ ] C1 Record site URL and display name (S1, S2)
- [ ] C2 Record library display names (L1)
- [ ] C3 Map the folder structure and its depth (L2)
- [ ] C4 Decide **explicit paths versus recursive**, per path, with a reason (§3.2)
- [ ] C5 Record whether library versioning is enabled (L4)
- [ ] C6 Record content types in use (L6)
- [ ] C7 Record approximate document count and total size (S4)
- [ ] C8 **Do not record site IDs or drive IDs** (§3.1)

### Phase D — Metadata and taxonomy

- [ ] D1 List every custom column with its type (L3)
- [ ] D2 Select `includedMetadata` per path, **with a stated use for each column** (§5.2)
- [ ] D3 Confirm no selected column carries personal data
- [ ] D4 Confirm the domain and topic taxonomy, with **immutable** domain codes (T-18)
- [ ] D5 Confirm a named taxonomy owner (A-10)
- [ ] D6 Draft `domainMapping` and `topicMapping` per path
- [ ] D7 Record each sampled document's column values, version label and modified date (D2, D3)

### Phase E — Permissions and ownership

- [ ] E1 Record whether each library inherits site permissions (§7.2)
- [ ] E2 Record any item- or folder-level unique permissions
- [ ] E3 Record anything shared externally or by anonymous link — candidate exclusion
- [ ] E4 Choose `permissionMode` per source, with a reason (T-14)
- [ ] E5 Identify a document restricted from a named test principal, for T-39
- [ ] E6 Confirm the accountable owner is **separate from** the SharePoint `Author`/`Editor` (§7.1)
- [ ] E7 Decide `usableForGeneration` / `usableForRefreshers` / `usableForExplanations` — three separate decisions
- [ ] E8 Decide `restrictions`: which roles, domains, teams or business functions may read this source

### Phase F — Output

- [ ] F1 One CSV row per candidate path, columns per §1
- [ ] F2 A real-content fixture set from the Phase B sample, with `.meta.json` sidecars carrying real column values and real permission facts (§5.2 of the access report)
- [ ] F3 The format distribution table (§6.1), and the extractor work it implies
- [ ] F4 The tenant values this discovery produced, fed into [TENANT_ADMIN_REQUESTS.md](TENANT_ADMIN_REQUESTS.md): T-09 through T-14, T-17, T-20, T-21
- [ ] F5 Anything discovery could **not** answer, listed explicitly rather than left blank

---

## 9. Two cautions

**Importing documents by another route is now a directed decision, and it is governed.** This
caution originally read "do not". The direction was given to proceed, so the constraints below are
why it is done the particular way that [TRANSITIONAL_KNOWLEDGE_SOURCE_PLAN.md](TRANSITIONAL_KNOWLEDGE_SOURCE_PLAN.md)
specifies — through the `FILE_REPOSITORY` template with honestly declared capabilities — rather than
an argument against doing it. `FILE_REPOSITORY` and
`AZURE_BLOB` are declared `SourceType` values with documented templates, so a file-share ingestion
path looks tempting. Note that `RELEASE_1_SOURCE_TYPES` is `['SHAREPOINT', 'MOCK']`, so this would be
a **release-scope change, not a workaround** — and it would cost the two properties the pilot exists
to demonstrate: per-user permission trimming (a file share has no per-user model, so
`supportsDelegatedAccess` must be `false` and everything becomes platform-trimmed) and real source
versioning (`mtime` is unreliable, so `supportsVersionLabels` must be `false`). Those two losses are exactly why that plan
requires `supportsDelegatedAccess: false` and `supportsVersionLabels: false` to be **declared**:
template rule P1 makes emulating a capability a contract violation, so the losses stay visible on
screen instead of fading into normality.

**Discovery findings are inputs, not decisions.** Every STOP in the checklist is a conversation with
the business, not a judgement for the delivery team to make alone. The single most likely way this
pilot disappoints is a well-integrated source whose content states nothing worth testing.
