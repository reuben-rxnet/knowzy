# Review packet — all-drafts-before-evaluation

37 question(s). Every one is a DRAFT unless its status says otherwise.

## acceptable-use.txt

### What is required before starting each remote access session to a customer device?

- **Question ID:** `01a0e7d4-01af-7b2b-91b1-6ffc701878d6` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** A one-time annual consent on file
- **B.** Explicit customer consent captured in the ticket for that session ✔
- **C.** Manager approval only
- **D.** Consent only if recording is enabled
- **Explanation:** The policy requires explicit consent for each session, documented in the ticket before the session starts.
- **Evidence (STRICT):** > Remote access to a customer device requires the customer's explicit consent for each session, captured in the ticket before the session begins. Consent given for one session does not carry to the next.
- **Confidence:** 0.972 · **Highest similarity:** 0.125

### If the approved script library lacks a script needed for a task, what should the agent do?

- **Question ID:** `01a0e7d4-01cc-797f-864b-3eedee90f2e0` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Use a script from a trusted colleague
- **B.** Download one from a vendor portal
- **C.** Write and run a quick custom script
- **D.** Raise a request with the tooling team ✔
- **Explanation:** Unreviewed scripts are not allowed; the documented action is to request one through tooling.
- **Evidence (STRICT):** > Where the library has no script for the task, the agent raises a request with the tooling team, because a script that has not been reviewed may change state on a production system in ways the agent cannot predict or explain afterwards.
- **Confidence:** 0.959 · **Highest similarity:** 0.124

### Which practice is compliant when using administrative consoles?

- **Question ID:** `01a0e7d4-01d8-7f27-9e96-6c195919efc9` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Using a colleague’s active session to save time
- **B.** Keeping admin sessions open for future tasks
- **C.** Using your own named account and letting elevation lapse after task completion ✔
- **D.** Leaving the console unlocked during short breaks
- **Explanation:** The section requires own-account use, no shared sessions, and ending elevated access once the task is done.
- **Evidence (STRICT):** > Administrative consoles are used with the agent's own named account. An agent does not use a colleague's session, does not leave a console unlocked, and does not hold an administrative session open beyond the task that needed it. Where a task requires elevation the agent requests it, performs the task, and allows the elevation to lapse rather than retaining it for convenience.
- **Confidence:** 0.990 · **Highest similarity:** 0.050

### Why is personal use of support tooling prohibited outright?

- **Question ID:** `01a0e7d4-01e1-748f-b7db-f7b1cbfd8b84` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Because every personal action causes direct customer harm
- **B.** Because it makes the audit trail unreadable ✔
- **C.** Because personal use is illegal in all jurisdictions
- **D.** Because tooling cannot technically access personal accounts
- **Explanation:** The document explicitly states the prohibition is due to audit-trail clarity, not inherent harm of each instance.
- **Evidence (STRICT):** > The tooling is instrumented and the logs are reviewed; the reason personal use is prohibited outright is that it makes the audit trail unreadable, not that any single instance is harmful on its own.
- **Confidence:** 0.958 · **Highest similarity:** 0.132

### An agent notices a tool producing results they cannot explain. What is the required response?

- **Question ID:** `01a0e7d4-01ea-76df-a8f5-1b7e7ae5065c` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Continue using it but add a warning note
- **B.** Stop using it and report it to tooling the same day ✔
- **C.** Use it only for low-priority tickets
- **D.** Ask a colleague to validate each output
- **Explanation:** The rule is immediate stop-and-report on the same day when tool behavior appears incorrect.
- **Evidence (STRICT):** > An agent who believes a tool is behaving incorrectly stops using it and reports it to the tooling team the same day. Continuing to use a tool that produces results the agent cannot explain risks acting on a false diagnosis, which costs the customer more than the delay of waiting for a fix.
- **Confidence:** 0.969 · **Highest similarity:** 0.136

## data-handling.html

### According to "Customer Data Handling > Access on a Need Basis", which statement is correct?

