# Knowzy — User Guide

**Applies to:** the local demonstration build with the Question Acquisition Framework
(provider-based generation and question import), taxonomy administration, the SharePoint Sync
Manager, the AI Generation Control Layer, AI provider administration and Phase 10 R1 and R2
reporting, including PILOT-T1, PILOT-T2, UI-M3, SYNC-M1..M4, AI-CONTROL-M1, AI-PROVIDER-M1,
PHASE10-R1, PHASE10-R2, P-5 (secret resolution), OPENAI-CODEX-00 (provider readiness) and
OPENAI-CODEX-01 (OpenAI generation, refused until approved), LIVE-PREVIEW-M1 (four learner
preview pages), UX-M1 (navigation at every width), LIVE-PREVIEW-M2 (Badges and My Progress
previews; every learner destination opens), GATEWAY-M1 (Azure API Management
gateway authentication) and GEN-PROVIDER-M1 (choosing the provider when generating)
**Last updated:** 2026-09-28
**Audience:** anyone driving Knowzy in a browser — an author, an approver, a publisher, an
assessment manager, a learner, or someone being shown the product

> **This guide describes what the software does today.** It is not a specification. Where it and the
> design documents in this directory disagree about what *should* happen, the design documents are
> the authority and this guide is out of date. Where it and the running software disagree, the
> software is right and this guide is out of date.
>
> **What you are using is a demonstration build.** It runs only on one machine, against fixture
> documents, with identities you pick from a list rather than sign in to. §10 says exactly what is
> and is not real.

---

## 1. What Knowzy does

Knowzy turns documents your organization already has into quiz questions that a person has read and
approved, and then into assessments a learner can take.

The shape of it, end to end:

```
a knowledge source          →  documents are indexed and split into sections
a document selection        →  draft questions, each grounded in a quoted span
a review                    →  an author fixes, submits
an approval                 →  a DIFFERENT person approves, against 13 gates
a publication               →  the question enters the Question Bank with an ID
an assessment               →  a published set with its question pool pinned
a learner                   →  one question at a time, answers saved server-side
a result                    →  a score, per-topic accuracy, and knowledge gaps
```

Two rules shape every screen you will see, and they are not configurable:

- **No question reaches a learner without a human approval,** and the person who approves cannot be
  the person who wrote it.
- **Every question must quote the document it came from.** A question whose evidence cannot be
  verified against the source text is refused at generation, not at review.

---

## 2. Before you start

### 2.1 Start the stack

From the repository root:

```bash
docker compose -f infrastructure/compose/docker-compose.yml up -d
```

That brings up PostgreSQL, the API, the MCP server, the job runner, all three web applications,
and Mailpit. The first start also applies migrations and seeds the local users, roles, and taxonomy.

### 2.2 The addresses

| What | Where |
| --- | --- |
| **Authoring Portal** | http://localhost:3000 |
| **Live Learning Portal** | http://localhost:3001 |
| **SharePoint Sync Manager** | http://localhost:3002 — an operations console, not a learning screen (§6) |
| API | http://localhost:8080 — the portals call it from their own process; you do not need it |
| Mailpit (captured mail) | http://localhost:8025 |

Start at **http://localhost:3000**. The three applications are separate on purpose and there are no
links between them — open each in its own tab.

### 2.3 If a page says "API unreachable"

The portals tell you honestly when they cannot reach the API rather than showing an empty screen.
The usual cause on a development machine is that `npm` was run on the host while the containers were
up, which empties the dependency volume the containers share. The fix:

```bash
docker compose -f infrastructure/compose/docker-compose.yml up migrate
docker compose -f infrastructure/compose/docker-compose.yml restart api mcp
```

If you edited source files and the browser shows no change, the containers did not see the edit —
file watching does not cross the bind mount on Windows. Restart the app you changed:

```bash
docker compose -f infrastructure/compose/docker-compose.yml restart authoring-web live-web sync-web
```

### 2.4 What surrounds every page

Both portals now share one frame. The pages inside it are the same pages, with the same controls and
the same refusals; only the furniture around them is new.

**Along the top**, on a navy band: the EssilorLuxottica mark, then the KNOWZY wordmark with its
tagline, a search field, a KNOWZY Copilot button, a notification bell, and on the right who you are
acting as. The identity line always begins with **Local Development Identity** when you are on a
demonstration build — it comes first so that a long role description cannot push it out of sight.

The search field, the Copilot button, and the bell are **deliberately disabled and labelled
"Planned"**. There is no search service, no Copilot service, and no notification service behind
them. They are shown rather than hidden so the shape of the product is visible, and disabled rather
than faked so nothing pretends to work. Anything marked Planned in this product does nothing.

**Down the left**, the destinations. Each carries its real status:

| What you see | What it means |
| --- | --- |
| A plain link | Built. It goes where it says |
| A link with grey text under it | Built, but living somewhere else in this release — the text says where, e.g. Question Bank → "On Publish" |
| "Planned" | Not built. Not a link |
| "Needs backend" | Cannot be built yet: the server capability does not exist |
| "Unavailable" | Turned off in this release |
| "Preview" | Not built, but a link: it opens a **preview page** showing how the finished screen is expected to look, labelled as a preview before anything else (§5.5). Learner portal only |

Nothing unavailable is a link, so you cannot land on a dead page, and nothing is hidden either — the
list is an honest statement of what exists. A preview is the one kind of link to something unbuilt,
and its page says so at the top.

**On a narrower screen** the same destinations are always reachable, in both portals:

| Width | Navigation |
| --- | --- |
| **Desktop** (1024 px and wider) | The full sidebar, as above |
| **Tablet** (768–1023 px) | A **collapsed rail** of icons down the left. Each icon is a link with its name as a tooltip, the current page is outlined in green, and a preview carries a small blue dot. The **menu button** (☰) at the left of the header opens the full list |
| **Phone** (below 768 px) | The **menu button** alone. It slides the full sidebar in from the left — same entries, same status chips, same notes |

The menu works from the keyboard. It opens with focus on the page you are on, Tab stays inside it,
**Escape** closes it and puts focus back on the menu button, and choosing an entry goes there. On a
phone the header also drops the disabled notification bell to make room.

**The SharePoint Sync Manager** (§6) has no sidebar — it is one dashboard. On a phone its header's
environment, identity and three disabled buttons fold behind one **Environment and settings** button. Exactly one destination is highlighted at a time, with a
green bar down its left edge as well as a colour change, so it reads without relying on colour.

**On the authoring workflow pages**, a thin ribbon under the header shows the seven stages —
Knowledge Sources → AI Generation → Review → Approval → Question Bank → Assessments → Insights — and
which one you are on. A stage is only ticked when the software knows it is complete, so an unticked
stage means "not known", not "not done". Insights has no page yet and is not a link.

**Keyboard:** the first Tab on any page offers "Skip to content", which jumps past the header and
navigation to the page itself. Everything focusable shows a visible blue outline.

---

## 3. Identities, and why you keep switching

The header of every page says who you are acting as, with your initials, your role, and — because
this is a demonstration build — the words "Local Development Identity".

**Change it from the header, on any page.** Press **Change**, beside your name, and pick an
identity from the list; each one says what it can do. The menu closes when you choose, and the
header's label updates to the identity the server is now using — that label, not the menu, is the
proof the switch took effect.

It moved here on 2026-09-26. It used to be a card at the bottom of each portal's home page, which
meant that hitting a refusal on the Publish screen required navigating away, switching, and
navigating back. A refusal happens where you are, so the control is where you are.

| **KNOWZY Administrator** *(default)* | Full Platform Access — every capability the platform has |
| **KNOWZY Administrator (second approver)** | Full Platform Access — use it to approve what the first administrator wrote |
| Identity | What it can do |
| --- | --- |
| **Source administrator** | Register sources, test connections, synchronize documents |
| **Author** | Browse documents, generate questions, edit and submit drafts |
| **Approver** | Review, comment, disposition duplicates, approve or reject |
| **Publisher** | Publish approved questions to the Question Bank, retire them |
| **Assessment manager** | Create, validate, and publish assessments |
| **Local Learner** (portal 3001) | Take assessments, see their own results |
| **Local Manager** (portal 3001) | Has no learner-portal access — there so a refusal can be shown |

**You still have to switch once, even as an administrator.** No identity can carry a question from
draft to published alone: the approval gate that checks separation of duties will refuse an approval
by the question's own author, and you will see it refuse. That is the product working, not a
configuration mistake — and it is why there are two administrator identities rather than one.

Everything *except* that one step can be done as a single identity. See below.

A screen you lack permission for does not hide — it shows the refusal, with the code and the reason.
An empty table means "nothing here"; a refusal panel means "not for you".

**If Test connection or Synchronize says "Forbidden — Requires permission
source.test" or "source.sync"**, you are acting as an identity that does not
hold it. The **Author** holds `source.read` only: it can browse documents and
generate, but not test or synchronize a source. Switch to **KNOWZY
Administrator** or **Source administrator** on the dashboard. The refusal panel
names the identity you are acting as, for exactly this reason.

**Your chosen identity persists in a cookie**, so a browser that was once set
to Author stays Author. The administrator is only the *default* for a browser
that has never chosen one.


---


### The KNOWZY Administrator identity

The identity picker's first entry, and the one selected by default, is **KNOWZY Administrator —
Full Platform Access**. It is a real production role, intended for platform and product owners,
knowledge managers, administrators, pilot leads and operational platform support. It holds every
permission the platform has, so you can move from Knowledge Sources through generation, review,
the Question Bank, assessments and publishing without ever being stopped by a missing capability.

**One thing it deliberately cannot do: approve a question it wrote itself.** That is not a gap in
the role. Separation of duties compares the approver against the author at the moment of approval,
and no amount of access changes the answer — gate 13 refuses the approval and records the refusal
before anything else happens. You will see it fail on screen with the reason.

A second identity, **KNOWZY Administrator (second approver)**, is provided for exactly that step.
Switch to it to approve, then switch back. One deliberate switch is the whole cost of keeping
approval meaningful, and the refusal you see in between is the control working rather than an
error.

Everything the administrator does is audited identically to any other identity. Governance,
approval recording, evidence verification, publishing logs and the audit trail are unchanged;
the role grants access, never exemption.

## 4. Authoring: from a document to a published question

### 4.0 The dashboard — `/`

Every number on it is counted from the same reads the screens use: configured sources, documents
indexed, questions in the bank, published assessments, and the count at each stage of the pipeline.
Nothing is estimated and nothing is compared to a previous period — no history is stored, so a
"vs last month" could only be made up.

Two panels list what needs a person: **drafts awaiting an author** (lowest confidence first) and
**submitted for approval**, which is somebody else's work by design.

If a figure is missing rather than zero, the panel headed **Not visible to this identity** says
which read was refused and why. As the Author, for instance, the assessment figures are absent
because the Author has no `assessment.read` — so a zero on this page always means zero.

The identity picker is at the bottom.

### 4.1 Knowledge sources — `/sources`

Act as the **source administrator**.

The page lists each configured source with its connection health, how many paths it reads, and how
many documents it has indexed.

1. **Test connection** runs the checks the adapter declares and shows each one with its outcome. A
   `SKIP` is an honest answer, not a failure: the mock source needs no credential and does not
   support live search, so it says so instead of pretending. Underneath, the declared capabilities
   are listed — a capability a source lacks is reported `false` rather than emulated.
2. **Synchronize** indexes the documents and extracts their text. The result gives you scanned,
   added, modified, unchanged, **failed**, **skipped**, and the character count extracted.
   **Failed and skipped are different things and are listed separately.** A failure is something
   that went wrong: a file the reader could not open. A skip is the configuration working: a file
   that sits in the tree but outside the folder this source is configured to read. Skips are listed
   in a calmer tone underneath, so a document you expected to be indexed cannot disappear quietly
   without a reason on screen.

Both results open in a **panel on the right**. Close it with the × or the Escape key; the page
behind it does not move while you read. The three figures above the table — configured sources,
usable for generation, documents indexed — are counted from the same list you are looking at, and
carry no comparison to any earlier period, because none is stored.

The specification's **Owner** and **Scope** columns are not there. A source has no owner field in
this build, and a made-up name attached to a real person's job is worse than a missing column.

If a document is listed in the fixture but not in the count, that is deliberate: a document the
caller may not read is skipped per-item, and the sync still succeeds. It never appears in browse,
search, or generation.

#### Reading a synchronized SharePoint folder (transitional)

While Graph access is unavailable, a source can read a **locally synchronized mirror** of an approved
SharePoint folder — the folder you get from *Add shortcut to OneDrive* or *Sync*. Microsoft's own
client does the authentication and the file transfer; Knowzy just reads the directory.

What you see on such a source, and should read carefully:

