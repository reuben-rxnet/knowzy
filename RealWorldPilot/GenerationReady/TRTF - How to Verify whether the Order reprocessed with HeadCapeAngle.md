# Verifying that a TRTF Order Was Reprocessed with HeadCapeAngle

> **Derived pilot asset — not the authoritative SOP.**
> Restructured from
> `TRTF - How to Verify whether the Order reprocessed with HeadCapeAngle.docx` for
> generation-quality evaluation only. The `.docx` in the SharePoint library remains the document of
> record. No operational rule has been added, removed or altered. **A customer order identifier and a
> reference ticket number have been replaced with placeholders**, and the two screenshot references
> have been omitted because images carry no extractable text.
>
> **This is the thinnest document in the generation-ready set.** The source states a verification
> method and a handoff, and no thresholds or exception cases. The `Thresholds` and `Exceptions`
> sections of the standard format are therefore **deliberately absent rather than filled**, because
> inventing them would create knowledge the source does not contain. See
> [`GENERATION_READY_CORPUS_SUMMARY.md`](../../docs/integrations/GENERATION_READY_CORPUS_SUMMARY.md).

## Purpose

This procedure defines how the L2 team confirms that a TRTF order has been reprocessed with a
HeadCapeAngle value, so that the Generix team can be given a definitive answer rather than an
assumption.

It is used after the Generix team has reprocessed an order and has asked L2 to confirm the outcome.
The verification is performed against the transformation database through the Azure portal's Data
Explorer, comparing the record as it existed before reprocessing with the record written after it.

## Business Context

This verification exists because the reprocessing itself is performed by a team that cannot confirm
its own result in the system of record. The sequence runs across three teams and is triggered by a
monitoring alert.

An alert of the form _"AppMetrics | where Name == JobError related to trtf-prd-rsg-frc->TRTF.PRD.
Some jobs are done with Failed status is fired trtf"_ is raised at P2. For alerts matching that
subject, the TRTF team's guidance is that a new ticket is raised with the Generix team to investigate
the issue relating to HeadCapeAngle. The Generix team then reprocesses the order and asks the L2 team
to confirm whether the order was in fact reprocessed. L2 answers that question using the steps below.

The customer order identifier needed for the query is not obtained from the alert. It is found in the
file attached by the TRTF team.

## Decision Rules

Confirmation to the Generix team may be given only after the reprocessed record has been inspected
and the error value has been observed to be null. The absence of a new alert is not evidence that the
order was reprocessed.

The customer order identifier used in the query must be taken from the file attached by the TRTF
team rather than assumed or reconstructed from the alert text.

The query returns records for a single customer order, and the verification depends on **two**
records being present — the state before reprocessing and the state after it. A result containing
only one record does not demonstrate that reprocessing occurred.

## Scenarios

### Running the verification

The handler opens the Azure portal and searches for the relevant resource, then opens **Data
Explorer** and navigates to the transformation database, through `Jobs` to `items`. The following
query is executed, with the customer order identifier taken from the file attached by the TRTF team:

```sql
SELECT * FROM c WHERE c.extendedProperties.customerOrderId = '<customerOrderId>'
```

The output is expected to contain two records for that order. One is the record carrying the error as
it stood before reprocessing. The other is the record written after the Generix team processed the
order, and in that record the error value is null. Once that has been observed, the handler can
confirm to the Generix team that the order has been reprocessed with HeadCapeAngle.

## Validation Criteria

The verification is complete when three things are true. The query has been executed against the
correct customer order identifier taken from the TRTF team's attached file. Two records have been
returned for that order. The error value in the record written after reprocessing is null.

Only then is the confirmation sent to the Generix team. The confirmation reports what the data shows
rather than that the reprocessing request was made.

## Knowledge Checks

A technician working this procedure should be able to explain:

- Which alert subject leads to a ticket being raised with the Generix team, and at what priority.
- Which team reprocesses the order, and which team confirms the outcome.
- Where the customer order identifier is obtained from, and why it is not taken from the alert.
- Which database, container and query are used for the verification.
- Why the query is expected to return two records rather than one.
- What field value distinguishes the reprocessed record from the original.
- Why the absence of a new alert does not constitute confirmation.