- **Question ID:** `01a0e2d3-2f26-77ee-812a-1c451a63be37` · **Provider:** DETERMINISTIC_LOCAL (knowzy-deterministic-local-1) · **Status:** SUBMITTED_FOR_APPROVAL
- **A.** under three cannot be attributed to a person.
- **B.** under one is permitted to be attributed to a person.
- **C.** under three is permitted to be attributed to a person.
- **D.** under one cannot be attributed to a person. ✔
- **Explanation:** The section "Customer Data Handling > Access on a Need Basis" states this rule directly. The other options alter a threshold, a timeframe, or the obligation itself, and none of them is supported by the document.
- **Evidence (STRICT):** > under one cannot be attributed to a person.
- **Confidence:** 0.663 · **Highest similarity:** 0.147

### How does this policy treat breaches, even when no harm is observed?

- **Question ID:** `01a0e7d4-01f1-7602-8790-2eb3576b2f9f` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** As coaching opportunities only
- **B.** As minor infractions if first-time
- **C.** As disciplinary matters regardless of harm ✔
- **D.** As reportable only when financial loss occurred
- **Explanation:** The policy states breach handling is disciplinary irrespective of demonstrated harm.
- **Evidence (STRICT):** > This policy states how support staff may access, share, and retain customer data while resolving a ticket. It applies to every member of the support organisation, including contractors and temporary staff, from the first day of access. Breach of this policy is treated as a disciplinary matter regardless of whether harm resulted.
- **Confidence:** 0.870 · **Highest similarity:** 0.036

### Which channels are approved for customer data leaving the platform?

- **Question ID:** `01a0e7d4-01fa-7f06-b7a5-4fde8dd68123` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Any encrypted third-party messaging app
- **B.** Only approved ticketing system or corporate secure transfer service ✔
- **C.** Personal email if password-protected attachments are used
- **D.** External file-sharing links approved by the customer
- **Explanation:** Data transmission is strictly limited to the two approved channels listed.
- **Evidence (STRICT):** > Customer data leaves the platform only through the approved ticketing system or the corporate secure transfer service. An agent never sends customer data to a personal email address, never pastes it into a public or third-party chat service, and never uploads it to an external file-sharing site - including one the customer themselves suggested.
- **Confidence:** 0.932 · **Highest similarity:** 0.115

### Before sending customer-requested data, what verification is required?

- **Question ID:** `01a0e7d4-0202-7419-b69f-beea31821017` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** One security question from any source
- **B.** A manager’s verbal approval
- **C.** Two independent factors from the account record ✔
- **D.** Confirmation from the requester’s current email signature
- **Explanation:** The rule requires identity verification using two independent factors from the account record before sending data.
- **Evidence (STRICT):** > Where a customer asks for their own data, the agent verifies identity using two independent factors from the account record before sending anything.
- **Confidence:** 0.913 · **Highest similarity:** 0.196

### How long may customer data extracts be kept on a managed device?

- **Question ID:** `01a0e7d4-0209-7716-aa7d-4ba6f0794e3c` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Indefinitely if encrypted
- **B.** Until the next monthly audit
- **C.** Only while the ticket is open, then delete at closure ✔
- **D.** For 30 days after ticket closure for possible reuse
- **Explanation:** Retention on desktop is tied to ticket status and must end when the ticket closes.
- **Evidence (STRICT):** > An agent may hold an extract of customer data on a managed device for as long as the ticket is open, and deletes it when the ticket closes. Extracts are never stored on removable media and never retained after the ticket closes "in case it is needed again".
- **Confidence:** 0.887 · **Highest similarity:** 0.102

### Within what timeframe must a suspected data disclosure be reported to the duty manager?

- **Question ID:** `01a0e7d4-0211-72c6-9f16-7b7820726093` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** By end of business day
- **B.** Within one hour ✔
- **C.** Within 24 hours
- **D.** Within one week
- **Explanation:** Reporting is required within one hour even if unconfirmed and regardless of fault.
- **Evidence (STRICT):** > An agent who suspects data has been disclosed reports it to the duty manager within one hour, whether or not the disclosure is confirmed and whether or not the agent caused it.
- **Confidence:** 0.862 · **Highest similarity:** 0.062

### What must an agent do if a data request comes from an email address not on the account?

- **Question ID:** `01a0e7d4-024a-74cd-ab0c-b3b0f1954971` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Proceed after one-factor verification
- **B.** Forward it to any teammate for approval
- **C.** Refuse the request and record the refusal ✔
- **D.** Send limited data with redactions
- **Explanation:** The policy explicitly requires refusing such requests and documenting that refusal.
- **Evidence (STRICT):** > A request that arrives from an address not on the account is refused, and the refusal is recorded.
- **Confidence:** 0.903 · **Highest similarity:** 0.166

