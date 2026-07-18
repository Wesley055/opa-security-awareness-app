\# OPA — Sprint Roadmap



\*\*This is the authoritative source of truth for sprint status.\*\*

Every status below was checked against real code, a real test run, or

a real live confirmation — not assumed. Cross-reference with

`docs/TODO.md` for granular open items.



Status key: ✅ Complete \& verified · 🟡 Partial · 🚧 Planned, not started · ⬜ Not started · ⚠️ Needs re-verification



\---



\## A lesson from this session, worth reading before anything else



Tonight's live SOS test discovered that `sms.provider.ts` — real,

tested, and committed weeks ago — had silently reverted to its

original fake stub, and the `africastalking` npm package was missing

entirely. Both were restored and verified. \*\*A file being committed

once is not the same as a file staying correct.\*\* Re-read critical

files with `Get-Content` before trusting their status, especially

anything on the SOS activation path.



\## Verified during this session — a permanent audit trail



Confirmed through live testing, on a real device, against the real backend:

\- ✅ Device GPS capture and accuracy

\- ✅ Incident creation

\- ✅ SMS delivery through Africa's Talking Sandbox — a real message arrived on a real phone with correct content

\- ✅ Google Maps navigation using real coordinates (replacing a previously fabricated address)



Identified during the same session:

\- ❌ `GeocodingProvider` — confirmed mock, was leaking fabricated

&#x20; location text into real SMS messages; fixed

\- ❌ `PlacesProvider` — confirmed mock

\- ⚠️ `RoutingProvider` — confirmed mock (called with zero arguments)

\- ⚠️ Push notifications and Email — fired in parallel with the SMS

&#x20; that was verified, but not individually confirmed delivered; treat

&#x20; as unverified until checked directly

\- ⚠️ Incident portal — does not exist; `trackingUrl` currently points

&#x20; at nothing



\---



\## Phase 1 — Foundation



\*\*Sprint 1 — Project Foundation\*\* ✅

\*\*Sprint 2 — Authentication\*\* ✅ (register screen still has no show/hide toggle)

\*\*Sprint 3 — Emergency Contacts\*\* ✅ (no edit screen; phone normalization defaults unrecognized numbers to +234)

\*\*Sprint 4 — Notification Engine\*\* 🟡 — see Feature Readiness Matrix for per-channel status

\*\*Sprint 5 — Survival Timeline\*\* ✅

\*\*Sprint 6 — Evidence Engine\*\* ✅ backend / ⬜ mobile

\*\*Sprint 7 — Incident Orchestrator\*\* ✅

\*\*Sprint 8 — Website\*\* ✅ v1



\---



\## Phase 2 — Mobile MVP



\*\*Sprint 9 — Emergency Activation\*\* 🟡



\- \*\*Pass 1 (SOS Button):\*\* ✅ Verified — real countdown, real GPS,

&#x20; real API call, real incident created, real SMS delivered and

&#x20; confirmed received. \*\*Not yet tested:\*\* the Cancel path during

&#x20; countdown, permission-denied and network-failure error paths,

&#x20; repeated/back-to-back activations.

\- \*\*Pass 2 (Voice — "Help Help"):\*\* ⬜ Not started.

\- \*\*Pass 3 (Custom trigger phrase):\*\* ⬜ Not started.



\*\*Deliverables in Pass 1, all confirmed working:\*\*

SOS button, confirmation countdown, device GPS + accuracy, incident

creation, SMS delivery, Google Maps navigation link using real

coordinates.



\*\*Deliberately not in Pass 1, by design:\*\*

address/cross-street/landmark (Sprint 10C), movement/compass direction

(Sprint 10B), live incident page (Sprint 10A).



\---



\### Sprint 10A — Incident Portal 🚧



The first step toward making OPA's own page the responder's primary

destination, not a bare map link.



\*\*Build:\*\* a public page at `https://opasafety.com/incidents/{id}`

showing only verified information — incident status, activation time,

trigger type, latitude/longitude, GPS accuracy, last-update timestamp,

incident ID, and an "Open in Google Maps" button. No placeholders, no

estimated address, no fake movement.



\*\*Reliability requirement:\*\* critical incident information (status,

location, time) must be server-rendered, not dependent on client-side

JavaScript loading successfully. A responder or family member opening

this under stress, possibly on a weak connection, must see the basic

facts immediately regardless of script load success.



\*\*Notification format once this ships:\*\*

