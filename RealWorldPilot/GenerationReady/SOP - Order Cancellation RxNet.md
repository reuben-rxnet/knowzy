# RxNet Order Cancellation

> **Derived pilot asset — not the authoritative SOP.**
> Restructured from `SOP - Order Cancellation RxNet.docx` (v1.0, effective 20-Jul-2026, owner RxIT
> Application Support) for generation-quality evaluation only. The `.docx` in the SharePoint library
> remains the document of record. No operational rule has been added, removed or altered; content has
> been consolidated and re-headed. See
> [`GENERATION_READY_CORPUS_SUMMARY.md`](../../docs/integrations/GENERATION_READY_CORPUS_SUMMARY.md).

## Purpose

This procedure defines how the Application Support team cancels RxNet orders through the CS Client.
It covers four distinct situations: cancelling a single job, cancelling multiple jobs together,
handling EOLP orders stuck in the orchestration queue, and cancelling an order where the
cancellation status must not be sent to the customer.

The objective is that every cancellation uses the correct cancellation reason or code for the
situation, is validated afterwards in Job Tracker, and never relies on an assumption about which
code the lab wants. The procedure applies to RxNet order cancellation requests handled by
Application Support and is written for the L2 and L3 support teams.

## Business Context

An RxNet cancellation is not a single action with a single outcome. The cancellation reason selected
in the CS Client determines whether a status message is generated and sent to the customer, so the
choice of reason has consequences outside the lab. Some reasons, such as `LAB SYSTEM SETUP AND TEST`
and `RETRIG-AWTORCH`, send no status to the customer. Others, such as `LMS PATIENT REQUEST` and
`LMS DISCONTINUED`, are used where the lab has identified that specific reason. Because of this, the
lab — not the support handler — decides which code applies when customer status must be suppressed.

A handler needs several things in place before starting: access to the relevant application server,
access to the RxNet CS Client, the job number or list of job numbers from the request, the ability to
validate order status in Job Tracker, and confirmation from the lab whenever a specific cancellation
reason or code is required.

## Decision Rules

The order status must be verified in Job Tracker before any cancellation is attempted. If the order
is already cancelled, the requester must be informed and the request closed as applicable rather than
cancelled a second time.

A blank cancellation reason must never be selected, in either the single-order or the mass
cancellation flow.

When the cancellation status must not be generated for the customer, the correct cancellation code
must be confirmed with the lab before proceeding. The handler must not assume the code; lab
confirmation is mandatory.

The EOLP orchestration queue process may only be used for EOLP orders that are stuck in the
orchestration queue table. It must not be used for WIP orders. Before using it, the handler must
confirm that the lab is EOLP, that the order is stuck in the orchestration queue table, and that the
order is not a WIP order.

Job Tracker validation must be completed after every cancellation, and the requester or lab must be
informed once the cancellation is complete.

## Thresholds

The SOP states few numeric thresholds, and the ones it does state are decisive.

A cancellation code suppresses the customer-facing status only when its status XML generation setting
is `NO = 1`. That value is the measurable test for whether a code is safe to use when the lab has
asked that the customer not be notified.

The distinction between the two main flows is also a count: the single-order flow applies when
exactly one job or order must be cancelled, and the mass cancellation flow applies when multiple jobs
or orders must be cancelled together. A handler choosing between them is choosing on job count, not
on preference.

The document itself is version 1.0, effective 20-Jul-2026, and is reviewed as required rather than on
a fixed cycle.

## Scenarios

### Cancelling a single order

This scenario applies when only one job or order needs to be cancelled. The handler navigates to
**Orders > Search or Modify Orders**, pastes the job number into the Cartnote Number field, selects
All and clicks Search, then right-clicks the status output and selects **Cancel Order**. The
cancellation reason is set to `LAB SYSTEM SETUP AND TEST`, for which no status is sent to the
customer. The change is saved and the final status verified in Job Tracker. No blank option may be
selected for the cancellation reason.

### Cancelling multiple orders together

This scenario applies when multiple jobs or orders need to be cancelled together. The handler
navigates to **Orders > Mass Order Cancellation** and pastes the list of job numbers received in the
request. The cancellation reason is set to `LAB SYSTEM SETUP AND TEST`, which sends no status to the
customer; where the lab has identified a different reason, `LMS PATIENT REQUEST` or
`LMS DISCONTINUED` is chosen instead and saved. The cancellation is saved and each job status is then
verified individually in Job Tracker. No blank option may be selected for the cancellation reason.

### Cancelling an EOLP order stuck in the orchestration queue

This scenario applies only to EOLP orders stuck in the orchestration queue, and explicitly not to WIP
orders. The handler first confirms that the lab is EOLP, that the order is stuck in the orchestration
queue table, and that the order is not a WIP order. Only then is the EOLP-specific cancellation
handling applied as per the Application Support process, after which the final order status is
validated in Job Tracker.

### Cancelling without sending status to the customer

This scenario applies when the lab wants the order cancelled but does not want the cancellation
status sent to the customer. The handler asks the lab which cancellation code must be used, then uses
a cancellation code whose status XML generation setting is `NO = 1`. The cancellation is completed
using the confirmed code and the handler validates that the order is cancelled internally. The code
must not be assumed, because lab confirmation is mandatory for this scenario.

### Choosing between the four scenarios

| Scenario           | When to use                                 | Navigation or area               | Key control                                                    |
| ------------------ | ------------------------------------------- | -------------------------------- | -------------------------------------------------------------- |
| Single order       | One job or order only                       | Orders > Search or Modify Orders | Reason `LAB SYSTEM SETUP AND TEST`; no status sent to customer |
| Mass cancellation  | Multiple jobs or orders                     | Orders > Mass Order Cancellation | Reason `LAB SYSTEM SETUP AND TEST`; no status sent to customer |
| EOLP queue         | EOLP order stuck in the orchestration queue | EOLP-specific handling           | Orchestration queue only; never for WIP orders                 |
| No customer status | Cancellation must not reach the customer    | Applicable cancellation flow     | Code with status XML generation `NO = 1`                       |

## Exceptions

Four conditions stop the standard procedure: the cancellation fails, the order is a WIP order, the
cancellation code is unclear, or the lab has not confirmed the expected cancellation reason or code.

In any of these cases the handler must not proceed on an assumption. The error or the impacted job
details are captured and the request is escalated to the appropriate support team for review. This is
the same principle that governs code selection throughout the procedure: where the correct
cancellation reason is not established, escalation is the correct action and guessing is not.

## Validation Criteria

A cancellation is complete when five things are true. The order status was checked before the
cancellation was attempted. The correct cancellation reason or code was selected. A blank
cancellation reason was not used. Job Tracker validation was completed after the cancellation. The
requester or lab was informed after completion.

For a mass cancellation, Job Tracker validation covers each job in the list rather than the batch as
a whole. For a cancellation where customer status is suppressed, validation also confirms that the
order is cancelled internally.

## Knowledge Checks

A technician working this procedure should be able to explain:

- Why the cancellation reason is a customer-facing decision and not only an internal one.
- Which cancellation reasons send no status to the customer, and which are used when the lab has
  identified a specific reason.
- What the status XML generation value `NO = 1` indicates about a cancellation code.
- How to choose between the single-order, mass, EOLP queue and suppressed-status flows.
- Why the EOLP orchestration queue process must never be applied to a WIP order.
- Why a blank cancellation reason is never acceptable.
- Why lab confirmation is mandatory before using a suppressed-status code, and what to do when that
  confirmation has not been given.
- What must be verified in Job Tracker before a cancellation and what must be verified after it.
