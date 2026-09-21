# Writing Documents KNOWZY Can Assess

**For:** SOP authors, knowledge owners, support teams, application owners, trainers, SMEs and
governance teams.
**Status:** Guidance, derived from measurement. Every number in this document was measured on the
real pilot corpus on 2026-09-22 and can be recomputed from the database.
**Evidence base:** 28 real EssilorLuxottica support SOPs — 122,106 characters, 234 sections, 115
assessable sections, 3 questions accepted, 194 refusals with a recorded reason.
**Registers:** [`CorpusManifest.md`](../../RealWorldPilot/CorpusManifest.md) ·
[`PILOT-T1-CORPUS-SELECTION.md`](PILOT-T1-CORPUS-SELECTION.md).

---

## 1. Why document structure matters

KNOWZY does not read a document the way a person does. It **splits the document into sections**,
then tries to write a question that is answerable from **one section alone**, quoting that section
**verbatim** as evidence. A human reviewer then approves or rejects it.

Three consequences follow, and all of them are about structure rather than writing quality:

1. **A section is the unit of assessment.** If the document has no headings, the whole document
   becomes one or two enormous sections and there is nothing precise to cite. If every step has its
   own heading, each section is a fragment too small to test.
2. **The heading becomes part of the question.** Questions are phrased *"According to \<heading\>,
   which statement is correct?"*. A heading of `9. Decision Matrix` makes a poor question; a heading
   of `When to cancel a single order` makes a good one.
3. **Evidence must exist as a quotable sentence.** KNOWZY checks the quoted span character by
   character against the section. If a rule is only implied by a screenshot or a click path, there
   is nothing to quote, and the platform **refuses to generate rather than inventing one**.

That refusal is deliberate and is the most important thing to understand about this platform: **it
will not make a question up.** A document that states nothing testable produces nothing, with a
reason recorded per section. Your documents are not being marked; the platform is telling you what
it could and could not find.

### 1.1 The one-line summary

> **KNOWZY assesses documents that state rules under meaningful headings. It cannot assess a
> screenshot tour.**

---

## 2. What KNOWZY can and cannot use

### 2.1 File formats — measured, and not the problem

| Format | Supported | Pilot result |
| --- | --- | --- |
| `.docx` Word | Yes | 27 of 27 extracted, **0 failures** |
| `.pdf` | Yes | 1 of 1 extracted |
| `.pptx` PowerPoint | Yes | None in the pilot corpus |
| `.xlsx` Excel | Yes | None in the pilot corpus |
| `.md`, `.txt`, `.html` | Yes | None in the pilot corpus |
| `.csv` | **No extractor** | 1 file reported as unsupported **before** synchronization |
| `.msg`, `.zip`, images, `.vsdx` | No | — |

**Extraction is not your bottleneck.** 28 of 28 supported files extracted cleanly, with zero
failures and zero empty documents. Do not spend effort converting formats. Spend it on §3–§7.

Two details worth knowing:

- **Tracked changes:** deletions are excluded, insertions are kept. So a document left in
  "track changes" mode is assessed as though every suggestion were accepted. Accept or reject before
  publishing the SOP.
- **Comments, headers, footers and hidden text are excluded.** A rule that lives only in a footer or
  a comment is invisible to KNOWZY.

### 2.2 Content KNOWZY can use

- Prose paragraphs that **state a rule, threshold, timeframe, condition or responsibility**
- **Decision tables** — condition in one column, required action in another
- **Scenario sections** that describe when an approach applies and when it does not
- Definitions with consequences attached

### 2.3 Content KNOWZY cannot use

- **Screenshots.** Images are not read. A rule visible only in a screenshot does not exist.
- **Click paths alone.** *"Open Orders > Search > Retry"* is a navigation instruction. It says what
  to press, not what the engineer must know.
- **Contents pages, revision histories, approval tables, legal notices, glossaries.** Correctly
  classified as document furniture.
- **Sections under ~300 characters.** Below that threshold a section is treated as too small to
  assess. In the pilot corpus **118 of 234 sections — half — fell below it**.