| | |
| --- | --- |
| **Every document links to SharePoint, not to a file on disk** | A published question's source link opens the real document in the library. No local path is ever stored |
| **Access is enforced by Knowzy, not by SharePoint** | Test Connection says so explicitly. Per-user SharePoint trimming is **not** available, so who can see a document is decided by role, domain, team and business function inside Knowzy |
| **The corpus is whatever one account can see** | The mirror contains exactly what the synchronizing person has access to. That account is recorded on the source |
| **No version numbers** | A synchronized file has no SharePoint version, so "the source changed" is detected from content and reported without a version |
| **Files must be downloaded, not cloud placeholders** | Mark the folder *Always keep on this device*. Test Connection fails with that instruction if any file is still a placeholder |

Test Connection runs nine checks and names the useful one plainly: how many of the matched documents
have a reader at all. A library of formats Knowzy cannot read is reported **before** you synchronize
rather than after.

### 4.2 Document browser — "Browse documents"

Act as the **author** (or stay as the administrator to look).

Pick a library from the **tabs** across the top — each carries the number of items in it — then
walk into folders by clicking their names. A breadcrumb above the table shows where you are and
takes you back up. Each document row shows its type, extraction state, section count, extracted
characters, and — the column that matters — **Selectable**. Only an extracted document can be a generation input; one that is not
selectable will not be offered on the Generate page.

**View sections** shows how the document was split: the heading path, the character offsets, whether
the section is assessable and why not if it isn't, and whether a question already covers it. The
offsets are the platform's claim about itself — the evidence a question quotes is exactly
`text.slice(start, end)` of the extracted document.

#### Which document formats can be read

| Format | Read? | What to expect |
| --- | --- | --- |
| **Word** `.docx` | Yes | Headings become sections. Tables are read as text. **Tracked deletions are ignored and insertions are kept** — a question is never built from a sentence the author removed. Comments, headers, footers and hidden text are ignored |
| **PDF** `.pdf` | Yes | Text per page, with the page number kept so a reviewer can find the quote. A **scanned** PDF has no text to read and is reported as empty — there is no OCR. A password-protected PDF is refused |
| **PowerPoint** `.pptx` | Yes, in presentation order | Speaker notes are ignored. Bear in mind slide text is often a fragment rather than a sentence, so slides frequently produce no questions |
| **Excel** `.xlsx` | Yes | Rows are read as text with the sheet name kept. A formula's **result** is read, not the formula. A sheet of data states no rule and will produce nothing; a policy table may |
| **Text, Markdown, HTML** | Yes | As before |
| `.doc`, `.xls`, `.ppt` (pre-2007) | **No** | A different file format entirely. Save as the modern equivalent |
| Anything else | **No** | Reported as unsupported, with the extension named. Never silently skipped |

A document Knowzy cannot read is always **reported with a reason**. It is never counted as read with
no content, because that would look like a document with nothing in it.

### 4.3 Generate questions — `/generate`

Act as the **author**. Three steps, in order, and they cannot be collapsed.

**Step 1 — choose documents.** Tick one to ten documents. There is no "all documents" option; an
unticked run is refused with a reason. Then **Check documents** (this is the preflight; the button
was called *Run preflight* before UX-M2).

**Step 2 — check what the documents support.** Preflight runs six checks and shows, for each
selected document, a coverage bar, a **section accounting** row, and then every check by name with
its verdict, the sentence explaining that verdict, and the facts behind it.

The section accounting shows five numbers side by side, and it is worth understanding what separates
them, because a single coverage percentage cannot:

| Number | Means |
| --- | --- |
| **Assessable** | Sections long enough to test and not marked as document furniture. Everything else is measured against this |
| **Attempted** | Sections that have been in at least one generation run's scope |
| **Generated** | Sections a question actually cites. **This, over assessable, is the coverage percentage** |
| **Refused** | Sections where a run looked and reported nothing testable. This is a fact about the run, **not** a verdict that the section could never be assessed |
| **Unresolved** | Assessable, no question, and no refusal — including sections nothing has looked at yet |

A high **Refused** count with a low **Generated** count means the generator could not form questions
from this material, not that the material is unassessable. Before 2026-09-22 refusals were counted
as coverage, so a document could read 100% covered with two questions across eight assessable
sections; the accounting row exists so that cannot happen silently again.

| Check | What it shows you |
| --- | --- |
| `PREVIOUSLY_PROCESSED` | Whether this document has been generated from before, when, and the job ids |
| `APPROVED_QUESTIONS_EXIST` | How many questions already exist from it, split into approved, published and draft, with a link to them |
| `SOURCE_CONTENT_CHANGED` | Whether the version or the content hash has moved since |
| `SIMILARITY_RISK` | The saturation behind the verdict — existing questions over assessable sections |

Two further checks are about the whole selection rather than one document:
`CROSS_DOMAIN_DUPLICATES` (how many near-matches exist in other domains) and `POOL_CONFLICTS`.

It gives a **recommendation** and a reason. Read the facts, not just the badge: a check reading HIGH
tells you its verdict, and the line under it tells you why, which is what you need in order to
choose between generating more and reusing what is there.

A preflight authorizes nothing. Choose an action — the recommended one is selected for you — and
**Record decision**. The choices mean:

| Action | Meaning |
| --- | --- |
| `GENERATE_NEW` | Nothing exists from this document yet; generate from scratch |
| `GENERATE_ADDITIONAL` | Keep what exists, add questions for what is not covered |
| `REUSE_EXISTING` | Do not generate; the existing questions are enough |
| `VIEW_EXISTING` | Look at what is already there first |
| `REGENERATE` | Replace what exists — needs the Publisher role and a justification |

`VIEW_EXISTING` and `REUSE_EXISTING` are decisions **not** to generate, and the server refuses a
generation job recorded against either. So recording one of them does not offer Step 3; it offers a
link to the questions that already exist for each selected document.

**Step 3 — generate.** A **Before you generate** panel opens the step and answers five questions in
one place: **Documents** (how many, and the first three names), **Generated by** (the provider and its
model), **Questions** (*Up to n* — fewer if the documents do not support more, never padded),
**Status** (*Ready to generate*, or that a justification is needed) and **What happens next** (the
drafts go to the Review Queue, and a different person approves each one before it can be published).
It follows the fields below as you change them. Pick the domain, topic, scope, reason code, and how
many questions you want, then **Generate questions**. Questions come **only** from the documents you selected in Step 1 — a
proposal citing any other section is refused. **The number you ask for is a maximum:** a generator
that proposes more has the surplus counted and set aside (the result shows *Beyond the request*),
and one that finds too little verifiable material in the selected documents returns fewer, with each
section's reason. It never pads the count with questions the documents do not support. The reason code **PUBLISHER_REQUESTED** is a regeneration: it needs the
Publisher role and a written **Justification** of at least 20 characters, and the box for it appears
when you choose that reason. Without one the job is refused with *Generation justification
required*.

**Which source Step 1 lists** is chosen at the top of the page: **Knowledge source**, then **Use this
source** (shown when more than one source is usable for generation; it opens on the first). With only
one usable source the page says **Documents come from:** and its name instead. Check it before generating with a network provider, because its
sections are what is sent. Switching source starts the wizard afresh.

**Generated by** lists every declared provider. The ones that cannot run right now are shown but
**disabled**, and *Why n providers cannot be chosen* opens each one's reason — not approved, not
enabled, no client, or unable to ground a question. The default is the **active** provider
(Administration → AI Providers) when it can run, and the deterministic generator otherwise. Choosing
a network provider such as **Codex via Azure APIM** says so plainly: *the selected sections are sent
to it*. What it proposes goes through exactly the same checks and arrives as drafts for review. The
list is a menu, not the control: if a provider stops being available between opening the page and
pressing Generate, the request is refused with the reason.

In the **Review Queue** (§4.4) each draft carries a badge saying what drafted it — **AI ·
gpt-5.3-codex_codeassist**, **Template generator** (the deterministic local generator), or
**Imported from a file**.

The result is a count *and* the refusals, with the **rejection breakdown** — which control refused
how many candidates — plus the scope, the job reference and the model usage. A section that produced nothing is reported with its
reason — most often that no set of four distinct plausible options could be built from it, or that a
question already tests it. Asking for six and getting five is normal and is not an error: the
platform would rather refuse a question than invent one the document does not support.


### 4.3a Import an existing question bank — `/import`

Act as an **author** or the **KNOWZY Administrator**. This brings a
multiple-choice bank you already have into Knowzy.

**It needs the file to be a document Knowzy already holds**, and that is not
red tape. An imported question is grounded in the file it came from: its
evidence is the exact block of text the question was read from, at real
offsets into that document. Without the file as a document there is nothing to
quote and nothing to verify, so the approval gates could not pass.

So the order is: drop the bank into a configured knowledge-source folder
(`KNOWZY Imported Question Banks` is seeded for this), **Test Connection**,
**Synchronize**, then come here.

**Two buttons, and the order matters.**

**Preview** reads the document and writes nothing. It reports:

| | |
| --- | --- |
| **Detected** | Questions recognised in the file |
| **Valid** | Questions with everything the question model requires |
| **Invalid** | Detected but unusable, each with the reason and where to look |
| **Drafts created / Refused by a gate** | Dashes until you actually import |

#### Where each question is filed

After **Preview**, the panel **Domains and topics in this file** lists every distinct Domain/Topic
pair the file itself names, with what will happen to it:

| Resolution | Meaning |
| --- | --- |
| `MATCHED` | The name matches an existing active domain or topic. Case, spacing and `-` versus `_` are ignored |
| `MAPPED` | You chose where these questions go |
| `FALLBACK` | The file names nothing for these questions, so the Domain and Topic selected above are used |
| `UNMATCHED` | The file names something this platform does not hold. **Nothing will be imported until this is resolved** |

**An import never creates a domain or a topic.** A spreadsheet typo would otherwise become a
permanent domain code — `VissionStar` is one keystroke from a real domain, and §4.3b explains why a
code cannot be taken back. Create what is missing under **Administration → Knowledge Domains**,
using the name the file uses, then preview again.

An unmatched value refuses the **whole file**, not the individual questions: a bank half-filed under
the right domains and half under a dropdown's default is harder to correct than one that never
landed.

**Create drafts** then imports what was valid. Each question becomes a
**DRAFT** in the review queue and goes through exactly the same gates as a
generated one — evidence verification, integrity, duplicate detection, the 13
approval gates, and approval by a different identity. **Importing a question
publishes nothing.**

#### What it can read

| Shape | Recognised as |
| --- | --- |
| A spreadsheet with a header row naming `Question`, `A`, `B`, `C`, `D`, `Answer`, `Explanation` (and optionally `Domain`, `Topic`, `Difficulty`, `Tags`, `Source`) | **TABULAR** |
| A question slide followed by an answer slide | **SLIDE_PAIR** |
| A stem, then options A to D, then `Answer:` and `Explanation:` — on their own lines **or** all on one paragraph | **PROSE** |

Formats: `.docx`, `.pdf`, `.pptx`, `.xlsx`, `.md`, `.txt`, `.html` — whatever
the platform can already extract.

**You do not have to rename your columns.** The spellings a working template
actually uses are recognised as they are: `QuestionText`, `OptionA`..`OptionD`,
`CorrectAnswer`, `AnswerKey`, `Justification`, `SourceDocument`, `Choice A`,
`Option_A`, and the plain `A`..`D`. `CorrectAnswer` may hold the letter (`C`)
or the letter with the option text after it.

**Trailing columns may be left blank.** A template that names fifteen columns
and fills the first twelve — `SourceDocument`, `ApprovedBySME` and
`LastReviewed` left for a reviewer — imports normally. A spreadsheet writes
nothing at all for an empty cell at the end of a row, so those rows arrive
short, and that is expected rather than a problem.

**One thing in a spreadsheet cell still cannot be read: ` - ` inside the text
of a cell.** The extractor separates columns with a dash, so a cell containing
`sudo su - root` cannot be told apart from two columns. That row is reported
with the value it found in the answer column and skipped; the rest of the file
imports. Write it without the spaces (`sudo su -root`) or put it in a cell of
its own.

**A Word or PDF bank needs an explanation for every question.** The first real
Word bank this met had a stem, four options, and `✅ Correct Answer: C` — and
no explanation anywhere. Every question in it was detected and then refused,
because a learner sees the explanation on review and the question model has
nowhere to store "there wasn't one". Add a line per question:

```
Explanation: A restart happens only after a request from the impacted lab.
```

The decoration in front of the keyword does not matter — a tick, a bullet, a
dash and a bold glyph all read the same — and `Rationale:`, `Why:` and
`Reason:` are accepted alongside `Explanation:`. In Word the four options may
sit on one line or on four; both are read.

