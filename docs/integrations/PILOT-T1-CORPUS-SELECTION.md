# PILOT-T1 — Corpus Selection

**Status:** Executed 2026-09-22 against the approved real SOP corpus.
**Register of record:** [`RealWorldPilot/CorpusManifest.md`](../../RealWorldPilot/CorpusManifest.md).
**Why this document exists:** the corpus is larger than one generation job may take, so a selection
is **required** rather than optional. This records what was selected, on what basis, and what the
result revealed about the basis itself.

---

## 1. Why a selection is forced, not chosen

`generation.maxDocumentsPerJob` is **10**, with a hard ceiling of 10 in the configuration catalogue.
Passing all 28 selectable documents is refused:

```
422 GENERATION_SELECTION_REQUIRED
The field "documentIds" is missing or invalid.
Generation requires an explicit selection of 1-10 documents.
```

That cap is not an arbitrary limit. Its declared purpose is to keep a batch **reviewable**: every
generated question needs a human to read it against its evidence, so a job that produces more than a
reviewer can work through converts a governance control into a backlog. The refusal is the control
working.

The consequence for a real corpus is worth stating plainly: **a 28-document corpus cannot be
generated from in one action, and no screen or script should pretend otherwise.** Selection is part
of the workflow.

---

## 2. The corpus

29 files in `SOPs/SOPs/` under the approved mirror root.

| | Count |
| --- | ---: |
| Files discovered | **29** |
| DOCX | 27 |
| PDF | 1 |
| CSV — **no registered extractor** | 1 |
| Selectable after extraction | **28** |
| Sections extracted | **234** |
| Sections **assessable** (by length) | **115** |
| Characters extracted | **122,106** |

The CSV is reported as unsupported by Test Connection check 5 — at configuration time, before any
synchronization — rather than being discovered as a failure afterwards.

---

## 3. The selection rule

**The ten documents with the most sections, descending, ties broken by name.**

Deterministic, so the same corpus yields the same selection on every run, which matters because a
preflight decision is recorded against a specific document set.

The reasoning behind the rule: section count is a proxy for how much distinct, separately-citable
content a document holds, and a document with more sections has more chances to contain a sentence
that states a testable rule. It is a **proxy**, and §5 shows how imperfect a proxy it turned out to
be.

### 3.1 What was selected

| # | Document | Sections | Assessable (by length) | Questions produced |
| --- | --- | ---: | ---: | ---: |
| 1 | `Rxnet Eolp Database Connection Pool Exhaustion Sop.docx` | 49 | 7 | 0 |
| 2 | `EOLP Support SOP.pdf` | 35 | 12 | 0 |
| 3 | `TRACELAB_Support_SOP.docx` | 32 | 6 | 0 |
| 4 | `RxNet_L2_SSL_Certificate_Renewal_SOP.docx` | 29 | 27 | 0 |
| 5 | `Tickets SOP's.docx` | 18 | 18 | **1** |
| 6 | `SOP - Order Cancellation RxNet.docx` | 13 | 8 | **2** |
| 7 | `ELTL_Lab_Orders_Stuck_in_Awaiting_Calculation_SOP.docx` | 10 | 6 | 0 |
| 8 | `SOP_Check_Email_Recipients_Alerts.docx` | 9 | 3 | 0 |
| 9 | `EPROM Frame Sync SOP.docx` | 7 | 2 | 0 |
| 10 | `SOP for Handling TRTF Job Failure Alerts.docx` | 5 | 5 | 0 |
| | **Totals** | **207** | **94** | **3** |

### 3.2 What was not selected

The 18 remaining documents, all 1–3 sections each. An earlier draft of this document claimed these
held all the assessable content; §5 withdraws that.

`Archive and Purge folders Doc.docx` · `azure RDR action steps.docx` ·
`Daily Operational Check – AICHI Azure Central Queue Monitoring.docx` ·
`EMEA SQL Server Patching – Implementation Plan.docx` · `EOLP RxNet Printing issue SOP.docx` ·
`Grafana User Access Guide.docx` ·
`Handling TRTF Job Failures SAP and ESO Data Issues in EOLP.docx` ·
`HOW TO RESEND F6 (F3 Before F6).docx` ·
`Orders stuck in AWT Calculation - Process Selection Labs.docx` ·
`SOP – Azure DevOps Query for Total Support Requests Handled by Dev Team.docx` ·
`SOP - Best Practices for Production Log Analysis Using Notepad.docx` ·
`SOP - High Memory Usage.docx` · `SOP - Printer Management.docx` · `SOP_RELEASE_FLAG.docx` ·
`SOP Retriggering F8 Interface - SAP Core Model Labs.docx` ·
`SOP to Identify Replication Issues Between RxNet and Reporting Server.docx` ·
`TRTF - How to Verify whether the Order reprocessed with HeadCapeAngle.docx` ·
`WCF - Retriggering jobs stuck in AWTCALCULATION.docx`

---

## 4. The result of the selected job