## incident-escalation.md

### According to "Network Incident Escalation > Severity Classification", which statement is correct?

- **Question ID:** `01a0e2ba-7b78-78b1-9749-fac76bd982ae` · **Provider:** DETERMINISTIC_LOCAL (knowzy-deterministic-local-1) · **Status:** PUBLISHED
- **A.** Only the frontline agent may lower a severity, and the reason must be recorded in the ticket.
- **B.** Only the duty manager may lower a severity, and the reason must be recorded in the ticket. ✔
- **C.** In addition to any other case the duty manager may lower a severity, and the reason must be recorded in the ticket.
- **D.** Only the duty manager must never lower a severity, and the reason must be recorded in the ticket.
- **Explanation:** The section "Network Incident Escalation > Severity Classification" states this rule directly. The other options alter a threshold, a timeframe, or the obligation itself, and none of them is supported by the document.
- **Evidence (STRICT):** > Only the duty manager may lower a severity, and the reason must be recorded in the ticket.
- **Confidence:** 0.786 · **Highest similarity:** 0.000

### According to "Network Incident Escalation > Escalation Timings", which statement is correct?

- **Question ID:** `01a0e2d3-5bd7-708f-86d7-2d6af610395e` · **Provider:** DETERMINISTIC_LOCAL (knowzy-deterministic-local-1) · **Status:** APPROVED
- **A.** A severity two incident is assigned to the network queue and may optionally be picked up within thirty minutes during business hours, or within two hours outside them.
- **B.** A severity two incident is assigned to the network queue and must be picked up within ninety minutes during business hours, or within two hours outside them.
- **C.** A severity two incident is assigned to the network queue and must be picked up within thirty minutes during business hours, or within two hours outside them. ✔
- **D.** A severity four incident is assigned to the network queue and must be picked up within thirty minutes during business hours, or within two hours outside them.
- **Explanation:** The section "Network Incident Escalation > Escalation Timings" states this rule directly. The other options alter a threshold, a timeframe, or the obligation itself, and none of them is supported by the document.
- **Evidence (STRICT):** > A severity two incident is assigned to the network queue and must be picked up within thirty minutes during business hours, or within two hours outside them.
- **Confidence:** 0.726 · **Highest similarity:** 0.412

### In the network incident procedure, who is accountable for escalation beyond the frontline team?

- **Question ID:** `01a0e7d4-0222-743d-bdce-ae77d905239d` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Frontline agents
- **B.** The monitoring platform owner
- **C.** The duty manager ✔
- **D.** The on-call network engineer
- **Explanation:** The section distinguishes accountability: frontline for classification, duty manager for escalation beyond team.
- **Evidence (STRICT):** > Frontline agents are accountable for classification; the duty manager is accountable for escalation beyond the team.
- **Confidence:** 0.869 · **Highest similarity:** 0.168

### For a severity one incident, when must the first customer update be sent and how often thereafter?

- **Question ID:** `01a0e7d4-022a-75b6-b9c0-d7d723643227` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Within 15 minutes, then every 30 minutes
- **B.** Within 30 minutes, then every 60 minutes until service restoration ✔
- **C.** Within 60 minutes, then every 2 hours
- **D.** At end of shift, then daily
- **Explanation:** The communication cadence for severity one is first update in 30 minutes and then hourly.
- **Evidence (STRICT):** > The agent sends the first customer update within thirty minutes of classifying a severity one incident, and every sixty minutes thereafter until service is restored.
- **Confidence:** 0.876 · **Highest similarity:** 0.079

### Which content rule applies to customer updates during incidents?

- **Question ID:** `01a0e7d4-0234-79a3-9331-f615d65f65ff` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Include likely root cause even if unconfirmed
- **B.** Name the engineer currently troubleshooting
- **C.** State what is known, what is being done, and next update time without speculating on cause ✔
- **D.** Share vendor name to increase transparency
- **Explanation:** Updates must include status and next timing, while avoiding cause speculation and naming individuals/vendors.
- **Evidence (STRICT):** > Updates state what is known, what is being done, and when the next update will arrive. An update never speculates about a cause, and never names an individual engineer or a vendor.
- **Confidence:** 0.912 · **Highest similarity:** 0.194