#### Why something was not imported

The list under **What was not imported, and why** separates three stages,
because they need different fixes:

- **DETECTION** — nothing was recognised there. Usually a missing header row,
  or options that do not run A, B, C, D in order.
- **VALIDATION** — a required field was missing. No answer, no explanation,
  two identical options, a stem shorter than fifteen characters. Import holds
  the **same thresholds generation holds**, so the review queue never contains
  two standards of question.
- **GATE** — it reached a gate and failed it. Most often `DUPLICATE`: the bank
  has already been imported, so every question matched one that exists. That is
  the expected result of importing the same file twice, and the screen says so
  rather than claiming drafts were created.

#### What is not built yet

**There is no file upload in the browser.** The file has to reach a
synchronized folder first. Adding an upload means a filename-traversal guard,
a size ceiling, a type allow-list and a writable mount — four controls that
have to be right rather than merely present — so it is deliberately left for
its own change rather than half-built here.

### 4.3b Knowledge Domains — `/administration/taxonomy`

Act as the **KNOWZY Administrator** or a **platform administrator** (`taxonomy.manage`).

**This is where domains and topics come from.** Until now the platform had exactly one domain and
one topic, from the seed, and no way to add a second — so an imported question bank about VisionStar
was filed under Support Operations / Escalation and Billing, because that was the only choice on the
screen.

Two tables: **Domains** and **Topics**. Search matches a domain code, a domain name or a topic name,
and the filter shows active, deactivated, or both. The result is a URL you can send to someone.

#### A domain

| Field | Rule |
| --- | --- |
| **Code** | Letters, digits and underscores, upper-cased. It appears in every published question id as `KNZ-{CODE}-2026-000001` |
| **Display name** | Editable at any time, forever |
| **Description** | Optional |
| **Active** | Deactivating hides it everywhere it could be selected. Nothing is deleted |
| **Require SME sign-off** | Carried on the domain, as it already was |

**The code becomes permanent, and the screen tells you when.** While nothing references the domain,
the code is an editable field with a note saying so — that window exists so a typo can be corrected.
As soon as a question, assessment or question set uses the domain, the code turns into plain text
marked **Permanent**, with the counts that locked it. A published question id carries the code into
the SharePoint Question Bank, which is outside this platform, so a rename would orphan identifiers
Knowzy cannot reach.

A duplicate code is refused and the refusal names it. Two codes that differ only in case are the
same code: `visionstar` is stored as `VISIONSTAR`.

#### A topic

A topic belongs to **exactly one domain**, chosen when it is created and never changed afterwards —
moving a topic would take its questions' lineage with it. Its name is unique **within its domain**,
so "Patching" can exist in two domains and means something different in each.

Names are compared after folding case, spacing and punctuation. `SAP Integration`,
`sap integration` and `SAP  Integration` are one topic, and the second attempt is refused.

#### Deactivate, never delete

There is no delete button, and that is deliberate. A domain or topic with questions cannot be
removed without destroying the lineage every published question depends on. Deactivating:

- removes it from the generate form, the import screen and assessment creation;
- makes a generation job against it refuse;
- **changes nothing about existing questions.** They stay published, keep their ids, and stay
  answerable in the Live Portal.

Deactivated rows stay visible on this screen so they can be reactivated. Every create, edit,
activation and deactivation is audited with what changed.

#### What is not here yet

The rest of **Administration** — generation profiles, duplicate and proficiency thresholds, field
mapping profiles, badge definitions, the Question Bank target — has no backend and is still marked
**Needs backend** in the sidebar. **Merging** two topics is specified and not built: the column
exists in the data model, and the operation that rewrites every reference in one transaction does
not. Deactivate the wrong one instead.

### 4.3c AI Usage & Budgets — `/governance/ai-usage`

**Governance → AI Usage & Budgets.** Who generation is costing, how close it is to a ceiling, which
providers exist and whether they work. Open to anyone holding **report.read** — a Reporting User, a
Report Publisher, a Manager, an Auditor or the KNOWZY Administrator.

It works now, before any paid provider is connected, because the deterministic generator runs
through exactly the same accounting. What you are looking at is real, small, and zero-cost.

**The rule this screen follows and the reason it matters:** every figure is a count of records that
exist. Where nothing has been recorded it says **Not Yet Recorded**. Where a cost cannot be known it
says **Not observable** — never `0.00`, which would claim a measurement nobody took. And there are
no trends anywhere, because no history of these numbers is stored to compare against.

**Eight figures**, then four panels:

- **Providers registered** and **available**. Available means four things at once: a client exists in
  this build, a data-processing approval is recorded, the credential resolves, and the provider does
  not do its own retrieval. Today that is one provider.
- **Total generations**, **questions generated**, **estimated tokens**, **active authors** — counts
  over the last 30 days.
- **Remaining daily budget** and **budget utilization**, from the ceilings below.

**Budget windows.** Daily, weekly and monthly, in **tokens** rather than money, each showing budget,
used, remaining and a state: `HEALTHY`, `WARNING` (at 80%) or `EXHAUSTED`. Weekly and monthly are
rolling 7- and 30-day spans, and the screen says so rather than implying a calendar month. One thing
to know: these windows count what the control layer recorded **per attempt**, which starts on
2026-09-24 — so a job generated before that appears in the figures above and not in these windows.
The panel says this too.

**Providers.** Every provider the platform declares, including the ones it will not use, each with
its state and **the reason beside it**:

| State | What it means for you |
| --- | --- |
| `AVAILABLE` | Usable now |
| `BLOCKED_BY_CAPABILITY` | It retrieves its own context, so it cannot ground a question in the documents you selected. Nothing configurable changes this |
| `BLOCKED_BY_APPROVAL` | No data-processing approval is recorded. A signature, not an engineering task |
| `UNAVAILABLE` | No client for it exists in this build yet |
| `BLOCKED_BY_CONFIGURATION` | Its credential does not resolve here |

A provider that has never run shows **Not reported yet** for its version, because there is no
version to claim.

Under each state is the provider's **Readiness** — configured, secret resolved, authenticated, and
so on — exactly as Administration → AI Providers shows it (§4.3f), from the same last Test
connection.

**Usage timeline.** Generation grouped by day, week or month — requests, questions, tokens and cost.

**Generation history.** The most recent jobs with the person, the provider, the mode, the tokens, the
cost and the outcome — **including the ones that were refused**, with the reason. A refusal is not a
failure: it is the platform deciding, and it reads as `REFUSED` rather than `FAILED`.

#### Setting a token limit for a provider

If you hold **platform.configure** (the KNOWZY Administrator), each provider row has **Set limits**.
You can cap, for that provider alone: the per-job ceiling, the daily, weekly and monthly ceilings,
and how many jobs may run at once.

Two things to get right:

- **Leave a field empty to keep the platform ceiling.** An empty field is not zero.
- **Clearing every field removes the override; setting 0 forbids generation** for that provider.
  Those are deliberately different gestures, so there is always a way back to the default.

A per-job ceiling above the daily ceiling is refused, because no job could ever run under it.

The change takes effect on the **next job**, is recorded in the configuration change log with its
previous and new value, and is audited.

#### What you will see when a ceiling stops a job

Generation refuses with the numbers in it — for example *"The daily budget is 2,000,000 tokens,
1,980,400 are spent, and this job needs about 31,000 more. It resets at …"* — and the job is
recorded as **REFUSED** with that reason. Nothing is silently trimmed: the platform does not quietly
generate five questions because twenty would have breached a ceiling.

---

### 4.3d Departments and Roles — `/administration/taxonomy`

On the same screen as Knowledge Domains, two more catalogues: **Departments** and
**Roles**. Together with the domain and the topic, they are the four axes a
question is filed under — so a report can ask "how is Support-RXNET doing on
RxNet troubleshooting, for Senior Developers".

**Add one** with **New department** or **New role**: a code, a display name, an
optional description. The code is normalized to upper case with underscores, so
`support-ng`, `Support NG` and `SUPPORT_NG` are the same code rather than three
departments that look identical in a dropdown.

**What is permanent and what is not**, exactly as for a domain:

- the **display name** is editable forever;
- the **code** is editable only while nothing references the entry. Once a
  question, a published question or a generation job refers to it, the field is
  replaced by the sentence "The code … is now permanent", because the code is
  copied into the published record and is what past reports grouped by;
- **nothing is ever deleted.** Deactivate instead: the entry disappears from
  every selection surface, existing filings keep it, and filing something NEW
  against it is refused with a reason rather than silently accepted.

**A role does not belong to a department.** Intern, Developer and Senior
Developer apply across the organization, so the two lists are independent and a
question can combine any department with any role.

**Questions that already existed carry neither.** That is deliberate: they were
drafted before these catalogues existed, and the platform records what it knows
rather than guessing. New generation and new imports can file under both.

---

### 4.3e Audit Explorer — `/governance/audit`

**Governance → Audit Explorer.** Everything the platform has recorded about
itself: who did what, to what, with what outcome. Open to anyone holding
**audit.read** — the Auditor and the KNOWZY Administrator.

There are **64,479 events** on this machine already, written by every milestone
since the first one. Until this screen existed, nothing could read them.

- **Four figures**: events in the window, and how many succeeded, failed or were
  **denied**. A spike in denials usually means a misconfigured scope rather than
  an attack — and either is worth knowing.
- **Filters**: family, action, actor, entity type, outcome, a date range, and a
  correlation id. The filter options are read from the events that **exist**, so
  the screen never offers a value that could only return nothing.
- **Busiest actions** in the window, each a link that narrows to itself.
- **View details** on any row opens the event as recorded — its detail keys, its
  previous and new value where it changed something, the policy, the IP address
  and the request id — plus the **correlated trace**: every event that shared
  the same request, in order. One click of Approve produces several events, and
  this is where you see them as one story.
- **Export CSV** takes the filtered set, up to 200 rows, and says how many of
  the matched total it contains. The export is itself audited.

Two things worth knowing about what you are reading:

- **Nothing is hidden on this screen, and nothing needs to be.** No secret,
  token or document body is ever written to audit, so an auditor reads it
  unscoped — an auditor with partial visibility cannot audit.
- **Question text and answer keys are not in audit**, by design. They live in
  the question's own version history, where they belong.

---

### 4.3f AI Providers — `/administration/providers`

**Who can open it:** anyone with `report.read`. **Who can change anything:** the KNOWZY
Administrator (`platform.configure`).

Every generation provider the platform declares, whether it can run a job, and what to do about it
if not. Reached from **Administration → AI Providers**, beside Knowledge Domains.

**The providers you cannot use are listed too.** Five of the six are unusable today, and each row
carries the reason rather than being hidden. That matters because the reasons need four different
people:

| It says | What it means | Who fixes it |
| --- | --- | --- |
| `BLOCKED_BY_CAPABILITY` | The provider retrieves its own context, so a question it drafts cannot be grounded in the sections you chose | Nobody. It is permanent. Microsoft Copilot is here |
| `BLOCKED_BY_APPROVAL` | No data-processing approval is recorded | Privacy, Legal, InfoSec — then record it here |
| `UNAVAILABLE` | No client for this provider exists in this build | A release |
| `BLOCKED_BY_CONFIGURATION` | Nobody has enabled it, or its credential reference does not resolve | An administrator, here |
| `OVER_BUDGET` | Usable, and out of tokens for the current window | Wait for the window, or raise the ceiling |
| `AVAILABLE` | It can run a job now | — |

The checks run in that order, **most permanent first**, so the reason you read is the one you can
least easily change. It would be a waste of a week to be sent to get Copilot approved for something
it can never do. That list is the **Generation gate** on each row: whether a job would run.

**Readiness sits above it**, and answers a different question: how far along the path you are. It
comes from the settings and the last **Test connection**, and drops back to `CONFIGURED` whenever
you change the base URL, model or reference:

| Readiness | What you have proved | Next step |
| --- | --- | --- |
| `BLOCKED_BY_CONFIGURATION` | Base URL, model or reference missing; or the secret did not resolve; or the host is not allowed | Fix what the reason names |
| `CONFIGURED` | Settings are complete; not tested since | **Test connection** |
| `RESOLVED` | The secret was read; the provider did not accept it | Check the key in the store |
| `AUTHENTICATED` | The provider accepted the key; the model is not available to it | Check the model name |
| `BLOCKED_BY_APPROVAL` | Endpoint, key and model all verified | The data-processing approval (T-29) |
| `UNAVAILABLE` | Cannot ground, no client, unreachable — or everything verified, but this build cannot generate with it | A release |
| `AVAILABLE` | Everything, and it can generate | — |

