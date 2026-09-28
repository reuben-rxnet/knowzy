# Review packet — arm-b-codex

105 question(s). Every one is a DRAFT unless its status says otherwise.

## ELTL_Lab_Orders_Stuck_in_Awaiting_Calculation_SOP.docx

### According to the ELTL Awaiting Calculation SOP, when is retriggering explicitly allowed?

- **Question ID:** `01a0e850-fd22-7862-8f85-19d8263cdfbd` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Whenever retries are 4 or more
- **B.** Only when the RxCalcService log shows an Object reference exception ✔
- **C.** When JSON parsing error appears
- **D.** For any error if order is stuck more than 10 minutes
- **Explanation:** The SOP explicitly states retriggering is only for the Object reference exception and must not be done for the JSON parsing error.
- **Evidence (STRICT):** > ImportantRetrigger only when the RxCalcService log shows: "Object reference not set to an instance of an object." Do not retrigger when the log shows the JSON parsing error: "Unexpected character encountered while parsing value: ?. Path '', line 0, position 0."
- **Confidence:** 0.918 · **Highest similarity:** 0.074

### In validation Step 1 for stuck calculation orders, which queue conditions must be confirmed?

- **Question ID:** `01a0e850-fd2c-76ce-8f81-1113155618e8` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Status = PerformCalculation and retries = 0
- **B.** Status = CalculationInProgress and retries are 4 or more ✔
- **C.** Status = RECVPROV and retries are less than 4
- **D.** Status = AwaitingCalculation and retries exactly 1
- **Explanation:** Step 1 requires checking for CalculationInProgress plus retries threshold of 4+.
- **Evidence (STRICT):** > Step 1: Verify queue status Query the LMTB_CALC_REQUEST_RESPONSE_QUEUE table and identify impacted orders. Confirm that CRRQ_REQUEST_STATUS / queue status indicates CalculationInProgress and that retries are 4 or more.
- **Confidence:** 0.824 · **Highest similarity:** 0.067

### Before taking action on an impacted order, what does Step 2 require L2 to identify in RxCalcService logs?

- **Question ID:** `01a0e850-fd34-7620-b6ba-80ee6af9fe17` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Any warning in Windows Event Viewer
- **B.** The latest server reboot time
- **C.** The exact exception message ✔
- **D.** The queue retry timestamp only
- **Explanation:** The procedure says to identify the exact exception message before any action.
- **Evidence (STRICT):** > Step 2: Review RxCalcService logs Check the RxCalcService logs for the impacted order and identify the exact exception message before taking any action.
- **Confidence:** 0.879 · **Highest similarity:** 0.165

### In the resolution matrix, what is the required action for a JSON parsing error showing "Unexpected character encountered..."?

- **Question ID:** `01a0e850-fd3c-73c7-afe3-0ebdfe46fc4c` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Retrigger by resetting queue and clearing CRRQ_DATA
- **B.** Restart SQL services immediately
- **C.** Do not retrigger; collect logs and escalate to L3 and DEV ✔
- **D.** Clear retries and set status to RECVPROV
- **Explanation:** The matrix marks this error as non-retrigger and requires escalation with logs.
- **Evidence (STRICT):** > JSON parsing error - Unexpected character encountered while parsing value: ?. Path '', line 0, position 0. - Do not retrigger. Collect logs and escalate to L3 and DEV team.
- **Confidence:** 0.897 · **Highest similarity:** 0.079

### For the known recoverable error scenario, what CRRQ_REQUEST_STATUS value is set in the SQL workaround?

- **Question ID:** `01a0e850-fd44-7a9e-a5e3-e95f258c244c` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** CalculationInProgress
- **B.** PerformCalculation ✔
- **C.** RECVPROV
- **D.** ReservationInProgress
- **Explanation:** The SQL update sets CRRQ_REQUEST_STATUS to PerformCalculation to retrigger processing.
- **Evidence (STRICT):** > UPDATE LMTB_CALC_REQUEST_RESPONSE_QUEUESET CRRQ_RETRIES = 0, CRRQ_ENABLED = 1, CRRQ_ERROR = '', CRRQ_REQUEST_STATUS = 'PerformCalculation', CRRQ_DATA = ''WHERE CRRQ_TRAK_NO = '103036532554';
- **Confidence:** 0.947 · **Highest similarity:** 0.074

### After applying the retrigger SQL workaround, approximately how long may it take for the order to move to RECVPROV?

- **Question ID:** `01a0e850-fd4d-7d15-a151-0a32d84c47f5` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** About 30 seconds
- **B.** About 2 minutes
- **C.** About 6 minutes ✔
- **D.** About 20 minutes
- **Explanation:** Expected result section specifies approximately 6 minutes after retriggering.
- **Evidence (STRICT):** > Expected ResultThe calculation request is re-triggered. The order should be recalculated and progress to RECVPROV. Monitor the order after applying the update. It may take approximately 6 minutes after retriggering for the order to be calculated and move to RECVPROV.
- **Confidence:** 0.866 · **Highest similarity:** 0.179

### For Scenario 2 (JSON parsing error), which escalation target is explicitly required?

- **Question ID:** `01a0e850-fd57-7a15-924b-d5b0912dea3e` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Only DBA Team
- **B.** L3 Support and Development Team ✔
- **C.** Only Incident Manager
- **D.** Wintel Support and DXC only
- **Explanation:** Scenario 2 action says escalate to L3 Support and Development Team with collected evidence.
- **Evidence (STRICT):** > Action RequiredDo not retrigger the calculation. Collect impacted order number(s), RxCalcService logs, exception stack trace, and queue record details. Escalate to L3 Support and the Development Team for further investigation.
- **Confidence:** 0.873 · **Highest similarity:** 0.157

### Which combination correctly summarizes the ELTL calculation guidance?

- **Question ID:** `01a0e850-fd5f-7b83-a088-460c59b91eca` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Retrigger for JSON parsing errors and skip Object reference errors
- **B.** Retrigger only for Object reference error; do not retrigger JSON parsing errors and escalate logs ✔
- **C.** Never retrigger any stuck calculation order
- **D.** Retrigger all errors if retries exceed 3
- **Explanation:** Summary restates approval only for Object reference exception and escalation for JSON parsing errors.
- **Evidence (STRICT):** > For ELTL orders stuck in Awaiting Calculation, retriggering is approved only when the RxCalcService log shows the Object reference exception. The workaround is to reset the queue record, enable it again, clear CRRQ_ERROR, set the request status to PerformCalculation, and clear CRRQ_DATA. For the JSON parsing error, do not retrigger; send the logs and supporting details to L3 and DEV for analysis.
- **Confidence:** 0.870 · **Highest similarity:** 0.115

## EMEA SQL Server Patching – Implementation Plan.docx

### During EMEA SQL patching, what must RxNet L2 avoid changing while disabling services?

- **Question ID:** `01a0e850-fd68-7789-b730-706bb48c89cd` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Service account passwords
- **B.** Windows Service Startup Type or service configuration ✔
- **C.** Server hostnames
- **D.** Database collation settings
- **Explanation:** Instruction is to disable required services only and not change startup type/configuration.
- **Evidence (STRICT):** > RxNet L2 Team: Disable only the required services to prevent them from restarting automatically during the maintenance. Do not change the Windows Service Startup Type or any service configuration.
- **Confidence:** 0.986 · **Highest similarity:** 0.053

### What must the DBA team do before rebooting the EOLP Database Server during patching?

- **Question ID:** `01a0e850-fd71-7f30-b6be-5ce4f0876382` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Wait for Microsoft approval email
- **B.** Receive confirmation from RxNet L2 that required services are stopped ✔
- **C.** Complete SSRS binding updates
- **D.** Run post-maintenance Event Viewer checks
- **Explanation:** DBA reboots only after confirmation from L2 team.
- **Evidence (STRICT):** > RxNet L2 Team: Inform the MS Teams group that all required services have been stopped. Share screenshots from both the Application Server and RXCNC Server showing the services are stopped and disabled. DBA Team: After receiving confirmation from the RxNet L2 Team, reboot the EOLP Database Server.
- **Confidence:** 0.972 · **Highest similarity:** 0.217

### Which item is part of required post-maintenance validation by RxNet L2?

- **Question ID:** `01a0e850-fd78-7186-a2c7-f0ee7338dda9` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Confirm no critical errors/warnings in logs or Windows Event Viewer ✔
- **B.** Reset all service startup types to Automatic
- **C.** Rebuild TempDB files
- **D.** Run SQL patch installer again
- **Explanation:** Section 2 lists this as one of the required validation confirmations.
- **Evidence (STRICT):** > RxNet L2 Team: Perform post-maintenance validation by confirming: All required Rx Application Services are running successfully. Application logs are updating normally without errors. No critical errors or warnings are present in the application logs or Windows Event Viewer.
- **Confidence:** 0.906 · **Highest similarity:** 0.108

## EOLP Support SOP.pdf

### If outsourced orders do not have the Beginning flag, what solution is specified?

- **Question ID:** `01a0e850-fd80-778b-9c80-7035c054c1db` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Restart orchestration services
- **B.** Run script to add BEGINNING flag manually in DB ✔
- **C.** Escalate directly to DBA only
- **D.** Delete and reimport all orders
- **Explanation:** The section’s solution is manual DB update via provided script.
- **Evidence (STRICT):** > Issue description : Outsourced orders do not have Beginning flag Root cause : - DB timeout > check PR logs - Wrong process of flagging (under analysis) Solution : - Run the following script to add "BEGINNING" flag manually in the DB 1.A. Flag missing Beginning flag on outsourced order L2 insert_beg_flag.sql
- **Confidence:** 0.897 · **Highest similarity:** 0.061

