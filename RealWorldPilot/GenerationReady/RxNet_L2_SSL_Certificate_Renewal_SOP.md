# SSL Certificate Expiry Monitoring, Renewal and Escalation

> **Derived pilot asset — not the authoritative SOP.**
> Restructured from `RxNet_L2_SSL_Certificate_Renewal_SOP.docx` (v1.0, Rx.Net L2 Support) for
> generation-quality evaluation only. The `.docx` in the SharePoint library remains the document of
> record. No operational rule has been added, removed or altered. **Named individuals, team mailbox
> addresses and internal server FQDNs have been redacted**, and the appendix listing known reporting
> servers has been omitted as incident-review data rather than assessable knowledge. See
> [`GENERATION_READY_CORPUS_SUMMARY.md`](../../docs/integrations/GENERATION_READY_CORPUS_SUMMARY.md).

## Purpose

This procedure defines how the Rx.Net L2 support team performs initial analysis for SSL and TLS
certificate issues, confirms whether a certificate has expired or is nearing expiry, engages
Certificate Management and the other resolver groups, coordinates renewal, and validates service
recovery afterwards.

It applies to SSL and TLS certificate issues affecting Rx.Net reporting servers, IIS-hosted reporting
portals, SSRS endpoints, and applications that connect to reporting services over HTTPS. The main
objective is to avoid production incidents caused by expired or invalid certificates, through
proactive monitoring, timely renewal requests, correct team engagement, and complete validation after
renewal. The procedure also defines how L2 reacts when an incident is already active and users are
reporting data feed refresh failures, SSRS access errors, or SSL/TLS trust relationship errors.

## Business Context

Certificate expiry is a predictable failure with an unpredictable blast radius. When a reporting
server certificate lapses, the symptoms surface as data feed refresh failures, inaccessible SSRS
portals, and trust relationship errors — none of which name the certificate as the cause. The
procedure exists so that L2 recognises those symptoms as certificate symptoms and acts before a
business impact forces the issue.

Renewal is also a multi-team activity, which is why the engagement model matters as much as the
technical steps. L2 maintains the tracker and raises the renewal request. Certificate Management
generates and returns the renewed certificate. L2, L3 or Lab Support installs it depending on who has
server access. The DBA team configures SSRS to use the new certificate once it is installed.
Validation is shared between L2 and the business or lab user. Closure is L2's responsibility, with
the actions, evidence and final confirmation documented.

## Decision Rules

L2 must not wait for business impact before checking certificate validity. A certificate that is
expired, nearing expiry, missing, or not trusted must be treated as a risk and tracked until it is
resolved.

A renewal request must be raised if the certificate is expired, invalid, not trusted, missing, bound
incorrectly, or approaching the defined renewal threshold. The request must ask for the certificate
to be generated in TripleDes encryption format, which is the standard followed across the
organisation.

Certificate warnings must not be ignored when the reported symptom is SSL or TLS trust related. Where
`curl` reports certificate errors, the full output must be captured and attached to the incident.

Installation may proceed only once the renewed certificate has been received through the approved
secure channel, and any password or private key handling must follow company security standards.
Certificate passwords must never be shared in plain text emails or tickets.

L2 must not assume that SSRS work is complete merely because the certificate was imported into IIS.
Where SSRS is in scope, the DBA team configures SSRS to use the newly installed certificate, and L2
confirms that this has happened.

A website restart may be performed only where the implementation plan requires it, and a Reporting
Services restart may be requested only where it is required and approved.

## Thresholds

Where no official renewal threshold has been defined, L2 should use a practical operational threshold
of **60 days before expiry** and align that with management. This is the measurable trigger that
converts monitoring into action.

The monitoring tracker must be reviewed **at least monthly**, and high-risk production certificates
must be reviewed more frequently where the environment has a history of certificate-related
incidents.

An HTTPS binding is expected to use **Type = https** and **Port = 443**, unless the application uses
a different approved port. The tracker carries a calculated **days to expiry** value for each
certificate, which is what makes proactive review possible, and a renewal status drawn from a fixed
set: Not Started, Requested, Received, Installed, Validated, Closed.

## Scenarios

### Recognising a certificate problem from the symptom

A data feed refresh failure should prompt a check of whether the reporting server certificate is
expired or not trusted, with the user error, application log and browser certificate warning as
evidence. An SSL or TLS trust relationship error should prompt validation of the certificate chain,
expiry date, hostname and issuer. An inaccessible SSRS portal should prompt browsing to the
`/reports` and `/reportserver` endpoints to check HTTPS behaviour. A certificate missing from the
server should prompt a check of both IIS Server Certificates and the Local Computer certificate
store. A binding that still uses the old certificate should prompt a review of the HTTPS binding
under IIS Site Bindings.

### Validating expiry before escalating