**OpenAI (Codex) is the first external provider that can generate.** Its row reads *Generation:
yes*. It still generates nothing until four things are true: a data-processing approval is recorded
(T-29), it is enabled, its credential resolves, and Test connection has passed. Until then it reads
`BLOCKED_BY_APPROVAL` or `BLOCKED_BY_CONFIGURATION`, and **Make active** stays refused. Once it is
`AVAILABLE`, its questions are **proposals**: they go through exactly the same checks as the
deterministic generator's (verbatim evidence, duplicates, integrity) and land in the review queue as
drafts, and a person still reviews and a different person still approves. Once it is available it
can be chosen on the Generate screen (§4.3). Each row also lists what the provider **declares**: generation,
cost reporting, token reporting, streaming and retrieval-free, each yes or no.

**Four things you can do per provider:**

- **Configure** — its display name, endpoint, model, credential reference, temperature and maximum
  output tokens, and whether it is **Enabled**. For an external provider there are two more:
  **API style** (Responses, the default and the only one Codex models are served on, or Chat
  Completions) and **Auth header name** (empty sends the key as a Bearer token; a gateway may need
  its own header, such as `api-key` or `Ocp-Apim-Subscription-Key`). Since GATEWAY-M1 there are
  three more, for a gateway in front of the model:
  - **Authentication location** — **Header** (the default) or **Query parameter**. An Azure API
    Management gateway may take its subscription key as a query parameter. There is no fallback:
    leave the other location's name empty, or the save is refused.
  - **Authentication query-parameter name** — e.g. `subscription-key`. The key is added to the
    request only as it is sent; it is never stored in, or shown as part of, a URL.
  - **Fixed extra headers (not secret)** — one per line as `name: value`, e.g.
    `x-openai-supplier: EssilorLuxottica`, sent on every request. They are ordinary configuration
    and appear in the change history, so a name that looks like a credential (`authorization`,
    `cookie`, anything containing `api-key`, `subscription-key`, `token`, `secret` or
    `credential`) is refused, as are headers the HTTP client controls (`host`, `content-type`, …),
    a duplicate, and more than five.

  The row shows the authentication (*Header authorization* or *Query parameter subscription-key*)
  and the fixed headers under the endpoint. Enabling one needs its endpoint, model and
  credential reference set first: an incomplete provider is refused at generation time, where the
  reason is much harder to find.
- **Record approval** — a separate dialog, on purpose, and it **requires a reference** to where the
  approval is held: a document id, a ticket, a signed decision, or — if that is how it arrived — a
  message with who sent it and when (*"Teams message from <approver>, <date>"*). A credential is not
  authorization, and an approval nobody can trace is not one. Once recorded the button reads
  **Manage approval**, and the dialog offers **Replace reference** (the previous one stays in the
  audit trail) and **Withdraw approval**, which needs no reference.
- **Set limits** — the per-provider token ceilings (per job, daily, weekly, monthly), concurrency
  and retry cap (maximum attempts).
- **Test connection** — see below.

**About the credential field.** You type a **reference**, never a key: `localstore://{name}` for the
local secure store, or `keyvault://{vault}/secrets/{name}` for Azure Key Vault. Anything that looks
like a key is refused before it is stored. The row now **shows the reference** and its source — a
reference names a secret and is not one — but the box stays empty when you reopen the dialog:
**leave it empty to keep the recorded reference**, or tick **Remove the recorded reference**. The key
itself never appears on any screen, in any response, or in any log or audit row.

**Putting a key in the local secure store.** There is deliberately no way to type a key into the
browser. On the machine running the stack:

```
npm run secrets -- init
npm run secrets -- set openai-api-key      # paste the key at the hidden prompt
```

then record `localstore://openai-api-key` in the provider's settings. `npm run secrets -- list` shows
names only; `status` says whether the store is readable. The store lives in `.secrets/` at the
repository root, which is never committed and never copied into an image. It works in the local
environment only — a deployed environment reads Key Vault, which this build cannot read yet.

**Test connection makes real calls now, and reports only what it saw.** Ten checks, each PASSED,
FAILED, NOT ATTEMPTED or SKIPPED, with a sentence and, for the live ones, what was observed (HTTP
status, time taken):

1. **Capability**, **Approval**, **Implementation**, **Configuration** — as the gate above.
2. **Secret resolution** — reads the reference from its store. The value is used and discarded.
3. **Endpoint** (reachable), **Authentication** (accepted), **Model** (discovery) — for OpenAI, two
   GET requests: list the models, then look up the configured one. They carry the key, the fixed
   headers and the model name, nothing else — no prompt, no document, no question. They run even
   without an approval, because they process no data; generating is what the approval governs.

   **Behind a gateway with no `/models` route** (common for Azure API Management), the gateway
   answers 404. Knowzy then repeats the same request **without** the key. If that one is refused
   (401 or 403), the key demonstrably got past the gateway, and **Authentication** passes on that
   difference. **Model** then reads **SKIPPED** — *"Model discovery is not exposed by this
   gateway."* — never PASSED: the deployment name is unverified until the first generation call.
4. **Model execution** — always NOT ATTEMPTED. Running the model means sending it a prompt, and a
   test sends none.
5. **Generation** — always NOT ATTEMPTED. A test never generates.

When a call cannot connect, **Endpoint** says why, in plain words and without the key or any URL:
the host could not be resolved (DNS — often the VPN or corporate DNS), no response in time, a
refused redirect, or a certificate this server does not trust. The last reads **"NODE_EXTRA_CA_CERTS
configuration required"**: the gateway uses an internal certificate authority, and the API container
needs that authority's certificate. TLS verification is never switched off to get past it. A 401
means the key was refused, a 403 that the gateway refused access, a 429 a rate limit, and a 502, 503
or 504 that the service behind it is unavailable. The gateway's own error text is never shown.

Two safeguards you may meet: the key is sent **only** to an allowed host (for OpenAI,
`api.openai.com`; other hosts are added by the deployment in `LLM_ENDPOINT_ALLOWLIST`, not on this
screen — the local stack allows the EssilorLuxottica Codex gateway, `dev-apim-ai.luxottica.com`) and
only over https. A base URL pointing anywhere else, or one with a key already in its query string,
fails **Endpoint** with *"The key was not sent."*

The overall result is `FAILED` while no approval is recorded and at best `INCOMPLETE` after it —
never `PASSED` for an external provider, because model execution and generation were not attempted. After a run, the
button reports the new readiness and any rate limits the provider reported.

**Secret sources**, at the bottom of the page, shows each place secrets can come from — the local
secure store and Azure Key Vault — whether it is permitted here, configured and reachable, and how
many secrets it holds. Never their names, never their values.

**Make active** switches the provider generation uses by default. It is refused for any provider that
is not `AVAILABLE` — generation would be refused for every job, so the switch is refused instead.

**Enable and make active** appears on a provider that is approved and has its endpoint, model and
credential reference recorded, but is off or not yet active. It does both in one step — two ordinary,
audited writes — and each is refused with its reason if the gate would refuse it. It never touches
the credential reference.

---

### 4.3g Reports — `/reports`

**Who can open it:** anyone with `report.read`. **Who can export:** `report.export`. **Who can
snapshot:** `report.create`. **Who can refresh on demand:** the KNOWZY Administrator.

A visual dashboard and twelve reports over records the platform already holds, with a tab strip:
**Dashboard**, **Question pipeline**, **Generation**, **Assessments**, **Filing**, **Sources**.

#### The dashboard

Two controls sit above it: **Period** (the last 30, 90 or 365 days — it drives the headline figures,
the learner heatmap and the AI summary) and **Trend range** (30 days by day, 90 days by week, or 12
months by month). Both are part of the address, so a filtered dashboard can be sent to somebody.
Under every panel is the moment its data was true and, where it covers a period, the two dates it
resolved to.

| Panel | What it shows | Where its numbers come from |
| --- | --- | --- |
| **Headline figures** | Eight cards: total questions, published questions, assessments completed, pass rate, knowledge sources, coverage, AI generations, estimated AI cost. Each shows its own formula | The same read models as the reports below |
| **Question generation trend** | Two lines, generated and published questions per period. The current period is drawn hollow at the end of a dashed line and labelled as still in progress | Generation jobs and publications, which carry their own dates |
| **Questions by status** | A donut of the design's five buckets — Published, Approved, In review, Draft, Rejected — **plus Retired or archived**, so the buckets add up to the total in the centre | The on-write pipeline counter |
| **Questions by department and job role** | Columns are job roles, stacked by department. **Not filed** is a column and a colour of its own | How each question is filed |
| **Learner performance** | Departments × topics, coloured in five bands (< 60%, 60–70%, 70–80%, 80–90%, ≥ 90%), with the number printed in every cell. Three measures: **Average score**, **Pass rate**, **Attempt success** | Scored topic results |
| **Recent activity** | The latest platform events — assessments published, questions approved and published, sources synchronized or added, questions generated, AI provider validations — with **View all in the Audit Explorer** | The audit trail |
| **Knowledge source health** | Per source: documents, sections, a coverage bar, questions, last sync, status. **Read-only** — synchronizing and pausing stay in the Sync Manager | The source coverage model; the last sync is live |
| **AI usage and budgets** | Generations, tokens, estimated cost and today's budget remaining, then one row per provider with its state, tokens, cost and health | **The same read Governance → AI Usage & Budgets uses**, linked rather than copied |

**The comparison under each headline figure.** Every card says what it is measured against, or
that it cannot be yet:

- A **count over the period** — assessments completed, pass rate, AI generations, estimated cost —
  is compared with the same count over the period immediately before it: *"vs previous 30 days"*.
- A **figure describing a moment** — total questions, published questions, knowledge sources,
  coverage — is compared with the **coverage snapshot** recorded on the day the period began:
  *"vs the 28 Aug 2026 snapshot"*. Snapshots are recorded once a day, at five past midnight UTC,
  and **never back-filled**. The first was recorded on 2026-09-27, so on a 30-day period these four
  cards read **Not Yet Available** until 2026-10-27, and the hover text says exactly that.
- A pass rate or a coverage figure moves in **points** (`+4 pts`), never in a percentage of a
  percentage. A change from zero shows the change but no percentage.
- Other honest answers you will see: **Comparison withheld** (one of the two periods had fewer than
  five learners), **Not observable** (a cost that cannot be known), and **Not available for your
  scope** (a snapshot is platform-wide, and your view is restricted to some domains).

The arrow's shape and the sign carry the direction. The colour does not judge it — a rise in cost
is not good news.

**Reading the learner heatmap.** *Department* means the department the **questions** were filed
under, not the learner's — learners carry no department. A topic result counts under a department
only when every question asked in that topic is filed there; otherwise it counts under **Not filed**
or **Filed under several departments**. A cell covering fewer than five learners reads **Suppressed**
on a hatched background, and so does any cell that could be worked out from the rest of its row or
its column; the panel says how many cells were withheld and why. With few learners, expect most of
the grid to read Suppressed. That is the privacy rule working, not an error.

**Reading recent activity.** Nobody is named. A completed assessment is never listed one learner at
a time: completions are grouped per assessment per day and shown only when at least five learners
took part, with the number of withheld days stated. An AI provider validation shows its **recorded
outcome** — today always FAILED or INCOMPLETE, because nothing in this build can call an external
provider — and never the word "verified".

#### The reports

Every dashboard panel has **Open the report**, which is the same data as a full table with its
export, its snapshot and every formula. The reports behind the tabs:

| Report | Grain | Answers |
| --- | --- | --- |
| Question pipeline | domain × lifecycle state | Where every question in the bank currently sits |
| Generation | provider × model × prompt version × day | How many jobs ran, what they yielded, what was refused |
| Assessments | assessment version | Attempts, pass rate, mean and median score, band distribution |
| Filing | domain × topic × department × role | How the bank is filed on all four axes, and how much is unfiled |
| Sources | source × document | Sections, coverage, and how many questions each document produced |

**Four things every report tells you that most reports do not.**

**Data as of.** The moment the underlying data was true, taken from the read model's own refresh
record and never from the clock. Five of the six models refresh every fifteen minutes; the question
pipeline is maintained as questions move, so it is exact and instant. If a model has never
refreshed, the report says **"This report has never been built"** rather than drawing zeros.

**The resolved window.** Choose "Last 7 days" and the page prints the two absolute dates it resolved
to, so a relative choice stays checkable. A report that describes *now* rather than a period says so
and ignores the filter instead of pretending to apply it.

**Every formula.** At the bottom of each report, one written definition per metric. "Yield" has at
least three plausible meanings; the page states which one it used.

**Suppression, when it applies.** The assessment report withholds any row covering fewer than five
learners, because an average over three people names them. A withheld cell reads **Suppressed** — never
a blank and never a zero — the header states how many were withheld and the threshold, and **a total
that lost rows to suppression reads "Withheld" rather than 0**, because a zero there would say
"nobody has taken it". There is no setting that turns this off.