### For missing Packing flag, which script is referenced to manually add the flag (with adjustment)?

- **Question ID:** `01a0e850-fd88-72f7-bda9-58daf36c07ff` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** insert_pack_flag.sql
- **B.** insert_beg_flag.sql ✔
- **C.** update_packing_queue.sql
- **D.** repair_flags_proc.sql
- **Explanation:** Section states to adjust and use insert_beg_flag.sql for packing flag addition.
- **Evidence (STRICT):** > Solution : - Run the following script to add "PACKING" flag manually in the DB (adjust script for packing flag) L2 insert_beg_flag.sql
- **Confidence:** 0.902 · **Highest similarity:** 0.067

### In TRTF dead letter monitoring, what is Step 4 in the listed process?

- **Question ID:** `01a0e850-fd8f-709d-9955-02096a39c3c3` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Re-send orders to SAP
- **B.** Purge dead letters manually ✔
- **C.** Reboot TRTF servers
- **D.** Disable notification topic
- **Explanation:** Process explicitly says to purge dead letters by manual deletion in step 4.
- **Evidence (STRICT):** > Frequency : each email received Process: 1. Identify dead letters id (in red) and check with TRTF team & Holty for the following steps 2. Check with lab if orders are to be resent 3. Resend orders (in blue) 4. Purge dead letters (manually delete them)
- **Confidence:** 0.920 · **Highest similarity:** 0.062

### If orchestration query returns results for output files not integrated, what file operation is instructed?

- **Question ID:** `01a0e850-fd97-7ed2-92f1-24d99fef28f3` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Delete all files in output-response-files
- **B.** Move day-specific files from awaiting-processing-files to output-response-files ✔
- **C.** Copy files from output-response-files to backup only
- **D.** Compress and send files to DBA
- **Explanation:** The SOP says cut/paste affected files from awaiting-processing-files to output-response-files.
- **Evidence (STRICT):** > 3. If you have results in this query (datepart value to change depending on the day to check) then go to \\PLER0109\Rx.Net\RxOrchestration\output-response-files\awaiting-processing-files cut the orders for the day that had the issue cut and paste to \\PLER0109\Rx.Net\RxOrchestration\output-response-files then check that status is changed
- **Confidence:** 0.942 · **Highest similarity:** 0.080

### For unreserved requests monitoring, which cancellation reason and remark should be set during re-import?

- **Question ID:** `01a0e850-fda0-7837-8a7e-e802a24861e8` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Reason 'LMS PATIENT REQUEST', remark 'Oracle Monitor'
- **B.** Reason 'Setup and test', remark 'Unreserved Monitoring' ✔
- **C.** Reason 'LAB SYSTEM SETUP AND TEST', remark 'UReq'
- **D.** Reason 'LMS DISCONTINUED', remark 'No reserve'
- **Explanation:** The process explicitly specifies both values.
- **Evidence (STRICT):** > - Cancel and re-import the orders using Foto (click on "Reimport Order") - Please setup cancellation reason to 'Setup and test ' as the illustration - Add a remark 'Unreserved Monitoring'
- **Confidence:** 0.867 · **Highest similarity:** 0.080

### In "order did not close" monitoring, what is L3’s DB action before using autoflagging tool?

- **Question ID:** `01a0e850-fdaa-74a5-aa33-af83e4eb601a` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Set phase 1 = 0 in cust_ord_phases
- **B.** Set phase 9 = 0 for impacted orders in cust_ord_phases ✔
- **C.** Delete impacted rows from cust_ord_phases
- **D.** Set phase 9 = 1 in LMTB_CUST_ORD_HEAD
- **Explanation:** L3 step says set phase 9 = 0 for impacted orders.
- **Evidence (STRICT):** > For L3: 1. In table cust_ord_phases set phase 9 = 0 for impacted orders 2. Use autoflagging tool to close the orders
- **Confidence:** 0.833 · **Highest similarity:** 0.104

### When incrementing RxNet Job ID, which table/column combination is specified for update?

- **Question ID:** `01a0e850-fdb3-7b0e-af13-febf7fa1cf75` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** LMTB_JOB_QUEUE.DOC_NO
- **B.** sequence_gen.DOC_NO where DOC_type = 'JOB' ✔
- **C.** LMTB_CUST_ORD_HEAD.CUOH_JOB_NO
- **D.** LMTB_STREAMSERVE_DD_PDF_INFO.SDP_JOB_NO
- **Explanation:** Section explicitly identifies table sequence_gen and DOC_NO column with DOC_type condition.
- **Evidence (STRICT):** > Process: - Change the JOB ID in the DB to the one indicated in the mail - Table to update: sequence_gen Column to update: DOC_NO where DOC_type = 'JOB'
- **Confidence:** 0.897 · **Highest similarity:** 0.091

## Rxnet Eolp Database Connection Pool Exhaustion Sop.docx

### Before restarting SQL services/database server in the connection pool exhaustion SOP, whose approval is required?

- **Question ID:** `01a0e850-fe5b-723c-819c-237803d7b88e` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** No approval required
- **B.** Only Incident Manager
- **C.** Lab Business approval + Dev Approval ✔
- **D.** Only DBA L2/L4 approval
- **Explanation:** Critical recovery table states DB restart needs Lab Business + Dev approvals.
- **Evidence (STRICT):** > Database Recovery - Restart SQL services / Database server - DBA L2/L4 - Lab Business approval + Dev Approval - Critical activity with production impact
- **Confidence:** 0.963 · **Highest similarity:** 0.142

### What must be done before clearing SQL head blockers during initial recovery?

- **Question ID:** `01a0e850-fe68-7ff9-a137-e70a060c3cc5` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Nothing; kill sessions directly
- **B.** Communicate on bridge and obtain Lab Manager/Dev Team approval ✔
- **C.** Get only Wintel approval
- **D.** Wait for end-of-day batch
- **Explanation:** The notes require communication on bridge and approval before kill session.
- **Evidence (STRICT):** > Initial Recovery - Clear SQL head blockers - DBA L2/L4 - Lab Manager / Dev Team - Must communicate on bridge before kill session
- **Confidence:** 0.976 · **Highest similarity:** 0.172

## Rxnet Eolp Database Connection Pool Exhaustion Sop.md

### For database pool exhaustion incidents, when is immediate P1 escalation required?

- **Question ID:** `01a0e852-2a97-73cb-b208-19fcf6cfd9d8` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Only when production has stopped
- **B.** Only when sleeping sessions exceed 200
- **C.** When any one listed critical condition is met ✔
- **D.** Only after two restart attempts fail
- **Explanation:** The rule says any single listed condition is sufficient for immediate P1 escalation.
- **Evidence (STRICT):** > The incident must be escalated immediately as P1 if multiple departments are impacted, production has stopped, timeout errors continue after a basic restart, or sleeping sessions are continuously increasing. Any one of these conditions is sufficient.
- **Confidence:** 0.964 · **Highest similarity:** 0.161

### Before restarting the database during pool exhaustion recovery, what must happen with application and RxCNC services?

- **Question ID:** `01a0e852-2aa2-744e-99d2-00c834753ec7` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** They should remain running to confirm connectivity
- **B.** They must be fully stopped first ✔
- **C.** Only RxCNC services must be stopped
- **D.** Only CS services must be stopped
- **Explanation:** The ordering rule explicitly requires full stop of all application and RxCNC services before DB restart.
- **Evidence (STRICT):** > All application and RxCNC services must be fully stopped before the database is restarted. The purpose of this ordering is specific: it prevents new SQL connections, additional sleeping sessions, further SQL contention, and reconnection attempts during the database restart.
- **Confidence:** 0.928 · **Highest similarity:** 0.222

### Who must approve clearing SQL head blockers during initial recovery?

- **Question ID:** `01a0e852-2aad-7d76-98a5-2cda7dab04d2` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Incident Manager only
- **B.** Lab Manager and Dev team, with bridge communication first ✔
- **C.** DBA team only
- **D.** Wintel Support and business users
- **Explanation:** Approval matrix lists Lab Manager and Dev team approval and bridge communication requirement.
- **Evidence (STRICT):** > | Initial recovery | Clear SQL head blockers | DBA L2/L4 | Lab Manager and Dev team; must be communicated on the bridge first |
- **Confidence:** 0.944 · **Highest similarity:** 0.432

### What sleeping-session count may indicate the database pool exhaustion issue is present?

- **Question ID:** `01a0e852-2abb-7a36-a752-4d85364b01dc` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Above 50
- **B.** Above 100
- **C.** Above 200 ✔
- **D.** Above 500
- **Explanation:** The threshold states that a count above 200 may indicate the issue.
- **Evidence (STRICT):** > Sleeping sessions that are abnormally high indicate a problem, and a count above 200 may indicate the issue is present.
- **Confidence:** 0.916 · **Highest similarity:** 0.151

### Which symptom pair is described as particularly diagnostic of connection pool exhaustion rather than a simple service failure?

- **Question ID:** `01a0e852-2acc-776c-b11a-816a0c31b823` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** High CPU and low disk space
- **B.** Services appear UP but app unstable, and quick recurrence after restart ✔
- **C.** Single user login failure and printer timeout
- **D.** Slow network with no SQL errors
- **Explanation:** The scenario highlights those two symptoms as especially diagnostic.
- **Evidence (STRICT):** > Two symptoms are particularly diagnostic because they distinguish this incident from a simple service failure: services appearing UP while the application remains unstable, and temporary recovery after a service restart followed by recurrence of the timeout issue shortly afterwards.
- **Confidence:** 0.979 · **Highest similarity:** 0.119

