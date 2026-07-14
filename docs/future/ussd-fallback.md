\# USSD Fallback — Future Design Note



\*\*Status: design captured, not implemented. Deliberately deferred —

see roadmap below.\*\*



\## Purpose



A fallback SOS channel for situations with cellular signal but no

mobile data — distinct from, and complementary to, offline mode.



\## Fallback decision tree

\## Why this is not offline mode, and doesn't replace it



USSD still requires:

\- Active cellular signal

\- A supported mobile network

\- A registered short code via a telecom or aggregator (e.g. Africa's

&#x20; Talking) — this requires formal approval, not something to assume

&#x20; or hardcode ahead of time

\- An active session, typically capped around 2â€“3 minutes



Zero connectivity still needs the offline queue regardless of USSD.



\## Security constraints for any future implementation



Do not transmit evidence, detailed medical records, or long location

payloads over USSD — session and channel security don't support it.

Keep any USSD-triggered incident minimal: confirm location/community,

create a bare incident record, send a short confirmation. Full detail

still flows through the real API once connectivity allows.



\## Prerequisite before implementation



A telecom or aggregator short-code agreement. No specific code (e.g.

`\*XXX#`) should be assumed or referenced in code until one is actually

allocated through that process.



\## Where this sits in the roadmap



Deliberately last:

1\. Backend integration (timeline, evidence, facility) — \*\*done\*\*

2\. React Native app, connected to the real backend — next

3\. Pilot with smartphone users

4\. Strengthen offline capture and sync

5\. USSD — once there's a validated product and a real telecom

&#x20;  partnership, not before