It applies to that one report. A question, a document and a section are not people, so question
counts by department are shown in full — suppressing those would protect nobody and make the report
useless.

**Export** produces a CSV with a header block above the data: the report, who exported it, when, the
effective scope, the as-of date, the minimum group size, how many cells were withheld, and every
formula. A file that leaves the platform still says what it does and does not contain. Cells that
begin with `=`, `+`, `-` or `@` are defused, because a document name containing `=HYPERLINK(...)`
would otherwise become a live formula in your spreadsheet. The export is recorded in the audit trail.

**Snapshot** stores what a report says right now, with all of that header block, under a label you
give it. **It is not a published report**: a publication is a definition plus an audience,
re-rendered for each viewer under their own entitlement. A snapshot is a fixed record of what *you*
saw, and it stores withheld cells as withheld.

**Refresh data** recomputes the read models instead of waiting for the schedule. It is an
administrator action and it is audited, because "why was the number different at 14:05" usually has
the answer "somebody refreshed it".

**What this screen still does not do.**

- **No notification count.** The bell in the header stays disabled; nothing produces notifications.
- **No team grouping.** Reporting is organised by department and job role. There are no teams to
  group learners by, and none will be added in this release.
- **No provider figures for a provider that has never run.** Anthropic, OpenAI, Azure OpenAI,
  Gemini and Copilot read **Not Yet Recorded**; their health is **UNKNOWN**, which is not healthy.

---

### 4.4 Draft review queue — `/review`

**Generated by**, above the list, narrows every tab to one generator — **OpenAI Codex**, the
**Deterministic local generator**, or **Imported from a file** — and stays chosen as you move between
tabs; **Show all** clears it. The number on each tab is the **true total** for that tab under the
filter. A tab opens on its first 25 rows and says *Showing 25 of n, lowest confidence first*; **Show
25 more** at the bottom extends it, up to 100.

**Each row is readable without opening it** (UX-M2): the question, then a badge for what drafted it
(**AI · model**, **Template generator** or **Imported from a file**) beside its domain and topic, then
the first line or two of the **evidence** the question rests on, in quotation marks. The source column
names the document; hover it for the internal section key. Confidence and similarity show two
decimals.
Codex drafts usually score higher than the deterministic generator's, so without the filter they sit
at the end of the list.

Five views of the same list, at five points in the question's life:

- **Author queue** — drafts and anything sent back for changes. Yours to work on.
- **Approval queue** — submitted, waiting for someone else.
- **Approved and awaiting publication** — approved, waiting for a publisher.
- **Published** — live in the Question Bank.
- **All questions** — every state, including the ones the queues above hide: rejected, retired, and
  archived.

**To see what already exists from a document**, use `All questions` with a document filter. Preflight
links straight to it: where the checks report that approved, published, or draft questions already
cite a document, the count is a link. The published inventory on the Publish page links each row to
the same question page, so a published question's evidence, gates, and version history stay
readable after it has gone live.

Ordered with the lowest confidence first, so the questions most likely to need work are at the top,
not buried. The Duplicate column shows the highest similarity found; **Blocks approval** means a
duplicate was flagged and nobody has decided about it yet.

### 4.5 Question approval — `/review/<id>`

Everything needed to judge one question, on one page, arranged in seven tabs.

**Above the tabs: how far this question has got.** A five-stage strip reads Knowledge → Evidence
→ Review → Approval → Publication. A stage is ticked only where the platform holds the record for
it, and shows that record — the source document and its version, the evidence offsets and the model,
each decision's version and time, the bank id. A stage with no record yet says "Not reached yet"
rather than being drawn as though it had happened.

Two things it does **not** say, deliberately. It does not name the reviewer or the approver: the
platform records the decision, its version and its time, and does not expose who made it. And the
approval stage reads "Gate 13 required an identity other than the author" rather than naming a
second person — that is the control which guarantees separation of duties, stated as a control.

**Below that, and never inside a tab: the gate verdict.** It reads "12 of 13 gates pass", draws a
numbered rail with a tick or a cross on each gate, and lists the failures first with the reason for
each. **It is advisory.** The server re-evaluates every gate at the
moment of the transition, so a green verdict is a preview, not permission. It sits outside the tabs
on purpose — it is the only thing on the page that says whether this question can proceed, and that
should not be one click away.

| Tab | What is in it |
| --- | --- |
| **Question** | The question, its four options with the proposed answer marked by a tick *and* a word, the explanation, and the form to edit the explanation |
| **Evidence** | The quoted span, verbatim, with its verification mode, character offsets, and similarity. Read the question against this text: the only thing being asked is whether the question is answerable from it |
| **Source** | The document, the section key, the document version at the time of generation, and which model generated it |
| **Governance** | All 13 gates, passing and failing, each with the detail that says how to fix it; the confidence score with every component that produced it; and the duplicate disposition |
| **Filing** | The four axes this question is filed under — domain, topic, department, role — and the form to correct the last two. See below |
| **Review history** | Every review and every approval, with the version each decision was made against |
| **Version history** | Each version, what changed, and whether the evidence was re-verified |

Each tab is its own address, so you can link someone straight to the Governance tab of a specific
question.

The **decision panel** is always at the bottom, whichever tab you are on.

**A decision that cannot be taken yet is disabled and says why.** The panel names the next step
available from the question's current state, and a button the lifecycle cannot reach from here
carries the reason on hover and for a screen reader: *"Not possible while this question is DRAFT.
Available from here: AUTHOR_REVIEW."* Before this, all five decisions were offered on every
question, and pressing **Submit for approval** on a draft returned
`STATE_TRANSITION_INVALID` — which reads like a missing permission and is not one. **Claim for
authoring first.** The reasons are two different things:

- **State** — an order of operations. Claim the draft, then submit it. Nothing is wrong with your
  access.
- **Permission** — your identity does not hold what this decision requires, and the button names
  the permission key.

It is still the server that decides. The panel is advisory in the same way the gate rail is, and
the note above the buttons says so.

The actions, and who can use them:

| Button | Who | Effect |
| --- | --- | --- |
| **Claim for authoring** | Author | `DRAFT` → `AUTHOR_REVIEW`; do this before submitting |
| **Submit for approval** | Author | `AUTHOR_REVIEW` → `SUBMITTED_FOR_APPROVAL` |
| **Approve** | Approver | Publishes nothing — it makes the question publishable. Comment optional |
| **Request changes** | Approver | Back to the author. Comment **required** |
| **Reject** | Approver | Ends it. Comment **required** |

Editing the explanation creates a new version and re-verifies the evidence. An approval that
predates the current version does not carry forward — one of the 13 gates exists to catch exactly
that.

**Watch gate 13 change hands.** Open the same question as the author and then as the approver: it
fails for the author with "the approver is the original author" and passes for the approver. That is
separation of duties, visible. Where it currently refuses, a note now sits beside **Approve**
saying so, rather than leaving the refusal to be discovered by pressing the button.

**This is the one thing full access does not grant.** A **KNOWZY Administrator** holds every
permission in the platform, including `question.publish`, and can author, review, submit, approve,
publish, import, generate, administer sources and create assessments. It still cannot approve a
question it authored or last edited, because separation of duties is a comparison of two identities
rather than a permission — no single role can hold both sides of it. A pilot run therefore needs
exactly one identity switch, at the approval step, and a second administrator identity is seeded
for it. Everything before and after that step is the same identity.

If a duplicate was flagged, a disposition section appears. Say whether it is `DISTINCT` or a
`DUPLICATE`, with a note. Until someone does, approval stays blocked.

#### The Filing tab

A question is filed on **four** axes. Two of them say what it is about, and two say who it is for:

| Axis | Editable? | Why |
| --- | --- | --- |
| **Domain** | No — fixed at generation | Its code is inside the published identifier `KNZ-{CODE}-{YYYY}-{NNNNNN}`, which lives in the Question Bank outside this platform. A question whose id says `SUPPORT_OPS` while its domain says `RX_NET` is a record that disagrees with itself |
| **Topic** | No — fixed at generation | It is what the preflight authorized, and what section coverage is measured against |
| **Department** | Yes, until submitted | A label for filing and reporting. Not in any identifier |
| **Role** | Yes, until submitted | The same |

**Why department and role are editable and the other two are not.** The Generate screen chooses all
four for a whole **job**, so one wrong choice there files a whole batch the same way — and that is
exactly the mistake a reviewer notices. Department and role can be corrected per question;
re-pointing a question at a different domain would mean a new question, which the platform does not
shortcut.

**The window closes at submission.** Once a question is submitted for approval the tab shows the
current filing and the reason it is read-only: a question is approved **as filed**, and the gates
and the approval record are taken at that moment. Letting the filing move underneath an approved
question would make the approval a statement about something else.

Saving a change creates a **new version** and an audit entry carrying the previous and the new
value. It does not touch the question text, the options or the evidence span, so nothing is
re-verified — and the version row says `evidenceReverified: false` rather than claiming a check
that never ran.

If the question carries no filing at all — every question drafted before 2026-09-26 does — the
header badge reads **"No department or role assigned"** and the tab says "Not assigned". Empty is
never dressed up as a placeholder value.

---

### 4.6 Publish — `/publish`

Act as the **publisher**.

**Approved questions** are listed with a tick box each, all ticked by default. **Publish selected**
writes them to the Question Bank.

The result is per question, not one message for the batch — one can publish while another is refused
by a gate:

| Outcome | Meaning |
| --- | --- |
| `PUBLISHED` | Written to the bank, with its bank item ID and version |
| `ALREADY_PUBLISHED` | The bank already holds it; nothing was written |
| `UPDATED` | An existing bank item was revised |
| `DRY_RUN` | Writes are off in this environment; the reason is stated. Nothing was written |
| `GATE_FAILED` | Refused, with the gates that refused it |

Publishing is idempotent: submitting the same batch twice does not publish twice.

**The inventory** below shows what has been published — the bank question ID
(`KNZ-{DOMAIN_CODE}-{YYYY}-{000000}`, e.g. `KNZ-SUPPORT_OPS-2026-000001`), version, status, and
when. It is labelled `local-projection` because that is what it is:
the platform's own record, which a later reconciliation pass compares against the bank itself.

Three figures above it count what is in the bank, how much of it is active, and how much is retired.

**Retire** opens a confirmation dialog and takes a written reason of at least ten characters.
Nothing is ever deleted — the bank adapter has no delete operation at all, by design. A retired
question stays readable, with its evidence and its history, and stops being served. Escape closes
the dialog without retiring anything.

A published question's text in the inventory is a link to the same read-only detail page an approver
used. A published version is never edited in place.

**Trace** opens a traceability panel for that question: where it was generated from (document,
section, the document version at the time, the model and job), then every review, every approval,
the publication with its bank id, and the retirement if there was one. A step appears **only**
because a record exists — there is no "pending approval" step, because not having approved something
is not evidence that someone is about to. Who took each decision is in the audit trail rather than
in this payload, and the panel says so instead of guessing.

### 4.7 Assessment — the bottom of `/publish`

Act as the **assessment manager**.

An assessment is what the learner portal serves. Name it, choose the domain and topic, how many
questions per attempt, the pass percentage, and optionally a time limit, then **Create and publish
assessment**. One submission creates it, submits it, approves it, and publishes it — each an audited
transition, stopping at the first refusal rather than leaving something half-made looking ready.

**Publishing pins the pool.** The exact question IDs and versions that satisfied every criterion at
that moment are captured in an eligibility snapshot, and every attempt draws from that snapshot.
Publishing a new question afterwards does not change an assessment that is already live; the
assessment has to be published again.

The table shows each assessment's status, its published version and that version's own status,
questions per attempt, the pinned pool size, and how many attempts have been started. A pool smaller than the questions per attempt is why a learner might see "not
available".

> This form is the whole assessment builder today. The one specified in `authoring-portal.md` §6 —
> topic distribution, fixed sets, availability windows, attempt limits — is not built.

---

## 5. Learning: taking an assessment

Open **http://localhost:3001** and act as **Local Learner**.

### 5.1 Your assessments — `/`

Only published assessments appear, and only those you are eligible for. Each **card** gives the
subject, questions per attempt, pass mark, time limit, and attempts used — every one of them a field
the server sent.

An assessment that is visible but cannot be started **says why** — closed, not yet open, or all
attempts used — instead of showing a dead button. If you have an attempt in progress, a **Resume**
card appears above everything else, with a bar showing how many questions you have answered.

What you will not find here: badges, points, levels, streaks, due dates, a recommended-for-you rail,
or courses. This release records none of them, and a card invented to fill the space would be
telling you something untrue.