### After clearing blockers and restarting services, how is success judged?

- **Question ID:** `01a0e852-2ada-7a98-b10d-7de537ade0ab` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Restart command completed without error
- **B.** Bridge call ended successfully
- **C.** Timeouts stop, orders process, SQL sessions normalize, and app stabilizes ✔
- **D.** No user complaints for 15 minutes
- **Explanation:** The procedure defines four outcome checks and not merely restart completion.
- **Evidence (STRICT):** > Success is judged on four things rather than on the restart completing: timeout errors stop, new orders process correctly, SQL sessions normalise, and the application stabilises.
- **Confidence:** 0.927 · **Highest similarity:** 0.095

### During controlled shutdown, which component explicitly does NOT need to be stopped at the lab?

- **Question ID:** `01a0e852-2ae5-7ae0-a91b-b814f878bfa4` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** RxCNC services
- **B.** CS and PR activity
- **C.** Decide software ✔
- **D.** SQL services
- **Explanation:** The controlled shutdown scenario explicitly excludes Decide software from stop requirements.
- **Evidence (STRICT):** > All Rx.Net related services are stopped gracefully on the application servers and the RxCNC servers, with the lab stopping activity on CS and PR. Decide software at the lab need not be stopped, because it is not network sensitive.
- **Confidence:** 0.961 · **Highest similarity:** 0.112

### If timeout errors repeatedly occur during this incident type, to whom should it escalate?

- **Question ID:** `01a0e852-2af1-7a32-8671-719e264302d4` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Incident Management
- **B.** L3 RXIT Dev ✔
- **C.** Wintel Support
- **D.** DBA L4
- **Explanation:** The exceptions matrix routes repeated timeout errors to L3 RXIT Dev.
- **Evidence (STRICT):** > Four conditions route the incident outside the standard sequence. Production having stopped escalates to Incident Management. SQL instability that persists escalates to DBA L4. Repeated timeout errors escalate to L3 RXIT Dev. A required server reboot escalates to Wintel Support.
- **Confidence:** 0.951 · **Highest similarity:** 0.128

### What additional requirement is needed for P1 closure after technical recovery in pool exhaustion incidents?

- **Question ID:** `01a0e852-2aff-779b-9b0b-b7b230ff6b95` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Only DBA verbal confirmation
- **B.** RCA and preventive recommendations with Incident Manager and business approval ✔
- **C.** A second reboot cycle
- **D.** Closure within 2 hours
- **Explanation:** Validation criteria explicitly add RCA and preventive recommendations plus approvals for P1 closure.
- **Evidence (STRICT):** > Six indicators are monitored continuously after recovery: sleeping SQL sessions, long running stored procedures, SQL blocking chains, database connection pool utilisation, application timeout frequency, and service availability. P1 closure additionally requires RCA findings and preventive recommendations with Incident Manager and business approval.
- **Confidence:** 0.978 · **Highest similarity:** 0.199

## RxNet_L2_SSL_Certificate_Renewal_SOP.docx

### How should L2 treat a certificate that is near expiry, missing, expired, or not trusted?

- **Question ID:** `01a0e850-fdbb-7219-9066-9b36dfd76c77` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Ignore unless users report issues
- **B.** Treat as risk and track until resolved ✔
- **C.** Escalate only after monthly review
- **D.** Close ticket if SSRS is accessible
- **Explanation:** The scope section explicitly says do not wait for business impact and track such conditions as risk.
- **Evidence (STRICT):** > ImportantL2 should not wait for business impact before checking certificate validity. A certificate that is expired, nearing expiry, missing, or not trusted should be treated as a risk and tracked until resolved.
- **Confidence:** 0.977 · **Highest similarity:** 0.077

### If the symptom is "Binding uses old certificate," what should L2 check?

- **Question ID:** `01a0e850-fdc4-716b-92c1-e90aefe10f03` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** SQL job history
- **B.** HTTPS binding under IIS Site Bindings ✔
- **C.** Only DNS TTL
- **D.** Wintel patch level
- **Explanation:** The trigger table directly maps this symptom to IIS site binding review.
- **Evidence (STRICT):** > Binding uses old certificate - Review HTTPS binding under IIS Site Bindings. - Binding still points to expired certificate
- **Confidence:** 0.984 · **Highest similarity:** 0.114

### When raising certificate renewal, what encryption format is requested as standard?

- **Question ID:** `01a0e850-fdcc-757a-b003-9ccb53ba5768` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** AES-256
- **B.** RSA-4096 only
- **C.** TripleDes Encryption format ✔
- **D.** SHA1 compatibility mode
- **Explanation:** Workflow requires requesting TripleDes encryption as Essilor Luxottica standard.
- **Evidence (STRICT):** > If certificate is expired, near expiry, missing, or invalid, raise a renewal request to Certificate Management. Request for the certificate to be generated in TripleDes Encryption format which is the standard followed in Essilor Luxottica.
- **Confidence:** 0.984 · **Highest similarity:** 0.123

### What should L2 do if curl output shows certificate errors during SSL/TLS trust-related investigation?

- **Question ID:** `01a0e850-fdd5-7742-890d-a70f94831405` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Ignore if ping succeeds
- **B.** Capture full output and attach to incident ✔
- **C.** Immediately reboot IIS
- **D.** Delete browser cache only
- **Explanation:** The note specifically instructs capturing full curl output and not ignoring warnings.
- **Evidence (STRICT):** > NoteIf curl shows certificate errors, capture the full output and attach it to the incident. Do not ignore certificate warnings if the reported symptom is SSL/TLS trust related.
- **Confidence:** 0.889 · **Highest similarity:** 0.113

### During IIS validation, which certificate attributes are explicitly reviewed?

- **Question ID:** `01a0e850-fddd-7fc4-916d-327fd84c35d6` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Only Subject and SAN
- **B.** Name, Issued To, Issued By, Expiration Date, and Certificate Hash ✔
- **C.** Only Thumbprint and private key
- **D.** Port bindings and app pool identity
- **Explanation:** Section 6.1 lists these exact fields for review.
- **Evidence (STRICT):** > Review Name, Issued To, Issued By, Expiration Date, and Certificate Hash. Capture screenshot of the Server Certificates page showing the relevant certificate and expiry date.
- **Confidence:** 0.868 · **Highest similarity:** 0.101

### If certificate is installed but SSRS still fails, which team should be engaged?

- **Question ID:** `01a0e850-fde6-7307-a0ca-711daebdfce2` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Incident Management
- **B.** DBA Team ✔
- **C.** Wintel Support
- **D.** Certificate Management only
- **Explanation:** Escalation model maps this scenario to DBA Team with specific details.
- **Evidence (STRICT):** > Certificate installed but SSRS still fails - DBA Team - Certificate thumbprint, server, SSRS URL, error screenshot, install confirmation.
- **Confidence:** 0.978 · **Highest similarity:** 0.110

### If no official renewal threshold is defined, what practical threshold does the SOP suggest?

- **Question ID:** `01a0e850-fdf1-75df-9c28-3fc92ebc1992` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** 15 days before expiry
- **B.** 30 days before expiry
- **C.** 60 days before expiry ✔
- **D.** 90 days before expiry
- **Explanation:** The SOP suggests using 60 days operationally and aligning with management.
- **Evidence (STRICT):** > If no official threshold is defined, L2 should use a practical operational threshold such as 60 days before expiry and align with management.
- **Confidence:** 0.772 · **Highest similarity:** 0.065

### Which statement must be included in the certificate renewal email template?

- **Question ID:** `01a0e850-fdfb-750a-86e0-86cc246942cb` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Request AES key rotation only
- **B.** Request generation in TripleDes Encryption format ✔
- **C.** Ask DBA to bind SSRS before renewal
- **D.** Confirm no screenshots are required
- **Explanation:** Template explicitly includes TripleDes request sentence.
- **Evidence (STRICT):** > Request for the certificate to be generated in TripleDes Encryption format which is the standard followed in Essilor Luxottica. Server Name / FQDN: <server_name>Lab / Application: <lab/application>Current Expiry Date: <expiry_date>Ticket Reference: <ticket_number>
- **Confidence:** 0.979 · **Highest similarity:** 0.114

### When importing a renewed certificate in IIS, which action depends on file type/origin?

- **Question ID:** `01a0e850-fe06-72fe-b541-7251b9555f98` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Always choose Complete Certificate Request
- **B.** Use Import for PFX; use Complete Certificate Request when CER matches CSR generated from same server ✔
- **C.** Always import into Trusted Root
- **D.** Use IIS reset before import
- **Explanation:** Procedure differentiates Import vs Complete Certificate Request based on certificate flow.
- **Evidence (STRICT):** > Click Import if the renewed certificate is a PFX file, or Complete Certificate Request if a CSR was generated from the same server and a CER file is returned. Browse to the certificate file. Enter the password if applicable.
- **Confidence:** 0.901 · **Highest similarity:** 0.118

### During IIS binding, what values are to be confirmed unless an approved different port is used?

