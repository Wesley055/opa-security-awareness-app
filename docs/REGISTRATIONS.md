CAC is the single item every other blocked item depends on, directly

or indirectly. Nothing below it can move faster than CAC itself.



\---



\## Launch Readiness — executive snapshot



\- Legal: not started (pending CAC + legal review)

\- Infrastructure/Deployment: not started

\- App Stores: blocked on CAC

\- Emergency Notifications: in progress (SMS verified via Sandbox; Live/production pending)

\- Security Review: not started

\- Privacy Review: draft written, pending legal review

\- Incident Portal: not started (Sprint 10A)



\---



\## Already done



\- (done) Domain — `opasafety.com`, registered and DNS correctly configured

&#x20; - Owner: Charles | Next Action: none

\- (done) Microsoft 365 mailboxes — all real, confirmed working

&#x20; - Owner: Charles | Next Action: none

\- (done) Azure Storage — evidence uploads tested and working

&#x20; - Owner: Charles | Next Action: none



\## In progress right now



\*\*(in progress) CAC (Corporate Affairs Commission)\*\*

Name verified as "OPA Technologies Limited," Private Company Limited

by Shares, ₦1,000,000 share capital. Registration ongoing.

\- Owner: Charles

\- Next Action: Check registration status regularly until certificate is issued — this is the critical-path item.



\*\*(in progress) Meta / WhatsApp Business Platform\*\*

App created; `opa\_emergency\_alert` template submitted under Utility

category; business verification pending.

\- Owner: Charles

\- Next Action: Check verification status; respond promptly to any Meta requests for documentation.



\*\*Africa's Talking\*\*

\- (done) Sandbox API — real credentials, working

\- (done) Live SMS verified through Sandbox credentials — confirmed real delivery tonight

\- (not started) Production Live Account

\- (not started) Production Billing

\- (not started) Custom Sender ID — blocked on CAC + signed letters to all four Nigerian telcos

&#x20; - Owner: Charles

&#x20; - Next Action: Continue Live/KYC steps that don't require full CAC now; hold Sender ID specifically until CAC completes.



\---



\## Blocked on CAC completion — start the moment it finishes



\*\*(blocked) NDPC (Nigeria Data Protection Commission) registration\*\*

Review current NDPC registration requirements before launch — do not

treat any specific threshold as fixed without confirming with current

official guidance or counsel, since regulations can change.

Current planning assumption: registration may become applicable once

operating beyond a small pilot.

\- Owner: Charles (or legal counsel once engaged)

\- Next Action: Confirm current requirements with counsel once CAC completes.



\*\*(blocked) D-U-N-S Number request\*\* (Dun \& Bradstreet)

Free, but only issued once verified against a completed legal entity.

Up to 5 business days once requested. Unblocks both app store

organization accounts below.

\- Owner: Charles

\- Next Action: Request immediately after CAC completes — highest-leverage single step on this list.



\*\*(blocked) Apple Developer Program (organization account)\*\*

Needs D-U-N-S. $99/year. \~5 business days to 2 weeks for approval once D-U-N-S exists.

\- Owner: Charles

\- Next Action: Wait for D-U-N-S.



\*\*(blocked) Google Play Console (organization account)\*\*

Needs D-U-N-S, incorporation documents, a verified individual's

government ID (ideally someone named in CAC registration). $25 one-time.

\- Owner: Charles

\- Next Action: Wait for D-U-N-S.



\*\*(blocked) Business bank account\*\* (Nigerian, company name)

Typically requires the CAC certificate.

\- Owner: Charles

\- Next Action: Open once CAC certificate is issued.



\---



\## Location Services — independent, technical decisions



Not one bundled "Google Maps API" decision — three separate services,

each independently mocked in the current codebase and each needing

its own production integration decision.



\- (not started) Reverse Geocoding — provider decision: Google Maps vs. OpenStreetMap/Nominatim

\- (not started) Places Search — hospitals, police stations, safe places

\- (not started) Routing — route calculations

&#x20; - Owner: Charles

&#x20; - Next Action: Decide provider(s) once Sprint 10C is prioritized; not urgent now.



\---



\## Deployment — operational milestones, cross-reference `docs/TODO.md`



\- (not started) Azure production environment

\- (not started) Production PostgreSQL

\- (not started) Production Redis

\- (not started) TLS certificates

\- (not started) Domain health monitoring

\- (not started) Backup strategy

\- (not started) Incident monitoring

&#x20; - Owner: Charles

&#x20; - Next Action: See `docs/TODO.md` Deployment section for the full sequence — tracked there in detail, referenced here for visibility only.



\---



\## Independent — no CAC dependency, can start anytime



\- (not started) Legal review of Privacy Policy and Terms of Service

&#x20; - Owner: Charles | Next Action: Engage a lawyer, whenever convenient.

\- (not started) Business liability insurance

&#x20; - Owner: Charles | Next Action: Research options ahead of a real pilot.

\- (not started) Google Analytics / Google Search Console

&#x20; - Owner: Charles | Next Action: Set up once website is deployed publicly.

\- (not started) Social media accounts (LinkedIn, X, YouTube)

&#x20; - Owner: Charles | Next Action: Start whenever ready for public-facing presence.



\---



\## Explicitly not needed yet — resist starting early



\- (not started) Payment gateway (Paystack, Flutterwave, etc.) — no

&#x20; billing code exists, no pricing finalized, individual tier is free.

\- (not started) App store enrollment as an individual — technically

&#x20; possible today, but lists a personal name instead of "OPA

&#x20; Technologies Limited" as seller; not recommended.



\---



\## While waiting on CAC



Nothing on this list moves faster than CAC. The best use of the

waiting period is continuing real product work — Sprint 9 Passes 2/3,

Sprint 10A/10B, or `docs/TODO.md`'s deployment items — none of which

are blocked by anything above.