### At shift end, how must open incidents above severity three be handed over?

- **Question ID:** `01a0e7d4-023b-709f-9aed-8d72407710d8` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Ticket notes only
- **B.** Verbal summary only
- **C.** Both verbally and in the ticket ✔
- **D.** Email to the duty manager only
- **Explanation:** The handover requirement explicitly mandates both verbal and written transfer.
- **Evidence (STRICT):** > At the end of a shift the agent hands over every open incident above severity three verbally and in the ticket.
- **Confidence:** 0.870 · **Highest similarity:** 0.135

### Which item is required in the written handover for open incidents above severity three?

- **Question ID:** `01a0e7d4-0242-7d7d-bba7-4e9a99d0efd0` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Estimated root cause probability
- **B.** Current severity, last update time, next update commitment, and engaged engineer name ✔
- **C.** Customer contract value and SLA tier only
- **D.** Only unresolved technical actions
- **Explanation:** The procedure lists four required written handover elements.
- **Evidence (STRICT):** > The written handover records the current severity, the last customer update time, the next update commitment, and the name of the engineer currently engaged.
- **Confidence:** 0.878 · **Highest similarity:** 0.313

## refunds-and-chargebacks.md

### According to "Refunds and Chargebacks > Refund Authority Limits", which statement is correct?

- **Question ID:** `01a0e2d3-2f53-7bde-a57f-efd51f040ba2` · **Provider:** DETERMINISTIC_LOCAL (knowzy-deterministic-local-1) · **Status:** PUBLISHED
- **A.** An agent may issue a refund up to and including five hundred euros without further approval, provided the request is within ninety days of the original charge and the account holds no open dispute. ✔
- **B.** An agent may issue a refund up to and including ten hundred euros without further approval, provided the request is within ninety days of the original charge and the account holds no open dispute.
- **C.** An agent must never issue a refund up to and including five hundred euros without further approval, provided the request is within ninety days of the original charge and the account holds no open dispute.
- **D.** An agent may issue a refund up to and including five thousand euros without further approval, provided the request is within ninety days of the original charge and the account holds no open dispute.
- **Explanation:** The section "Refunds and Chargebacks > Refund Authority Limits" states this rule directly. The other options alter a threshold, a timeframe, or the obligation itself, and none of them is supported by the document.
- **Evidence (STRICT):** > An agent may issue a refund up to and including five hundred euros without further approval, provided the request is within ninety days of the original charge and the account holds no open dispute.
- **Confidence:** 0.763 · **Highest similarity:** 0.156

### According to "Refunds and Chargebacks > Goodwill Credits", which statement is correct?

- **Question ID:** `01a0e2d3-2f61-7fc0-9b79-b1295b68f346` · **Provider:** DETERMINISTIC_LOCAL (knowzy-deterministic-local-1) · **Status:** PUBLISHED
- **A.** An agent may apply a goodwill credit up to fifty euros per customer per calendar year without approval. ✔
- **B.** An agent may apply a goodwill credit up to two hundred euros per customer per calendar year without approval.
- **C.** An agent must never apply a goodwill credit up to fifty euros per customer per calendar year without approval.
- **D.** A duty manager may apply a goodwill credit up to fifty euros per customer per calendar year without approval.
- **Explanation:** The section "Refunds and Chargebacks > Goodwill Credits" states this rule directly. The other options alter a threshold, a timeframe, or the obligation itself, and none of them is supported by the document.
- **Evidence (STRICT):** > An agent may apply a goodwill credit up to fifty euros per customer per calendar year without approval.
- **Confidence:** 0.692 · **Highest similarity:** 0.367

### According to "Refunds and Chargebacks > Chargeback Response", which statement is correct?

- **Question ID:** `01a0e2d3-5bc3-7a6c-a7bb-e30f73adfd4a` · **Provider:** DETERMINISTIC_LOCAL (knowzy-deterministic-local-1) · **Status:** PUBLISHED
- **A.** A chargeback must be answered within seven calendar days of notification from the payment provider. ✔
- **B.** A chargeback must be answered within three calendar days of notification from the payment provider.
- **C.** A chargeback may optionally be answered within seven calendar days of notification from the payment provider.
- **D.** A chargeback may optionally be answered within three calendar days of notification from the payment provider.
- **Explanation:** The section "Refunds and Chargebacks > Chargeback Response" states this rule directly. The other options alter a threshold, a timeframe, or the obligation itself, and none of them is supported by the document.
- **Evidence (STRICT):** > A chargeback must be answered within seven calendar days of notification from the payment provider.
- **Confidence:** 0.700 · **Highest similarity:** 0.379

