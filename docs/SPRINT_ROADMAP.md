\# OPA — Sprint Roadmap



\*\*This is the authoritative source of truth for sprint status,

replacing informal "Sprint 5/6" references used inconsistently

earlier in the project.\*\* Every status below was checked against real

code, a real test run, or a real live confirmation — not assumed.

Cross-reference with `docs/TODO.md` for granular open items.



Status key: ✅ Complete \& verified · 🟡 Partial / code real but not

fully functional · ⬜ Not started



\---



\## Phase 1 — Foundation



\*\*Sprint 1 — Project Foundation\*\* ✅

NestJS, PostgreSQL + Prisma, JWT auth foundation, Docker, Swagger,

config validation, structured logging, correlation IDs, global

exception filter. Confirmed real by reading `main.ts`/`app.module.ts`

directly. Basic rate limiting (`ThrottlerModule`, 60 req/60s) is also

confirmed real — previously mislabeled as not started.



\*\*Sprint 2 — Authentication\*\* ✅ (one small gap)

Registration, login, refresh tokens, logout, bcrypt hashing,

validation, secure mobile token storage with auto-refresh, show/hide

password on login. \*\*Gap:\*\* register screen still has no show/hide

toggle.



\*\*Sprint 3 — Emergency Contacts\*\* ✅ (one gap)

Full CRUD, set-primary, phone normalization (Nigerian + international),

tested live. \*\*Gap:\*\* no edit screen — only add/remove/set-primary

exist.



\*\*Sprint 4 — Notification Engine\*\* 🟡 — corrected framing

SMS, Push, and Email are \*\*live and tested\*\* with real delivery. Voice

and WhatsApp are \*\*coded correctly but non-functional today\*\* — this is

one unfinished feature, not "integration complete, activation

pending." WhatsApp needs an approved Meta template; Voice needs a

public webhook endpoint (blocked on deployment). Also open: the

parallel-notifications orchestrator refactor was written once in chat

and never confirmed applied to the real file — treat as not done until

verified. Delivery receipts, retry engine, and idempotency protection

are not built.



\*\*Sprint 5 — Survival Timeline\*\* ✅

Hash-chained, append-only timeline engine, wired into the real

orchestrator, `verify()` endpoint tested to actually catch tampering.



\*\*Sprint 6 — Evidence Engine\*\* ✅ backend / ⬜ mobile

Azure Blob Storage, SHA-256 hashing at upload, short-lived signed

download URLs — all real and tested. Mobile capture (camera, audio,

video) does not exist; nothing on the phone calls this API yet.



\*\*Sprint 7 — Incident Orchestrator\*\* ✅

Full coordinated flow: detection → intelligence → incident creation →

timeline → parallel notification dispatch. Real, tested.



\*\*Sprint 8 — Website\*\* ✅ v1 / corrected from prior draft

\*\*Actually complete:\*\* Homepage (Hero, How It Works, Hospital,

Security, CTA), About, Hospitals, Contact, Privacy Policy (draft),

Terms of Service (draft) — six pages, fully linked, verified live.

\*\*Actually remaining:\*\* dedicated Pilot Partnership page with a

structured form, expanded standalone Security page, FAQ, Cookie

Policy, restrained animations, Azure deployment/DNS/HTTPS/analytics/CI-CD.



\---



\## Phase 2 — Mobile MVP



\*\*Sprint 9 — Emergency Activation\*\* ⬜ \*\*← TODAY\*\*

SOS button, confirmation/countdown UI, cancel action, GPS capture,

wiring to `POST /incident-orchestrator/activate`. The single most

important unbuilt piece of the entire project.



\*\*Sprint 10 — Live Incident View\*\* ⬜

Post-activation status screen, timeline view for the active incident.



\*\*Sprint 11 — Evidence Capture\*\* ⬜

Camera, audio, video, GPS snapshots, offline upload queue against the

real (already-tested) backend Evidence API.



\*\*Sprint 12 — User Profile\*\* ⬜

\*\*Important correction:\*\* medical profile fields (blood type,

allergies, conditions) do not exist anywhere in the database schema.

This sprint needs a schema migration before any mobile UI, not just a

screen.



\---



\## Phase 3 — Command Center



\*\*Sprint 13 — Dashboard Foundation\*\* ⬜

\*\*Sprint 14 — Incident Management UI\*\* ⬜

Backend `Facility` model and access guards are real and tested; no

dashboard UI is currently connected to them.



\---



\## Phase 4 — Deployment



\*\*Sprint 15 — Production Infrastructure\*\* ⬜

\*\*Sprint 16 — Production Hardening\*\* ⬜

Deliberately deferred to its own dedicated session, not squeezed into

other work.



\---



\## Phase 5 — Security Hardening



\*\*Sprint 17\*\* ⬜ (basic rate limiting already real, see Sprint 1)

Penetration testing, MFA, session security, security headers, CSP,

dependency audit — none started.



\---



\## Phase 6 — Pilot



\*\*Sprint 18 — Pilot Execution\*\* ⬜

\*\*Sprint 19 — Pilot Operations\*\* ⬜

Pilot proposal document exists and is current; no outreach has been

sent yet, no hospital has agreed.



\---



\## Phase 7 — Business Operations



\*\*Sprint 20 — Legal\*\* 🟡

CAC registration \*\*in progress\*\* — "OPA Technology Limited" name

verified, Private Company Limited by Shares, ₦1,000,000 share capital,

registration ongoing. Privacy Policy and Terms of Service drafted, both

explicitly marked pending real legal review. Contracts and insurance:

not started.



\*\*Sprint 21 — Sales Operations\*\* ⬜

Pricing strategy exists conceptually (free individual tier,

institutional TBD, diaspora premium) from earlier strategic work; no

pricing page, quotation system, or CRM implementation.



\*\*Sprint 22 — Marketing Assets\*\* 🟡

Pitch deck exists. Demo video \*\*script\*\* exists (not a produced video).

Case study \*\*template\*\* exists, deliberately empty pending a real

pilot. Brochure/one-pager: not started. Website is built but not

deployed publicly yet.



\---



\## Phase 8 — App Store



\*\*Sprint 23\*\* ⬜ — not started, depends on Sprint 9 shipping first.



\---



\## Phase 9 — Market-Ready Documentation



\*\*Sprint 24\*\* 🟡

Company Profile, Architecture Guide, and Security Overview are built

(the Enterprise Kit). User Manual, Admin Guide, Hospital Deployment

Guide, API docs, Ops Manual, DR Plan: correctly not started — these

would document features and processes that don't exist yet.



\---



\## Deliberately deferred — not near-term



Journey Risk Intelligence, Safe Walk/Trip mode, Family Dashboard,

enterprise analytics, AI-based risk detection, international

expansion, government/FRSC data integration, USSD fallback, wearables,

drone/CCTV integration, insurance partnerships.



\---



\## Critical path to a real pilot, in order



1\. \*\*Sprint 9 — Emergency Activation\*\* (today)

2\. Sprint 10 — Live Incident View

3\. Sprint 6 completion — mobile Evidence Capture

4\. Sprint 15/16 — Deployment (unblocks Voice webhook too)

5\. Sprint 13/14 — Command Center reconnected to real backend

6\. Sprint 18 — Pilot outreach actually sent

