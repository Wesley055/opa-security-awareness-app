# OPA — Working To-Do List

**Last updated:** this session. Read this before assuming anything is
done — verify against real files/tests, same as everything else in
this project.

## In progress right now

- [ ] **Applying the corrected CTA.tsx** — keeps the real hospital pilot
      claim as the primary headline, reframes the broader audience
      (NGOs, corporate security, government) as an honest low-key
      invitation rather than an active-pilot claim. About to save and
      verify.

## Backend — still unconfirmed, don't assume done

- [ ] **Confirm the parallel-notifications orchestrator refactor actually builds and passes tests.**
      Confirmed via `git status` that `apps/api` has zero uncommitted
      changes — meaning this was never actually pasted into the real
      file. Still just written in chat. Needs to be applied fresh,
      built, tested, and committed before it's real.
- [ ] **WhatsApp Business (Meta) registration** — steps: create Business
      app at developers.facebook.com → add WhatsApp product → test with
      the 5 free registered numbers using `hello_world` → submit
      `opa_emergency_alert` template under **Utility** category → complete
      business verification (2–10 business days) → generate a permanent
      System User token → add `WHATSAPP_ACCESS_TOKEN` and
      `WHATSAPP_PHONE_NUMBER_ID` to `.env`.

## Deployment — separate future session, not tonight

- [ ] Provision Azure App Service (or Container Apps) for the API
- [ ] Provision Azure Database for PostgreSQL (managed) — expect
      `?sslmode=require`, which local dev never needed
- [ ] Generate real production `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`
      — current values are named "change-later," don't carry them into production
- [ ] Run `prisma migrate deploy` against the new production database
- [ ] Update `ALLOWED_ORIGINS` / CORS for the real API URL
- [ ] Point the mobile app's `API_BASE_URL` at the deployed URL, re-test
      login → contacts live against it
- [ ] Voice's webhook becomes testable only once the API has a public URL
- [ ] **Website: deploy to Azure Static Web Apps, connect opasafety.com,
      HTTPS, DNS, analytics, GitHub Actions CI/CD** — deliberately held
      for a dedicated session, not squeezed in at the end of a long day,
      given how error-prone infrastructure work has been tonight

## Real, known gaps — not urgent, not forgotten

- [ ] **Idempotency protection against duplicate notification sends**
- [ ] **No edit screen for emergency contacts** (create/list/delete/set-primary work; editing doesn't)
- [ ] **Register screen has no show/hide password toggle** — login has one, register still doesn't
- [ ] **Nigeria-only account registration** — deliberately left as-is
      until non-Nigerian SMS delivery has a real answer
- [ ] **Family Dashboard / parent-monitoring** — needs its own consent/linking design, not written up yet
- [ ] **Direction-of-travel / movement intelligence** — `PlacesProvider`
      is an explicit self-labeled mock; see
      docs/architecture/emergency-intelligence-engine.md. Never add to
      the website, even as "Planned," until genuinely built.
- [ ] **Mobile evidence capture (audio/video/photo)** — backend Evidence
      API is real; mobile client to record/upload it doesn't exist.
      This exact feature has now been proposed for the website four
      separate times and correctly declined each time — do not add it
      to any page until a real mobile client exists and a real upload
      has been tested end-to-end.
- [ ] **Logo/brand mark** — explored two rounds of concepts, neither
      landed. Deliberately shelved, not being pursued right now.

## Documentation status

- [x] `docs/architecture/system-overview.md` — confirmed saved
- [x] `docs/architecture/incident-lifecycle.md` — confirmed saved
- [ ] `docs/architecture/notification-engine.md` — written in chat, never saved
- [ ] `docs/architecture/survival-timeline.md` — written in chat, never saved
- [ ] `docs/architecture/evidence-engine.md` — written in chat, never saved
- [ ] `docs/architecture/journey-risk-intelligence.md` — saved once, never re-confirmed
- [x] `docs/architecture/emergency-intelligence-engine.md` — confirmed saved
- [x] `docs/future/ussd-fallback.md` — confirmed saved
- [ ] ADRs (`docs/adr/`) — good practice, zero urgency, not started

## Website — actively in progress

- [x] Next.js scaffold, TypeScript + Tailwind v4 + App Router, locked to port 3001
- [x] Design tokens (`globals.css`), real fonts, title template
- [x] `Navbar`, `Footer`, `Container` — shared across every page
- [x] Complete homepage: Hero, How It Works, Hospital, Security, CTA — every claim checked against what's real
- [x] Icons added (lucide-react) to How It Works, Hospital, and Security cards
- [x] Security section: strengthened intro, "Powered by" technology strip
- [x] About page — real mission, vision, guiding principles, linked from Navbar
- [x] Committed and pushed (commit b563db2)
- [ ] Applying the corrected CTA.tsx (in progress, see top of this file)
- [ ] Hospitals page
- [ ] Contact page
- [ ] Privacy policy page
- [ ] Terms of service page
- [ ] **Dedicated Pilot Partnership page** (future) — who we're looking
      for, what partners receive, pilot expectations, a structured
      inquiry form instead of just a mailto link. Correctly scoped as
      later work, linked from the homepage CTA once it exists.
- [ ] Restrained scroll/hover animations — not yet added

## Mobile — the actual critical path, still not started

- [ ] **SOS activation screen** — the entire reason OPA exists. Login,
      register, and emergency contacts are all real and tested; nothing
      on the phone calls `POST /incident-orchestrator/activate` yet.
      This remains the single most important unbuilt thing in the
      entire project, ahead of every website or backend polish item
      above it.

## Where we stopped this session

Mobile auth and contacts work from earlier tonight is committed. The
website's full homepage and About page are live, verified, and
committed. Currently applying one more correction to the CTA (broadening
the invited audience honestly, without overclaiming active pilots with
organizations OPA hasn't actually engaged). Long session in progress —
after the CTA fix, next candidates are: remaining website pages
(Hospitals/Contact/Privacy/Terms), or switching to the mobile SOS
screen, which remains the highest-leverage unbuilt piece of the whole
project.