# TRACELAB L2 Support and Troubleshooting

> **Derived pilot asset — not the authoritative SOP.**
> Restructured from `TRACELAB_Support_SOP.docx` (v1.0, RxIT Manufacturing L2 Application Support) for
> generation-quality evaluation only. The `.docx` in the SharePoint library remains the document of
> record. No operational rule has been added, removed or altered; the original's 32 step-level
> headings have been consolidated under topic headings. **Named contacts and their email addresses
> have been redacted.** See
> [`GENERATION_READY_CORPUS_SUMMARY.md`](../../docs/integrations/GENERATION_READY_CORPUS_SUMMARY.md).

## Purpose

This procedure provides a standardised approach for L2 support engineers to investigate, troubleshoot,
resolve and escalate incidents relating to the TRACELAB application. It applies to all production and
pre-production environments where TRACELAB is integrated with RX.Net for retrieving and publishing OMA
shape files.

It covers incident triage, troubleshooting, root cause identification, validation checks, the
escalation process and evidence collection. Following it is intended to produce consistent support,
faster incident resolution and minimal disruption to manufacturing operations.

L2's responsibilities are to investigate reported incidents, validate application health, verify API
availability, identify configuration issues, restore service where possible, escalate when required
and maintain ticket updates. Resolving application defects, resolving API code issues, supporting
configuration changes and performing permanent fixes sit with L3 rather than L2.

## Business Context

TRACELAB is a manufacturing application used during the lens finishing process. It retrieves OMA shape
files from RX.Net, allows manufacturing modifications, publishes updated shape files back into RX.Net,
and supports downstream finishing equipment. An incident therefore stops finishing work rather than
merely inconveniencing a user, which is why triage speed matters.

The application communicates through two APIs, and which one is implicated depends entirely on what
the user was doing. The **RX-DEVICE-COMMUNICATION** API retrieves job and OMA files, which is Input
Mode. The **RX-MFGEVENTS** API publishes updated shape files back into RX.Net, which is Publish Mode.
Establishing the mode is the first diagnostic step because it determines which API requires
investigation, and investigating the wrong one wastes the time the incident does not have.

Incorrect URLs and incorrect environments are common causes of incidents, so configuration validation
is treated as a first-line check rather than an afterthought.

## Decision Rules

The engineer must always identify whether the issue relates to Input Mode or Publish Mode before
troubleshooting, because that determines which API is investigated.

API health must be verified before investigating application defects. An API that is healthy while
functionality still fails is an escalation trigger, not a reason to keep testing at L2.

Where either API is unavailable, server status must be verified before escalating.

Where a job is missing, the engineer must coordinate with the RX.Net support team before proceeding
rather than continuing to troubleshoot TRACELAB.

Where connectivity issues are identified, the infrastructure or network team must be engaged.

The correct production environment must be confirmed as being in use, and complete evidence must be
collected before any escalation. Users must be kept informed throughout the incident lifecycle, and
all validation steps and findings must be recorded in the ticket to support future root cause
analysis and knowledge sharing.

## Thresholds

Three measurable conditions define a healthy TRACELAB integration.

The application version must be **1.6.0.2 or higher**. A version below that is a configuration
finding in its own right.

Each API health check has two expected values that must both hold: **Health Status = Healthy** and
**HTTP Response = 200 OK**. This applies to RX-DEVICE-COMMUNICATION for Input Mode incidents and to
RX-MFGEVENTS for Publish Mode incidents.

Incident scope is also assessed as a measurable quantity, because it changes the escalation path: the
engineer determines whether the issue affects a single user, multiple users, or an entire
manufacturing site. Multiple sites impacted is itself an escalation trigger.

## Scenarios

### Triaging a reported incident

The engineer captures the ticket number, site or lab, user name, machine name, business impact, time
of failure and error message. Scope is then determined — single user, multiple users, or the entire
manufacturing site.