- **SQL, code and log excerpts** on their own. Useful context, not testable knowledge.

---

## 3. Heading best practices

### 3.1 Use real Word Heading styles

Not bold text. Not a larger font. Not underlining. **Heading 1 / Heading 2 / Heading 3** from the
Styles gallery.

KNOWZY reads the document's structural markup. Text that merely *looks* like a heading is an ordinary
paragraph, and the platform never invents a heading it cannot see.

**Measured on the pilot corpus: 15 of 28 documents contain no headings at all**, and **81 of 234
sections have no heading**. Those documents collapse into one or two large blocks. Eleven of them
became a **single section** — meaning the entire SOP is one citable unit and no question can point at
a specific part of it.

### 3.2 Write headings that name the knowledge, not the position

The heading is quoted into the question stem, so it must read as a subject a trainer would ask about.

| Instead of | Write |
| --- | --- |
| `9. Decision Matrix` | `Choosing the right cancellation route` |
| `Section 4` | `When an order may be cancelled after dispatch` |
| `Steps` | `Restoring a failed nightly interface` |
| `Appendix B` | `Escalation thresholds for billing disputes` |
| `Overview` | `What a stuck calculation job means for the lab` |

**Both of the pilot corpus's successful headed sections show the effect.**
`5. Scenario 1 - Single Order Cancellation` produced a usable question because the heading names a
scenario. `9. Decision Matrix` produced a question whose stem reads *"According to '9. Decision
Matrix', which statement is correct?"* — grammatical, grounded, and weaker than it needed to be,
purely because of the heading.

### 3.3 Use two or three levels, not six

Heading 1 for the topic, Heading 2 for each sub-topic, Heading 3 only where a sub-topic genuinely
divides. Deeper nesting fragments sections without adding meaning.

### 3.4 Never put a heading on an individual step

This is the single most damaging habit in the pilot corpus and §4.2 quantifies it.

---

## 4. Section-size best practices

### 4.1 Target 300–1,500 characters per section

Roughly **50 to 250 words** — one to three solid paragraphs.

| Size | What happens |
| --- | --- |
| Under 300 characters | Below the assessable threshold. Ignored for generation |
| 300–1,500 characters | **The target.** Enough to state a rule and its rationale |
| 1,500–3,000 characters | Usable, but likely covers several topics — consider splitting |
| Over 3,000 characters | Almost certainly several topics in one section. Questions become vague |

Measured on the pilot corpus: mean section size **520 characters**, smallest **5**, largest
**3,053**. Half of all sections were under the threshold.

### 4.2 The fragmentation trap, measured

Two documents in the corpus are long, thorough, well-maintained SOPs that produced almost nothing —
because every numbered step carries its own heading:

| Document | Sections | With headings | **Assessable** | Share |
| --- | ---: | ---: | ---: | ---: |
| `Rxnet Eolp Database Connection Pool Exhaustion Sop.docx` | 49 | 49 | **7** | 14% |
| `TRACELAB_Support_SOP.docx` | 32 | 32 | **6** | 19% |

Compare the best-structured document in the corpus, which uses headings at the *topic* level:

| Document | Sections | With headings | **Assessable** | Share |
| --- | ---: | ---: | ---: | ---: |
| `RxNet_L2_SSL_Certificate_Renewal_SOP.docx` | 29 | 28 | **26** | **90%** |

**All three are long, headed, professionally written SOPs.** The difference is entirely where the
headings sit. Heading-per-step produced 234-character average sections; heading-per-topic produced
647-character sections that KNOWZY can actually assess.

### 4.3 The opposite trap: the monolith

Eleven documents became a **single section**, because they used no headings at all — for example
`SOP - Printer Management.docx` (one section, 3,053 characters) and `SOP - High Memory Usage.docx`
(one section, 2,456 characters). These are assessable in principle but have no internal granularity:
a question can only cite "the document", coverage cannot be tracked per topic, and a reviewer cannot
see which part of the SOP a question came from.

**Numbering your steps is fine. Giving each step a Heading style is not. Giving the document no
headings at all is equally bad in the other direction.**

