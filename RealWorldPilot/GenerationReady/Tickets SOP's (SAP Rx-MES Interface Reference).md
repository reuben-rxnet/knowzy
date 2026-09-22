# SAP to Rx.Net Core Model Interfaces (F1 to F15)

> **Derived pilot asset — not the authoritative SOP. PARTIAL derivation.**
> Derived from **one section** of `Tickets SOP's.docx`, which is a working collection of unrelated
> ticket-handling notes rather than a single procedure. The `.docx` in the SharePoint library remains
> the document of record and contains considerably more than appears here.
>
> **Why only one section was converted.** The parent document's other topics are individual ticket
> walkthroughs containing real job numbers, live SQL against named tables, internal server
> identifiers and an AWS instance IP. Restructuring those into a repository asset would copy customer
> and infrastructure identifiers into version control for no assessment benefit, so they were
> excluded rather than redacted into meaninglessness. The interface reference converted here contains
> no identifiers of any kind.
>
> The file name departs from the `<Original Document Name>.md` convention deliberately, because a
> file named for the parent document would misrepresent what it contains.
>
> `Thresholds`, `Exceptions` and `Validation Criteria` are **deliberately absent**: this section of
> the source is a conceptual reference and states none. See
> [`GENERATION_READY_CORPUS_SUMMARY.md`](../../docs/integrations/GENERATION_READY_CORPUS_SUMMARY.md).

## Purpose

This reference describes the interface stages between SAP and Rx.Net in the Rx-MES core model,
labelled F1 through F15. Each stage names a specific exchange of information between the two systems
at a particular point in the order and manufacturing lifecycle.

Its purpose in support is orientation. When a ticket refers to an interface by label — an F6 failure,
an F8 retrigger, an F14 notification — the handler needs to know what that stage does and which
direction the information flows, before deciding which system and which team owns the problem.

## Business Context

An order does not pass between SAP and Rx.Net once. It crosses the boundary repeatedly, and each
crossing is a numbered interface with a defined payload and direction. Some stages carry order data
into Rx.Net, some carry manufacturing status back into SAP, and some carry document availability
notifications onward to Rx-MES.

This matters for support because the interface label in a ticket subject is often the only
information available at triage. Knowing that F1 carries prescription details from SAP to Rx.Net
while F7 carries manufacturing status from Rx.Net to SAP tells a handler immediately which side of
the boundary a failure sits on. Several stages are also conditional rather than universal — F4 order
cancellation is described as optional and occurs only where a user chooses to cancel — so the absence
of a stage for a given order is not necessarily a fault.

## Decision Rules

The direction of flow determines which system is investigated first. Stages that send data from SAP
into Rx.Net are F1 (order entry), F2 (lens and stock availability), F3 (materials information) and
F10 (shipment notification). Stages that send data from Rx.Net into SAP are F7 (manufacturing status)
and F8 (prescription and lens cutting details). F5 originates at the lab, F6 returns confirmation
from SAP to Rx.Net, and F14 and F15 concern document notification and download to Rx-MES.

F4 is optional. It is invoked only where a user wants to cancel the order, in which case the job is
called to Rx.Net and the order can then be cancelled in SAP. Its absence for a given order is
therefore normal and not a missing step.

F5 and F6 are a request and confirmation pair and must be read together. F5 is the pick request, F6
is the pick confirmation, and F6 depends on the pick request having been confirmed and the job ticket
having been printed.

## Scenarios

### Order intake and material availability

**F1** is order entry: prescription details are sent from SAP to Rx.Net. **F2** covers availability —
SAP checks lens availability and stock availability from the warehouse and sends that information to
Rx.Net. **F3** covers materials: lenses, frames, kitting materials and similar production materials
are managed by SAP, and the same information is communicated to Rx.Net.

These three stages establish what is to be made and whether the components exist. A failure here
means the order is not fully known to Rx.Net, rather than that manufacturing has failed.

### Picking and confirmation

**F5** is the pick request, where OPC details are sent from the lab to SAP so that lenses —
semi-finished and stock lenses — can be picked from the warehouse. **F5.1** follows: once the lens has
been picked from the warehouse, the job ticket containing the user requirement details is printed on
the print server.

**F6** is pick confirmation. Once the pick request is confirmed and the job ticket has been printed,
the OPC referenced in F5 is picked and SAP sends confirmation back to Rx.Net as a conformity check.

### Manufacturing and status reporting

**F7** is Rx.Net sending the status of the different stages of the order to SAP. As lens
manufacturing begins — filming, blocking and the subsequent stages — the corresponding statuses are
shared from Rx.Net to SAP.

**F8** is Rx.Net sending prescription details to SAP. This is the stage at which the actual cutting of
the lens takes place, and the lens cutting precision details are shared via the calculation service
to Rx.Net. The calculation service is also referred to as the saturn call.

### Shipment and documents

**F10** is SAP informing Rx.Net that the order has been shipped.

**F14** is document notification: when a document such as a sticker, WC, DN or FJT becomes available,
Rx-MES is notified. **F15** relates to downloading the document. The two are sequential — notification
that a document exists, then retrieval of it — so a document that cannot be downloaded is an F15
concern while a document nobody was told about is an F14 concern.

## Knowledge Checks

A technician working with these interfaces should be able to explain:

- Which interface carries order entry, and in which direction.
- Which interfaces send data from SAP into Rx.Net, and which send data from Rx.Net into SAP.
- Which interface is optional, and why its absence for an order is not a fault.
- The relationship between F5, F5.1 and F6, and what must have happened before F6 can occur.
- What is printed at F5.1 and where.
- Which interface reports manufacturing stage status, and give examples of those stages.
- Which interface covers lens cutting, and what the calculation service is also called.
- Which interface reports shipment, and in which direction.
- The difference between F14 and F15, and which one a failed document download belongs to.
