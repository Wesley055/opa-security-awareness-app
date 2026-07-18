# OPA - Sprint Roadmap

**This is the authoritative source of truth for sprint status.**
Every status below was checked against real code, a real test run, or
a real live confirmation - not assumed. Cross-reference with
docs/TODO.md for granular open items.

Status key: DONE = Complete and verified - PARTIAL = Partial -
PLANNED = Planned, not started - NOT STARTED - VERIFY = Needs re-verification

---

## A lesson from this session

This file was silently truncated at some point tonight, and multiple
"confirmed complete" checks on it were based on unreliable document
attachments, not genuine verification. From now on: verify long file
content via plain-text paste in chat, not attachments. Use a guarded
PowerShell replace that checks find-text exists before writing. Write
and paste large content in small chunks, not one giant block.

## Verified during this session

Confirmed through live testing, on a real device, against the real backend:
- Device GPS capture and accuracy - DONE
- Incident creation - DONE
- SMS delivery through Africa's Talking Sandbox - DONE, a real message arrived on a real phone
- Google Maps navigation using real coordinates - DONE

Identified during the same session:
- GeocodingProvider - confirmed mock, was leaking fabricated location text into real SMS; fixed
- PlacesProvider - confirmed mock
- RoutingProvider - confirmed mock, called with zero arguments
- Push and Email - fired in parallel with the verified SMS, not individually confirmed
- Incident portal - does not exist; trackingUrl points at nothing

---

## Phase 1 - Foundation

**Sprint 1 - Project Foundation** - DONE
**Sprint 2 - Authentication** - DONE (register screen still has no show/hide toggle)
**Sprint 3 - Emergency Contacts** - DONE (no edit screen; phone normalization defaults unrecognized numbers to +234)
**Sprint 4 - Notification Engine** - PARTIAL, see Feature Readiness Matrix for per-channel status
**Sprint 5 - Survival Timeline** - DONE
**Sprint 6 - Evidence Engine** - DONE backend / NOT STARTED mobile
**Sprint 7 - Incident Orchestrator** - DONE
**Sprint 8 - Website** - DONE v1

---

## Phase 2 - Mobile MVP

**Sprint 9 - Emergency Activation** - PARTIAL

- Pass 1 (SOS Button) - DONE - real countdown, real GPS, real API
  call, real incident created, real SMS delivered and confirmed
  received. Not yet tested: the Cancel path, permission-denied and
  network-failure error paths, repeated activations.
- Pass 2 (Voice - "Help Help") - NOT STARTED
- Pass 3 (Custom trigger phrase) - NOT STARTED

Deliberately not in Pass 1, by design: address/cross-street/landmark
(Sprint 10C), movement/compass direction (Sprint 10B), live incident
page (Sprint 10A).

---

### Sprint 10A - Incident Portal - PLANNED

Build a public page at https://opasafety.com/incidents/{id} showing
only verified information - incident status, activation time, trigger
type, latitude/longitude, GPS accuracy, last-update timestamp,
incident ID, and an "Open in Google Maps" button. No placeholders, no
estimated address, no fake movement. Reliability requirement:
critical incident information must be server-rendered, not dependent
on client-side JavaScript loading successfully.

### Sprint 10B - Live Tracking - PLANNED

Continuous GPS updates, last known location, automatic refresh, GPS
history, movement detection, bearing calculation, compass conversion,
route visualization, offline buffering synchronization.

### Sprint 10C - Location Intelligence - PLANNED

Only after PlacesProvider, GeocodingProvider, and RoutingProvider are
replaced with real, validated production integrations.

---

**Sprint 11 - Evidence Capture** - NOT STARTED
**Sprint 12 - User Profile** - NOT STARTED, medical fields need a schema migration first, confirmed absent from the database.

---

## Phase 3 - Command Center
**Sprint 13 - Dashboard Foundation** - NOT STARTED
**Sprint 14 - Incident Management UI** - NOT STARTED
Backend Facility model and access guards are real and tested; no
dashboard UI is currently connected to them.

## Phase 5 - Security Hardening
**Sprint 17** - NOT STARTED (basic rate limiting already real, ThrottlerModule confirmed in app.module.ts)

## Phase 6 - Pilot
**Sprint 18 - Pilot Execution** - NOT STARTED
**Sprint 19 - Pilot Operations** - NOT STARTED

## Phase 7 - Business Operations
**Sprint 20 - Legal** - PARTIAL, CAC registration in progress. A working
Africa's Talking API key does not require CAC completion - only a
custom branded Sender ID does.
**Sprint 21 - Sales Operations** - NOT STARTED
**Sprint 22 - Marketing Assets** - PARTIAL

## Phase 8 - App Store
**Sprint 23** - NOT STARTED