---

## 5. Rule-writing best practices

This is where question quality is won or lost.

### 5.1 State the rule as a sentence

KNOWZY needs a **declarative sentence** that states an obligation, a limit, a threshold or a
condition. Procedural imperatives — *"Click Retry"*, *"Run the query"*, *"Check the log"* — tell a
reader what to do next. They are right for their purpose and there is nothing in them to test.

| Not testable | Testable |
| --- | --- |
| Click **Retry** on the failed job. | A failed job **may** be retried **once**; a second failure **must** be escalated to L2. |
| Check the certificate expiry date. | A certificate **must** be renewed at least **30 days** before expiry. |
| Contact the duty manager. | Any incident affecting more than **50** orders **must** be reported to the duty manager within **one hour**. |
| Run the update query. | The update query **may** be run for **only one** job at a time; the next job waits for confirmation. |

Notice what changes: each testable version names **who**, **what**, **how many** and **by when**.

### 5.2 Put the rule and the reason together

Keep the rule and its rationale in the **same section**. A rule in section 3 whose reason is in
section 9 cannot be assessed as one question — and the explanation shown to a learner comes from the
same section as the rule.

### 5.3 Include the quantity

A threshold, a count, a timeframe or a version gives a single correct answer and plausible wrong
ones. *"A certificate must be renewed 30 days before expiry"* yields a question. *"A certificate
must be renewed promptly"* does not — there is no defensible right answer.

### 5.4 Write the rule in a way that survives being quoted alone

The evidence span is shown to the reviewer and to auditors on its own. A sentence that begins
*"In that case, it must be done within the window"* is meaningless out of context. Repeat the subject:
*"A rejected billing dispute must be reopened within five working days."*

### 5.5 Words that signal a rule

`must` · `must not` · `may` · `may only` · `requires` · `never` · `always` · `shall` · `cannot` ·
`is refused` · `is escalated` · `within N hours` · `no more than N`

These are not magic words — they are how obligations are normally written. If a section contains none
of them, it very probably states no rule, which is exactly what the platform reported for **124
refusals across 58 sections**: *"The section describes context and ownership but states no procedure,
threshold, or decision rule that could be tested reliably."*

---

## 6. Scenario-writing best practices

Scenario sections were the corpus's best performers, so they are worth writing deliberately.

A good scenario section has four parts:

1. **A heading that names the situation** — `Cancelling a single order`
2. **When this applies** — the condition that selects this scenario
3. **When it does not apply** — the boundary, which is what makes distractors plausible
4. **What the handler must do, and the constraint on doing it**

**Anonymized example** (structure faithful to the corpus, content invented):

> ### Cancelling a single order
>
> This route applies when exactly **one** job or order must be cancelled and the order has not yet
> reached dispatch. It **must not** be used for bulk cancellations, which follow the batch route in
> the next section.
>
> The handler cancels the order from **Orders → Search or Modify Orders**, and **must** record the
> requester's reference in the cancellation note. A cancellation **may** be reversed within **24
> hours**; after that a replacement order is required.

**Why KNOWZY succeeds on this:** the heading names the situation, the section is roughly 500
characters, and the boundary (*"must not be used for bulk cancellations"*) plus the quantities
(*one*, *24 hours*) give a single correct answer and three genuinely plausible wrong ones. The
corpus's real equivalent, `5. Scenario 1 - Single Order Cancellation` (606 characters), is one of only
three sections in 28 documents that produced a question.

**The boundary sentence matters more than authors expect.** *"When it does not apply"* is what
separates a question that tests judgement from one that tests reading.

---

## 7. Decision-table best practices

Decision tables are the single most productive shape in the corpus. `9. Decision Matrix` in the
Order Cancellation SOP (721 characters) produced a question, and the reason is structural: a table
row **is** a rule.

**Anonymized example:**

