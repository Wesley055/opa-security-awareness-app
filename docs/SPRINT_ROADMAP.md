\# OPA — Sprint Roadmap



\*\*This is the authoritative source of truth for sprint status.\*\*

Every status below was checked against real code, a real test run, or

a real live confirmation — not assumed. Cross-reference with

`docs/TODO.md` for granular open items.



Status key: ✅ Complete \& verified · 🟡 Partial / code real but not

fully functional · ⬜ Not started



\---



\## A lesson from this session, worth reading before anything else



Tonight's live SOS test discovered that `sms.provider.ts` — real,

tested, and committed weeks ago — had \*\*silently reverted to its

original fake stub\*\*, along with the `africastalking` npm package

being missing entirely. This wasn't caught by any build or test,

because the stub was itself valid, passing code — it just did the

wrong thing. \*\*A file being committed once is not the same as a file

staying correct.\*\* Before trusting any previously-verified file

tonight, this session, or in the future — especially anything on the

SOS activation path — re-read the real file with `Get-Content` first,

the same discipline used everywhere else in this project, rather than

trusting an old status.



\---



\## Phase 1 — Foundation



\*\*Sprint 1 — Project Foundation\*\* ✅

NestJS, PostgreSQL + Prisma, JWT auth foundation, Docker, Swagger,

config validation, structured logging, correlation IDs, global

exception filter, basic rate limiting (`ThrottlerModule`, 60 req/60s).



\*\*Sprint 2 — Authentication\*\* ✅ (one small gap)

Registration, login, refresh tokens, logout, bcrypt hashing,

validation, secure mobile token storage with auto-refresh, show/hide

password on login. \*\*Gap:\*\* register screen still has no show/hide

toggle.



\*\*Sprint 3 — Emergency Contacts\*\* ✅ (two gaps)

Full CRUD, set-primary, phone normalization, tested live. \*\*Gaps:\*\* no

edit screen (add/remove/set-primary only); phone normalization

defaults any unrecognized-prefix number to +234, which can silently

mis-normalize a foreign number typed without its country code — a

real, small bug, not yet fixed.



\*\*Sprint 4 — Notification Engine\*\* 🟡 — updated with tonight's findings

SMS, Push, and Email dispatch code is real. WhatsApp is coded but

non-functional (no approved Meta template). Voice is coded but

non-functional (no public webhook endpoint).



\*\*Confirmed tonight:\*\* the parallel-notifications orchestrator refactor

(SMS + WhatsApp + Email sent concurrently, not sequentially) is real

and tested — proven by a live test failure that expected the old

sequential call count, then corrected. This item can move from

"unconfirmed" to genuinely done.



\*\*Also discovered and fixed tonight:\*\* `sms.provider.ts` had reverted

to a fake stub (see lesson above) — restored to the real Africa's

Talking integration. The `africastalking` npm package was missing

entirely — installed. \*\*SMS is coded correctly again, but still not

actually delivering\*\* — `AFRICASTALKING\_API\_KEY`/`AFRICASTALKING\_USERNAME`

are not set; the Africa's Talking account has not been created yet.

This is genuinely external account setup, not a code task — see Sprint

20 for the Sender ID dependency on CAC completion specifically (a

working API key/basic sending does not require full CAC completion;

only a custom branded Sender ID does).



\*\*Also discovered and fixed tonight:\*\* `EmergencyIntelligenceService`'s

fake `GeocodingProvider` cross-street/address text was being sent

inside real SMS/email messages to real emergency contacts. Fixed —

messages now include a real, tappable Google Maps link built from

actual GPS coordinates instead.



Delivery receipts, retry engine, and idempotency protection are still

not built.



\*\*Sprint 5 — Survival Timeline\*\* ✅

Hash-chained, append-only timeline engine, wired into the real

orchestrator, `verify()` endpoint tested to actually catch tampering.



\*\*Sprint 6 — Evidence Engine\*\* ✅ backend / ⬜ mobile

Azure Blob Storage, SHA-256 hashing, short-lived signed download URLs

— real and tested. Mobile capture does not exist.



\*\*Sprint 7 — Incident Orchestrator\*\* ✅ (strengthened tonight)

Full coordinated flow, real and tested. Tonight's fixes (real SMS

provider restored, fake location text removed) both live inside this

sprint's code.



\*\*Sprint 8 — Website\*\* ✅ v1

Six pages live and linked. Remaining: Pilot Partnership page, expanded

Security page, FAQ, Cookie Policy, animations, Azure deployment.



\---



\## Phase 2 — Mobile MVP



\*\*Sprint 9 — Emergency Activation\*\* 🟡 \*\*← Pass 1 built and live-tested once\*\*



\- \*\*Pass 1 (button):\*\* 🟡 Built, verified structurally (`tsc` clean),

&#x20; and \*\*run live once, successfully\*\* — real countdown, real GPS

&#x20; permission and capture, real API call, real incident created in the

&#x20; database with a real ID, real notification pipeline triggered.

&#x20; \*\*Not yet tested:\*\* the Cancel path during countdown, error-handling

&#x20; paths (denied permission, network failure), and repeated/back-to-back

&#x20; activations. \*\*Blocked from full end-to-end proof:\*\* actual SMS

&#x20; delivery, pending Africa's Talking credentials (see Sprint 4).

\- \*\*Pass 2 (voice, default phrase):\*\* ⬜ not started.

\- \*\*Pass 3 (custom phrases):\*\* ⬜ not started.



\*\*Sprint 10 — Live Incident View\*\* ⬜

10A (continuous tracking) and 10B (the

