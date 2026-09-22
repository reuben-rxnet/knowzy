# Rx.Net Database Connection Pool Exhaustion and Timeout Recovery

> **Derived pilot asset — not the authoritative SOP.**
> Restructured from `Rxnet Eolp Database Connection Pool Exhaustion Sop.docx` (P1 / critical
> production impact, Rx.Net EOLP and similar labs) for generation-quality evaluation only. The
> `.docx` in the SharePoint library remains the document of record. No operational rule has been
> added, removed or altered; the original's 49 step-level headings have been consolidated under topic
> headings. **Named individuals and the bare reference-ticket list have been omitted.** See
> [`GENERATION_READY_CORPUS_SUMMARY.md`](../../docs/integrations/GENERATION_READY_CORPUS_SUMMARY.md).

## Purpose

This procedure provides a standardised recovery sequence for Rx.Net incidents caused by database
connection pool exhaustion, timeout errors, long running queries and high sleeping database sessions.
It applies to Rx.Net production environments in EOLP and similar laboratories, and is written for P1
incidents involving timeout errors, connection pool exhaustion, long running queries, high sleeping
SQL sessions, application instability or production stoppage.

The objective is to quickly identify, contain and recover from pool exhaustion causing a production
outage. Five specific goals follow from that: minimise production downtime, standardise
troubleshooting actions, ensure proper escalation and coordination, restore Rx.Net services as
quickly as possible, and prevent prolonged instability caused by recurring sleeping sessions and
blocked SQL connections.

## Business Context

The root cause identified from previous incidents is improperly managed database sessions from the
Rx.Net application: SQL sessions remain open and unreleased, the connection pool is exhausted, heavy
concurrent stored procedure executions compound the load, and blocking sessions cause SQL contention.
Left unaddressed the condition escalates from exhausted connections to system-wide timeout errors, to
application instability, to a full production outage.

Five lessons from previous incidents shape the procedure and explain why it is ordered as it is.
High sleeping sessions are a major early warning sign. Service restarts alone may not fully resolve
the issue. An application server reboot can be the definitive recovery action rather than a last
resort. Faster escalation to L3 and the DBA team reduces downtime. Standardised ownership improves
coordination efficiency. Together these are why the procedure escalates early, treats a successful
restart with suspicion, and assigns a named owner to every phase.

Recovery is a six-team activity. Incident Management coordinates the bridge, communication,
escalation and timeline tracking. L2 RXIT performs initial investigation, application and service
restarts, validation and escalation. L3 RXIT Dev performs application analysis and deep
troubleshooting. DBA L2/L4 performs SQL analysis, blocker clearing and database service restarts.
Wintel Support performs the application server reboot and infrastructure support. The local lab
contact provides production validation and business confirmation, and for EOLP the first point of
contact is normally someone from EOLP IT.

## Decision Rules

The incident must be escalated immediately as P1 if multiple departments are impacted, production has
stopped, timeout errors continue after a basic restart, or sleeping sessions are continuously
increasing. Any one of these conditions is sufficient.

Head blockers may be terminated only where that has been approved, and the DBA team must communicate
on the bridge before killing a session.

All application and RxCNC services must be fully stopped before the database is restarted. The
purpose of this ordering is specific: it prevents new SQL connections, additional sleeping sessions,
further SQL contention, and reconnection attempts during the database restart. The business must be
informed before any shutdown activity, and no active processing may remain when services are stopped.

The application server may be rebooted only after all application services have been stopped, and
application server services are restarted only after the database has stabilised.

Where a restart appears to succeed, the environment must still be checked for recurrence. If the
issue persists or returns quickly after a service restart, the controlled shutdown sequence is the
next action rather than a second restart.

### Approval requirements by phase

| Phase                   | Activity                                                               | Responsible            | Approval required from                                                                  |
| ----------------------- | ---------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------- |
| Incident validation     | Validate SQL health, sleeping sessions, blockers, long running queries | DBA L2/L4              | None                                                                                    |
| Incident validation     | Validate application services, timeout errors, impacted modules        | L2 RXIT / Dev          | None                                                                                    |
| Initial recovery        | Clear SQL head blockers                                                | DBA L2/L4              | Lab Manager and Dev team; must be communicated on the bridge first                      |
| Initial recovery        | Restart CS, PR and RxCNC services                                      | L2 RXIT                | Lab Manager and Dev team; validate no active processing first                           |
| Controlled shutdown     | Stop application and RxCNC services                                    | L2 RXIT                | Lab business approval and Dev approval                                                  |
| Database recovery       | Restart SQL services or the database server                            | DBA L2/L4              | Lab business approval and Dev approval                                                  |
| Infrastructure recovery | Reboot the application server                                          | DXC Infra / Wintel     | Lab business approval and Dev approval; only after all application services are stopped |
| Validation              | Validate application functionality and order processing                | L2 RXIT / Lab team     | Business validation required                                                            |
| Closure                 | Provide RCA findings and preventive recommendations                    | DBA, Dev, Infra and IM | Incident Manager and business approval; required for P1 closure                         |

## Thresholds

Four indicators carry a threshold that distinguishes a healthy environment from an incident.