> ### Choosing the right cancellation route
>
> | Situation | Route | Approval required |
> | --- | --- | --- |
> | One order, before dispatch | Orders → Search or Modify Orders | None |
> | One order, after dispatch | Raise a credit request | Team leader |
> | More than 10 orders | Batch cancellation script | Duty manager |
> | Any order under billing dispute | Escalate; do not cancel | Billing manager |

Rules for tables that KNOWZY can read:

1. **Use a real table**, not a tab-aligned or space-aligned layout. Alignment by spacing is lost in
   extraction.
2. **Give every column a header row.** The header words become part of the meaning of each cell.
3. **One rule per row.** A row covering two situations cannot become one question.
4. **Keep the consequence in the table**, not in a footnote below it.
5. **Give the table a meaningful heading**, because that heading is quoted into the question stem —
   `Choosing the right cancellation route`, not `Matrix 2`.
6. **Avoid merged cells.** A merged cell makes the row-to-rule mapping ambiguous.
7. **Do not rely on colour.** Red and green cells carry no meaning after extraction — and a
   colour-only rule is an accessibility failure in the source document too.

---

## 8. Examples of good sections

### 8.1 A good rule statement

> ### Certificate renewal window
>
> An SSL certificate **must** be renewed no later than **30 days** before its expiry date. Renewal
> is requested through the platform team, who **require** the certificate's common name and the
> target environment. A renewal raised inside the 30-day window **must** be flagged as expedited,
> because the issuing authority does not guarantee turnaround under five working days.

**Why it works:** one topic, 430 characters, a modal obligation, two quantities (30 days, five
working days), a named actor, and a rationale in the same section. A question can test the window, the
actor or the escalation, and each has exactly one defensible answer.

### 8.2 A good heading hierarchy

```
Heading 1   Certificate renewal for RxNet L2
Heading 2     When a certificate must be renewed
Heading 2     Requesting a renewal
Heading 2     Installing a renewed certificate
Heading 3        Verifying the installation
Heading 2     What to do if renewal is refused
```

**Why it works:** each Heading 2 is a topic with a paragraph or two beneath it, so each becomes a
section of assessable size. This is the shape of
`RxNet_L2_SSL_Certificate_Renewal_SOP.docx` — **29 sections, 26 assessable, 90%**, the best-performing
document in the corpus.

### 8.3 A good scenario section

See §6. The boundary sentence — *"must not be used for bulk cancellations"* — is the part most
authors leave out and the part that makes the question worth asking.

### 8.4 A good decision matrix

See §7.

---

## 9. Examples of poor sections

### 9.1 Too small — below the threshold

> ### 4.7 Retry
>
> Click **Retry**.

**Why it fails:** 18 characters of content. Below the 300-character threshold, so it is not
assessable at all — and even if it were, there is nothing to test. **118 of 234 pilot sections look
like this.**

**Fix:** fold the step into a topic section that states the rule governing retries.

### 9.2 Navigation only

> ### Resolving a stuck job
>
> Open the monitoring dashboard. Navigate to the job list. Filter by status. Select the job. Click
> **Reprocess**. Wait for the status to change. Confirm in the log.

**Why it fails:** 170 characters of pure click path. Nothing is stated that a person could be wrong
about. This is what the platform reported **63 times across 26 sections**: *"No set of four distinct,
plausible options could be formed from this section without inventing content it does not contain."*

**Fix:** add the knowledge around the steps — *"A job may be reprocessed only once. A job that fails
a second time must be escalated to L2 with the correlation ID, because repeated reprocessing
duplicates downstream lab orders."*

### 9.3 Context and ownership with no rule

> ### Purpose and scope
>
> This document describes the process for handling printer issues in the EOLP environment. It is
> owned by the Central Rx Operations Support team and is reviewed annually. It applies to all
> production printers.

**Why it fails:** perfectly good SOP front matter, and it states no rule. The platform's own words,
recorded **124 times**: *"The section describes context and ownership but states no procedure,
threshold, or decision rule that could be tested reliably."*

**This is not a defect to fix.** Every SOP needs a purpose section. Just do not expect questions from
it.

### 9.4 The heading-per-step document

> ```
> Heading 2   Step 1
> Heading 2   Step 2
> Heading 2   Step 3
> ...
> Heading 2   Step 41
> ```