- **Question ID:** `01a0e850-fe13-7ff3-902c-a13628754607` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Type=http and Port=80
- **B.** Type=https and Port=443 ✔
- **C.** Type=tcp and Port=1433
- **D.** Type=ssl and Port=8443 only
- **Explanation:** Section 9.3 specifies HTTPS and 443 as default expected binding settings.
- **Evidence (STRICT):** > Select existing https binding and click Edit, or click Add if HTTPS binding is missing. Confirm Type = https and Port = 443, unless the application uses a different approved port.
- **Confidence:** 0.896 · **Highest similarity:** 0.094

### Why should L2 not assume SSRS work is complete after importing certificate into IIS?

- **Question ID:** `01a0e850-fe20-7fb2-aec8-456be8b868c9` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Because SSRS always auto-updates in 24 hours
- **B.** Because DBA must configure SSRS to use the new certificate ✔
- **C.** Because Wintel owns all IIS certificates
- **D.** Because no validation is needed for SSRS
- **Explanation:** Section states DBA configuration is required for SSRS and IIS import alone is insufficient.
- **Evidence (STRICT):** > For SSRS servers, the incident minutes defined that DBA Team configures SSRS to use the newly installed certificate. L2 should not assume SSRS is complete only because the certificate was imported into IIS.
- **Confidence:** 0.947 · **Highest similarity:** 0.119

### Which post-renewal validation result is expected for HTTPS access to server URL?

- **Question ID:** `01a0e850-fe2e-734b-81bf-af387cc2c5c7` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Certificate warning may appear but acceptable
- **B.** No certificate warning and valid certificate shown ✔
- **C.** HTTP redirect failure is expected
- **D.** Only SSRS endpoint must be tested
- **Explanation:** Expected result for IIS HTTPS access is no warning with valid cert.
- **Evidence (STRICT):** > IIS HTTPS access - Browse to https://<server_name>. - No certificate warning. Valid certificate shown. Certificate details - Open browser certificate details. - Issued To and expiry date reflect renewed certificate.
- **Confidence:** 0.963 · **Highest similarity:** 0.112

### What is the recommended minimum review frequency for the certificate tracker?

- **Question ID:** `01a0e850-fe3e-763b-8de1-29bbcb367f08` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Daily
- **B.** Weekly
- **C.** At least monthly ✔
- **D.** Only when incident occurs
- **Explanation:** Recommended control says review at least monthly, with more frequent checks for high-risk certs.
- **Evidence (STRICT):** > Recommended Control L2 should review the tracker at least monthly and raise renewal requests in advance of expiry. High-risk production certificates should be reviewed more frequently if the environment has a history of certificate-related incidents.
- **Confidence:** 0.984 · **Highest similarity:** 0.115

### If certificate is imported but not visible in IIS binding dropdown, what likely cause is listed?

- **Question ID:** `01a0e850-fe4d-704b-9d87-04c89537980c` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Database login expired
- **B.** Certificate missing private key or in wrong store ✔
- **C.** DNS cache issue only
- **D.** SSRS service stopped
- **Explanation:** Troubleshooting table identifies private key/store issues as likely cause.
- **Evidence (STRICT):** > Certificate imported but not visible in IIS binding dropdown - Certificate may not include private key or may be in wrong certificate store. - Check HasPrivateKey and certificate store. Engage Certificate Management/L3 if needed.
- **Confidence:** 0.983 · **Highest similarity:** 0.117

## RxNet_L2_SSL_Certificate_Renewal_SOP.md

### In the SSL certificate procedure, what must L2 do when a certificate is expired, nearing expiry, missing, or not trusted?

- **Question ID:** `01a0e852-2a27-7ed4-bd1c-4d564260f684` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Wait for business impact before taking action
- **B.** Treat it as a risk and track it until resolved ✔
- **C.** Escalate directly to DBA without tracking
- **D.** Close the incident if users are not reporting errors
- **Explanation:** The decision rule explicitly requires treating these conditions as risk and tracking to resolution without waiting for impact.
- **Evidence (STRICT):** > L2 must not wait for business impact before checking certificate validity. A certificate that is expired, nearing expiry, missing, or not trusted must be treated as a risk and tracked until it is resolved.
- **Confidence:** 0.969 · **Highest similarity:** 0.287

### Which encryption format must be requested when raising a certificate renewal request?

- **Question ID:** `01a0e852-2a36-7e8b-9be9-17ffea1ba974` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** AES-256
- **B.** RSA-2048
- **C.** TripleDes ✔
- **D.** SHA-256
- **Explanation:** The procedure states that renewal requests must explicitly ask for TripleDes encryption format.
- **Evidence (STRICT):** > A renewal request must be raised if the certificate is expired, invalid, not trusted, missing, bound incorrectly, or approaching the defined renewal threshold. The request must ask for the certificate to be generated in TripleDes encryption format, which is the standard followed across the organisation.
- **Confidence:** 0.957 · **Highest similarity:** 0.418

### If no official SSL renewal threshold exists, what operational threshold should L2 use?

- **Question ID:** `01a0e852-2a44-7621-9ed7-7810299a2c31` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** 30 days before expiry
- **B.** 45 days before expiry
- **C.** 60 days before expiry ✔
- **D.** 90 days before expiry
- **Explanation:** The thresholds section defines 60 days as the practical trigger when no official threshold is set.
- **Evidence (STRICT):** > Where no official renewal threshold has been defined, L2 should use a practical operational threshold of 60 days before expiry and align that with management. This is the measurable trigger that converts monitoring into action.
- **Confidence:** 0.823 · **Highest similarity:** 0.361

### How often must the SSL monitoring tracker be reviewed at minimum?

- **Question ID:** `01a0e852-2a50-7f70-b53b-66bacfa44544` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Weekly
- **B.** At least monthly ✔
- **C.** Quarterly
- **D.** Only when an alert occurs
- **Explanation:** The threshold explicitly sets monthly as the minimum review cadence.
- **Evidence (STRICT):** > The monitoring tracker must be reviewed at least monthly, and high-risk production certificates must be reviewed more frequently where the environment has a history of certificate-related incidents.
- **Confidence:** 0.954 · **Highest similarity:** 0.238

### According to the SSL procedure, how many validation methods are sufficient to confirm certificate expiry and raise a request?

- **Question ID:** `01a0e852-2a5e-7251-82a8-67afbc6ec680` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Exactly three methods must all be completed
- **B.** Any one of the three methods is sufficient ✔
- **C.** Only IIS Manager is accepted
- **D.** Only PowerShell and browser together are accepted
- **Explanation:** The scenario says there are three ways and any one of them is enough evidence.
- **Evidence (STRICT):** > Expiry can be confirmed three ways, and any of them is sufficient evidence to raise a request. From IIS Manager, the handler opens inetmgr, selects the server node, opens Server Certificates, and reviews the Name, Issued To, Issued By, Expiration Date and Certificate Hash
- **Confidence:** 0.937 · **Highest similarity:** 0.130

### If a certificate has been installed but SSRS is still failing, which team should be engaged?

- **Question ID:** `01a0e852-2a6a-73b9-b5db-24e79853b936` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Certificate Management
- **B.** Incident Manager
- **C.** DBA team ✔
- **D.** Wintel Support
- **Explanation:** The engagement matrix maps this exact situation to the DBA team.
- **Evidence (STRICT):** > | Certificate installed but SSRS still fails | DBA team | Certificate thumbprint, server, SSRS URL, error screenshot, install confirmation |
- **Confidence:** 0.939 · **Highest similarity:** 0.597

### When importing a renewed SSL certificate in IIS, which action is used for a PFX file?

- **Question ID:** `01a0e852-2a75-73fc-ad1a-28804ebcbd5c` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Complete Certificate Request
- **B.** Import ✔
- **C.** Renew Existing Certificate
- **D.** Create Self-Signed Certificate
- **Explanation:** The installation scenario specifies Import for PFX files.
- **Evidence (STRICT):** > The renewed certificate is then imported through Server Certificates, using Import for a PFX file or Complete Certificate Request where a CSR was generated on the same server and a CER file has been returned.
- **Confidence:** 0.944 · **Highest similarity:** 0.350

### After renewal, if the imported certificate does not appear in the IIS binding dropdown, what is the likely issue to check first?

- **Question ID:** `01a0e852-2a80-79aa-8802-36c741d9ec84` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** DNS resolution failure
- **B.** Missing private key or wrong certificate store ✔
- **C.** Expired SAN entry
- **D.** Blocked SQL session
- **Explanation:** The exceptions section identifies private key absence or wrong store as the first likely causes.
- **Evidence (STRICT):** > A certificate that was imported but does not appear in the IIS binding dropdown may lack a private key or be in the wrong certificate store; the handler checks HasPrivateKey and the store, and engages Certificate Management or L3 if needed.
- **Confidence:** 0.972 · **Highest similarity:** 0.258

### Which additional update is required for closure after SSL renewal, besides technical validation?

- **Question ID:** `01a0e852-2a8b-7a09-923c-72cb7e54a50a` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Update antivirus signatures
- **B.** Update the monitoring tracker with the new expiry date ✔
- **C.** Archive all IIS logs for 12 months
- **D.** Run a full DR drill
- **Explanation:** Closure criteria explicitly include updating the monitoring tracker with the new expiry date.
- **Evidence (STRICT):** > Closure additionally requires that the impacted server and application were identified, the certificate issue was confirmed, Certificate Management was engaged with complete details, the renewed certificate was received and verified, installation succeeded, the HTTPS binding was updated, the DBA was engaged where SSRS was in scope, the monitoring tracker was updated with the new expiry date, and stakeholders were updated with user confirmation received.
- **Confidence:** 0.981 · **Highest similarity:** 0.126

