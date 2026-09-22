# Rx.Net Printer Troubleshooting — Unable to Print

> **Derived pilot asset — not the authoritative SOP.**
> Restructured from `SOP - Printer Management.docx` (v1.0, 29-June-2026, Rx.Net Print Management,
> PROD, medium criticality) for generation-quality evaluation only. The `.docx` in the SharePoint
> library remains the document of record. No operational rule has been added, removed or altered; the
> original was extracted as a **single 3,053-character section** and has been divided under topic
> headings. **The named author has been redacted.** See
> [`GENERATION_READY_CORPUS_SUMMARY.md`](../../docs/integrations/GENERATION_READY_CORPUS_SUMMARY.md).

## Purpose

This procedure provides the standard troubleshooting steps for resolving printer issues when users
report that they are unable to print from Rx.Net. It applies to the production environment and is
written for L2 support handling print incidents raised against Rx.Net Print Management.

The procedure works through four ordered checks — printer status, a test page, network reachability,
and a restart of the printing services — each with a defined expected result and a defined handoff
when that result is not achieved. It also fixes what evidence must be attached to the Global Case
before the incident can be closed or escalated.

## Business Context

An inability to print from Rx.Net can originate in three different places, and the procedure is
ordered so that each is ruled out in turn before the next is investigated. The printer itself may be
in a non-ready state, which is the user's or the local site's problem to resolve. The network path
between the server and the printer may be broken, which belongs to the Infrastructure and Network
team. The printing services on the server may have stopped, which is L2's to restart.

Ordering the checks this way means an incident is never escalated to the network team while the
printer is sitting in a paper-jam state, and the printing services are never restarted to work around
a printer that is simply offline. Each step also produces a screenshot or result that is attached to
the Global Case, so the evidence trail follows the same order as the diagnosis.

## Decision Rules

Where the printer queue status is anything other than Ready — offline, error, paper jam or similar —
the user must be asked to investigate or resolve the printer issue. L2 does not continue the
server-side sequence while the printer itself is in a fault state.

Where the test page fails or returns an error, the user must be requested to verify the printer
locally.

Where the ping request times out or the printer is unreachable on the network, the issue must be
escalated to the Infrastructure and Network team.

Each of the four checks produces evidence that must be captured and attached to the Global Case: a
screenshot of the printer status, the test page result, the ping result, and confirmation of the
service restart outcome.

The evidence set must be attached before the ticket is closed or escalated, not afterwards.

## Thresholds

The procedure states its pass conditions as exact expected results rather than as judgements.

The printer queue status must display **Ready**. Any other value is a fault state that stops the
server-side sequence.

The test page must **print successfully**. A failure or an error is a local printer verification
task.

The printer must return **successful ping replies** from the server. A timeout or an unreachable
printer is a network escalation.

Both the **RxPrinting** service and the **Print Spooler** service must return to the **Running**
state after being restarted, and a further print test is performed once they have.

## Scenarios

### Verifying printer status

The handler opens the Print Management application, locates the affected printer, and verifies that
the queue status is Ready. A screenshot of the printer status is captured and attached to the Global
Case. If the status is anything other than Ready, the user is asked to investigate or resolve the
printer issue before the sequence continues.

### Printing a test page

The handler opens Print Management, selects the affected printer, right-clicks it and selects Print
Test Page, then waits for the test page to print. The results are captured and the screenshot
attached to the Global Case. If the test page fails or displays an error, the user is requested to
verify the printer locally.

### Verifying network connectivity

The handler pings the printer IP address from the server and verifies that the printer is reachable on
the network. The ping results are captured and attached to the Global Case. If the ping request times
out or the printer is unreachable, the issue is escalated to the Infrastructure and Network team
rather than pursued further at L2.

### Restarting the printing services

The handler restarts the RxPrinting service and the Print Spooler service, waits for both to return to
the Running state, then performs another print test and records the outcome in the Global Case. The
expected result is that the services restart successfully and printing resumes.

## Exceptions

Five conditions require escalation rather than further troubleshooting: the printer remains offline
after troubleshooting, the test page continues to fail, the printer is unreachable over the network,
the RxPrinting or Print Spooler services fail to start, or the issue persists after all troubleshooting
steps have been completed.

Escalation carries the same evidence requirement as closure. Before closing or escalating the ticket,
the handler attaches the printer status screenshot, the print test page result, the ping and network
connectivity result, the service restart confirmation, and any error messages.

## Validation Criteria

The incident is complete when seven checks have been satisfied: printer status verified, test page
completed, network connectivity verified, RxPrinting service restarted, Print Spooler restarted,
screenshots attached to the Global Case, and the user has confirmed printing.

The final item is the one that distinguishes a resolved incident from a completed procedure. Every
technical check can pass while the user still cannot print, so user confirmation is required rather
than inferred from a successful test page.

## Knowledge Checks

A technician working this procedure should be able to explain:

- The four checks in order, and why the order matters.
- The expected result of each check, stated as the exact value or state required.
- Which queue status permits the server-side sequence to continue.
- When the incident belongs to the user or the local site rather than to L2.
- When the incident belongs to the Infrastructure and Network team.
- Which two services are restarted, and what state both must reach.
- The five conditions that require escalation.
- What evidence must be attached before a ticket is closed or escalated.
- Why user confirmation is required in addition to a successful test page.