Below the cards, **Your progress over time** is labelled as a capability this release does not
include, with the reason: a result is shown at the end of the attempt that produced it, and nothing
stores a way to list an earlier one. Attempts used, on each card, is the only history there is. The
absence is stated in the same panel style every unbuilt capability uses, so you can tell a decision
from a fault.

### 5.2 Start — `/assessments/<id>`

What to expect, then **Start**. If an attempt is already open for this assessment, the button says
**Resume** and takes you back to it rather than starting another one.

### 5.3 The quiz — `/sessions/<id>`

One question at a time. Pick an answer and **Save and continue**.

Every answer is written on the server as you go. Nothing about the attempt is held in the browser —
not the question list, not your answers, not your position. That is what makes the URL a resume
point: **close the tab, reopen it, and you land on the same question with the same answer
selected.** Try it; it is the most convincing thing in the demonstration.

The heading counts your position, and the progress line shows how many you have answered and how
long the session has left. An untimed assessment still has a deadline — a day-wide idle window — so
that figure is never blank.

**Finish and score** ends the attempt. Scoring happens on the server, and unanswered questions count
as incorrect, so finish when you are ready.

Answering the last question does not end the attempt — the session stays open until you press
Finish. Coming back to a fully answered attempt puts you on the last question with your answer still
selected, and the home page card reads "3 of 3 answered".

### 5.4 Your result — `/results/<id>`

The score as the platform stored it, the pass decision, and the proficiency band. Nothing is
recalculated in your browser — a second rounding could disagree with the decision on record.

Four figures follow it: correct of total, incorrect, unanswered (counted as incorrect), and time
taken.

**How you did by topic** draws one bar per topic. Every bar prints its own percentage and its
correct-of-asked numbers, so the picture tells you nothing the text does not — the bar is there to
be scanned, not to be the only way to read the number. Beside each bar is its band and its **gap
state**, and three answers are possible rather than two: no gap, a gap, or too few questions asked
about that topic to say. The third is excluded from gap reporting rather than guessed at.

**Where to focus** lists the topics identified as gaps, each with the numbers behind it. **Bands
applied to this attempt** shows the five thresholds that were copied onto the result when it was
scored — with your score marked in the band it fell into — so a later configuration change cannot
restate what you were told.

There is no comparison with other learners, no trend against your past attempts, and no suggested
next step. None of the three is recorded anywhere, so none is shown.

**Correct answers and explanations are not shown, ever.** The answer key does not leave the server
for a learner, in the quiz or in the result.

### 5.5 Preview pages — My Learnings, Discover, Badges, Knowledge Library, My Progress, Help & Support

These six sidebar entries carry a blue **Preview** chip and open real pages, added so a stakeholder
can see what the finished learner portal is expected to look like. With Home and Assessments, that is
**every learner destination**: none of the eight is a dead entry, and none reads "Needs backend". **They are not the finished
screens.** Each one works the same way:

- **A blue Preview notice comes first.** It says what is not live yet and what has to be built
  before it can be (the milestone, or **Phase 9** for badges, certificates, suggestions and
  knowledge search).
- **Everything illustrative sits inside a dashed frame** whose tag reads *Illustrative example — not
  real data* (or *— not your data*). A frame's chip says **Coming in Phase 9** or **Future
  capability**. The names, durations and progress figures inside are examples, not records.
- **Nothing inside a frame works.** Every button in one is disabled and explains why when you hover
  or focus it; search boxes and filters are disabled as a group; there are no links out of a frame.
- **Real sections have no frame** and carry a green **Live — from this release** tag.

What is real on each page:

| Page | Real (Live) | Illustrative (framed) |
| --- | --- | --- |
| **My Learnings** — `/my-learnings` | Three counts: assessments available to you, attempted, in progress. **Assessment history**: every assessment you have attempted, with attempts used, and **Resume** for one in progress | Active and completed learning paths, badges (the approved designs, greyed and captioned *not earned*), a certificate |
| **Discover** — `/discover` | **Subjects you can be assessed on**: the domains of the assessments published to you, with a count each | Search and filters, suggested topics (each with the reason it would be suggested), trending topics, popular assessments, suggested paths |
| **Badges** — `/badges` | **Nothing** — no badge is awarded in this build, so there is no live section at all | Badge categories; the gallery of all eight approved designs, greyed and captioned *Design only — not earned*; the criteria table naming what each rule would read (two designs are marked as needing data the platform does not keep); how a *recently earned* award would be listed, with **no date**; progress toward a badge. All **Coming in Phase 9** |
| **Knowledge Library** — `/knowledge-library` | **Domains**: the same list, from what is published to you | Sources (each **Not connected**), search and filters, resources, categories and topics, a document detail |
| **My Progress** — `/my-progress` | **Assessment completion**: how many of the assessments published to you you have attempted | Period and domain filters, progress by topic and by domain, a competency overview using the platform's own five bands, a learning journey. Your per-topic results today are on each result page (§5.4) |
| **Help & Support** — `/help` | **User guides** (taking an assessment, resuming, reading a result) and **Frequently asked questions** — both describe exactly how this release behaves | Help search, tutorials, support channels (each **Not configured**), support hours, system status |

Help names **no** support address, telephone number or hours, and system status claims nothing: no
channel or status service is connected. There is no learning calendar on My Learnings at all, because
a dated session nobody scheduled would be invented even inside a frame.

On a phone or tablet the previews are reached through the menu button like every other page (§2.4).
All six use the same hero, the same Preview notice, the same frames and the same two milestone chips.

What the Badges and My Progress mockups show and these pages **do not**, even as examples: a badge
count, points, a streak, an achievement level, learning hours, courses completed, an average score,
and every "this month" or "this quarter" change. None of them is recorded anywhere.

---

## 6. The SharePoint Sync Manager — http://localhost:3002

A third application, for whoever keeps the document sources healthy. It does one job: **it
synchronizes configured document sources INTO Knowzy**, on a schedule or on demand, and shows you
whether that is working.

> **Read the subtitle under the product name.** It says *Knowledge-source synchronization into
> KNOWZY*, and it is the most important sentence on the screen. This release does **not** copy
> content from one SharePoint location to another, in either direction. There is no destination in
> the product, because Knowzy's own index is the destination. Everything a two-location product
> would offer — a destination site, a library, a folder, two-way sync, syncing deletions back,
> writing metadata back — is on screen, disabled, reading **"Requires Microsoft Graph write
> integration and tenant approval."** Nothing is hidden and nothing is faked.

Who can open it: any identity holding **source.read** — the **Knowledge Source Administrator** and
the **KNOWZY Administrator**. Anyone else is refused with `PORTAL_ACCESS_DENIED` and sees no data at
all, not an empty table.

### 6.1 The dashboard

One page, no navigation, because there is only one thing here.

- **Connection health** — how many sources are reachable, and *when that was last actually
  checked*. It is the result of the last real probe, not a fresh test dressed up as one. Press
  **Test connection** on a row if you want a current answer.
- **Five figures**, each a count of rows over the **last 30 days**: total workflows, successful
  syncs, failed syncs, pending, and documents indexed. There are no trends and no "vs last month",
  because no history of these numbers is stored anywhere to compare against.
- **The workflow table** — one row per knowledge source, with its adapter, its paths, its schedule,
  its next run, and its status: `RUNNING`, `SUCCESS`, `FAILED`, `PAUSED`, `SCHEDULED`, `DISABLED`,
  or `NEVER_RUN`. A status is worked out from the state; none of them is a stored label somebody
  could forget to update.
- **Recent activity** — the last 25 runs, each with how many documents it saw, added, updated,
  failed and skipped, and whether **a person or the scheduler** started it. A failed run's reason
  opens in a panel.

### 6.2 Creating a workflow

**New workflow** opens a four-step wizard: basic information, the source, options, and scheduling.

Two things about the source step are deliberate and will look like gaps:

- **The adapter list contains only adapters that exist.** Today that is a file repository, plus the
  mock source in the local environment. **SharePoint over Graph is listed and disabled** — the
  adapter is not written (Phase 7), and offering it would mean a workflow that can never run.
- **You type the root path; you cannot browse for it.** The browser is never given a directory
  listing of the server, and the path you type is checked **on the server** against a configured
  allow-list before anything is saved. A path outside it is refused, naming the roots that are
  allowed. A path containing `..`, a relative path, or a null byte is refused before the allow-list
  is even consulted. If a deployment configures no roots, **every** local path is refused — an
  unconfigured environment is the strictest one, not the loosest.

The first folder is created with the workflow, because a source with no folder has nothing to scan.

### 6.3 Scheduling

**Manual**, **Hourly** (with the number of hours), **Daily**, **Weekly**, **Monthly**, or a
validated **Cron** expression, each with a timezone. The job runner executes them; the next run is
shown on the row, and an overdue one says so rather than showing a time in the past as if it were
upcoming.

> **Weekly and Monthly are intervals, not dates.** Weekly means *every 7 days from the last run* and
> Monthly means *every 30 days*, and the screen words it that way. They are not "every Monday" or
> "the 1st of the month" — calendar anchoring is a separate piece of work, and guessing at it would
> quietly run your sync on the wrong day.

A **Cron** schedule is handed to the job runner, which owns cron parsing, so the row shows the
expression rather than a next run this application computed.

### 6.4 Running, pausing, retiring

- **Sync now** runs one workflow immediately. **Sync all** runs every *eligible* one — active, not
  archived, with at least one active folder — one after another, so one failure cannot stop the
  rest. The summary lists each source's outcome, and **lists what it skipped with the reason**: a
  paused source, a source with no folder, or one that is already running.
- A source that is **already running** is never started a second time, by you or by the scheduler.
  If a run is interrupted — the container is killed mid-sync — the scheduler releases it on its
  next tick, so that protection cannot lock a source forever.
- **Pause** stops the scheduler picking it up and leaves everything it has already indexed alone.
  **Resume** puts it back.
- **Delete** asks you to choose **Archive** or **Delete**, and a source that anything references —
  documents, questions, generation jobs, or its own run history — **cannot be deleted**, only
  archived. Published questions trace back to the document they were written from, and that trail
  is not allowed to break.

Every one of these writes an audit record naming who did it and what changed.

### 6.5 What this application is not for

No learning, no assessments, no question generation, no badges, no reporting. Those are the other
two portals. And it has not been deployed anywhere — it runs in the local stack, and
`docs/operations/SHAREPOINT_SYNC_MANAGER_DEPLOYMENT.md` describes what a real deployment would need.

---

## 7. When something is refused

A refusal panel gives a title, a plain-language reason, a code, and — for an approval — the gates
that failed. The ones you are most likely to meet:

| Code | What happened | What to do |
| --- | --- | --- |
| `GENERATION_SELECTION_REQUIRED` | No document was ticked | Tick one to ten documents |
| `GENERATION_SCOPE_EMPTY` | The selection has no assessable sections left | Choose other documents, or look at the section list to see why |
| `PREFLIGHT_REQUIRED` | Generation without a recorded decision | Run **Check documents** and record an action |
| `DOCUMENT_NOT_READY` | The document has not been extracted | Synchronize the source |
| `DOCUMENT_CONTENT_DRIFT` | The document changed after the scope was captured | Synchronize and run preflight again |
| `STATE_TRANSITION_INVALID` | The question is not in a state that allows this | The message names the transitions that are available |
| `SEPARATION_OF_DUTIES` (gate 13) | You are trying to approve your own work | Switch to the approver identity |
| `BUDGET_EXCEEDED` | A per-job, daily, weekly or monthly token ceiling would be breached | The message names the ceiling, what is spent and when it resets (§4.3c) |
| `GENERATION_CONCURRENCY_LIMIT` | Too many generation jobs are already running for that provider | Wait for one to finish |
| `PROVIDER_NOT_APPROVED` | No data-processing approval is recorded for the provider | Not an engineering fix: the approval has to exist, then be recorded on Administration → AI Providers with a reference (§4.3f) |
| `PROVIDER_CREDENTIAL_UNAVAILABLE` | Nobody has enabled the provider, or its credential reference does not resolve | Enable and configure it on Administration → AI Providers (§4.3f) |
| `TAXONOMY_INACTIVE` | The department or role you filed against has been deactivated | Pick another, or reactivate it on Administration → Knowledge Domains |
| `PROVIDER_NOT_GROUNDING_SAFE` | The provider retrieves its own context | It cannot be used for grounded generation at all |
| `PROVIDER_RETRY_EXHAUSTED` | The provider kept failing and the attempt cap was reached | The job stopped rather than looping |
| `VALIDATION_FAILED` | A required field or comment is missing | The detail names the field |
| `PORTAL_ACCESS_DENIED` | This identity has no access to this portal | Switch identity |
| `NOT_FOUND` | It does not exist, or is outside your scope | Both read the same on purpose |
| `API unreachable` / `MCP_UNAVAILABLE` | The portal could not reach the API | See §2.3 |