## SOP - Order Cancellation RxNet.docx

### In order cancellation prerequisites, what is the rule regarding blank cancellation reason?

- **Question ID:** `01a0e850-fe79-779d-ac77-607fe49362e0` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Blank reason is allowed for mass cancellation
- **B.** Blank reason is allowed if lab approves verbally
- **C.** Do not select blank reason; confirm correct code with lab when customer status should not be generated ✔
- **D.** Use blank reason for EOLP only
- **Explanation:** Prerequisite explicitly prohibits blank reason and mandates lab confirmation for no-customer-status cases.
- **Evidence (STRICT):** > Important: Do not select a blank cancellation reason. Always confirm the correct cancellation code with the lab when customer status should not be generated.
- **Confidence:** 0.871 · **Highest similarity:** 0.140

### If the order is already cancelled during common pre-validation, what should L2 do?

- **Question ID:** `01a0e850-fe8b-7694-91e3-2fdc03a86d0c` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Re-cancel with different reason
- **B.** Escalate to L3 immediately
- **C.** Inform requester and close the request as applicable ✔
- **D.** Delete order from Job Tracker
- **Explanation:** Procedure clearly states requester should be informed and request closed if already cancelled.
- **Evidence (STRICT):** > Verify the order status in Job Tracker. If the order is already cancelled, inform the requester and close the request as applicable. If the order is not cancelled, login to the respective server.
- **Confidence:** 0.883 · **Highest similarity:** 0.127

### In Single Order Cancellation, which reason is specified and what is its customer-status behavior?

- **Question ID:** `01a0e850-fea3-7a2b-901d-727504970e6b` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** LMS PATIENT REQUEST; status sent to customer
- **B.** LAB SYSTEM SETUP AND TEST; no status sent to customer ✔
- **C.** LMS DISCONTINUED; no status sent to customer
- **D.** RETRIG-AWTORCH; status sent to customer
- **Explanation:** Scenario 1 step 5 explicitly defines reason and no-customer-status note.
- **Evidence (STRICT):** > 5 - Reason - Select LAB SYSTEM SETUP AND TEST as the cancellation reason. [Note: no status will be sent to customer for this reason] 6 - Save and validate - Save the change and verify the final status in Job Tracker.
- **Confidence:** 0.842 · **Highest similarity:** 0.165

### For mass cancellation, which navigation path should be used in CS Client?

- **Question ID:** `01a0e850-feb2-7626-86c9-6b1896c2ddd6` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Orders > Search or Modify Orders
- **B.** Orders > Mass Order Cancellation ✔
- **C.** Support > Regenerate DD files
- **D.** Utilities > Generate F15 Document
- **Explanation:** Scenario 2 step 1 directs to Orders > Mass Order Cancellation.
- **Evidence (STRICT):** > Use this scenario when multiple jobs/orders need to be cancelled together. Step - Action - Details 1 - Navigate - Orders > Mass Order Cancellation 2 - Paste jobs - Paste the list of job numbers received in the request.
- **Confidence:** 0.925 · **Highest similarity:** 0.137

### Which condition set is required before using EOLP orchestration queue cancellation?

- **Question ID:** `01a0e850-febc-7eb4-826b-31e1be2fdfdc` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Any lab, any queue, including WIP
- **B.** EOLP lab, order stuck in orchestration queue, and not a WIP order ✔
- **C.** Only non-EOLP labs with WIP
- **D.** Only if customer asks by phone
- **Explanation:** Scenario 3 requires confirming EOLP, stuck in orchestration queue, and not WIP.
- **Evidence (STRICT):** > Use this scenario only for EOLP orders stuck in the orchestration queue. Do not use this process for WIP orders. Confirm that the lab is EOLP. Confirm that the order is stuck in the orchestration queue table. Confirm that the order is not a WIP order.
- **Confidence:** 0.897 · **Highest similarity:** 0.134

### When cancellation status must not be sent to customer, what control is mandatory?

- **Question ID:** `01a0e850-fec8-730e-89c4-2da22b440665` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Use any default code
- **B.** Use code where status XML generation is NO = 1 and get lab confirmation ✔
- **C.** Always use LMS DISCONTINUED without confirmation
- **D.** Skip Job Tracker validation
- **Explanation:** Scenario 4 requires lab-confirmed code and XML generation NO=1.
- **Evidence (STRICT):** > Ask the lab which cancellation code must be used. Use a cancellation code where status XML generation is set to NO = 1. Complete the cancellation using the confirmed code. Validate that the order is cancelled internally. Do not assume the code. Lab confirmation is mandatory.
- **Confidence:** 0.889 · **Highest similarity:** 0.149

### According to the decision matrix, what key control applies to EOLP Queue cancellation?

- **Question ID:** `01a0e850-fed3-794f-a81d-456b4edd0cdf` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Use LMS PATIENT REQUEST only
- **B.** Only for orchestration queue; not for WIP orders ✔
- **C.** Use status XML generation NO = 0
- **D.** Applicable only to single-order cancellation
- **Explanation:** Matrix key control for EOLP Queue is scope restriction to orchestration queue and exclusion of WIP.
- **Evidence (STRICT):** > EOLP Queue - EOLP order stuck in orchestration queue - EOLP-specific handling - Only for orchestration queue; not for WIP orders.
- **Confidence:** 0.938 · **Highest similarity:** 0.141

## SOP - Order Cancellation RxNet.md

### Before attempting RxNet order cancellation, what must be checked first?

- **Question ID:** `01a0e852-2b0b-7c84-b9ea-3b1321113290` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Printer status
- **B.** Order status in Job Tracker ✔
- **C.** SQL sleeping sessions
- **D.** API health endpoint
- **Explanation:** Decision rules require pre-checking Job Tracker status before any cancellation.
- **Evidence (STRICT):** > The order status must be verified in Job Tracker before any cancellation is attempted. If the order is already cancelled, the requester must be informed and the request closed as applicable rather than cancelled a second time.
- **Confidence:** 0.976 · **Highest similarity:** 0.172

### When cancellation status must not be sent to the customer, what is mandatory before proceeding?

- **Question ID:** `01a0e852-2b18-7efd-9eec-4beedd4fc507` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Use LAB SYSTEM SETUP AND TEST by default
- **B.** Proceed with blank reason and update later
- **C.** Confirm the correct code with the lab ✔
- **D.** Escalate directly to L3
- **Explanation:** The rule states handlers must not assume; lab confirmation is mandatory.
- **Evidence (STRICT):** > When the cancellation status must not be generated for the customer, the correct cancellation code must be confirmed with the lab before proceeding. The handler must not assume the code; lab confirmation is mandatory.
- **Confidence:** 0.948 · **Highest similarity:** 0.435

### Which value indicates a cancellation code suppresses customer-facing status XML generation?

- **Question ID:** `01a0e852-2b24-7f86-97c9-44b985a1a592` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** YES = 1
- **B.** NO = 1 ✔
- **C.** FALSE = 0
- **D.** NULL
- **Explanation:** Thresholds define NO = 1 as the measurable test for suppression-safe code.
- **Evidence (STRICT):** > A cancellation code suppresses the customer-facing status only when its status XML generation setting is NO = 1. That value is the measurable test for whether a code is safe to use when the lab has asked that the customer not be notified.
- **Confidence:** 0.930 · **Highest similarity:** 0.137

### Which condition makes an order eligible for the EOLP orchestration queue cancellation process?

- **Question ID:** `01a0e852-2b32-7a6f-b0e1-97828369aeda` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Any order with timeout errors
- **B.** Only EOLP orders stuck in orchestration queue and not WIP ✔
- **C.** All WIP orders
- **D.** Any order with unknown status
- **Explanation:** The scenario explicitly restricts this process to EOLP stuck queue orders and excludes WIP.
- **Evidence (STRICT):** > This scenario applies only to EOLP orders stuck in the orchestration queue, and explicitly not to WIP orders. The handler first confirms that the lab is EOLP, that the order is stuck in the orchestration queue table, and that the order is not a WIP order.
- **Confidence:** 0.873 · **Highest similarity:** 0.256

### If cancellation code is unclear or lab confirmation is missing, what should the handler do?

- **Question ID:** `01a0e852-2b40-7e41-a6cb-0512cc8ea361` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Guess the closest code and proceed
- **B.** Use blank reason temporarily
- **C.** Capture details and escalate to appropriate support team ✔
- **D.** Cancel using mass flow by default
- **Explanation:** Exceptions state not to proceed on assumption; capture details and escalate.
- **Evidence (STRICT):** > Four conditions stop the standard procedure: the cancellation fails, the order is a WIP order, the cancellation code is unclear, or the lab has not confirmed the expected cancellation reason or code. In any of these cases the handler must not proceed on an assumption. The error or the impacted job details are captured and the request is escalated to the appropriate support team for review.
- **Confidence:** 0.929 · **Highest similarity:** 0.140

### Which statement is required for a cancellation to be considered complete?

- **Question ID:** `01a0e852-2b50-7596-aae7-d99c6f4f3b20` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Only cancellation code selection is required
- **B.** Requester/lab notification after completion is required ✔
- **C.** Job Tracker validation is optional for single orders
- **D.** Pre-check of order status is not necessary
- **Explanation:** Validation criteria include informing requester or lab after completion.
- **Evidence (STRICT):** > A cancellation is complete when five things are true. The order status was checked before the cancellation was attempted. The correct cancellation reason or code was selected. A blank cancellation reason was not used. Job Tracker validation was completed after the cancellation. The requester or lab was informed after completion.
- **Confidence:** 0.903 · **Highest similarity:** 0.175

