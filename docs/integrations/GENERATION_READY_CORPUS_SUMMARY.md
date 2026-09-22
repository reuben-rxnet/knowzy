# Generation-Ready Corpus — Summary

**Created:** 2026-09-22. **Location:** `RealWorldPilot/GenerationReady/` (7 Markdown documents).
**Register of record:** [`CorpusManifest.md` §7](../../RealWorldPilot/CorpusManifest.md).
**Authoring rules applied:** [`SOURCE_DOCUMENT_AUTHORING_GUIDE.md`](SOURCE_DOCUMENT_AUTHORING_GUIDE.md).
**Purpose:** give the generator comparison in
[`LIVE_CLAUDE_EVALUATION_PLAN.md`](LIVE_CLAUDE_EVALUATION_PLAN.md) a corpus whose structure is not the
limiting factor, so that what the comparison measures is the *generator*.

---

## 0. What these files are

Seven Markdown documents restructured from the real pilot SOPs. They are **pilot, evaluation,
demonstration and comparison assets**, and nothing else.

- **The originals are unmodified.** No `.docx` or `.pdf` was opened for writing. Every derived
  document was produced from the platform's own stored `extracted_text`.
- **They do not replace anything.** The SharePoint library remains the source of record, and
  `CorpusManifest.md` §3 still describes the authoritative corpus.
- **They are not authoritative.** Each file carries a header block saying so, naming its original.
- **No rule was invented.** Content was consolidated, reorganised, re-headed and clarified. Nothing
  was added, removed or changed in meaning.

### 0.1 One instruction I did not follow literally, and why

The requested format specifies nine fixed sections, and the same brief says not to create knowledge
the source does not contain. For several documents those two instructions conflict: a verification
procedure that states no thresholds cannot have a `Thresholds` section without one being invented.

**Resolution: the section is omitted rather than filled**, and each file records which sections are
absent and why. This is also consistent with the brief's own instruction to avoid empty sections. The
alternative — writing plausible thresholds — would have produced exactly the fabrication the whole
platform exists to prevent, and would have contaminated the evaluation corpus with content no SOP
owner ever approved.

### 0.2 Redactions

Named individuals, mailbox addresses, internal server FQDNs, an AWS instance IP, customer order
identifiers and real job numbers were redacted or excluded before anything was written to the
repository. **No operational rule depends on any of them.** The rule *"request the certificate in
TripleDes encryption format"* survives without the requester's email address.

---

## 1. Source documents selected

Seven, chosen to cover every category in the brief and to test the authoring guide's claims against
opposite structural failure modes.

| Original | Why selected | Original structure |
| --- | --- | --- |
| `RxNet_L2_SSL_Certificate_Renewal_SOP.docx` | Named priority. Also the corpus's **best-structured** document, included as a control: if restructuring helps a document that is already good, that says something | 29 sections, 26 assessable (90%) |
| `SOP - Order Cancellation RxNet.docx` | Named priority. The only document that has ever produced published questions, so its "after" figure is directly comparable | 13 sections, 8 assessable (62%) |
| `Rxnet Eolp Database Connection Pool Exhaustion Sop.docx` | Operational runbook, and the **worst** structural case: a heading on every step | 49 sections, 7 assessable (14%) |
| `TRACELAB_Support_SOP.docx` | Operational runbook, second-worst structural case, same failure mode | 32 sections, 6 assessable (19%) |
| `SOP - Printer Management.docx` | "Low structural quality but strong operational content" — the monolith case. One section, 3,053 characters, four ordered checks with exact pass conditions | 1 section, 1 assessable |
| `TRTF - How to Verify whether the Order reprocessed with HeadCapeAngle.docx` | The only verification procedure in the corpus | 2 sections, 1 assessable, no headings |
| `Tickets SOP's.docx` | Decision-based candidate and the corpus's densest content — 18 assessable sections, zero headings | 18 sections, 18 assessable, no headings |

### 1.1 Why `Tickets SOP's.docx` was only partially converted

It is not a single SOP. It is a working collection of unrelated ticket notes: a customer-group transco
mapping walkthrough, two PDF regeneration procedures with live SQL, a SAP interface reference, and an
EOLP hypercare routine with server identifiers. One of its entries even contains an unresolved
authoring note.

Its other topics carry real job numbers, live SQL against named tables, internal server identifiers
and an AWS instance IP. Restructuring those into a repository asset would copy customer and
infrastructure identifiers into version control for no assessment benefit, so **only the SAP to Rx.Net
interface reference (F1–F15) was converted** — coherent, conceptual, and free of identifiers of any
kind.

That file is therefore named `Tickets SOP's (SAP Rx-MES Interface Reference).md` rather than following
the `<Original Document Name>.md` convention, because a file named for the parent document would
misrepresent what it contains. **This is a deliberate departure from the brief**, recorded here rather
than made silently.

---

## 2. Generated files created