**Why it fails:** produces 49 sections averaging 234 characters, of which 7 clear the threshold —
14%. The document is thorough and the structure defeats it (§4.2).

**Fix:** group the steps under topic headings. `Diagnosing pool exhaustion`, `Clearing blocked
sessions`, `Preventing recurrence` — with the numbered steps as an ordinary numbered list inside each.

### 9.5 A screenshot with the rule inside it

An image showing a configuration screen with the required value highlighted.

**Why it fails:** images are not read. The rule does not exist as far as KNOWZY is concerned.

**Fix:** state the value in text next to the screenshot. Keep the screenshot — it helps the human.

---

## 10. Real findings from the pilot corpus

### 10.1 Headline numbers

| | Value |
| --- | ---: |
| Files in the corpus folder | 29 |
| Documents ingested | **28** (one `.csv`, no extractor) |
| **Extraction failures** | **0** |
| Empty documents | **0** |
| Characters extracted | 122,106 |
| Sections extracted | **234** |
| Sections with **no heading** | **81** (34.6%) |
| Documents with **no headings at all** | **15 of 28** |
| Documents reduced to a **single section** | **11** |
| Sections **below** the 300-character threshold | **118** (50.4%) |
| Sections assessable | **115** (49.1%) |
| Documents with **zero** assessable sections | **0** |
| **Questions accepted** | **3** |
| Refusals with a recorded reason | **194** |

### 10.2 Why only three questions

| Recorded reason | Refusals | Sections |
| --- | ---: | ---: |
| *"…states no procedure, threshold, or decision rule that could be tested reliably"* | **124** | 58 |
| *"No set of four distinct, plausible options could be formed…without inventing content"* | **63** | 26 |
| *"A question testing this section already exists…"* | 5 | 3 |
| `EVIDENCE_NOT_FOUND` — the quoted span was not an exact quotation | 2 | 1 |

**Read the first two rows together: 187 of 194 refusals are the platform saying "this section states
nothing a person could be wrong about."** That is a finding about how support SOPs are written, not
about the documents being poor. They are good runbooks. Runbooks tell you what to press.

**Important caveat, and the reason this guide should not be followed slavishly.** The generator in
use during the pilot is a deterministic sentence-matcher: it requires a declarative sentence carrying
a modal verb. A live model, planned as the next workstream
([`LIVE_CLAUDE_IMPLEMENTATION_PLAN.md`](LIVE_CLAUDE_IMPLEMENTATION_PLAN.md)), should be able to read a
procedure and ask what an engineer must know to follow it.

So:

- **§3 and §4 — headings and section size — help every generator**, now and later. Do this work.
- **§5 — rewriting imperatives as rules — is partly a workaround** for the current generator. Do it
  where the rule genuinely exists and is merely unstated. **Do not rewrite 28 working runbooks to
  suit a template engine that is about to be replaced.**

### 10.3 Evidence verification held

One candidate question was **refused because its quoted span was not an exact quotation** of the
section it cited (`EVIDENCE_NOT_FOUND`, recorded twice — the same section was attempted in two
separate job runs). All three accepted questions verified at **similarity 1.000 under STRICT mode** —
exact, character-for-character quotations. Their composite confidence scores were 0.712, 0.755 and
0.778.

**This is the control working on documents nobody on the project wrote.** It is also why §5.4
matters: the span is quoted exactly, so it must make sense on its own.

### 10.4 Where the three questions came from

| Document | Section | Characters |
| --- | --- | ---: |
| `SOP - Order Cancellation RxNet.docx` | `9. Decision Matrix` | 721 |
| `SOP - Order Cancellation RxNet.docx` | `5. Scenario 1 - Single Order Cancellation` | 606 |
| `Tickets SOP's.docx` | *(no heading)* | 1,520 |

**A decision matrix, a scenario section and a long prose block.** Exactly the three shapes §6 and §7
recommend. Two of the three came from one 13-section document — the one with topic-level headings and
a decision table.

---