The decisive triage question is put to the user directly: is the issue occurring while downloading a
shape file, which is Input Mode, or while publishing a shape file, which is Publish Mode? The answer
selects the API to investigate.

Job validity is then confirmed: the correct job number, that the job exists in RX.Net, the job status,
that the shape OMA file exists, and that the job is available for processing.

### Validating configuration and API health

Configuration validation covers the correct environment (production or pre-production), the server
URL, the API endpoint, the application version and the authentication settings.

API health is then checked for the relevant API, expecting Health Status Healthy and HTTP 200 OK.
Authentication is confirmed by checking the username, password, account status and authentication
success; where authentication fails, the account is unlocked if applicable, credentials are reset if
required, and access permissions are validated.

Connectivity validation covers DNS resolution, server reachability, firewall rules, proxy
configuration, browser access to the API, and network latency.

### Common failure patterns and their resolutions

| Symptom                        | Possible causes                                                              | Resolution                                                                          |
| ------------------------------ | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Job not found                  | Incorrect job number, job not available in RX.Net, replication delay         | Validate job details, verify in RX.Net, retry after synchronisation if applicable   |
| Shape file cannot be retrieved | Missing OMA file, API unavailable, authentication failure                    | Verify API health, confirm the OMA file exists, review API logs                     |
| Shape file cannot be published | RX-MFGEVENTS unavailable, invalid payload, site-specific configuration issue | Validate API health, review publish logs, escalate to Integration or L3 if required |
| Authentication failure         | Invalid credentials, locked account, authentication service unavailable      | Verify credentials, unlock the account, validate authentication services            |
| Wrong environment or endpoint  | Incorrect environment, wrong API URL, job unavailable                        | Validate configuration, verify environment, test the API directly                   |

### Reviewing logs

Available logs are reviewed for API failures, authentication failures, missing OMA files, invalid
payloads, timeout errors and communication failures. All findings are documented in the incident
ticket rather than held informally.

## Exceptions

Escalation to L3 or the application team is required in seven situations: the API is healthy but
functionality fails, application defects are suspected, publish payload errors occur, configuration
changes are required, the issue cannot be reproduced, multiple sites are impacted, or the root cause
cannot be determined.

All collected evidence must be included before escalation. The evidence set is defined and extensive:
username, site, machine name, job number, timestamp, production order, TRACELAB version, environment,
API version, error message, configuration window, application screen, health check result, API URL,
response status, application logs, API logs, and Windows event logs where applicable. Everything is
attached to the incident ticket.

## Validation Criteria

Before closing or escalating an incident, thirteen checks must be confirmed: the incident type was
identified as Input or Publish, the correct environment was verified, the job exists in RX.Net, the
OMA file is available, the application version was validated, RX-DEVICE-COMMUNICATION is healthy,
RX-MFGEVENTS is healthy where applicable, credentials were verified, network connectivity was
confirmed, logs were reviewed, screenshots were collected, the ticket was updated with the
troubleshooting performed, and the business user was informed of status.

An incident may be closed when five conditions hold: the user confirms successful operation, shape
file retrieval or publishing is functioning correctly, the root cause has been documented, the
resolution steps are recorded, and the ticket documentation is complete.

## Knowledge Checks

A technician working this procedure should be able to explain:

- What TRACELAB does in the lens finishing process, and why an incident stops manufacturing work.
- Which API serves Input Mode and which serves Publish Mode.
- Why establishing the mode is the first diagnostic step rather than a later one.
- The two values an API health check must return for the integration to be considered healthy.
- The minimum supported application version.
- Why API health must be verified before application defects are investigated.
- Why a healthy API with failing functionality is an escalation trigger rather than a reason to
  continue at L2.
- What to do when a job is missing from RX.Net.
- Which situations require escalation to L3, and what evidence must accompany the escalation.
- The difference between the checks required before closure and the conditions that permit closure.
