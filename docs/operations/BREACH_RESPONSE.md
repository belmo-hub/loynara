# Personal-data breach response

Prepared 15 October 2026 for LOY-209. Procedure and blank templates only; no messages have been sent. Operator legal identity, processing agreement, controller/processor allocation, competent authority and private contact roster require owner/legal confirmation before launch. The [approved retention policy](RETENTION_POLICY_PROPOSAL.md) does not suspend incident duties; production deletion still requires the separate activation process.

## Roles and escalation

The private roster must assign a primary and alternate for each named role, with a tested contact route:

| Role | Responsibility |
| --- | --- |
| Incident Lead | Open case, coordinate containment, preserve UTC timeline, ensure deadlines and handover. |
| Technical Response Owner | Restrict exposure, revoke compromised access through approved procedures, establish affected systems/window and recovery evidence. |
| Privacy Lead / appointed DPO where applicable | Assess personal-data impact, advise on authority/individual notification and document reasoning. |
| Controller Decision Owner | Make and record the controller's notification decisions; ensure authorized timely submission. |
| Merchant Communications Owner | Verify each affected merchant's contact, prepare separate factual notices and track receipt/updates without cross-tenant disclosure. |
| Evidence Custodian | Restrict evidence access, preserve integrity/access history and set a justified review/retention date. |

Working assumption requiring contractual confirmation: each merchant is controller for its customer loyalty processing; Loynara acts as processor on that merchant's instructions. Loynara may separately be controller for its own account/business processing. Assess each affected processing purpose rather than treating every record as one role. A processor alerts each affected controller without undue delay; the controller retains notification responsibility. Do not wait for a complete risk assessment before alerting a controller. [EDPB Guidelines 9/2022, sections II.A.3–4](https://www.edpb.europa.eu/system/files/2023-04/edpb_guidelines_202209_personal_data_breach_notification_v2.0_en.pdf).

## Timeline and notification decisions

Record suspicion, first detection and **awareness** separately. Awareness is a reasonable degree of certainty that a security incident compromised personal data; do not delay the clock by waiting for a full forensic report. The controller notifies the competent supervisory authority without undue delay and, where feasible, within **72 hours of awareness**, unless unlikely to risk individuals' rights/freedoms. Explain delay if late; provide missing information in phases without undue further delay. [EDPB Guidelines 9/2022, sections II.A–C](https://www.edpb.europa.eu/system/files/2023-04/edpb_guidelines_202209_personal_data_breach_notification_v2.0_en.pdf).

| When | Operational action |
| --- | --- |
| Immediately | Page Incident Lead/alternate and Privacy Lead; record UTC times, secure affected access and preserve minimal evidence. Use [incident containment](INCIDENT_ROLLBACK.md). |
| Initial target: within 1 hour of confirmed breach | Processor provides the affected controller an initial factual notice through its verified channel. This internal target is not permission to wait or a replacement for a shorter contractual obligation. |
| Initial target: within 24 hours | Controller Decision Owner records initial risk, authority/contact route, notification decision, unresolved facts and next review. Start any required submission sooner when ready. |
| Statutory clock | Monitor the 72-hour deadline continuously, including weekends. If details remain incomplete, use an initial notification and follow-up; do not wait for release approval, recovery or merchant reply. |
| Throughout / after recovery | Reassess as facts change; track each notice/update and receipt. Record a reasoned no-notification decision where applicable and reopen it when evidence changes. |

High-risk breaches require the controller to inform affected individuals without undue delay, using clear language; Article 34 exceptions need a documented case-specific assessment. Record every personal-data breach, including facts, effects, remedial action and notification reasoning. Consider confidentiality, integrity **and availability**, and risks from bearer card links, contact data, balances, staff accounts and backups. Pseudonymous identifiers remain potentially personal data; “no names” is not a no-risk conclusion. [EDPB small-business breach guidance](https://www.edpb.europa.eu/sme/assess-the-risks/data-breaches_en), [GDPR Articles 4(12), 28, 32–34](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng).

The Privacy Lead confirms the competent authority using the actual establishment, processing and cross-border facts and the [official supervisory-authority directory](https://www.edpb.europa.eu/about-edpb/about-edpb/members_en). Do not assume a single German authority or one-stop-shop eligibility. Keep current submission/contact details in the private roster. Obtain legal advice promptly without using that dependency to postpone mandatory notification.

## Evidence and recovery

Limit investigation to authorized access. Store evidence in a restricted incident location outside this repository and public tickets. Preserve originals and checksums/access history where appropriate; use sanitized summaries for collaboration. Do not export a production database for debugging or attach secrets, raw URLs, message bodies, contact lists or tokens. Preserve only relevant evidence under a documented purpose and review date; an incident is not a blanket hold on all customer history.

Containment may include disabling an exposed route, revoking sessions or scoped credentials and stopping outbound delivery. Record changes and uncertain remote effects. Coordinate key rotation and service recovery so historical deployment variables cannot reintroduce a compromised secret. Restore only through an approved isolated recovery plan. Do not erase evidence or alter ledger history to hide the incident.

## Private case template

Copy this blank form to the restricted incident system; never fill real evidence into Git:

```text
Case ID / severity / Incident Lead and alternate:
Detected UTC / suspected start-end UTC / awareness UTC and basis:
Affected controller(s) / processing role / verified contact route:
Systems, deployments, full source SHAs and configuration revision:
Breach type: confidentiality / integrity / availability:
Data and subject categories / approximate records and persons / uncertainty:
Likely consequences, affected credentials and mitigating protections:
Containment actions, owners, UTC times and verification:
Evidence location, integrity record, authorized viewers and review date:
Controller alerted UTC / recipient / acknowledgment / contractual clock:
Risk assessment / authority decision and reasons / decision owner:
72-hour due UTC / submission UTC / reference / delay explanation:
Individual-notice decision, channel, content approval and dispatch evidence:
Facts still unknown / next update UTC / follow-up submissions:
Recovery validation / unresolved remote outcomes / corrective actions:
Case closure approver/date / evidence retention or specific legal hold:
```

## Initial merchant notice template — draft, do not send automatically

```text
Subject: [Initial / update] personal-data incident — [case reference]
To: [verified authorized merchant contact]

We became aware on [UTC date/time] of [brief factual incident description]
affecting [your service/processing scope] during [known or estimated window].
Our current assessment is [confirmed facts]; [specific facts] remain unknown.
Potentially affected data: [categories and approximate persons/records].
Possible consequences: [supported assessment, with uncertainty stated].
Actions taken/proposed: [containment and mitigation, times, current status].
Action requested from you: [specific protective action / none identified yet].
Please involve your controller decision contact to assess regulatory and
individual notification duties. We will assist with available evidence.
This update does not establish that notification is unnecessary.

Incident contact: [approved contact name/role and route].
Next update: [UTC date/time], including if investigation is still ongoing.
```

The Controller Decision Owner and Privacy Lead adapt any authority/individual notice to the applicable requirements. Required notice content includes the nature/scope, contact point, likely consequences and measures taken/proposed. Merchant updates do not replace authority or individual notices. Never state “no data accessed”, “fully deleted” or “resolved” without supporting evidence. Official legal sources reviewed 15 October 2026; review again when roles or processing jurisdictions change.