## 11. Pilot Corpus Findings — per document

All 28 documents, measured. **Extraction outcome was `EXTRACTED` for every one; there were no
failures.**

### 11.1 The rating rule

Stated so the rating can be recomputed rather than argued about. Let *ratio* = assessable ÷ total
sections, and *headed* = sections with a heading ÷ total sections.

| Rating | Rule |
| --- | --- |
| **Excellent** | ratio ≥ 0.60 **and** headed ≥ 0.60 **and** ≥ 5 assessable sections |
| **Good** | ratio ≥ 0.60 **and** ≥ 3 assessable sections (content right, structure weak) |
| **Fair** | ratio ≥ 0.25, **or** ratio ≥ 0.60 with fewer than 3 assessable sections (monolithic) |
| **Poor** | ratio < 0.25 |

### 11.2 The table

| Document | Sections | Headed | Assessable | Chars | Avg | Extraction | Rating |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| `RxNet_L2_SSL_Certificate_Renewal_SOP.docx` | 29 | 28 | **26** | 18,768 | 647 | EXTRACTED | **Excellent** |
| `SOP - Order Cancellation RxNet.docx` | 13 | 12 | **8** | 5,416 | 417 | EXTRACTED | **Excellent** |
| `ELTL_Lab_Orders_Stuck_in_Awaiting_Calculation_SOP.docx` | 10 | 9 | **6** | 3,770 | 377 | EXTRACTED | **Excellent** |
| `Tickets SOP's.docx` | 18 | 0 | **18** | 25,613 | 1,423 | EXTRACTED | **Good** |
| `SOP for Handling TRTF Job Failure Alerts.docx` | 5 | 0 | **5** | 6,234 | 1,247 | EXTRACTED | **Good** |
| `EOLP Support SOP.pdf` | 35 | 0 | 12 | 10,420 | 298 | EXTRACTED | Fair |
| `SOP_Check_Email_Recipients_Alerts.docx` | 9 | 9 | 3 | 2,445 | 272 | EXTRACTED | Fair |
| `EPROM Frame Sync SOP.docx` | 7 | 7 | 2 | 1,658 | 237 | EXTRACTED | Fair |
| `SOP - Best Practices for Production Log Analysis Using Notepad.docx` | 2 | 0 | 2 | 1,908 | 954 | EXTRACTED | Fair |
| `Handling TRTF Job Failures SAP and ESO Data Issues in EOLP.docx` | 2 | 0 | 2 | 2,009 | 1,005 | EXTRACTED | Fair |
| `EMEA SQL Server Patching – Implementation Plan.docx` | 2 | 0 | 2 | 1,890 | 945 | EXTRACTED | Fair |
| `SOP Retriggering F8 Interface - SAP Core Model Labs.docx` | 2 | 0 | 2 | 1,995 | 998 | EXTRACTED | Fair |
| `Grafana User Access Guide.docx` | 3 | 2 | 1 | 1,014 | 338 | EXTRACTED | Fair |
| `SOP – Azure DevOps Query for Total Support Requests Handled by Dev Team.docx` | 2 | 1 | 1 | 1,510 | 755 | EXTRACTED | Fair |
| `TRTF - How to Verify whether the Order reprocessed with HeadCapeAngle.docx` | 2 | 0 | 1 | 1,544 | 772 | EXTRACTED | Fair |
| `SOP to Identify Replication Issues Between RxNet and Reporting Server.docx` | 2 | 0 | 1 | 1,573 | 787 | EXTRACTED | Fair |
| `WCF - Retriggering jobs stuck in AWTCALCULATION.docx` | 1 | 1 | 1 | 1,416 | 1,416 | EXTRACTED | Fair |
| `azure RDR action steps.docx` | 1 | 0 | 1 | 1,187 | 1,187 | EXTRACTED | Fair |
| `Daily Operational Check – AICHI Azure Central Queue Monitoring.docx` | 1 | 0 | 1 | 1,022 | 1,022 | EXTRACTED | Fair |
| `EOLP RxNet Printing issue SOP.docx` | 1 | 0 | 1 | 1,508 | 1,508 | EXTRACTED | Fair |
| `HOW TO RESEND F6 (F3 Before F6).docx` | 1 | 0 | 1 | 1,266 | 1,266 | EXTRACTED | Fair |
| `Orders stuck in AWT Calculation - Process Selection Labs.docx` | 1 | 0 | 1 | 1,170 | 1,170 | EXTRACTED | Fair |
| `SOP - High Memory Usage.docx` | 1 | 1 | 1 | 2,456 | 2,456 | EXTRACTED | Fair |
| `SOP - Printer Management.docx` | 1 | 1 | 1 | 3,053 | 3,053 | EXTRACTED | Fair |
| `SOP_RELEASE_FLAG.docx` | 1 | 0 | 1 | 895 | 895 | EXTRACTED | Fair |
| `Archive and Purge folders Doc.docx` | 1 | 1 | 1 | 2,041 | 2,041 | EXTRACTED | Fair |
| `TRACELAB_Support_SOP.docx` | 32 | 32 | 6 | 6,425 | 201 | EXTRACTED | **Poor** |
| `Rxnet Eolp Database Connection Pool Exhaustion Sop.docx` | 49 | 49 | 7 | 11,488 | 234 | EXTRACTED | **Poor** |
| **Totals** | **234** | **153** | **115** | **122,106** | 520 | 28 EXTRACTED | — |

