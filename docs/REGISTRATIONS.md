# OPA - Registrations & External Accounts Tracker

Organized by what actually unblocks what. Owner and Next Action are
included per item so this stays actionable, not just a status list.

Status key: (done) (in progress) (not started) (blocked)

---

## Critical Path - UPDATED 25 July 2026: CAC IS DONE

CAC (RC 9697630, OPA Technologies Limited) - DONE, confirmed directly
by founder. This was previously tracked as PENDING; the file itself
was found silently truncated tonight and is being rebuilt here with
the correct, current status.

CAC -> D-U-N-S Number -> Business Bank / NDPC / Sender ID -> Apple and
Google Developer Org accounts -> Public Mobile Release.

CAC completing unblocks the entire Tier 1 chain below immediately -
these should be started now, not deferred.

---

## Launch Readiness - executive snapshot

- Legal entity: DONE (CAC, RC 9697630)
- Legal documents (Privacy/Terms): draft, pending legal review
- Infrastructure/Deployment: Azure provisioned, production blocked on Sprint 10C (real location-intelligence providers)
- App Stores: unblocked pending D-U-N-S (fire now, CAC is done)
- Emergency Notifications: SMS and WhatsApp both proven live
- Sprint 10A (Incident Portal): substantially built, locally verified
- Sprint 10B (Live Tracking): design in progress, not yet built
- Hospital outreach: fully drafted, not yet sent

---

## TIER 1 - Fire now, CAC is done

**(not started) D-U-N-S Number** - highest-leverage item, unlocks both
Apple and Google Developer Organization accounts. Free, ~1-2 week
issuance. Apply immediately.
- Owner: Charles | Next Action: Apply for D-U-N-S today.

**(not started) Business Banking** - open a corporate account using
the real CAC certificate (RC 9697630).
- Owner: Charles | Next Action: Visit bank with CAC documents.

**(not started) NDPC Registration** - Nigeria Data Protection
Commission, required once processing personal data of 200+ people
within any rolling 6-month window. Needs the CAC certificate and a
Nigerian-resident/citizen Data Protection Officer.
- Owner: Charles | Next Action: Confirm current requirements with counsel.

**(not started) Africa's Talking Custom Sender ID** - production SMS
identity, replacing the current default shared sender. Needs CAC +
signed letters to all four Nigerian telcos.
- Owner: Charles | Next Action: Begin telco letter process now that CAC is done.

---

## App Store Registration - unblocked pending D-U-N-S

**(not started) Apple Developer Program (Organization)** - needs
D-U-N-S. $99/year, ~5 business days to 2 weeks once D-U-N-S exists.
- Owner: Charles | Next Action: Wait for D-U-N-S, then apply.

**(not started) Google Play Console (Organization)** - needs D-U-N-S,
incorporation documents, verified individual government ID. $25 one-time.
- Owner: Charles | Next Action: Wait for D-U-N-S, then apply.

---

## Already Done

- (done) Domain - opasafety.com, registered and DNS correctly configured
- (done) Microsoft 365 mailboxes - all real, confirmed working
- (done) Azure Storage - evidence uploads tested and working
- (done) Azure App Service + PostgreSQL provisioned (South Africa North)
- (done) Website deployed to Vercel, live at opasafety.com
- (done) SMS delivery - Africa's Talking, real message confirmed received
- (done) WhatsApp delivery - Meta Cloud API, real message confirmed received
- (done) CAC registration - RC 9697630, OPA Technologies Limited


---

## Location Services - independent technical decisions

- (not started) Reverse Geocoding - provider decision pending (Sprint 10C)
- (not started) Places Search - hospitals, police, safe places
- (not started) Routing - Sprint 10C blocker, confirmed via boot-time validator

---

## Independent - no CAC dependency, can start anytime

- (not started) Legal review of Privacy Policy and Terms of Service
- (not started) Business liability insurance
- (not started) Google Analytics / Search Console
- (not started) Social media accounts (LinkedIn, X, YouTube)

---

## Explicitly not needed yet - resist starting early

- (not started) Payment gateway (Paystack, Flutterwave) - no billing code exists, no pricing finalized
- (not started) App store enrollment as an individual - would list a personal name instead of "OPA Technologies Limited"; not recommended, D-U-N-S is close via Tier 1

---

## Note on this file's history

This file was found silently truncated on 25 July 2026 (only the
Intellectual Property section remained, 116 lines). Rebuilt from
scratch in small verified chunks, same recovery method used
successfully on SPRINT_ROADMAP.md earlier. CAC status corrected to
DONE (RC 9697630) during the same rebuild - previously tracked as
PENDING.

---

## Intellectual Property

**(not started) Trademark Registration**
Genuinely different from CAC - CAC registers the company entity name;
trademark protects the brand itself with exclusive nationwide rights
in a specific class of use, and stops others from using a confusingly
similar name for similar goods/services.
- Register now, once filed: "OPA," "OPA Technologies Limited," and
  the logo once one is chosen (still an open item).
- Do NOT register speculative future product names (e.g. Journey
  Intelligence-related) before they are genuinely being built.
- Cost: roughly N150,000-N350,000 all-in per class, via a licensed
  agent. Timeline: 8-12+ months. Start promptly now that CAC is done.
- Owner: Charles | Next Action: Engage a trademark agent now.

**(not started) Copyright Strategy**
Copyright exists automatically upon creation - no registration
required. NCC offers optional notification for dated evidence in a
future dispute. Not a launch blocker.
- Owner: Charles | Next Action: Consider NCC notification after MVP launch.

**(not started) Patent Review**
Do not assume OPA needs a patent. Most software companies never
obtain one. Only worth exploring if a genuinely novel, patentable
method is developed. Consult a patent attorney before public
disclosure if something genuinely novel emerges.
- Owner: Charles | Next Action: None now.

**(ongoing) Trade Secrets**
Protected through security practice and confidentiality, not
registration. Applies to detection logic, future AI models/prompts,
risk-scoring, infrastructure architecture, deployment scripts.
- Owner: Charles | Next Action: Maintain access controls as standing practice.

**(not started) Defensive domain registration**
opasafety.com is secured. Consider a small number of closely related
domains only if they genuinely reduce confusion.
- Owner: Charles | Next Action: Low priority; revisit if budget allows.