### What does the monthly review sample for billing records?

- **Question ID:** `01a0e7d4-021a-7426-9d12-5b8aba8812ea` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** All refunds under five hundred euros
- **B.** Ten percent of all credits and all chargebacks
- **C.** Ten percent of refunds above five hundred euros and every refund to a non-original payment method ✔
- **D.** Every transaction regardless of amount or method
- **Explanation:** The sampling scope is specifically defined for higher-risk refund cases.
- **Evidence (STRICT):** > Every refund, credit, and chargeback response is recorded against the account with the amount, the authority relied on, the approver where one was required, and the reason. The monthly review samples ten per cent of all refunds above five hundred euros and every refund issued to a payment method other than the original.
- **Confidence:** 0.869 · **Highest similarity:** 0.045

## Rxnet Eolp Database Connection Pool Exhaustion Sop.md

### According to "Rx.Net Database Connection Pool Exhaustion and Timeout Recovery > Knowledge Checks", which statement is correct?

- **Question ID:** `01a0e2d6-0faa-7051-bdd5-274cb7f0a33a` · **Provider:** DETERMINISTIC_LOCAL (knowzy-deterministic-local-1) · **Status:** PUBLISHED
- **A.** The seven conditions that do not require immediate P1 escalation.
- **B.** The four conditions that require immediate P1 escalation. ✔
- **C.** The seven conditions that require immediate P1 escalation.
- **D.** The four conditions that do not require immediate P1 escalation.
- **Explanation:** The section "Rx.Net Database Connection Pool Exhaustion and Timeout Recovery > Knowledge Checks" states this rule directly. The other options alter a threshold, a timeframe, or the obligation itself, and none of them is supported by the document.
- **Evidence (STRICT):** > The four conditions that require immediate P1 escalation.
- **Confidence:** 0.722 · **Highest similarity:** 0.152

### According to the decision rules, what should be done if a restart seems successful but the issue quickly returns?

- **Question ID:** `01a0e7e5-3c4d-7a89-867b-3701e8466185` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Repeat the same service restart a second time before escalating
- **B.** Treat it as resolved if timeout errors are reduced
- **C.** Move to the controlled shutdown sequence rather than attempting a second restart ✔
- **D.** Immediately reboot the application server regardless of service state
- **Explanation:** The procedure states that quick recurrence after an apparent restart success requires moving to controlled shutdown, not repeating restart attempts.
- **Evidence (STRICT):** > Where a restart appears to succeed, the environment must still be checked for recurrence. If the issue persists or returns quickly after a service restart, the controlled shutdown sequence is the next action rather than a second restart.
- **Confidence:** 0.970 · **Highest similarity:** 0.113

### Which phase/activity explicitly requires business validation before closure of the incident?

- **Question ID:** `01a0e7e5-3c76-705a-b47a-4b2be47c31d1` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Incident validation: Validate SQL health, sleeping sessions, blockers, long running queries
- **B.** Validation: Validate application functionality and order processing ✔
- **C.** Initial recovery: Restart CS, PR and RxCNC services
- **D.** Controlled shutdown: Stop application and RxCNC services
- **Explanation:** In the approval table, the Validation activity requires business validation, while incident validation requires none and other activities require different approvals.
- **Evidence (STRICT):** > | Validation | Validate application functionality and order processing | L2 RXIT / Lab team | Business validation required |
- **Confidence:** 0.961 · **Highest similarity:** 0.076

### During controlled shutdown and database recovery, which lab component is stated as not needing to be stopped, and why?

- **Question ID:** `01a0e7e5-3c81-7f3f-aab7-5e891bcab376` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** RxCNC services, because they auto-recover after SQL restart
- **B.** CS and PR activity, because they are isolated from database operations
- **C.** Decide software at the lab, because it is not network sensitive ✔
- **D.** Middleware services, because they do not open SQL sessions
- **Explanation:** The section explicitly says Decide software at the lab need not be stopped due to not being network sensitive.
- **Evidence (STRICT):** > All Rx.Net related services are stopped gracefully on the application servers and the RxCNC servers, with the lab stopping activity on CS and PR. Decide software at the lab need not be stopped, because it is not network sensitive.
- **Confidence:** 0.943 · **Highest similarity:** 0.125