**Distribution: 3 Excellent · 2 Good · 21 Fair · 2 Poor.**

### 11.3 Reading the table

- **Nothing scored Poor for lack of content.** Both Poor documents are among the *longest* and most
  thorough in the corpus. They are Poor because of heading placement, which is a formatting decision
  taking an afternoon to reverse.
- **The 21 Fair documents split into two distinct groups**, which need opposite fixes:
  - **Monolithic** (14 documents, 1–2 sections): add topic headings.
  - **Fragmented or front-matter-heavy** (7 documents): consolidate small sections and add rule
    statements.
- **The two highest-yielding documents by content share nothing structurally.** `Tickets SOP's.docx`
  has 18 assessable sections and **zero headings** — its sections came from fallback windowing.
  Adding headings to that document alone would likely make it the best source in the corpus.
- **No document has zero assessable sections.** Worth stating because an earlier report said
  otherwise; that was a platform defect, since fixed, not a property of these documents.

---

## 12. Summary of pilot findings

1. **Extraction is solved.** 28 of 28, zero failures, four binary formats supported. Not the problem.
2. **Structure is the problem.** 15 of 28 documents have no headings; 81 of 234 sections have none;
   half of all sections are below the assessable threshold.
3. **Heading placement decides everything.** Topic-level headings → 90% assessable. Step-level
   headings → 14%. Same authors, same quality, same length.
4. **187 of 194 refusals say the same thing:** the section states nothing a person could be wrong
   about. Support SOPs describe actions, not knowledge.
5. **Grounding held.** One of four candidates was refused for an inexact quotation; the three accepted
   verified exactly. The platform did not fabricate anything.
6. **Decision tables and scenario sections are the productive shapes.** All three questions came from
   a decision matrix, a scenario section and one long prose block.
7. **Low yield is currently a property of the generator**, not of the documents. Fix structure now;
   wait for the model comparison before rewriting prose.

---

## 13. Recommended authoring checklist

Use this when writing a new SOP or revising one for KNOWZY.

**Structure**

- [ ] Uses real **Heading 1/2/3** styles — not bold, not larger font
- [ ] Two or three heading levels, no deeper
- [ ] One **topic** per heading, never one step per heading
- [ ] Each section is **300–1,500 characters** (50–250 words)
- [ ] No section is a single sentence or a bare instruction
- [ ] The document has **more than one** section

**Headings**

- [ ] Each heading names the knowledge, not a position (`When to escalate`, not `Section 4`)
- [ ] A reader could guess what is in the section from the heading alone
- [ ] No heading is only a number, `Overview`, `Steps` or `Matrix`

**Content**

