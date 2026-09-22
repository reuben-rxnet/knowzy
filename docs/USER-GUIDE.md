# Knowzy — User Guide

**Applies to:** the local demonstration build with the Question Acquisition Framework
(provider-based generation and question import), including PILOT-T1, PILOT-T2 and UI-M3
**Last updated:** 2026-09-22
**Audience:** anyone driving Knowzy in a browser — an author, an approver, a publisher, an
assessment manager, a learner, or someone being shown the product

> **This guide describes what the software does today.** It is not a specification. Where it and the
> design documents in this directory disagree about what *should* happen, the design documents are
> the authority and this guide is out of date. Where it and the running software disagree, the
> software is right and this guide is out of date.
>
> **What you are using is a demonstration build.** It runs only on one machine, against fixture
> documents, with identities you pick from a list rather than sign in to. §9 says exactly what is
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

That brings up PostgreSQL, the API, the MCP server, the job runner, both web applications, and
Mailpit. The first start also applies migrations and seeds the local users, roles, and taxonomy.

### 2.2 The addresses

| What | Where |
| --- | --- |
| **Authoring Portal** | http://localhost:3000 |
| **Live Learning Portal** | http://localhost:3001 |
| API | http://localhost:8080 — the portals call it from their own process; you do not need it |
| Mailpit (captured mail) | http://localhost:8025 |

Start at **http://localhost:3000**. The two portals are separate applications on purpose and there
is no link between them — open the learner portal in its own tab.

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
docker compose -f infrastructure/compose/docker-compose.yml restart authoring-web live-web
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

Nothing unavailable is a link, so you cannot land on a dead page, and nothing is hidden either — the
list is an honest statement of what exists. Exactly one destination is highlighted at a time, with a
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
this is a demonstration build — the words "Local Development Identity". Change it from the Authoring
Portal's home page, or from the learner portal's home page for the learner side.

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
   added, modified, unchanged, failed, and the character count extracted.

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

**Step 1 — select documents.** Tick one to ten documents. There is no "all documents" option; an
unticked run is refused with a reason. Then **Run preflight**.

**Step 2 — read the checks and choose an action.** Preflight runs six checks and shows, for each
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

**Step 3 — generate.** Pick the domain, topic, scope, reason code, and how many questions you want,
then **Generate questions**.

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

### 4.4 Draft review queue — `/review`

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

Everything needed to judge one question, on one page, arranged in six tabs.

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
| **Review history** | Every review and every approval, with the version each decision was made against |
| **Version history** | Each version, what changed, and whether the evidence was re-verified |

Each tab is its own address, so you can link someone straight to the Governance tab of a specific
question.

The **decision panel** is always at the bottom, whichever tab you are on.

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
separation of duties, visible.

If a duplicate was flagged, a disposition section appears. Say whether it is `DISTINCT` or a
`DUPLICATE`, with a note. Until someone does, approval stays blocked.

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

---

## 6. When something is refused

A refusal panel gives a title, a plain-language reason, a code, and — for an approval — the gates
that failed. The ones you are most likely to meet:

| Code | What happened | What to do |
| --- | --- | --- |
| `GENERATION_SELECTION_REQUIRED` | No document was ticked | Tick one to ten documents |
| `GENERATION_SCOPE_EMPTY` | The selection has no assessable sections left | Choose other documents, or look at the section list to see why |
| `PREFLIGHT_REQUIRED` | Generation without a recorded decision | Run preflight and record an action |
| `DOCUMENT_NOT_READY` | The document has not been extracted | Synchronize the source |
| `DOCUMENT_CONTENT_DRIFT` | The document changed after the scope was captured | Synchronize and run preflight again |
| `STATE_TRANSITION_INVALID` | The question is not in a state that allows this | The message names the transitions that are available |
| `SEPARATION_OF_DUTIES` (gate 13) | You are trying to approve your own work | Switch to the approver identity |
| `VALIDATION_FAILED` | A required field or comment is missing | The detail names the field |
| `PORTAL_ACCESS_DENIED` | This identity has no access to this portal | Switch identity |
| `NOT_FOUND` | It does not exist, or is outside your scope | Both read the same on purpose |
| `API unreachable` / `MCP_UNAVAILABLE` | The portal could not reach the API | See §2.3 |

`MCP_UNAVAILABLE` on an "API unreachable" panel is a known mislabel — the code registry has no
"API unreachable" code yet. The message is accurate; the code is the nearest existing one.

---

## 7. A complete walkthrough, in order

For showing the product end to end from an empty state. Roughly fifteen minutes.

1. **Source administrator**, `/sources` → **Test connection**, then **Synchronize**.
2. Same page → **Browse documents**. Open a library, walk into a folder, **View sections** on one
   document. Note the offsets and the coverage column.
3. **Author**, `/generate` → tick two documents → **Run preflight**. Read the per-document checks.
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

## 8. Things that will surprise you

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

## 9. What is real, and what is not

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
| **Dashboards and reporting** | Not built. They need the Phase 10 read models |
| **Badges and certificates** | Not built |
| **Refreshers** | Not built |
| **The assessment builder** | One form on the Publish page, not the specified builder |
| **Email** | Captured by Mailpit; nothing is sent anywhere |

For the full assessment of what is built and how it was verified, see
[MVP-READINESS.md](MVP-READINESS.md).

---

## 10. Keeping this guide current

This guide tracks the software, not the plan. It is updated in the same commit as any change that
alters what a person sees or does — a new screen, a moved control, a changed label, a new refusal, or
a promotion of something in §9 from "not real yet" to real. A milestone that changes the UI is not
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