Sleeping sessions that are abnormally high indicate a problem, and a count **above 200** may indicate
the issue is present. Head blockers are significant when there are **multiple blocking chains**
rather than a single blocked session. Long running queries are significant at excessive execution
duration. SQL timeouts are significant when occurrences are continuous rather than isolated.

Before deciding on an application or database restart, the DBA team performs three further
validations, each with a defined objective. SQL connection pool visibility is monitored per
application to identify excessive or unreleased application connections. TempDB usage is checked to
detect contention, abnormal growth or resource exhaustion. Disk latency checks identify storage
performance bottlenecks and IO problems affecting SQL responsiveness.

## Scenarios

### Validating that this is a pool exhaustion incident

The symptoms that may indicate connection pool exhaustion are wide: the Rx.Net application not
responding, multiple timeout errors, orders stuck in processing, users unable to log in or process
jobs, delayed response from Rx.Net modules, production stoppage across multiple departments, a large
number of sleeping SQL sessions, database exceptions in logs, head blockers detected, long running
stored procedures, connection timeout messages, and failure to acquire new database connections.

Two symptoms are particularly diagnostic because they distinguish this incident from a simple service
failure: services appearing UP while the application remains unstable, and temporary recovery after a
service restart followed by recurrence of the timeout issue shortly afterwards.

L2 validates by reviewing application logs, checking Windows service status, verifying SQL
connectivity, confirming impact with the local lab contact, and identifying whether the issue is
recurring.

### Initial recovery by clearing blockers and restarting services

The DBA team identifies blocking sessions, terminates head blockers where approved, and monitors SQL
stabilisation. L2 RXIT or Wintel then restarts the application services — CS services, PR services,
RxCNC services and related middleware or application services.

Success is judged on four things rather than on the restart completing: timeout errors stop, new
orders process correctly, SQL sessions normalise, and the application stabilises. If the issue
persists or returns quickly, the controlled shutdown sequence follows.

### Controlled shutdown and database recovery

This sequence is performed when application service restarts fail, timeout errors continue after a
restart, sleeping sessions continue increasing, the environment remains unstable, or orders are still
not processing correctly.

All Rx.Net related services are stopped gracefully on the application servers and the RxCNC servers,
with the lab stopping activity on CS and PR. Decide software at the lab need not be stopped, because
it is not network sensitive. Once all application and RxCNC services are confirmed stopped, the DBA
team restarts the database server or SQL services and then validates database availability and SQL
service health, confirming that the database is accessible, SQL services are healthy, no active
blockers remain, sleeping sessions have normalised, and SQL is responding normally.

### Infrastructure recovery and service restoration

After the database server is fully operational, L2 RXIT or Wintel Support restarts the application
servers and the RxCNC servers and starts all required Rx.Net services. The expected outcome is that
all services are operational, the database connection pool has been refreshed, the application has
stabilised, timeout errors are resolved, orders are processing normally and the environment is
restored.

The recommended recovery order across the whole incident is: validate the issue, clear blockers,
restart Rx.Net services, stop the application, restart SQL services if required, reboot the
application server, then validate production.

## Exceptions

Four conditions route the incident outside the standard sequence. Production having stopped escalates
to Incident Management. SQL instability that persists escalates to DBA L4. Repeated timeout errors
escalate to L3 RXIT Dev. A required server reboot escalates to Wintel Support.

Beyond the escalation matrix, the procedure's own exception is recurrence: an apparently successful
service restart followed by a rapid return of timeout errors is not a resolved incident and must be
treated as confirmation that the deeper recovery sequence is required. The incident is coordinated on
a bridge call with a shared timeline of events, screenshots, logs and errors, and clearly assigned
action owners.

## Validation Criteria

Recovery is validated on the application side by confirming that users can access Rx.Net, orders
process successfully, no timeout errors are observed, interfaces are operational, services are
stable, and no new database exceptions appear.

It is validated on the database side by confirming that SQL sessions have normalised, no blockers are
present, there are no long running queries, and SQL performance is stable. Connection pool visibility
per application, TempDB utilisation and growth, and disk latency and storage IO performance remain
under monitoring afterwards.

Business validation is separate and required: confirmation must be obtained from local IT, production
users and lab management that orders are processing correctly, no production blockage remains, and
workflows are functioning normally.

Six indicators are monitored continuously after recovery: sleeping SQL sessions, long running stored
procedures, SQL blocking chains, database connection pool utilisation, application timeout frequency,
and service availability. P1 closure additionally requires RCA findings and preventive
recommendations with Incident Manager and business approval.

## Knowledge Checks

A technician working this procedure should be able to explain:

- Why services appearing UP while the application is unstable is diagnostic of pool exhaustion rather
  than reassuring.
- Why a successful service restart followed by rapid recurrence means the incident is not resolved.
- The sleeping-session count that may indicate the issue is present.
- The four conditions that require immediate P1 escalation.
- Why all application and RxCNC services must be fully stopped before the database is restarted, and
  what that ordering prevents.
- Why the application server may only be rebooted after application services are stopped.
- Which activities require lab business and Dev approval, and which require none.
- What the DBA team must do before killing a blocking session.
- Which lab component does not need to be stopped, and why.
- The difference between technical validation and business validation, and why both are required
  before closure.