| Generated file | Sections | Headed | Assessable | Characters | Avg section | Sections omitted from the format |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `Rxnet Eolp Database Connection Pool Exhaustion Sop.md` | 13 | 13 | 13 | 12,371 | 952 | — |
| `SOP - Order Cancellation RxNet.md` | 13 | 13 | 13 | 8,508 | 654 | — |
| `RxNet_L2_SSL_Certificate_Renewal_SOP.md` | 12 | 12 | 12 | 11,581 | 965 | — |
| `TRACELAB_Support_SOP.md` | 12 | 12 | 11 | 9,274 | 773 | — |
| `SOP - Printer Management.md` | 12 | 12 | 11 | 6,517 | 543 | — |
| `Tickets SOP's (SAP Rx-MES Interface Reference).md` | 9 | 9 | 9 | 6,292 | 699 | Thresholds, Exceptions, Validation Criteria |
| `TRTF - ...HeadCapeAngle.md` | 7 | 7 | 7 | 4,667 | 667 | Thresholds, Exceptions |
| **Totals** | **78** | **78** | **76** | **59,210** | 759 | — |

Measured with the platform's own `extractContent` and sectionizer, not estimated.

**Structural outcome: 78 of 78 sections carry a heading, and 76 of 78 are assessable (97.4%)**, against
46.5% for the same seven documents in their original form. No section exceeds the 1,500-character
guideline except one, and two fall just below the 300-character assessable floor.

---

## 3. Assessable section improvements

| Document | Assessable before | Assessable after | Change |
| --- | ---: | ---: | --- |
| `SOP - Printer Management` | 1 | 11 | **+10** |
| `Rxnet Eolp Database Connection Pool Exhaustion Sop` | 7 | 13 | **+6** |
| `TRTF - HeadCapeAngle verification` | 1 | 7 | **+6** |
| `TRACELAB_Support_SOP` | 6 | 11 | **+5** |
| `SOP - Order Cancellation RxNet` | 8 | 13 | **+5** |
| `Tickets SOP's` (partial derivation, not comparable) | 18 | 9 | −9 |
| `RxNet_L2_SSL_Certificate_Renewal_SOP` | 26 | 12 | **−14** |
| **Totals** | **67** | **76** | **+9** |

**The totals understate what happened, and the two negative rows are the interesting ones.**

Assessable-section *count* is a poor measure of improvement, because consolidating many small
sections into fewer large ones reduces the count while improving each section. The SSL document lost
14 assessable sections and every remaining one is better. The density figure — 46.5% to 97.4% — says
more, and the yield figure in §5 says most.

---

## 4. Why each document was selected

**`RxNet_L2_SSL_Certificate_Renewal_SOP.docx` — the control.** At 90% assessable it was already the
corpus's best document. Including it tests whether restructuring helps unconditionally. It does not:
see §6.

**`SOP - Order Cancellation RxNet.docx` — the only baseline that exists.** Two of the three published
pilot questions came from it, so its before-and-after is the one directly comparable pair in the
corpus.

**The two step-headed runbooks — the diagnosis under test.** The authoring guide's central claim is
that heading placement, not content quality, predicts yield: 49 sections yielding 7 assessable, and
32 yielding 6, against 29 yielding 26 in a document written by the same team. If that claim is right,
consolidating these two should transform them. It did — 7 → 13 and 6 → 11.

**`SOP - Printer Management.docx` — the monolith.** One section of 3,053 characters containing four
ordered checks, each with an exact pass condition (`Ready`, test page prints, ping replies, services
`Running`) and a defined handoff. Strong operational content that the platform could only cite as
"the document". The largest single improvement in the set.

**`TRTF - ...HeadCapeAngle.docx` — the verification category, and an honesty test.** The thinnest
document selected. It states a verification method and a three-team handoff, and no thresholds or
exceptions. It is included partly to demonstrate that a thin source produces a thin derived document
with sections **omitted rather than padded**.

**`Tickets SOP's.docx` — the densest content in the corpus.** 18 assessable sections and zero
headings, so nothing could be cited precisely. Converted partially, for the reasons in §1.1.

---

## 5. Expected question-generation improvements — measured

Not expected. **Measured**, by running the platform's real deterministic generator over both corpora
with evidence verification in STRICT mode and the integrity gate applied.

| Document | Questions before | Questions after |
| --- | ---: | ---: |
| `SOP - Order Cancellation RxNet` | 2 | **5** |
| `TRACELAB_Support_SOP` | 0 | **5** |
| `SOP - Printer Management` | 0 | **3** |
| `Rxnet Eolp Database Connection Pool Exhaustion Sop` | 0 | **1** |
| `TRTF - HeadCapeAngle verification` | 0 | **1** |
| `Tickets SOP's` (partial) | 2 | 1 |
| `RxNet_L2_SSL_Certificate_Renewal_SOP` | 0 | **0** |
| **Totals** | **4** | **16** |