## SOP - Printer Management.md

### In printer troubleshooting, what should L2 do if printer queue status is not Ready?

- **Question ID:** `01a0e852-2b60-75c6-8462-b8992cc90c85` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Restart Print Spooler immediately
- **B.** Continue with ping test anyway
- **C.** Ask user to investigate/resolve printer issue first ✔
- **D.** Escalate to DBA team
- **Explanation:** Decision rules stop server-side sequence when printer is in fault state and direct user-side resolution.
- **Evidence (STRICT):** > Where the printer queue status is anything other than Ready - offline, error, paper jam or similar - the user must be asked to investigate or resolve the printer issue. L2 does not continue the server-side sequence while the printer itself is in a fault state.
- **Confidence:** 0.971 · **Highest similarity:** 0.127

### What exact queue status permits the server-side printer troubleshooting sequence to continue?

- **Question ID:** `01a0e852-2b6f-7c06-906e-3e5e800a0b80` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Online
- **B.** Idle
- **C.** Ready ✔
- **D.** Connected
- **Explanation:** Threshold section defines Ready as the required pass value.
- **Evidence (STRICT):** > The printer queue status must display Ready. Any other value is a fault state that stops the server-side sequence.
- **Confidence:** 0.923 · **Highest similarity:** 0.195

### If ping to printer IP times out, what is the correct next action?

- **Question ID:** `01a0e852-2b80-7f3b-b666-2f2e380b3862` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Retry print test page three times
- **B.** Restart RxPrinting service
- **C.** Escalate to Infrastructure and Network team ✔
- **D.** Close ticket as user-side issue
- **Explanation:** Network-unreachable condition is explicitly routed to Infrastructure and Network team.
- **Evidence (STRICT):** > The handler pings the printer IP address from the server and verifies that the printer is reachable on the network. The ping results are captured and attached to the Global Case. If the ping request times out or the printer is unreachable, the issue is escalated to the Infrastructure and Network team rather than pursued further at L2.
- **Confidence:** 0.891 · **Highest similarity:** 0.136

### When must the required printer troubleshooting evidence be attached to the Global Case?

- **Question ID:** `01a0e852-2b93-7fc1-a15e-3d6b1e12da81` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Only after incident closure
- **B.** Before the ticket is closed or escalated ✔
- **C.** Within 24 hours after resolution
- **D.** Only if escalation occurs
- **Explanation:** Decision rule states evidence set must be attached before closure or escalation.
- **Evidence (STRICT):** > Each of the four checks produces evidence that must be captured and attached to the Global Case: a screenshot of the printer status, the test page result, the ping result, and confirmation of the service restart outcome. The evidence set must be attached before the ticket is closed or escalated, not afterwards.
- **Confidence:** 0.956 · **Highest similarity:** 0.208

### Which condition is listed as requiring escalation in printer troubleshooting?

- **Question ID:** `01a0e852-2ba8-75ad-983e-7c505e537ffa` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Printer status is Ready
- **B.** Test page succeeds
- **C.** RxPrinting or Print Spooler services fail to start ✔
- **D.** User confirms printing works
- **Explanation:** Exceptions include service start failure as an escalation trigger.
- **Evidence (STRICT):** > Five conditions require escalation rather than further troubleshooting: the printer remains offline after troubleshooting, the test page continues to fail, the printer is unreachable over the network, the RxPrinting or Print Spooler services fail to start, or the issue persists after all troubleshooting steps have been completed.
- **Confidence:** 0.937 · **Highest similarity:** 0.147

### What final check distinguishes a resolved print incident from merely completed technical steps?

- **Question ID:** `01a0e852-2bbd-70bc-9762-41f185013642` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Ping success
- **B.** Print Spooler restart
- **C.** User confirmation of printing ✔
- **D.** Screenshot attachment
- **Explanation:** Validation criteria explicitly say user confirmation is required even if technical checks pass.
- **Evidence (STRICT):** > The incident is complete when seven checks have been satisfied: printer status verified, test page completed, network connectivity verified, RxPrinting service restarted, Print Spooler restarted, screenshots attached to the Global Case, and the user has confirmed printing. The final item is the one that distinguishes a resolved incident from a completed procedure.
- **Confidence:** 0.925 · **Highest similarity:** 0.087

## SOP for Handling TRTF Job Failure Alerts.docx

### Before relaunching TRTF failed jobs, which query must always be run first per SOP instruction?

- **Question ID:** `01a0e850-fedf-707e-8e1e-e8a12e500765` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Eligible Query 1
- **B.** Known Functional Errors Query 2
- **C.** Unknown Errors Query 3 ✔
- **D.** Any query order is acceptable
- **Explanation:** The SOP marks this as very important and blocks relaunch if records return.
- **Evidence (STRICT):** > Recommended SOP Instruction (Very Important) Always run Unknown Errors Query (Query 3) before relaunch.If any records are returned, do NOT proceed with relaunch until validated.
- **Confidence:** 0.958 · **Highest similarity:** 0.076

### Which error patterns are considered eligible for relaunch in Query 1?

- **Question ID:** `01a0e850-feeb-75b4-a896-728442044315` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Index and length must refer to a location / The input string
- **B.** 500 (Internal Server Error) / HttpClient.Timeout ✔
- **C.** Value cannot be null / Hostname mismatch
- **D.** Any failed status regardless of error
- **Explanation:** Query 1 filters failed jobs for these two error signatures only.
- **Evidence (STRICT):** > Query 1: Eligible for Relaunch (STRICT - Use for action) SELECT c.id, c.errorMessage, c.updateDateFROM c WHERE c.status = 'Failed'AND CONTAINS(c.updateDate, 'YYYY-MM-DD')AND ( CONTAINS(c.errorMessage, '500 (Internal Server Error)') OR CONTAINS(c.errorMessage, 'HttpClient.Timeout'))
- **Confidence:** 0.983 · **Highest similarity:** 0.079

### For job list extraction prior to relaunch, which tool/format rule is mandated?

- **Question ID:** `01a0e850-fef7-7766-908a-f0f95ab4bfa2` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Use Excel and save as .xlsx
- **B.** Use Notepad++ and save as .csv; do not use Excel ✔
- **C.** Use Word and save as .txt
- **D.** Use any editor as long as comma-separated
- **Explanation:** The SOP explicitly mandates Notepad++ and prohibits Excel for this step.
- **Evidence (STRICT):** > ⚠️ Important: Use Notepad++ only Name the file as Job_Retrigger_08012026 (change the data accordingly) Save as .csv Do NOT use Excel
- **Confidence:** 0.924 · **Highest similarity:** 0.079

### If TRTF relaunch fails again, what is the ticket handling instruction?

- **Question ID:** `01a0e850-ff05-76ef-a114-9ebc71897c3c` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Close ticket with workaround
- **B.** Assign to DBA and close
- **C.** Keep ticket OPEN ✔
- **D.** Delete and recreate ticket
- **Explanation:** Post-execution case 2 clearly says to keep ticket open.
- **Evidence (STRICT):** > Case 2: Relaunch Failed Capture: Error details Job count failed to relaunch 📧 Email: To: Sumatheendra CC: Holty, Karthikeyan 📌 Keep ticket OPEN
- **Confidence:** 0.958 · **Highest similarity:** 0.128

### For error "Value cannot be null (Parameter 's')", who is primary owner for ticket raising?

- **Question ID:** `01a0e850-ff16-71ef-aba4-2a75f794fde3` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** SAP EOLP team
- **B.** Generix team ✔
- **C.** L2 RxIT
- **D.** Certificate Management
- **Explanation:** Section clarifies ticket must be raised to Generix as primary; SAP loop-in only.
- **Evidence (STRICT):** > ✔ Ticket must be raised to: Generix team✔ SAP team → looped in email (not primary owner) 👥 Correct Contacts (from Master File) Generix Team → 🎯 Primary Raise ticket here SAP Abstract Team (EOLP) → 🔁 Loop in
- **Confidence:** 0.923 · **Highest similarity:** 0.073

## SOP_Check_Email_Recipients_Alerts.docx

### In server folder configuration check for alert recipients, which keywords are suggested for searching config files?

- **Question ID:** `01a0e850-ff24-79d3-b626-bc7ff2a01d1f` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** TLS, SSL, Cert, Thumbprint
- **B.** Email, SMTP, Alert, Recipient, or MailTo ✔
- **C.** Queue, Retry, Timeout, DeadLetter
- **D.** Oracle, SSRS, IIS, Binding
- **Explanation:** The SOP lists these exact search keywords for recipient verification.
- **Evidence (STRICT):** > Open the XML/Config file using Notepad or Notepad++. Search for keywords such as Email, SMTP, Alert, Recipient, or MailTo. Verify the configured recipient email IDs.
- **Confidence:** 0.905 · **Highest similarity:** 0.075

## Tickets SOP's (SAP Rx-MES Interface Reference).md

### Which interface is optional and may be absent without indicating a fault?

- **Question ID:** `01a0e852-2c82-7298-8fdf-9ef74c0f409d` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** F1
- **B.** F4 ✔
- **C.** F7
- **D.** F10
- **Explanation:** Decision rules state F4 is optional and invoked only on user cancellation.
- **Evidence (STRICT):** > F4 is optional. It is invoked only where a user wants to cancel the order, in which case the job is called to Rx.Net and the order can then be cancelled in SAP. Its absence for a given order is therefore normal and not a missing step.
- **Confidence:** 0.989 · **Highest similarity:** 0.102

