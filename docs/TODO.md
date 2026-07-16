\# OPA — Working To-Do List



\*\*Last updated:\*\* this session. Read this before assuming anything is

done — verify against real files/tests, same as everything else in

this project.



\## In progress right now



\- \[ ] \*\*WhatsApp Business (Meta) registration\*\* — you're doing this now.

&#x20;     Steps: create Business app at developers.facebook.com → add

&#x20;     WhatsApp product → test with the 5 free registered numbers using

&#x20;     `hello\_world` → submit `opa\_emergency\_alert` template under

&#x20;     \*\*Utility\*\* category (not Marketing) → complete business

&#x20;     verification (2–10 business days) → generate a permanent System

&#x20;     User token → add `WHATSAPP\_ACCESS\_TOKEN` and

&#x20;     `WHATSAPP\_PHONE\_NUMBER\_ID` to `.env`.



\## Immediate next step — finish what's already coded, don't skip verification



\- \[ ] \*\*Confirm the parallel-notifications orchestrator refactor actually builds and passes tests.\*\*

&#x20;     The code is written (`incident-orchestrator.service.ts` — parallel

&#x20;     `Promise.all` sends, sequential timeline writes, WhatsApp channel

&#x20;     added) but `npm run build` / `npx jest --runInBand` was never run

&#x20;     against it. The test file also needs its

&#x20;     `expect(notificationService.sendEmergencyAlert).toHaveBeenCalledTimes(2)`

&#x20;     assertion updated to `3` (SMS + WhatsApp + Email) before it will

&#x20;     pass.

\- \[ ] Commit that work once confirmed clean.



\## Deployment — next session's main focus



\- \[ ] Provision Azure App Service (or Container Apps) for the API

\- \[ ] Provision Azure Database for PostgreSQL (managed) — expect to need

&#x20;     `?sslmode=require` on the connection string, which local dev never needed

\- \[ ] Generate real production `JWT\_ACCESS\_SECRET` / `JWT\_REFRESH\_SECRET`

&#x20;     — current values are literally named "change-later," don't carry

&#x20;     them into production

\- \[ ] Run `prisma migrate deploy` against the new production database

\- \[ ] Update `ALLOWED\_ORIGINS` / CORS for the real API URL

\- \[ ] Point the mobile app's `API\_BASE\_URL` at the deployed URL instead

&#x20;     of the local IP, and re-test the full login → contacts flow live

&#x20;     against it

\- \[ ] Only once this exists: Voice's webhook becomes testable for real

&#x20;     (Africa's Talking needs a public HTTPS URL — local/tunnel URLs

&#x20;     don't count)



\## Real, known gaps — not urgent, not forgotten



\- \[ ] \*\*Idempotency protection against duplicate notification sends\*\* —

&#x20;     nothing currently stops the same alert firing twice if a request

&#x20;     gets retried at the HTTP layer. Genuine gap, worth its own design

&#x20;     pass.

\- \[ ] \*\*No edit screen for emergency contacts\*\* — create, list, delete,

&#x20;     and set-primary are all built and tested; updating an existing

&#x20;     contact's details isn't (only remove-and-re-add works today).

\- \[ ] \*\*Register screen has no show/hide password toggle\*\* — login got

&#x20;     one, register didn't, worth adding for consistency.

\- \[ ] \*\*Nigeria-only account registration\*\* (`RegisterDto`'s

&#x20;     `@IsPhoneNumber('NG')`) — deliberately left as-is. Relaxing this

&#x20;     for diaspora self-registration needs a real answer for

&#x20;     non-Nigerian SMS delivery first (Africa's Talking is

&#x20;     Nigeria-optimized); don't just loosen the validator without that.

\- \[ ] \*\*Family Dashboard / parent-monitoring\*\* — real, valuable idea

&#x20;     (someone abroad wanting live visibility into a family member's

&#x20;     safety status), needs its own consent/linking/permission design.

&#x20;     Not yet written up in `docs/future/` — do that before building

&#x20;     any part of it.

\- \[ ] \*\*Direction-of-travel / movement intelligence\*\* — architecture

&#x20;     exists (`EmergencyIntelligenceService`), but `PlacesProvider` is

&#x20;     an explicitly self-labeled mock returning hardcoded fake

&#x20;     locations, and no bearing-to-compass conversion exists anywhere.

&#x20;     See docs/architecture/emergency-intelligence-engine.md for the

&#x20;     full breakdown of what's real vs. mocked. Do not add to the

&#x20;     website, even as "Planned," until genuinely built and verified.

\- \[ ] \*\*Mobile evidence capture (audio/video/photo)\*\* — backend Evidence

&#x20;     API is real and tested (Azure Blob, SHA-256, SAS URLs); the

&#x20;     mobile client that would actually record and upload it does not

&#x20;     exist. Design already scoped: tiered levels (GPS/timeline first,

&#x20;     opt-in audio next, video/photo last), audio prioritized over

&#x20;     video since a pocketed phone can still hear even when it can't

&#x20;     see, consent flow required before any automatic recording. Do

&#x20;     not add to the website until the mobile client is built and a

&#x20;     real upload has been tested end-to-end.



\## Documentation status — verify before trusting any of these are saved



\- \[x] `docs/architecture/system-overview.md` — confirmed saved

\- \[x] `docs/architecture/incident-lifecycle.md` — confirmed saved

\- \[ ] `docs/architecture/notification-engine.md` — written in chat,

&#x20;     never actually saved to disk

\- \[ ] `docs/architecture/survival-timeline.md` — written in chat, never

&#x20;     actually saved to disk

\- \[ ] `docs/architecture/evidence-engine.md` — written in chat, never

&#x20;     actually saved to disk

\- \[ ] `docs/architecture/journey-risk-intelligence.md` — written, saved

&#x20;     once, but never re-confirmed with a `Get-Content` read-back —

&#x20;     verify before trusting it

\- \[x] `docs/architecture/emergency-intelligence-engine.md` — confirmed saved

\- \[x] `docs/future/ussd-fallback.md` — confirmed saved

\- \[ ] ADRs (`docs/adr/`) — good practice, zero urgency, not started



\## Website — in progress



\- \[x] Next.js scaffold created (`apps/website`), TypeScript + Tailwind v4 + App Router

\- \[x] Design tokens (`globals.css`) carrying over OPA's brand system

\- \[x] `layout.tsx` — real fonts, metadata, title template

\- \[x] `Navbar`, `Footer`, `Container` components

\- \[x] `Hero.tsx` — live, correct

\- \[x] `HowItWorks.tsx` — corrected to only claim real, tested capabilities;

&#x20;     unbuilt items removed or marked Planned/In progress

\- \[x] `HospitalSection.tsx` — Command Center reframed as in-development,

&#x20;     not a plain claim

\- \[ ] Trust/Security section — next

\- \[ ] Closing CTA tied to the pilot program

\- \[ ] Additional pages (About, Hospitals, Contact, Privacy, Terms) — after homepage is complete



\## Where we stopped this session



Emergency Contacts (full CRUD, phone normalization, live-tested) and

login's show/hide password are the last fully-confirmed, tested,

committed work on the backend/mobile side. The parallel-notifications

orchestrator refactor is written but \*\*not yet build-tested or

committed\*\*. Separately, the website is now under active build —

foundation and three homepage sections done and verified live in the

browser; Trust/Security and the closing CTA remain.