Expiry can be confirmed three ways, and any of them is sufficient evidence to raise a request. From
IIS Manager, the handler opens `inetmgr`, selects the server node, opens **Server Certificates**, and
reviews the Name, Issued To, Issued By, Expiration Date and Certificate Hash, capturing a screenshot
of the relevant certificate and its expiry date. From a browser, the handler opens the application
URL, opens the certificate details from the lock or warning icon, and validates Issued To, Issued By,
Valid From, Valid To and the certificate chain. From PowerShell, the handler lists the certificates
in the Local Computer Personal store and inspects Subject, Issuer, Thumbprint, NotAfter and
HasPrivateKey.

### Engaging the right team

| Situation                                         | Team to engage                         | What to provide                                                                                          |
| ------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Certificate expired or nearing expiry             | Certificate Management                 | Server name, FQDN, application, current expiry, screenshot, impact, requested renewal date               |
| Certificate received but L2 lacks server access   | L3 or Lab Support                      | Certificate file location, password handling instructions, server, installation window, validation steps |
| Certificate installed but SSRS still fails        | DBA team                               | Certificate thumbprint, server, SSRS URL, error screenshot, install confirmation                         |
| HTTPS binding still points to the old certificate | L2, L3 or Lab Support                  | IIS binding screenshot, old and new thumbprints, affected site and hostname                              |
| Certificate chain or trust issue after renewal    | Certificate Management with L3         | Certificate chain screenshot, browser error, `curl` output, issuer details                               |
| Production outage or wide business impact         | Incident Manager or Support Management | Business impact, timeline, current findings, active owner, next action                                   |

### Installing and binding a renewed certificate

Before installing, the handler captures the current Server Certificates list, records the existing
certificate's Subject, Issuer, Thumbprint and expiry date and whether the private key exists, captures
the current HTTPS binding details, and confirms whether a rollback certificate is available.

The renewed certificate is then imported through **Server Certificates**, using Import for a PFX file
or Complete Certificate Request where a CSR was generated on the same server and a CER file has been
returned. The certificate store is chosen according to local standard, typically Personal or Web
Hosting depending on server configuration, and the handler verifies that the certificate appears in
Server Certificates.

Binding follows: under **Sites**, the affected website's bindings are opened, the existing HTTPS
binding is edited or an HTTPS binding is added, Type and Port are confirmed, the renewed certificate
is selected from the SSL certificate dropdown, and the hostname or SNI settings are confirmed to match
the existing binding and the application requirement.

## Exceptions

Six failures are expected after a renewal and each has a defined next action.

A certificate that was imported but does not appear in the IIS binding dropdown may lack a private key
or be in the wrong certificate store; the handler checks `HasPrivateKey` and the store, and engages
Certificate Management or L3 if needed. A browser still showing the old certificate usually means the
IIS binding still points to it or the service cache has not refreshed; the handler rechecks Site
Bindings and restarts the website if approved. SSRS still failing after the IIS binding was updated
means the SSRS configuration has not been updated, and the DBA team is engaged with the thumbprint and
SSRS URL. A certificate chain warning indicates a missing intermediate certificate or an untrusted
chain, and Certificate Management is engaged with the browser certificate chain screenshot. A hostname
mismatch warning means the certificate subject or SAN does not match the URL, so the required FQDN or
SAN is confirmed and a corrected certificate requested. An application still reporting a trust error
may be using another endpoint, a cached configuration, or a separate certificate store; the handler
checks the application URL, configuration and logs, and involves L3 if needed.

## Validation Criteria

Renewal is validated across seven areas. Browsing the server over HTTPS must produce no certificate
warning and must show a valid certificate. The browser certificate details must show an Issued To and
an expiry date that reflect the renewed certificate. The SSRS reports portal must open successfully,
and the `/reportserver` endpoint must respond successfully. A data feed refresh from the reporting
tool must complete without an SSL or TLS trust error. Application, SSRS and Event Viewer logs must
show no new certificate or SSL/TLS related errors. The ticket must carry the screenshots and
validation notes that make the closure evidence clear.

Closure additionally requires that the impacted server and application were identified, the
certificate issue was confirmed, Certificate Management was engaged with complete details, the renewed
certificate was received and verified, installation succeeded, the HTTPS binding was updated, the DBA
was engaged where SSRS was in scope, the monitoring tracker was updated with the new expiry date, and
stakeholders were updated with user confirmation received.

## Knowledge Checks

A technician working this procedure should be able to explain:

- Why a certificate that is expired, nearing expiry, missing or untrusted is treated as a risk before
  any business impact appears.
- The operational renewal threshold to use when no official threshold has been defined, and who it
  must be aligned with.
- Which encryption format a renewal request must specify, and why the request names it explicitly.
- The three methods for validating certificate expiry, and what evidence each produces.
- Which team owns certificate generation, which owns installation, and which owns SSRS configuration.
- Why importing a certificate into IIS does not complete an SSRS renewal.
- The conditions under which installation may begin, and the rule governing certificate passwords.
- How to tell a binding problem from a chain problem from a hostname mismatch after renewal.
- What must be validated before an SSL incident can be closed, and what evidence the ticket must
  carry.