### How should F5 and F6 be interpreted when troubleshooting SAP↔Rx.Net interfaces?

- **Question ID:** `01a0e852-2c93-78f7-aefa-40d4167e1fda` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** As independent, unrelated events
- **B.** As optional stages that can occur in any order
- **C.** As request/confirmation pair read together ✔
- **D.** As document notification and download stages
- **Explanation:** Decision rule says F5 is pick request and F6 pick confirmation; they must be read together.
- **Evidence (STRICT):** > F5 and F6 are a request and confirmation pair and must be read together. F5 is the pick request, F6 is the pick confirmation, and F6 depends on the pick request having been confirmed and the job ticket having been printed.
- **Confidence:** 0.960 · **Highest similarity:** 0.171

### If a ticket subject says “F7 failure,” which boundary side should be investigated first based on flow direction?

- **Question ID:** `01a0e852-2ca5-737c-8e04-8c46cd6fea7c` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** SAP into Rx.Net path
- **B.** Rx.Net into SAP path ✔
- **C.** Only Rx-MES document path
- **D.** Warehouse pick-print path only
- **Explanation:** Business context says F7 carries manufacturing status from Rx.Net to SAP.
- **Evidence (STRICT):** > Knowing that F1 carries prescription details from SAP to Rx.Net while F7 carries manufacturing status from Rx.Net to SAP tells a handler immediately which side of the boundary a failure sits on.
- **Confidence:** 0.921 · **Highest similarity:** 0.092

### What does an F1 interface represent?

- **Question ID:** `01a0e852-2cbb-74eb-86e7-29cf2ea444f3` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Shipment notification from SAP to Rx.Net
- **B.** Order entry from SAP to Rx.Net ✔
- **C.** Manufacturing status from Rx.Net to SAP
- **D.** Document download to Rx-MES
- **Explanation:** Scenario defines F1 as order entry with prescription details sent SAP→Rx.Net.
- **Evidence (STRICT):** > F1 is order entry: prescription details are sent from SAP to Rx.Net.
- **Confidence:** 0.809 · **Highest similarity:** 0.093

### At which stage is the job ticket printed in the picking sequence?

- **Question ID:** `01a0e852-2ccd-7aa3-aeee-aa9d12c5a717` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** F5
- **B.** F5.1 ✔
- **C.** F6
- **D.** F8
- **Explanation:** Picking scenario states F5.1 occurs after lens pick and includes job ticket printing.
- **Evidence (STRICT):** > F5.1 follows: once the lens has been picked from the warehouse, the job ticket containing the user requirement details is printed on the print server.
- **Confidence:** 0.923 · **Highest similarity:** 0.102

### Which interface stage includes lens cutting precision details via the calculation service (saturn call)?

- **Question ID:** `01a0e852-2cdf-7996-b483-78a8574497ab` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** F7
- **B.** F8 ✔
- **C.** F10
- **D.** F14
- **Explanation:** Manufacturing/status section identifies F8 as lens cutting stage with calculation service details.
- **Evidence (STRICT):** > F8 is Rx.Net sending prescription details to SAP. This is the stage at which the actual cutting of the lens takes place, and the lens cutting precision details are shared via the calculation service to Rx.Net. The calculation service is also referred to as the saturn call.
- **Confidence:** 0.915 · **Highest similarity:** 0.147

### A document was available but could not be downloaded. Which interface concern does this map to?

- **Question ID:** `01a0e852-2cf0-73d2-9cff-8d1b1f6c9be7` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** F10
- **B.** F14
- **C.** F15 ✔
- **D.** F5
- **Explanation:** Shipment/documents section distinguishes F14 notification vs F15 retrieval/download.
- **Evidence (STRICT):** > F14 is document notification: when a document such as a sticker, WC, DN or FJT becomes available, Rx-MES is notified. F15 relates to downloading the document. The two are sequential - notification that a document exists, then retrieval of it - so a document that cannot be downloaded is an F15 concern while a document nobody was told about is an F14 concern.
- **Confidence:** 0.906 · **Highest similarity:** 0.131

## Tickets SOP's.docx

### For TRISTAR print selection queue issues, what is recommended for the first update attempt?

- **Question ID:** `01a0e850-ff55-72df-a2dd-9962870afb08` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Update all jobs immediately
- **B.** Restart SQL server first
- **C.** Run update query for only one job first, then wait ✔
- **D.** Delete queue rows directly
- **Explanation:** Note says first instance should update only one job and observe clearing behavior.
- **Evidence (STRICT):** > NOTE: For the first instance, run update query for ONLY ONE job then wait for sometime & usually the remaining jobs gets cleared automatically. If the queue does not clear then copy all the JOB NUMBERS from the DB results & clear the queue in one shot !
- **Confidence:** 0.982 · **Highest similarity:** 0.113

### For FUV#5 timeout alert, how is RXCNC login chosen based on machine number parity?

- **Question ID:** `01a0e850-ff69-72db-8c72-409d1690aabd` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Odd -> RXCNC2, Even -> RXCNC1
- **B.** Odd -> RXCNC1, Even -> RXCNC2 ✔
- **C.** Always RXCNC1
- **D.** Always RXCNC2
- **Explanation:** Instruction maps odd machine numbers to RXCNC1 and even to RXCNC2.
- **Evidence (STRICT):** > Check the mail and see the machine number -> if the number is odd (FUVL1) then login to RXCNC1 -> if the number is even (FUVL2) then login to RXCNC2
- **Confidence:** 0.955 · **Highest similarity:** 0.058

### In HN aged WIP label issue handling, what format should excel data follow before regeneration?

- **Question ID:** `01a0e850-ff77-704d-8426-bd8c261d4de5` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Job;DN;Family
- **B.** Track_number ; ST; RX21 ✔
- **C.** Track,Sticker,Date
- **D.** Job,ST,Hostname
- **Explanation:** Step 6 explicitly prescribes this arrangement format.
- **Evidence (STRICT):** > Step 6: Copy the Track numbers and paste them in excel Then you need to arrange excel in the below fashion. Track_number ; ST; RX21
- **Confidence:** 0.985 · **Highest similarity:** 0.094

### To regenerate sticker/delivery/authenticity PDFs in customer service module, which support tool path is used?

- **Question ID:** `01a0e850-ff88-7fc5-9420-bf4e268e5440` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Support tools -> Regenerate PDF Docs(ST,DN,AC) ✔
- **B.** Utilities -> Generate F8 RecomputePowerRequest
- **C.** Orders -> Mass Order Cancellation
- **D.** Support -> Regenerate DD files
- **Explanation:** Section 16 step 8 gives this exact menu path for PDF docs regeneration.
- **Evidence (STRICT):** > Step 8 : Navigate to D/APPS/RXNET/Client/Customer service module select Support tools -> Regenerate PDF Docs(ST,DN,AC) Step 9: Check ST check box -> browse the text file that we saved before -> Click Regenerate
- **Confidence:** 0.957 · **Highest similarity:** 0.074

### If sticker is still not generated after F8 recompute power request, what is the next instructed action?

- **Question ID:** `01a0e850-ff98-7d63-9f08-933b11f78cec` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Restart print server
- **B.** Generate F15 Document for Sticker using track-number file ✔
- **C.** Escalate directly to SAP team
- **D.** Cancel and reimport order
- **Explanation:** Step 4 says run Generate F15 Document -> Select Sticker -> browse track file.
- **Evidence (STRICT):** > If not follow Step 4 Step 4: Again navigate to Utilities->Sap Core Utilities -> Generate F15 Document -> Select Sticker ->Browse the Notepad file containing the Track number -> Click F15 Document.
- **Confidence:** 0.985 · **Highest similarity:** 0.114

### After updating BaseShapeNumberTranscoSetup for RISP and RIVS, what must be done?

- **Question ID:** `01a0e850-ffa7-72af-a66b-6f26919ae94b` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Reboot database server
- **B.** Restart RISP and RIVS services ✔
- **C.** Run SSRS config utility
- **D.** Clear API queue
- **Explanation:** Section explicitly instructs service restart after file updates.
- **Evidence (STRICT):** > Open "BaseShapeNumberTranscoSetup" file move to last line in file add the data as below fashion. 0OO9514;4 (Frame model; TargetBase) -> Save it Open Services -> Restart RISP and RIVS services.
- **Confidence:** 0.924 · **Highest similarity:** 0.090

### For order reintegration, where should XML be pasted if the requested lab is AEL?

- **Question ID:** `01a0e850-ffb6-7cd3-980c-3caf7484e052` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** E/RXNET/Imported Orders
- **B.** E/RXNET/ROUTING ✔
- **C.** E/RXNET/Imported Orders/Failed Orders
- **D.** D/Apps/RxNet/Client/CS client
- **Explanation:** Step 2 differentiates path by lab type; AEL uses ROUTING.
- **Evidence (STRICT):** > Step 2: Check whether the requested lab is AEL lab or not If the lab is AEL lab, then navigate to the path E/RXNET/ROUTING -> Paste the copied file If the lab is not AEL Lab, then navigate to the path E / RXNET / Imported Orders -> Paste the copied file
- **Confidence:** 0.960 · **Highest similarity:** 0.126

## TRACELAB_Support_SOP.docx

### Which is an explicit escalation criterion in TRACELAB SOP?