- [ ] Every section that should be assessed contains at least one **declarative rule sentence**
- [ ] Rules name **who**, **what**, **how many** and **by when** where applicable
- [ ] Each rule sits in the **same section** as its rationale
- [ ] Each rule reads sensibly **quoted on its own**
- [ ] Scenario sections state **when this does not apply**
- [ ] Any rule shown in a screenshot is **also stated in text**
- [ ] Decision logic is in a **real table** with a header row and one rule per row
- [ ] No rule depends on cell colour, merged cells or a footnote

**Hygiene**

- [ ] Tracked changes accepted or rejected before publishing
- [ ] No rule lives only in a comment, header or footer
- [ ] Saved as `.docx`, `.pdf`, `.pptx`, `.xlsx`, `.md`, `.txt` or `.html` — **not** `.csv`
- [ ] Front matter (purpose, scope, revision history) is present and **not expected to yield
      questions**

---

## 14. Top 10 actions for SOP owners

In descending order of measured impact.

| # | Action | Why, with evidence |
| --- | --- | --- |
| **1** | **Add Heading styles to the 15 documents that have none** | 81 sections currently have no heading and 11 documents are a single block. Highest-impact change available, and it is formatting, not rewriting |
| **2** | **Move headings from steps to topics in the two Poor documents** | `…Connection Pool Exhaustion…` (49 sections, 7 assessable) and `TRACELAB_Support_SOP.docx` (32, 6). Same content, ~3× the assessable sections |
| **3** | **Add headings to `Tickets SOP's.docx`** | 18 assessable sections, 1,423 characters average, zero headings. The richest content in the corpus with no structure to cite |
| **4** | **Rename numeric and generic headings** | The heading is quoted into the question stem. `9. Decision Matrix` produced a grounded but weak question |
| **5** | **Consolidate sections under 300 characters** | 118 of 234 sections are invisible to generation today |
| **6** | **Add one rule sentence to each procedural section** | 124 refusals said the section states no rule. One sentence per section converts a runbook step into assessable knowledge |
| **7** | **Convert branching prose into decision tables** | A table row is a rule. The corpus's decision matrix is one of only three productive sections |
| **8** | **Add the boundary to every scenario** — *"when this does not apply"* | This is what makes distractors plausible and turns reading into judgement |
| **9** | **Transcribe any rule that exists only in a screenshot** | Images are not read. Keep the screenshot for the human |
| **10** | **Adopt `RxNet_L2_SSL_Certificate_Renewal_SOP.docx` as the house template** | 90% assessable, measured. Do not design a template — copy the one that already works |

**Do first:** actions 1–3. They are formatting changes to five documents, they require no
subject-matter rewriting, and they address the largest measured gaps.

**Do not do yet:** a wholesale prose rewrite of all 28 SOPs (action 6 at scale). Wait for the live
model comparison, which may make most of it unnecessary.

---

## 15. Traceability

| Claim | Source |
| --- | --- |
| Per-document sections, headings, assessable counts, characters | `document_section` and `knowledge_document`, queried 2026-09-22 |
| Refusal reasons and counts | `generation_job_rejection`, grouped by `detail` |
| Evidence spans, modes, similarity, confidence | `draft_question` |
| Corpus totals, extraction outcomes | [`CorpusManifest.md`](../../RealWorldPilot/CorpusManifest.md) §4 |
| Assessable threshold (300 characters) | `coverage.minAssessableChars`, `packages/configuration/src/keys.ts` |
| Evidence bounds (40–1,200 characters), STRICT mode | `packages/claude-services/src/evidence.ts` |
| Supported formats | `packages/content-extraction/src/extract.ts` — `supportedDocumentTypes` |
| Tracked changes, comments, headers excluded | `packages/content-extraction/src/extractors/docx.ts` |
| Generator's rule-sentence requirement | `packages/claude-services/src/generator.ts` — `RULE_SIGNAL` |
| The caveat in §10.2 | [`LIVE_CLAUDE_IMPLEMENTATION_PLAN.md`](LIVE_CLAUDE_IMPLEMENTATION_PLAN.md) §1 |