### Which escalation route is specified when SQL instability persists?

- **Question ID:** `01a0e7e5-3c8b-7a5d-a7d7-378da5757bb7` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Escalate to Wintel Support
- **B.** Escalate to DBA L4 ✔
- **C.** Escalate to Incident Management only
- **D.** Escalate to L2 RXIT
- **Explanation:** The exceptions section maps persistent SQL instability specifically to DBA L4 escalation.
- **Evidence (STRICT):** > Four conditions route the incident outside the standard sequence. Production having stopped escalates to Incident Management. SQL instability that persists escalates to DBA L4. Repeated timeout errors escalate to L3 RXIT Dev. A required server reboot escalates to Wintel Support.
- **Confidence:** 0.893 · **Highest similarity:** 0.091

### Which set lists only indicators that are continuously monitored after recovery?

- **Question ID:** `01a0e7e5-3c97-7b9f-aa46-4d9a200ea0b9` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Sleeping SQL sessions, long running stored procedures, SQL blocking chains, database connection pool utilisation, application timeout frequency, and service availability ✔
- **B.** Only sleeping SQL sessions and service availability
- **C.** User training completion, release notes sign-off, and incident bridge attendance
- **D.** Hardware warranty status, antivirus signatures, and desktop patch levels
- **Explanation:** The validation criteria explicitly names six continuous post-recovery indicators, and option A reproduces that exact set.
- **Evidence (STRICT):** > Six indicators are monitored continuously after recovery: sleeping SQL sessions, long running stored procedures, SQL blocking chains, database connection pool utilisation, application timeout frequency, and service availability.
- **Confidence:** 0.975 · **Highest similarity:** 0.058

## SOP - Order Cancellation RxNet.md

### According to "RxNet Order Cancellation > Purpose", which statement is correct?

- **Question ID:** `01a0e2d6-0fba-71be-973c-012a705d8fb4` · **Provider:** DETERMINISTIC_LOCAL (knowzy-deterministic-local-1) · **Status:** PUBLISHED
- **A.** It covers four distinct situations: cancelling a single job, cancelling multiple jobs together, handling EOLP orders stuck in the orchestration queue, and cancelling an order where the cancellation status must not be sent to the account manager.
- **B.** It covers four distinct situations: cancelling a single job, cancelling multiple jobs together, handling EOLP orders stuck in the orchestration queue, and cancelling an order where the cancellation status must not be sent to the customer. ✔
- **C.** It covers seven distinct situations: cancelling a single job, cancelling multiple jobs together, handling EOLP orders stuck in the orchestration queue, and cancelling an order where the cancellation status must not be sent to the customer.
- **D.** It covers four distinct situations: cancelling a single job, cancelling multiple jobs together, handling EOLP orders stuck in the orchestration queue, and cancelling an order where the cancellation status may optionally not be sent to the customer.
- **Explanation:** The section "RxNet Order Cancellation > Purpose" states this rule directly. The other options alter a threshold, a timeframe, or the obligation itself, and none of them is supported by the document.
- **Evidence (STRICT):** > It covers four distinct situations: cancelling a single job, cancelling multiple jobs together, handling EOLP orders stuck in the orchestration queue, and cancelling an order where the cancellation status must not be sent to the customer.
- **Confidence:** 0.726 · **Highest similarity:** 0.212

### According to "RxNet Order Cancellation > Decision Rules", which statement is correct?

- **Question ID:** `01a0e2d6-0fc6-755c-8bf3-9d4213227d07` · **Provider:** DETERMINISTIC_LOCAL (knowzy-deterministic-local-1) · **Status:** DRAFT
- **A.** When the cancellation status must not be generated for the account manager, the correct cancellation code must be confirmed with the lab before proceeding.
- **B.** When the cancellation status must not be generated for the customer, the correct cancellation code must be confirmed with the lab before proceeding. ✔
- **C.** When the cancellation status may optionally not be generated for the customer, the correct cancellation code must be confirmed with the lab before proceeding.
- **D.** When the cancellation status must not be generated for the customer, the correct cancellation code may optionally be confirmed with the lab before proceeding.
- **Explanation:** The section "RxNet Order Cancellation > Decision Rules" states this rule directly. The other options alter a threshold, a timeframe, or the obligation itself, and none of them is supported by the document.
- **Evidence (STRICT):** > When the cancellation status must not be generated for the customer, the correct cancellation code must be confirmed with the lab before proceeding.
- **Confidence:** 0.745 · **Highest similarity:** 0.436