`MCP_UNAVAILABLE` on an "API unreachable" panel is a known mislabel — the code registry has no
"API unreachable" code yet. The message is accurate; the code is the nearest existing one.

---

## 8. A complete walkthrough, in order

For showing the product end to end from an empty state. Roughly fifteen minutes.

1. **Source administrator**, `/sources` → **Test connection**, then **Synchronize**.
2. Same page → **Browse documents**. Open a library, walk into a folder, **View sections** on one
   document. Note the offsets and the coverage column.
3. **Author**, `/generate` → tick two documents → **Check documents**. Read the per-document checks.
4. **Record decision** (`GENERATE_NEW`) → set the domain, topic, and a count → **Generate
   questions**. Read the refusals, not just the count.
5. `/review` → open a question. Read the evidence span against the question. Note that gate 13
   fails for you.
6. **Claim for authoring**, then **Submit for approval**. Repeat for the others.
7. **Approver**, `/review?queue=approval` → open the same question. Gate 13 now passes. **Approve**
   with a comment.
8. **Publisher**, `/publish` → **Publish selected**. Read the per-question outcomes and the bank
   IDs that appear in the inventory.
9. **Assessment manager**, bottom of `/publish` → name an assessment, 4 questions, 70% → **Create
   and publish assessment**. Note the pinned pool size.
10. **Learner**, http://localhost:3001 → open the assessment → **Start** → answer one question →
    **close the tab** → reopen http://localhost:3001 → **Resume where you left off**. You are on the
    same question.
11. Answer the rest → **Finish and score** → read the result, the per-topic table, and the gap
    analysis. Confirm no correct answers are shown anywhere.

---

## 9. Things that will surprise you

- **You will switch identity several times.** By design; see §3.
- **Generation returns fewer questions than you ask for.** The local generator only builds a
  question from a sentence stating an explicit rule, and every refusal is reported with its reason.
- **One fixture document never appears.** It is marked as denied to the caller, to prove that
  permissions are honoured in browse, search, sync, and generation.
- **The approval checklist can be green and the approval still refused.** The panel is advisory; the
  server re-evaluates at the transition. A version change between the two is the usual cause.
- **Publishing again after a database reset may report `ALREADY_PUBLISHED`.** The mock Question Bank
  keeps its own state in a file under `fixtures/bank/.state/`, which survives a database teardown.
  Delete that file for a clean publish.
- **Every form except identity switching needs JavaScript.** The results these forms return — a
  failed gate, a per-question publish outcome — have to stay on screen, and that costs the no-script
  fallback.

---

## 10. What is real, and what is not

**Real, and working:**

- The whole pipeline from source to score, with every state transition audited.
- Authorization: every route has a declared policy, and roles and scope are re-resolved server-side
  on every request regardless of what the browser sends.
- Evidence verification, duplicate detection, the 13 approval gates, separation of duties,
  idempotent publishing, session recovery, and deterministic scoring.
- Answer-key protection, asserted at runtime on every learner response.

**Not real yet:**

| | |
| --- | --- |
| **Sign-in** | Identities are picked from a list. The local stub issuer refuses to run outside the `local` environment |
| **SharePoint over Graph** | Not connected. Graph SharePoint calls return 403 until a tenant administrator consents, so the Graph adapter is still Phase 7. **A locally synchronized mirror of an approved SharePoint folder can be read today** through a file-repository source — real documents, but access is enforced by Knowzy rather than by SharePoint (§4.1) |
| **The Question Bank** | A local JSON file behind the same port the SharePoint adapter will implement. Phase 8 |
| **Claude** | Generation uses a deterministic local generator that quotes documents verbatim and passes through the same gates. Question *quality* has never been tested against a model |
| **Dashboards and reporting** | **Partly real.** **Reports** (§4.3g) has a visual dashboard and twelve reports on nine read models, with suppression, export and snapshots; **Governance → AI Usage & Budgets** (§4.3c) reports token usage, cost, budgets, concurrency and provider health; **Governance → Audit Explorer** (§4.3e) reads the audit trail. Most of `reporting.md`'s thirty-five catalogue entries are still unbuilt, including everything needing proficiency or recognition |
| **Trends and deltas** | **Real** (§4.3g). Counts over a period are compared with the period before; figures describing a moment are compared with the daily coverage snapshot. Snapshots began on 2026-09-27 and are never back-filled, so those four comparisons read **Not Yet Available** until a snapshot old enough exists |
| **The learner performance heatmap** | **Real** (§4.3g), by the department the questions were filed under. With few learners most cells read **Suppressed**, which is correct |
| **AI provider configuration** | **Real** (§4.3f). A provider's endpoint, model, credential reference, ceilings, enablement and its recorded data-processing approval are all set from **Administration → AI Providers**, with no deployment. What remains a release is *writing a client* for a provider — see the Claude row above |
| **A connection test against an AI provider** | **Real for OpenAI** (§4.3f), directly or through an Azure API Management gateway: the secret is resolved and the endpoint, key and model are checked with content-free GET requests. Behind a gateway with no model discovery, the model check reads SKIPPED. Not real for any other external provider, which has no client — its live checks read NOT ATTEMPTED |
| **Generating questions with OpenAI (Codex)** | **Built, not yet run.** The generation client exists and its proposals go through the full gate chain, but it is refused until the T-29 approval is recorded, and no working credential is configured. The Generate screen does not offer it yet. See docs/integrations/OPENAI_CODEX_EVALUATION_RESULTS.md |
| **Azure Key Vault** | Not real. `keyvault://` references are accepted and reported as unreadable here; the local secure store works in the local environment only |
| **Badges and certificates** | Not built. **Badges** and My Learnings show the badge designs and a certificate as labelled **previews** (§5.5); nothing is awarded |
| **My Learnings, Discover, Badges, Knowledge Library, My Progress, Help & Support** | **Previews only** (§5.5). Each shows the finished design with every illustrative block framed and every control in a frame disabled; the parts built from your assessments, and the help guides and FAQ, are real |
| **Refreshers** | Not built |
| **The assessment builder** | One form on the Publish page, not the specified builder |
| **Email** | Captured by Mailpit; nothing is sent anywhere |
| **Destination synchronization** | There is none, and there is no plan for one in this release. The Sync Manager brings documents **into** Knowzy. A destination, two-way sync, syncing deletions back, and writing metadata back are all shown disabled reading "Requires Microsoft Graph write integration and tenant approval." (§6) |
| **A deployed Sync Manager** | It runs in the local stack only. No hosting target, environment or pipeline exists |

For the full assessment of what is built and how it was verified, see
[MVP-READINESS.md](MVP-READINESS.md).

---

## 11. Keeping this guide current

This guide tracks the software, not the plan. It is updated in the same commit as any change that
alters what a person sees or does — a new screen, a moved control, a changed label, a new refusal, or
a promotion of something in §10 from "not real yet" to real. A milestone that changes the UI is not
finished until this file matches it.

When updating, change the header block at the top (`Applies to` and `Last updated`) and add a row to
the log below.