**A 4× increase — 4 to 16 — with every one of the sixteen passing evidence verification and the
integrity gate.**

**Method caveat, stated because it affects how the number should be quoted.** The "before" column
re-runs the generator over the stored normalized text through the plain-text extractor, so its
sectioning differs from the DOCX path and its section counts are lower than the authoritative
register. It is a proxy rather than a controlled arm. It agrees closely with the authoritative pilot
run, which accepted 3 questions with 2 from Order Cancellation and 1 from `Tickets SOP's`.

The properly controlled comparison is Arm A of the evaluation plan, which re-runs the control on a
clean database over a pinned scope. **This measurement is evidence that the restructuring works; it
is not a substitute for that arm.**

---

## 6. Two findings that contradict the expectation

### 6.1 Restructuring a well-structured document made it worse

`RxNet_L2_SSL_Certificate_Renewal_SOP` produced **zero questions before and zero after**, and lost 14
assessable sections in the process. Twelve sections averaging 950 characters, dense with obligations,
and the generator found nothing in any of them.

**That document did not need converting.** It is recorded as **Good** rather than Excellent for that
reason, and it is the clearest evidence in this exercise that "restructure everything" is the wrong
instruction.

### 6.2 Yield tracks quantities in rule sentences, not structural quality

The generator builds three distractors by swapping a quantity, a modal, or a known actor noun. A
sentence carrying one modal, no number and no recognised actor yields **one** distractor, and the
section is then refused for want of three.

That is exactly the SSL document's prose style — *"L2 must not wait for business impact before
checking certificate validity"* — a perfectly good rule with nothing for the generator to vary.
Whereas the two documents that produced five questions each are full of numbers: TRACELAB carries
version `1.6.0.2`, `HTTP 200 OK`, "seven situations", "thirteen checks"; Order Cancellation carries
`NO = 1` and the one-versus-three job distinction.

**So the measured rule is narrower than the authoring guide's advice implies:**

> Headings and section size make a document **assessable**. A stated quantity makes it **generate**.

This refines [`SOURCE_DOCUMENT_AUTHORING_GUIDE.md`](SOURCE_DOCUMENT_AUTHORING_GUIDE.md) §5.3 from
advice into a measured requirement — and it is a property of **this generator**. A model reading
*"L2 must not wait for business impact"* can construct three plausible wrong answers without needing
a number to vary. Whether it does is what the comparison exists to find out, and this corpus is now
the place to find out on equal structural footing.

---

## 7. Governance constraint

These files are in the repository, not the SharePoint library, so `CorpusManifest.md` §2 — inclusion
criteria, permission assumptions, retention — does **not** govern them.

Any question generated from this corpus carries provenance pointing at a **derived asset** rather than
at a document of record. That is acceptable for evaluation and **not acceptable for publication**:
**no question generated from this corpus may be published to the Question Bank.** A published question
must cite the SOP its owner approved.

---

## 8. Recommended evaluation corpus

| | |
| --- | --- |
| **For the generator comparison** (evaluation plan Arms A and B) | These **7 documents, 78 sections, 76 assessable**. Structure is no longer the limiting factor, so the comparison measures the generator |
| **Exclude from the comparison** | `RxNet_L2_SSL_Certificate_Renewal_SOP.md`. It yields zero under the control, so it contributes no signal to a before-and-after — but **keep it for the blind-stem and rubric scoring**, where a model finding questions the control cannot is the most interesting result available |
| **For the authoritative pilot demonstration** | The **original 28 documents**, unchanged. A demonstration must run on the documents of record |
| **Do not use for** | Publication to the Question Bank, any coverage or yield figure quoted as being about the real corpus, or any claim about the SOPs themselves |

---

## 9. Traceability

| Claim | Source |
| --- | --- |
| Original section, heading and assessable counts | `document_section` / `knowledge_document`, queried 2026-09-22; [`CorpusManifest.md` §3](../../RealWorldPilot/CorpusManifest.md) |
| Generated section counts, headings, characters | `extractContent` + sectionizer, run over `RealWorldPilot/GenerationReady/` |
| Question yield before and after | `createDeterministicGenerator` + `verifyEvidence` (STRICT) + `checkIntegrity` |
| Source content of every derived document | `knowledge_document.extracted_text` for the named original |
| Assessable threshold (300 characters) | `coverage.minAssessableChars` |
| Distractor construction and `RULE_SIGNAL` | `packages/claude-services/src/generator.ts` |
| The authoring rules applied | [`SOURCE_DOCUMENT_AUTHORING_GUIDE.md`](SOURCE_DOCUMENT_AUTHORING_GUIDE.md) §3–§7 |
| Comparison methodology this corpus feeds | [`LIVE_CLAUDE_EVALUATION_PLAN.md`](LIVE_CLAUDE_EVALUATION_PLAN.md) §4 |