- **Question ID:** `01a0e850-ff33-7fee-b23b-ae9d01d50300` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Single user impact only
- **B.** API is healthy but functionality fails ✔
- **C.** Issue resolved after restart
- **D.** Job exists in RX.Net
- **Explanation:** Escalation criteria include this exact condition among others.
- **Evidence (STRICT):** > Escalate to L3/Application Team when: API is healthy but functionality fails Application defects are suspected Publish payload errors occur Configuration changes are required
- **Confidence:** 0.885 · **Highest similarity:** 0.118

### What should be identified first before troubleshooting in TRACELAB best practices?

- **Question ID:** `01a0e850-ff44-77f3-9926-966445fc8779` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Whether issue is Input Mode or Publish Mode ✔
- **B.** Whether SQL services are running
- **C.** Whether SSRS binding is old
- **D.** Whether SAP is in maintenance
- **Explanation:** Best practices start with identifying Input vs Publish mode.
- **Evidence (STRICT):** > Always identify whether the issue is related to Input Mode or Publish Mode before troubleshooting. Verify API health before investigating application defects. Confirm the correct production environment is being used.
- **Confidence:** 0.874 · **Highest similarity:** 0.088

## TRACELAB_Support_SOP.md

### Before troubleshooting TRACELAB, what must the engineer identify first?

- **Question ID:** `01a0e852-2bcd-7923-9ca2-1b29ef4bb08a` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Whether issue is P1 or P2
- **B.** Whether it is Input Mode or Publish Mode ✔
- **C.** Which shift is active
- **D.** Which printer is assigned
- **Explanation:** Decision rule mandates mode identification first because it determines API path.
- **Evidence (STRICT):** > The engineer must always identify whether the issue relates to Input Mode or Publish Mode before troubleshooting, because that determines which API is investigated.
- **Confidence:** 0.938 · **Highest similarity:** 0.257

### What are the two expected API health values for TRACELAB integration checks?

- **Question ID:** `01a0e852-2bde-7f84-a71b-620804a529e3` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Health Status = Healthy and HTTP Response = 200 OK ✔
- **B.** Health Status = Running and HTTP Response = 201
- **C.** Health Status = Healthy and HTTP Response = 202
- **D.** Health Status = Active and HTTP Response = 204
- **Explanation:** Threshold section requires both Healthy and 200 OK.
- **Evidence (STRICT):** > Each API health check has two expected values that must both hold: Health Status = Healthy and HTTP Response = 200 OK. This applies to RX-DEVICE-COMMUNICATION for Input Mode incidents and to RX-MFGEVENTS for Publish Mode incidents.
- **Confidence:** 0.835 · **Highest similarity:** 0.087

### What is the minimum supported TRACELAB application version according to thresholds?

- **Question ID:** `01a0e852-2bed-7ae1-ae30-34149fab2eed` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** 1.5.9.9
- **B.** 1.6.0.0
- **C.** 1.6.0.2 or higher ✔
- **D.** 2.0.0.0
- **Explanation:** Threshold explicitly states minimum version 1.6.0.2.
- **Evidence (STRICT):** > The application version must be 1.6.0.2 or higher. A version below that is a configuration finding in its own right.
- **Confidence:** 0.939 · **Highest similarity:** 0.197

### If a TRACELAB job is missing, what is the required action before continuing troubleshooting?

- **Question ID:** `01a0e852-2bfb-7017-a695-1cf1f937613b` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Restart both APIs
- **B.** Coordinate with RX.Net support team ✔
- **C.** Escalate directly to Wintel
- **D.** Close as user error
- **Explanation:** Decision rules require coordination with RX.Net support when job is missing.
- **Evidence (STRICT):** > Where a job is missing, the engineer must coordinate with the RX.Net support team before proceeding rather than continuing to troubleshoot TRACELAB.
- **Confidence:** 0.969 · **Highest similarity:** 0.288

### Which user question determines whether to investigate RX-DEVICE-COMMUNICATION or RX-MFGEVENTS first?

- **Question ID:** `01a0e852-2c09-729f-96b7-d12a44dae35b` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Is printing failing during checkout?
- **B.** Is issue during shape file download (Input) or publishing (Publish)? ✔
- **C.** Is the user in production or pre-production only?
- **D.** Is the machine recently rebooted?
- **Explanation:** Triaging scenario says this direct question is decisive for selecting API investigation path.
- **Evidence (STRICT):** > The decisive triage question is put to the user directly: is the issue occurring while downloading a shape file, which is Input Mode, or while publishing a shape file, which is Publish Mode? The answer selects the API to investigate.
- **Confidence:** 0.924 · **Highest similarity:** 0.065

### During TRACELAB authentication validation, what actions are specified if authentication fails?

- **Question ID:** `01a0e852-2c1a-7350-afd0-d88f07bfe682` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Only escalate immediately
- **B.** Unlock account if applicable, reset credentials if required, and validate permissions ✔
- **C.** Reinstall application first
- **D.** Restart SQL services
- **Explanation:** Scenario lists concrete actions for authentication failure handling.
- **Evidence (STRICT):** > Authentication is confirmed by checking the username, password, account status and authentication success; where authentication fails, the account is unlocked if applicable, credentials are reset if required, and access permissions are validated.
- **Confidence:** 0.948 · **Highest similarity:** 0.130

### Which situation is an explicit escalation trigger to L3 or application team in TRACELAB?

- **Question ID:** `01a0e852-2c28-7622-bc2a-11541ebb113e` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Single user impact only
- **B.** API is healthy but functionality fails ✔
- **C.** Version is above 1.6.0.2
- **D.** Ticket includes complete screenshots
- **Explanation:** Exceptions list this exact condition as requiring escalation.
- **Evidence (STRICT):** > Escalation to L3 or the application team is required in seven situations: the API is healthy but functionality fails, application defects are suspected, publish payload errors occur, configuration changes are required, the issue cannot be reproduced, multiple sites are impacted, or the root cause cannot be determined.
- **Confidence:** 0.932 · **Highest similarity:** 0.391

### Which condition is required before a TRACELAB incident may be closed?

- **Question ID:** `01a0e852-2c37-7ccb-80fe-b0a49ce07093` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Only API health check passed
- **B.** User confirms successful operation ✔
- **C.** Only screenshots collected
- **D.** Multiple sites affected
- **Explanation:** Closure conditions explicitly include user confirmation of successful operation.
- **Evidence (STRICT):** > An incident may be closed when five conditions hold: the user confirms successful operation, shape file retrieval or publishing is functioning correctly, the root cause has been documented, the resolution steps are recorded, and the ticket documentation is complete.
- **Confidence:** 0.960 · **Highest similarity:** 0.198

## TRTF - How to Verify whether the Order reprocessed with HeadCapeAngle.md

### In TRTF HeadCapeAngle verification, what is NOT valid evidence of reprocessing?

- **Question ID:** `01a0e852-2c46-7304-881e-761f03e3cd3d` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Two records including one with null error after reprocessing
- **B.** Observed null error in post-reprocessing record
- **C.** Absence of a new alert alone ✔
- **D.** Query run using customer order ID from TRTF attached file
- **Explanation:** Decision rule states no new alert is not evidence of reprocessing.
- **Evidence (STRICT):** > Confirmation to the Generix team may be given only after the reprocessed record has been inspected and the error value has been observed to be null. The absence of a new alert is not evidence that the order was reprocessed.
- **Confidence:** 0.940 · **Highest similarity:** 0.100

### Where must the customer order identifier come from for the TRTF verification query?

- **Question ID:** `01a0e852-2c55-7c26-889d-b2f3aa4b98c5` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** From alert subject text
- **B.** From Generix email body
- **C.** From TRTF team attached file ✔
- **D.** From previous incident ticket
- **Explanation:** Rule mandates using identifier from TRTF attached file, not reconstructed from alert.
- **Evidence (STRICT):** > The customer order identifier used in the query must be taken from the file attached by the TRTF team rather than assumed or reconstructed from the alert text.
- **Confidence:** 0.910 · **Highest similarity:** 0.187

### What query output pattern confirms TRTF reprocessing occurred?

- **Question ID:** `01a0e852-2c64-7b4d-a40d-9a568e1ba057` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** One record with any non-empty error
- **B.** Two records, with post-reprocessing record showing error = null ✔
- **C.** At least three records for same order
- **D.** No records returned after retry
- **Explanation:** Scenario requires two records and null error in the post-reprocessing one.
- **Evidence (STRICT):** > The output is expected to contain two records for that order. One is the record carrying the error as it stood before reprocessing. The other is the record written after the Generix team processed the order, and in that record the error value is null.
- **Confidence:** 0.951 · **Highest similarity:** 0.107

### When should confirmation be sent to Generix in TRTF verification?

- **Question ID:** `01a0e852-2c73-7e1e-84a2-21e50002b1db` · **Provider:** OPENAI (gpt-5.3-codex_codeassist) · **Status:** DRAFT
- **A.** Immediately after reprocessing request is logged
- **B.** After alert is cleared
- **C.** Only after correct ID query returns two records and post record error is null ✔
- **D.** After one matching record is found
- **Explanation:** Validation criteria define all three required checks before confirming.
- **Evidence (STRICT):** > The verification is complete when three things are true. The query has been executed against the correct customer order identifier taken from the TRTF team's attached file. Two records have been returned for that order. The error value in the record written after reprocessing is null. Only then is the confirmation sent to the Generix team.
- **Confidence:** 0.873 · **Highest similarity:** 0.119