| | |
| --- | --- |
| Sections in scope | 93 |
| Questions accepted | **3** |
| Refused by evidence verification (`EVIDENCE_UNVERIFIED`) | **1** |
| Sections reporting insufficient evidence | **97** |
| Tokens | 21,354 in / 1,084 out |

All three accepted questions were then claimed, submitted, approved by a second identity, and
published as `KNZ-SUPPORT_OPS-2026-000001…000003`.

---

## 5. What the run actually showed — and a conclusion I withdrew

The first reading of this run was that the selection rule had picked exactly the wrong documents:
every one of the ten showed zero assessable sections, while the eighteen unselected ones held all 22.
That looked like a clean anti-correlation between section count and assessability.

**It was an artifact of a defect, and the conclusion is withdrawn.** Generation had been writing
`isAssessable: false` on any section it could not build a question from, so the ten selected documents
had their flags cleared *by the very job being measured*. The eighteen unselected documents still had
intact flags because nothing had generated from them. Measured against section length instead, the
selected ten held **95** sections over the assessable threshold. Full account:
[`CorpusManifest.md` §4.3.1](../../RealWorldPilot/CorpusManifest.md).

### 5.1 What is true about the selection rule

Section count is a **weak and unreliable** proxy — not systematically inverted, which was the second
thing I got wrong. The relationship is simply inconsistent:

| Document | Sections | Assessable | Ratio |
| --- | ---: | ---: | ---: |
| `RxNet_L2_SSL_Certificate_Renewal_SOP.docx` | 29 | 27 | 93% |
| `Tickets SOP's.docx` | 18 | 18 | 100% |
| `SOP for Handling TRTF Job Failure Alerts.docx` | 5 | 5 | 100% |
| `Rxnet Eolp Database Connection Pool Exhaustion Sop.docx` | 49 | 7 | 14% |
| `TRACELAB_Support_SOP.docx` | 32 | 6 | 19% |
| `EOLP Support SOP.pdf` | 35 | 12 | 34% |

Some long SOPs are written in prose sections well over the threshold; others are step-by-step lists
whose sections are mostly fragments. **Section count does not tell you which**, so ranking by it is
guessing with extra steps.

**Better rule: rank by assessable section count, then by assessable characters.** Both are computed
and stored at extraction time, and preflight already reports `assessableSectionCount` per document.
The selection was reading the wrong column — and the right column was available all along.

### 5.2 But a better selection would not have helped this corpus

Tested directly rather than assumed. A second job was aimed at the ten documents with the **most
untried assessable sections** — precisely what §5.1 recommends:

| | |
| --- | --- |
| Documents selected | 10 |
| Assessable sections in scope | 14, none previously attempted |
| Questions requested | 10 |
| Questions accepted | **0** |
| Insufficient evidence | **14 of 14** |

So the ranking is worth fixing for correctness, but it is **not** what limits yield here. The limit is
the generator's requirement for a declarative sentence containing a modal
(`must|may|requires|never|only|shall|cannot`), against a corpus written in the imperative —
*"Click Retry"*, *"Run the query"*, *"Check the log"*.

### 5.3 Recommendation

1. **Adopt the §5.1 ranking** and expose assessable-section count in any future selection UI, so a
   person choosing documents sees the number that predicts yield rather than one that does not.
2. **Do not tune the selection to chase yield on this corpus.** No selection of these 28 documents
   produces meaningfully more questions from the deterministic generator.
3. **Treat this as the T-29 case.** The 106 recorded refusals are the baseline a model should be
   measured against.

## 6. What this says about the pilot, beyond the rule

**Real support SOPs are procedural, and procedure resists four-option testing.** The refusal reasons
the platform recorded are precise about it:

> *"The section describes context and ownership but states no procedure, threshold, or decision rule
> that could be tested reliably."*
>
> *"No set of four distinct, plausible options could be formed from this section without inventing
> content it does not contain."*

That is the platform declining to fabricate, which is the behaviour the whole governance design
exists to produce. It is also the clearest argument yet for the Claude comparison (**T-29**): the
deterministic generator needs a sentence carrying a modal and ideally a quantity, and a model may
find testable knowledge in a procedure that sentence-matching cannot. The **97 recorded refusals are
the baseline** to measure that against.

Until that comparison runs, low yield is a property of **the generator as much as of the content**,
and the two must not be conflated when reporting to stakeholders.

### 6.1 Three practical consequences

1. **Do not promise a question count from a document count.** For this corpus and this generator the
   honest ratio is 3 questions from 10 documents, and it is content-dependent.
2. **Prefer policy and threshold documents over step-by-step runbooks** when choosing a pilot corpus.
   A document that says *"a certificate must be renewed thirty days before expiry"* yields a
   question; one that says *"click Retry, then check the log"* does not, and should not.
3. **`coverage.minAssessableChars` (300) is now a tuned parameter with evidence behind it.** Lowering
   it would admit more sections and more fragments; it is configurable per profile, and any change
   should be measured against this baseline rather than guessed at.
