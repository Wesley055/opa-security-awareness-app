# OPA - Working To-Do List

**Last updated:** this session. Read this before assuming anything is
done - verify against real files/tests, same as everything else in
this project.

## Backend - still unconfirmed, don't assume done

- [ ] **Confirm the parallel-notifications orchestrator refactor actually builds and passes tests.**
      Confirmed via `git status` that `apps/api` has zero uncommitted
      changes - meaning this was never actually pasted into the real
      file. Still just written in chat. Needs to be applied fresh,
      built, tested, and committed before it's real.
- [ ] **WhatsApp Business (Meta) registration** - steps: create Business
      app at developers.facebook.com -> add WhatsApp product -> test with
      the 5 free registered numbers using `hello_world` -> submit
      `opa_emergency_alert` template under **Utility** category -> complete
      business verification (2-10 business days) -> generate a permanent
      System User token -> add `WHATSAPP_ACCESS_TOKEN` and
      `WHATSAPP_PHONE_NUMBER_ID` to `.env`.

## Deployment - separate future session, not tonight

- [ ] Provision Azure App Service (or Container Apps) for the API
- [ ] Provision Azure Database for PostgreSQL (managed) - expect
      `?sslmode=require`, which local dev never needed
- [ ] Generate real production `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`
      - current values are named "change-later," don't carry them into production
- [ ] Run `prisma migrate deploy` against the new production database
- [ ] Update `ALLOWED_ORIGINS` / CORS for the real API URL
- [ ] Point the mobile app's `API_BASE_URL` at the deployed URL, re-test
      login -> contacts live against it
- [ ] Voice's webhook becomes testable only once the API has a public URL
- [ ] **Website: deploy to Azure Static Web Apps, connect opasafety.com,
      HTTPS, DNS, analytics, GitHub Actions CI/CD** - deliberately held
      for a dedicated session, not squeezed in at the end of a long day

## Real, known gaps - not urgent, not forgotten

- [ ] **Idempotency protection against duplicate notification sends**
- [ ] **No edit screen for emergency contacts** (create/list/delete/set-primary work; editing doesn't)
- [ ] **Register screen has no show/hide password toggle** - login has one, register still doesn't
- [ ] **Nigeria-only account registration** - deliberately left as-is
      until non-Nigerian SMS delivery has a real answer
- [ ] **Family Dashboard / parent-monitoring** - needs its own consent/linking design, not written up yet
- [ ] **Direction-of-travel / movement intelligence** - `PlacesProvider`
      is an explicit self-labeled mock; see
      docs/architecture/emergency-intelligence-engine.md. Never add to
      the website, even as "Planned," until genuinely built.
- [ ] **Mobile evidence capture (audio/video/photo)** - backend Evidence
      API is real; mobile client to record/upload it doesn't exist.
      This exact feature has now been proposed for the website multiple
      separate times and correctly declined each time.
- [ ] **No medical information fields anywhere in the schema** - confirmed
      by reading the real `schema.prisma`: no `bloodType`, `allergies`,
      or `knownConditions` field exists on `User`, `EmergencyContact`, or
      anywhere else. Was briefly drafted for the Hospitals page and
      correctly removed once the schema was checked.
- [ ] **Logo/brand mark** - explored two rounds of concepts, neither
      landed. Deliberately shelved, not being pursued right now.

## Documentation status

- [x] `docs/architecture/system-overview.md` - confirmed saved
- [x] `docs/architecture/incident-lifecycle.md` - confirmed saved
- [ ] `docs/architecture/notification-engine.md` - written in chat, never saved
- [ ] `docs/architecture/survival-timeline.md` - written in chat, never saved
- [ ] `docs/architecture/evidence-engine.md` - written in chat, never saved
- [ ] `docs/architecture/journey-risk-intelligence.md` - saved once, never re-confirmed
- [x] `docs/architecture/emergency-intelligence-engine.md` - confirmed saved
- [x] `docs/future/ussd-fallback.md` - confirmed saved
- [ ] ADRs (`docs/adr/`) - good practice, zero urgency, not started

## Real mailboxes confirmed to exist (Microsoft 365)

hello@, info@, partnerships@, sales@, support@, security@, privacy@,
media@, legal@, careers@ - all confirmed real via direct screenshots
of the mailbox admin panel. `info@` is the sitewide primary public
address; `hello@` remains active but is not used as the primary
anywhere on the site.

## Website - v1 complete

- [x] Next.js scaffold, TypeScript + Tailwind v4 + App Router, locked to port 3001
- [x] Design tokens (`globals.css`), real fonts, title template
- [x] `Navbar`, `Footer`, `Container` - shared across every page
- [x] Homepage: Hero, How It Works, Hospital, Security, CTA
- [x] Icons (lucide-react) across How It Works, Hospital, Security, Contact
- [x] About page
- [x] Hospitals page - checked against real schema
- [x] Contact page - nine real department mailboxes
- [x] Privacy Policy page - accurate to real data practices, flagged for legal review
- [x] Terms of Service page - includes explicit "not a replacement for calling
      emergency services" disclaimer, flagged for legal review
- [x] Footer links to Privacy and Terms; Navbar links to About, How it works,
      Privacy & security, For hospitals, Contact
- [ ] **Dedicated Pilot Partnership page** (future) - structured inquiry form
- [ ] Restrained scroll/hover animations - not yet added
- [ ] Azure deployment, DNS, HTTPS, analytics, CI/CD - separate future session

## A technique worth remembering

When a specific single line in a file repeatedly refuses to save
correctly via Notepad copy-paste, stop retrying the same paste-and-save
cycle. Instead, use PowerShell directly:
`(Get-Content <path> -Raw).Replace('<exact text>', '<replacement>') | Set-Content <path>`
This bypasses Notepad and the browser-clipboard path entirely. Verify
with `Select-String -Path <path> -Pattern "<exact text>"` afterward.

Separately: when writing a full file's content via PowerShell, a
here-string (@'...'@) pasted as one block is more reliable than
Notepad copy-paste for long files - it avoids clipboard truncation.

## Mobile - the actual critical path, still not started

- [ ] **SOS activation screen** - the entire reason OPA exists. Login,
      register, and emergency contacts are all real and tested; nothing
      on the phone calls `POST /incident-orchestrator/activate` yet.

## Where we stopped this session

Website v1 is complete: six real pages (Home, About, Hospitals, Contact,
Privacy, Terms), fully linked, every claim checked against actual code,
schema, or confirmed mailboxes. Both legal pages are explicitly marked
as drafts pending real attorney review. Next real work: Azure deployment
or the mobile SOS activation screen, per tomorrow's plan - SOS remains
the single most important unbuilt piece of the entire project.