| Date | Commit | Change |
| --- | --- | --- |
| 2026-09-18 | `1762cc7` | First version. Covers M7: six authoring screens, four learner screens, the identity picker, and the refusals each screen can show |
| 2026-09-21 | PILOT-T1 | **Real documents can now be read.** Word, PDF, PowerPoint and Excel files are read in addition to text, Markdown and HTML, and §4.2 says what to expect from each — including that a scanned PDF has no text to read and that tracked deletions are deliberately ignored. A knowledge source can now read a **locally synchronized mirror** of an approved SharePoint folder while Graph access is unavailable (§4.1): documents still link to SharePoint, never to a file on disk, and Test Connection states plainly that access is enforced by Knowzy rather than by SharePoint. Test Connection reports how many matched documents have no reader at all, before you synchronize |
| 2026-09-21 | UI-M3 | **Traceability and preflight depth.** Question approval (§4.5) gains a five-stage strip above the tabs reading Knowledge → Evidence → Review → Approval → Publication, each stage ticked only where a record exists and showing that record; it does **not** name the reviewer or approver, because the platform does not expose who made a decision. Generate (§4.3) now shows each preflight check by name with the sentence and the facts behind its verdict instead of a badge in a table, and the result carries the rejection breakdown, scope, job reference and model usage. Learner home (§5.1) states "Your progress over time" as a capability this release does not include, rather than as small print. Also fixed: the sidebar tagline was clipped at 1440px |
| 2026-09-21 | UI-M3 | The header is rebuilt to the approved mockup: a larger EssilorLuxottica mark, then the KNOWZY wordmark with its tagline, on a slightly taller bar (§2.4). The Start and Resume buttons are green, and anything marked **Planned** is now a soft blue pill. On the screens: **pipeline health** on the dashboard (§4.0) listing conditions that are true right now; connection health and staleness in one cell on Knowledge Sources (§4.1); the drafts a generation job created are now listed and linked (§4.3); every review queue tab carries its own count (§4.4); the provenance trail shows revisions (§4.6); and assessment cards show four figures with an explicit "Ready to start" (§5.1). Also fixed: a refusal on the learner portal was rendering as unstyled text, and six colour pairs were below the WCAG AA contrast minimum |
| 2026-09-21 | UI-M2b | The implemented screens redesigned on real data. New: the authoring **dashboard** (§4.0) with the pipeline counts and a panel naming any read your identity may not see; the **approval gate rail** (§4.5); a **traceability** panel on each published question (§4.6); learner **assessment cards** and a resume bar (§5.1); and the result screen's **per-topic bars, gap table and band scale** (§5.4). Two real fields that had been dropped are now shown: whether a source is active, and a duplicate's recorded disposition. **Nothing was invented** — no deltas, no placeholder metrics, no recommendations, no badges |
| 2026-09-21 | UI-M2 | The six authoring screens are on the design system: Knowledge Sources (§4.1 — results now open in a side panel, and three counted figures sit above the table), the document browser (§4.2 — libraries are tabs, with a breadcrumb), Generate (§4.3 — three numbered cards), the review queue (§4.4 — five queues as tabs with counts), Question approval (§4.5 — **six tabs, with the gate verdict kept outside them**), and Publish (§4.6 — Retire is now a confirmation dialog). **No control, action, or refusal changed.** Also fixed: clicking Finish and score, Test connection, Claim, Submit, or the assessment steps returned a 400 "Validation failed" — every one of them now works |
| 2026-09-21 | UI-M1 | Both portals now render inside one shared KNOWZY shell: brand header, left-hand destinations carrying their real status, the authoring workflow ribbon, a skip link, and visible focus. The search field, KNOWZY Copilot, and notifications are shown disabled and labelled "Planned" — see §2.4. **No page body, control, action, or refusal changed**; the screens themselves are modernized one at a time from UI-M2 |
| 2026-09-21 | `abb1c45`+ | Resume of a fully answered attempt now works (it returned a 404 before, and the home page card printed "NaN / "). Two new review views, `Published` and `All questions`, with a per-document filter; preflight counts and published inventory rows link into them. Recording `VIEW_EXISTING` or `REUSE_EXISTING` no longer offers the generate form |
| 2026-09-22 | Import on real files | **The first two real question banks were fed in, and both were refused for reasons that were the platform’s fault rather than the files’.** Fixed, in §4.3a: a spreadsheet may leave its trailing columns blank (a fifteen-column template with twelve filled imported nothing before, and now imports every row); `OptionA`, `CorrectAnswer`, `AnswerKey`, `QuestionText`, `Justification` and `SourceDocument` are recognised as column names; a Word bank whose four options sit on one line is read; and a decoration in front of `Correct Answer:` — a tick, a bullet, a dash — no longer hides the answer. A Word bank with no explanation per question is still refused, and §4.3a now says so before you try. Also: a spreadsheet cell whose own text contains ` - ` is reported with the value it found rather than mis-split. On §4.1, **skipped** is now counted and listed apart from **failed**: a file outside this source’s configured folder is the configuration working, not an error |
| 2026-09-22 | Decision panel | **A decision the lifecycle cannot reach is now disabled and says why** (§4.5), and the panel names the next step available from the current state. All five decisions used to be offered on every question, so pressing **Submit for approval** on a draft returned `STATE_TRANSITION_INVALID` — which reads as missing access and never was: a draft has to be claimed first. A state block and a permission block are now worded differently, because one is an order of operations and the other is an identity. Where gate 13 currently refuses an approval, a note beside **Approve** says so. §4.5 also states plainly what full access does and does not grant a KNOWZY Administrator |
| 2026-09-22 | Taxonomy administration | **Domains and topics can now be created and edited** (§4.3b, **Administration → Knowledge Domains**), which is the first Administration screen with a backend behind it. Before this the platform held one seeded domain and one seeded topic and offered no way to add a second, so an imported VisionStar question bank was filed under Support Operations. A domain code is editable only while nothing references the domain and then shows as **Permanent** with the counts that locked it; a topic belongs to exactly one domain and is unique within it; nothing can be deleted, only deactivated. **Import now files each question where the FILE says it belongs** (§4.3a) and refuses a file naming taxonomy that does not exist, rather than creating it — a spreadsheet typo must never mint a permanent domain code |
| 2026-09-26 | PHASE10-R1 | **Reporting exists** (§4.3g, **Reports**), which makes `Reports` the last dead entry in the navigation to become a link. Five reports over records the platform already held — the question pipeline, generation yield, assessment performance, how the bank is filed on all four axes, and source coverage — on six read models in their own database schema. Every report states **when its data was true** (from the model's own refresh record, never from the clock), **the absolute dates** a relative window resolved to, and **one written formula per metric**. The assessment report **withholds any row covering fewer than five learners**, including the second row needed so the first cannot be derived by subtraction, and **a total that lost rows to suppression reads "Withheld" rather than 0** — a zero there would have said "nobody has taken it". Export produces a CSV with a header block stating scope, as-of, threshold and withheld count, with formula-injection defused, and is audited; a snapshot stores the same header block under a label, and is **not** a published report. Two absences are stated rather than filled: **no "vs previous period" anywhere**, because no history of those figures is stored and two of them could never have one, and **no learner heatmap**, because its read models do not exist, a learner has no department, and most of its cells would be withheld |
| 2026-09-27 | PHASE10-R2 | **The Reports dashboard is visual** (§4.3g): eight headline figures, a generated-vs-published trend line, a status donut, a department × job role column chart, the **learner performance heatmap**, recent activity from the audit trail, knowledge source health and an AI usage summary. **Two decisions made this possible.** Department and job role are the reporting hierarchy, so the heatmap groups by the department the *questions* were filed under and says so; and coverage history is now recorded — **one coverage snapshot per day**, append-only, never back-filled — so every headline figure carries a real comparison or reads **Not Yet Available**. The heatmap withholds any cell under five learners and any cell derivable from its row or column. The feed names nobody and groups completions. Every panel opens as a full report with its own CSV export and snapshot, and an export now records the period it covered. The two absences R1 stated — no comparisons and no heatmap — are promoted out of §10 |
| 2026-09-27 | P-5 / OPENAI-CODEX-00 | **Test connection is real for OpenAI** (§4.3f): the credential reference is resolved from the new **local secure store** and the endpoint, key and model are verified with two metadata requests, each result showing what it observed. Rows now show a **Readiness** ladder beside the **Generation gate**, the five **declared capabilities**, and the credential **reference** (never the key). A **Secret sources** panel reports each source's health. Keys enter the store only through `npm run secrets`. Re-saving a provider without re-typing the reference now keeps it; removing it is a checkbox. The button is renamed **Test connection**. AI Usage & Budgets (§4.3c) shows the same readiness. OpenAI still cannot generate |
| 2026-09-27 | OPENAI-CODEX-01 | **OpenAI can generate — once approved.** The AI Providers row for OpenAI now reads *Generation: yes*. The Configure dialog gains **API style** and **Auth header name**, so a key issued for a corporate gateway can be sent in the gateway's own header. OpenAI stays `BLOCKED_BY_APPROVAL` until T-29 is recorded; once available, its questions are drafts that pass the same checks and the same review and approval as any other. The Generate screen is unchanged |
| 2026-09-26 | AI-PROVIDER-M1 | **A provider can now be configured through the product** (§4.3f, **Administration → AI Providers**), which is what makes the day a credential arrives a configuration change rather than a release. Every declared provider is listed — including the five that cannot be used — each with the reason and who can clear it, in order of permanence: capability, approval, implementation, credential. **Recording a data-processing approval is its own act and requires a reference** to where the approval is held, because a credential is not authorization and a checkbox beside "Enabled" would be one nobody stopped at. A credential is typed as a `keyvault://` **reference**, never a key: anything key-shaped is refused before storage, the field is write-only, and no read, screen or audit row ever returns it. **Validate** reports five checks with a sentence each and marks the live call **NOT ATTEMPTED** — because nothing in this build can make one, and a green tick here would be read as "authentication successful". A provider that is not AVAILABLE cannot be made active. Also on §4.3c: **Estimated cost** and **Daily budget** joined the KPIs, the provider table gained a **Questions** column, a **Concurrent generation** card shows jobs running against the cap and states that there is no queue, and a **usage heatmap** shades tokens by day, week or month with five labelled bands and an empty square for a period with no activity |
| 2026-09-26 | Filing | **The question review page has a seventh tab, Filing** (§4.5), showing all four axes a question is filed under and letting **department and role be corrected** while the question is still with its author. Domain and topic are shown read-only with the reason: the domain code is inside the published identifier, and the topic is what the preflight authorized. After submission the whole filing is read-only, because a question is approved as filed. A change creates a new version and an audit entry carrying the previous and new value, and touches no text, so nothing is re-verified. Also fixed: the header badge printed the word "undefined" twice for a question with no filing, and now reads **"No department or role assigned"** — an absent value and a null value render identically |
| 2026-09-26 | Identity switcher | **Identity switching moved into the header** (§3), on every page of both portals, from the card it used to occupy at the bottom of each home page. A refusal happens where you are, and switching identity is the usual fix, so it should not require navigating away and back |
| 2026-09-26 | Departments and Roles | **Two more managed catalogues on Administration → Knowledge Domains** (§4.3d), on request: a question is now filed under **Department, Role, Domain and Topic**. Same rules as a domain — a normalized code, a code that becomes permanent once anything references it, a display name that never does, and deactivation instead of deletion, with a refusal if something tries to file against a deactivated entry. A role is deliberately independent of a department. Questions drafted before today carry neither, and the screens say so rather than guessing. Also new: **Governance → Audit Explorer** (§4.3e), which reads the 64,479 audit events the platform had already written and could not show anybody — filter by actor, action, family, entity, outcome, correlation id and date, open any event to see its **correlated trace** (every event from the same click, across the API, MCP and the job runner), and export the filtered set as CSV, with the export itself audited |
| 2026-09-24 | AI-CONTROL-M1 | **Generation now has ceilings, and a page that shows them** (§4.3c, **Governance → AI Usage & Budgets**). Every generation call — including the deterministic one — now passes through a provider-independent control layer: a per-job token ceiling checked from the prompt estimate **before** any call, daily, weekly and monthly token budgets that count retries, a concurrency cap, and a retry policy with jittered backoff and a hard attempt cap. A ceiling that stops a job produces a **refusal with the numbers in it** and a job recorded as `REFUSED` rather than `FAILED`, because a decision is not a failure. The new page reports usage, cost, budget consumption, provider states and provider health, and a **KNOWZY Administrator can set a token limit per provider from it**. Two things it deliberately will not do: show a zero for a metric nothing has recorded (it says **Not Yet Recorded**), and show a cost that cannot be known (it says **Not observable** with the reason — a per-seat licence and a user-managed run have no observable cost, and the deterministic generator's zero is the one case where 0 is a measurement). OpenAI is now a declared provider, visible on the page as `UNAVAILABLE` with its reason; nothing external is enabled and no credential exists |
| 2026-09-23 | SYNC-M1..M4 | **A third application**, the **SharePoint Sync Manager** on http://localhost:3002 (§6), for whoever keeps the document sources healthy: connection health, five counted figures over a 30-day window, a workflow table with a derived status, and the last 25 runs with who or what started them. New capability behind it: a source can now be **created, edited, paused, resumed and archived** from a screen rather than only seeded, and it can be put on a **schedule** — manual, hourly, daily, weekly, monthly or cron — executed by the job runner. **Sync all** reports each source's outcome and names what it skipped and why. Four things it deliberately does not do, each on screen and disabled with "Requires Microsoft Graph write integration and tenant approval.": a destination, two-way sync, syncing deletions back, writing metadata back — this release synchronizes **into** Knowzy and has no destination model at all. A SharePoint Graph source is listed and disabled because the adapter is not written. A local root path is **typed, not browsed**, and validated server-side against an allow-list. Also fixed, found by the browser test: a dialog taller than the window could not be scrolled, so its buttons were unreachable at 720px — that affected the existing portals too |
| 2026-09-23 | Acceptance automation | **Nothing about the screens changed.** What changed is that they are now driven by an automated browser suite — sources, generation, review, **gate 13**, publication, and a learner attempt including resume and scoring — so a broken screen is found by the build rather than by the next person to open it. Two things that suite is not: it does not cover refreshers, the revalidation queue or the audit surfaces, because those are not built; and it is not part of `npm run verify`, because it needs the stack running |
| 2026-09-27 | LIVE-PREVIEW-M1 | **Four learner preview pages** (§5.5): My Learnings, Discover, Knowledge Library and Help & Support are now links with a blue **Preview** chip, at the product owner's request. Each opens with a Preview notice, frames every illustrative block with a visible *Illustrative example* tag, and disables every control inside a frame. Real parts: progress counts and assessment history (My Learnings), the domains published to you (Discover, Knowledge Library), and user guides and FAQs (Help). Badges and My Progress are unchanged. No authoring screen changed: none of them showed a placeholder |
| 2026-09-27 | UX-M1 | **Navigation at every width** (§2.4). Below desktop width both portals had no navigation at all; there is now a **collapsed icon rail** on a tablet and a **menu button** that slides the full sidebar in on a phone or tablet, keyboard and screen-reader operable, focus starting on the current page. The Sync Manager's header folds behind **Environment and settings** on a phone. Also fixed, found by a review of every screen at phone, tablet and laptop width: **AI Providers** scrolled sideways at every width, the **Reports** dashboard did on a phone, and so did the Sync Manager's identity form |
| 2026-09-27 | LIVE-PREVIEW-M2 | **Badges and My Progress previews** (§5.5), so **every learner destination now opens** a working screen or a labelled preview, and none reads "Needs backend". Badges is entirely illustrative (categories, gallery, criteria, how an award would be listed, progress toward one), because nothing is awarded; My Progress shows real **assessment completion** beside framed examples of progress by topic and domain, competency and a learning journey. The six previews now share one hero style |
| 2026-09-28 | GATEWAY-M1 | **An Azure API Management gateway can be configured and tested** (§4.3f). The Configure dialog gains **Authentication location** (header or query parameter), **Authentication query-parameter name** and **Fixed extra headers (not secret)**; the row shows the authentication and the fixed headers. **Test connection now sends exactly what generation would** (before, it always sent a Bearer header). It has ten checks: **Model execution** is new and always NOT ATTEMPTED, and **Model** can read **SKIPPED** when a gateway exposes no model discovery — authentication is then established by comparing a keyed and an anonymous request. Connection failures name their cause (DNS, timeout, TLS trust with *NODE_EXTRA_CA_CERTS configuration required*, redirect, rate limit, service unavailable) without the key, a URL or the gateway's text. Generation stays refused until a data-processing approval is recorded |
| 2026-09-28 | GEN-PROVIDER-M1 | **Choose the provider when generating** (§4.3 Step 3): **Generated by** now lists every declared provider, with the ones that cannot run disabled and their reasons one click away, defaulting to the active provider when it can run. On AI Providers (§4.3f), **Enable and make active** turns an approved, configured provider on and makes it the default in one step, and **Manage approval** gains **Replace reference**. Fixed: after withdrawing an approval the dialog still showed *Approval recorded* beside *Approval withdrawn* until it was closed |
| 2026-09-28 | GEN-PROVIDER-M1 (fixes) | **Found in use by the owner.** Generate Step 3 now has the **Justification** box PUBLISHER_REQUESTED always needed — the reason was offered with nowhere to write one, so it could only be refused. After a submission the **Generated by** dropdown and the note under it could describe two different providers; they now always agree. Review Queue rows say **Drafted by** which model, so Codex drafts can be told apart |
| 2026-09-28 | EVAL-M1 | **Choose the knowledge source on Generate** (§4.3): a **Knowledge source** selector and **Use this source** replace the silent "first usable source", because with a network provider active that choice decides which documents are sent. The formal Codex evaluation ran the same day — see docs/integrations/OPENAI_CODEX_EVALUATION_RESULTS.md |
| 2026-09-28 | EVAL-M1 (owner requests) | **Review Queue: a Generated by filter** on every tab, **true totals** on the tabs (they read "25" whatever was behind them), and up to 100 rows per page with *Showing n of total*. **The requested question count is now a maximum** for every provider — Codex had returned 56 for a request of 50; the surplus is reported as *Beyond the request*. Confirmed from the data that every Codex question came from a selected document (0 of 131 outside) |