### According to "RxNet Order Cancellation > Thresholds", which statement is correct?

- **Question ID:** `01a0e2d6-0fd1-7435-bafb-84e51f4d3c04` · **Provider:** DETERMINISTIC_LOCAL (knowzy-deterministic-local-1) · **Status:** APPROVED
- **A.** The distinction between the two main flows is also a count: the single-order flow applies when exactly three job or order must be cancelled, and the mass cancellation flow applies when multiple jobs or orders must be cancelled together.
- **B.** The distinction between the two main flows is also a count: the single-order flow applies when exactly one job or order must be cancelled, and the mass cancellation flow applies when multiple jobs or orders must be cancelled together. ✔
- **C.** The distinction between the four main flows is also a count: the single-order flow applies when exactly one job or order must be cancelled, and the mass cancellation flow applies when multiple jobs or orders must be cancelled together.
- **D.** The distinction between the two main flows is also a count: the single-order flow applies when exactly one job or order may optionally be cancelled, and the mass cancellation flow applies when multiple jobs or orders must be cancelled together.
- **Explanation:** The section "RxNet Order Cancellation > Thresholds" states this rule directly. The other options alter a threshold, a timeframe, or the obligation itself, and none of them is supported by the document.
- **Evidence (STRICT):** > The distinction between the two main flows is also a count: the single-order flow applies when exactly one job or order must be cancelled, and the mass cancellation flow applies when multiple jobs or orders must be cancelled together.
- **Confidence:** 0.707 · **Highest similarity:** 0.464

### According to "RxNet Order Cancellation > Scenarios > Cancelling a single order", which statement is correct?

- **Question ID:** `01a0e2d6-0fdd-7e39-b282-063af35ab2ae` · **Provider:** DETERMINISTIC_LOCAL (knowzy-deterministic-local-1) · **Status:** SUBMITTED_FOR_APPROVAL
- **A.** This scenario applies when only three job or order needs to be cancelled.
- **B.** This scenario applies when in addition to any other case one job or order needs to be cancelled.
- **C.** This scenario applies when in addition to any other case three job or order needs to be cancelled.
- **D.** This scenario applies when only one job or order needs to be cancelled. ✔
- **Explanation:** The section "RxNet Order Cancellation > Scenarios > Cancelling a single order" states this rule directly. The other options alter a threshold, a timeframe, or the obligation itself, and none of them is supported by the document.
- **Evidence (STRICT):** > This scenario applies when only one job or order needs to be cancelled.
- **Confidence:** 0.658 · **Highest similarity:** 0.386

### According to "RxNet Order Cancellation > Knowledge Checks", which statement is correct?

- **Question ID:** `01a0e33d-ac09-739a-9e27-4d50cca76555` · **Provider:** DETERMINISTIC_LOCAL (knowzy-deterministic-local-1) · **Status:** DRAFT
- **A.** Why the cancellation reason is an account manager-facing decision and not only an internal one.
- **B.** Why the cancellation reason is a customer-facing decision and not only an internal one. ✔
- **C.** Why the cancellation reason is a customer-facing decision and not only an internal three.
- **D.** Why the cancellation reason is a customer-facing decision and not in addition to any other case an internal one.
- **Explanation:** The section "RxNet Order Cancellation > Knowledge Checks" states this rule directly. The other options alter a threshold, a timeframe, or the obligation itself, and none of them is supported by the document.
- **Evidence (STRICT):** > Why the cancellation reason is a customer-facing decision and not only an internal one.
- **Confidence:** 0.730 · **Highest similarity:** 0.422

## SOP - Printer Management.md

### According to "Rx.Net Printer Troubleshooting - Unable to Print > Decision Rules", which statement is correct?