## Phase 9 - Market-Ready Documentation
**Sprint 24** - PARTIAL, Enterprise Kit built.

---

## Phase 4 - Deployment

**Sprint 15 - Production Infrastructure** - PARTIAL, in progress

### Phase A - Immediate, before hospital outreach

Goal: make opasafety.com publicly accessible and professional.
Backend deployment is not a dependency for this phase.

Website hosting:
- [ ] Deploy Next.js website to Vercel (Azure Static Web Apps ruled
      out - App Router support confirmed still in preview, with
      documented production failures)
- [ ] Verify all six pages load publicly
- [ ] Verify HTTPS certificate
- [ ] Verify mobile responsiveness
- [ ] Verify page titles and metadata
- [ ] Verify all navigation links
- [ ] Verify the mailto info@opasafety.com button opens correctly

Domain:
- [ ] Connect opasafety.com to Vercel
- [ ] Preserve all Microsoft 365 DNS records (MX/SPF/DKIM/DMARC)
- [ ] Verify DNS propagation
- [ ] Verify www.opasafety.com redirects correctly

Production verification:
- [ ] Test from an external network
- [ ] Test on desktop
- [ ] Test on mobile
- [ ] Confirm no localhost references remain
- [ ] Confirm no placeholder content remains

Milestone: public website ready for hospital outreach - ACHIEVED.
opasafety.com is live on Vercel, DNS connected via one clean CNAME
record (Microsoft 365 email records confirmed untouched), verified
working on mobile data, all six pages confirmed, mailto button
confirmed working. Achieved this session.

### Phase B - Production API, before the first real pilot

Goal: deploy the backend for real pilot usage. Not required to send
outreach - only required once a hospital says yes.

- [ ] Azure App Service provisioned for the backend API
- [ ] Azure Database for PostgreSQL provisioned
- [ ] Existing Azure Storage account confirmed live; verify production
      application integration, access controls, and networking
- [ ] Real production JWT_ACCESS_SECRET / JWT_REFRESH_SECRET generated
      - current values are named "change-later"
- [ ] All development secrets removed from production config
- [ ] prisma migrate deploy run against the real production database
- [ ] Database connectivity verified
- [ ] NestJS API deployed
- [ ] Health endpoint verified
- [ ] Authentication verified end-to-end in production
- [ ] api.opasafety.com created and pointed at Azure App Service
- [ ] SSL verified on api.opasafety.com
- [ ] CORS / ALLOWED_ORIGINS updated for the real API URL
- [ ] Mobile app's API_BASE_URL pointed at the deployed backend, full
      login -> contacts -> SOS flow re-tested live against it

Milestone: production API available for pilot customers.

**Sprint 16 - Production Hardening** - NOT STARTED
Full penetration testing, security headers, dependency audit,
disaster recovery, backup strategy - deferred until Phase A/B are live.

---

## Deliberately deferred - not near-term

Journey Monitoring (traffic and incident awareness) - design agreed,
see docs/TODO.md "Journey Intelligence (Future)" section for full
detail. Do not start before Sprint 10B exists. Also deferred: Safe
Walk/Trip mode, Family Dashboard, enterprise analytics, international
expansion, government/FRSC integration, USSD fallback, wearables,
drone/CCTV, insurance partnerships, Guardian (undefined placeholder),
Enterprise fleet monitoring (concept only).

---

## Feature Readiness Matrix

| Capability | Status |
|---|---|
| Device GPS + accuracy | DONE - live tested |
| Incident creation | DONE - live tested |
| SMS delivery | DONE - live tested, real message received |
| Google Maps navigation | DONE - live tested |
| Push notifications | VERIFY - fired in parallel, not individually confirmed |
| Email delivery | VERIFY - fired in parallel, not individually confirmed |
| WhatsApp delivery | PLANNED - blocked on Meta template approval |
| Voice delivery | PLANNED - blocked on a public webhook |
| Diaspora SMS (non-Nigerian numbers) | NOT STARTED - Africa's Talking Sandbox confirmed rejecting a US number; Twilio identified as the real fix, see Phase 4 |
| Incident portal | PLANNED - Sprint 10A |
| Live tracking | PLANNED - Sprint 10B |
| Command Center | NOT STARTED - Sprint 13/14 |

---

## Critical path to a real pilot, in order

1. Phase A - deploy website to Vercel, connect opasafety.com
2. Send real hospital outreach (Lagoon Hospitals, Reddington, Eko, St. Nicholas - all confirmed in Lagos)
3. Verify Push and Email delivery individually
4. Test SOS Cancel and error-handling paths
5. Sprint 10A - Incident Portal
6. Twilio integration for diaspora SMS
7. Sprint 9 Pass 2 - Voice trigger
8. Sprint 10B - Live tracking
9. Phase B - Production API deployment
10. Sprint 13/14 - Command Center reconnected

