# Network Incident Escalation

This procedure governs how the frontline support team classifies and escalates a
network incident. It applies to every customer-facing network fault reported
through the service desk, the monitoring platform, or a direct call from a
customer's own operations team. Frontline agents are accountable for
classification; the duty manager is accountable for escalation beyond the team.

## Severity Classification

Severity is decided by customer impact, not by the technical cause. An agent
classifies an incident within ten minutes of the first report, and records the
classification in the ticket before any diagnostic work begins.

Severity one means a total loss of service affecting more than one customer
site, or any loss of service at a site designated as critical in the customer
register. Severity two means a partial loss of service, or a total loss at a
single non-critical site, where a documented workaround exists. Severity three
covers degraded performance with no loss of service, and severity four covers
requests for information and scheduled work.

An agent may raise a severity at any time as new information arrives. Only the
duty manager may lower a severity, and the reason must be recorded in the
ticket. This asymmetry is deliberate: under-classification is the failure mode
that causes missed commitments, so the cautious direction is unrestricted.

## Escalation Timings

A severity one incident pages the on-call network engineer immediately and the
duty manager within fifteen minutes. If the on-call engineer has not
acknowledged the page within ten minutes, the agent pages the secondary
on-call engineer and informs the duty manager that the primary did not respond.

A severity two incident is assigned to the network queue and must be picked up
within thirty minutes during business hours, or within two hours outside them.
A severity three incident is worked during business hours only and carries no
paging obligation. Severity four work is scheduled through the weekly planning
meeting.

Escalation to the vendor is the network engineer's decision, never the agent's.
The agent's obligation ends at paging the right person and recording the time
at which each page was sent.

## Customer Communication

The agent sends the first customer update within thirty minutes of classifying a
severity one incident, and every sixty minutes thereafter until service is
restored. Updates state what is known, what is being done, and when the next
update will arrive. An update never speculates about a cause, and never names an
individual engineer or a vendor.

For a severity two incident, the first update goes out within two hours and
subsequent updates arrive every four hours. Severity three and four incidents
are updated when the work state changes.

## Handover

At the end of a shift the agent hands over every open incident above severity
three verbally and in the ticket. The written handover records the current
severity, the last customer update time, the next update commitment, and the
name of the engineer currently engaged. An incident is never handed over by
ticket alone, because a commitment the receiving agent does not know about is a
commitment that will be missed.