- **Question ID:** `01a0e33d-ac28-7485-a0ef-aa3ea9ee2937` · **Provider:** DETERMINISTIC_LOCAL (knowzy-deterministic-local-1) · **Status:** DRAFT
- **A.** Each of the four checks produces evidence that must be captured and attached to the Global Case: a screenshot of the printer status, the test page result, the ping result, and confirmation of the service restart outcome. ✔
- **B.** Each of the seven checks produces evidence that must be captured and attached to the Global Case: a screenshot of the printer status, the test page result, the ping result, and confirmation of the service restart outcome.
- **C.** Each of the four checks produces evidence that may optionally be captured and attached to the Global Case: a screenshot of the printer status, the test page result, the ping result, and confirmation of the service restart outcome.
- **D.** Each of the seven checks produces evidence that may optionally be captured and attached to the Global Case: a screenshot of the printer status, the test page result, the ping result, and confirmation of the service restart outcome.
- **Explanation:** The section "Rx.Net Printer Troubleshooting - Unable to Print > Decision Rules" states this rule directly. The other options alter a threshold, a timeframe, or the obligation itself, and none of them is supported by the document.
- **Evidence (STRICT):** > Each of the four checks produces evidence that must be captured and attached to the Global Case: a screenshot of the printer status, the test page result, the ping result, and confirmation of the service restart outcome.
- **Confidence:** 0.741 · **Highest similarity:** 0.288

### According to "Rx.Net Printer Troubleshooting - Unable to Print > Exceptions", which statement is correct?

- **Question ID:** `01a0e33d-ac3d-769e-8bcf-f2c448cca562` · **Provider:** DETERMINISTIC_LOCAL (knowzy-deterministic-local-1) · **Status:** APPROVED
- **A.** Ten conditions require escalation rather than further troubleshooting: the printer remains offline after troubleshooting, the test page continues to fail, the printer is unreachable over the network, the RxPrinting or Print Spooler services fail to start, or the issue persists after all troubleshooting steps have been completed.
- **B.** Five conditions do not require escalation rather than further troubleshooting: the printer remains offline after troubleshooting, the test page continues to fail, the printer is unreachable over the network, the RxPrinting or Print Spooler services fail to start, or the issue persists after all troubleshooting steps have been completed.
- **C.** Ten conditions do not require escalation rather than further troubleshooting: the printer remains offline after troubleshooting, the test page continues to fail, the printer is unreachable over the network, the RxPrinting or Print Spooler services fail to start, or the issue persists after all troubleshooting steps have been completed.
- **D.** Five conditions require escalation rather than further troubleshooting: the printer remains offline after troubleshooting, the test page continues to fail, the printer is unreachable over the network, the RxPrinting or Print Spooler services fail to start, or the issue persists after all troubleshooting steps have been completed. ✔
- **Explanation:** The section "Rx.Net Printer Troubleshooting - Unable to Print > Exceptions" states this rule directly. The other options alter a threshold, a timeframe, or the obligation itself, and none of them is supported by the document.
- **Evidence (STRICT):** > Five conditions require escalation rather than further troubleshooting: the printer remains offline after troubleshooting, the test page continues to fail, the printer is unreachable over the network, the RxPrinting or Print Spooler services fail to start, or the issue persists after all troubleshooting steps have been completed.
- **Confidence:** 0.678 · **Highest similarity:** 0.479

### According to "Rx.Net Printer Troubleshooting - Unable to Print > Knowledge Checks", which statement is correct?

- **Question ID:** `01a0e33d-ac4d-729a-981c-620ff63946d4` · **Provider:** DETERMINISTIC_LOCAL (knowzy-deterministic-local-1) · **Status:** SUBMITTED_FOR_APPROVAL
- **A.** Which four services are restarted, and what state both must reach.
- **B.** Which two services are restarted, and what state both may optionally reach.
- **C.** Which four services are restarted, and what state both may optionally reach.
- **D.** Which two services are restarted, and what state both must reach. ✔
- **Explanation:** The section "Rx.Net Printer Troubleshooting - Unable to Print > Knowledge Checks" states this rule directly. The other options alter a threshold, a timeframe, or the obligation itself, and none of them is supported by the document.
- **Evidence (STRICT):** > Which two services are restarted, and what state both must reach.
- **Confidence:** 0.659 · **Highest similarity:** 0.463
