# OPA — Working To-Do List

**Last updated:** this session. Read this before assuming anything is
done — verify against real files/tests, same as everything else in
this project. **Tonight's session proved this matters even for
previously-verified files — see the lesson at the top of
`docs/SPRINT_ROADMAP.md`.**

## Immediate — unblocks real SMS delivery

- [ ] **Sign up for Africa's Talking, get a real API key/username.**
      Confirmed tonight: does NOT require CAC completion — only a
      custom branded Sender ID does (a separate, later step). Add
      `AFRICASTALKING_API_KEY` and `AFRICASTALKING_USERNAME` to
      `.env` once obtained.
- [ ] **Test the SOS screen's Cancel path** — never tested yet, only
      the full-countdown-to-activation path has been verified live.
- [ ] **Test SOS error-handling paths** — denied location permission,
      network failure during activation, repeated activations.

## Confirmed real tonight — no longer open items

- [x] Parallel-notifications orchestrator refactor (SMS + WhatsApp +
      Email sent concurrently) — was "written in chat, never
      confirmed" for a while; now proven real by a live test failure
      that correctly expected the old sequential count, then fixed.
- [x] Mobile SOS activation screen (Sprint 9 Pass 1) — built,
      structurally verified, and run live once successfully end to
      end: real countdown, real GPS, real API call, real incident
      created, real notification pipeline triggered.

## Real bugs found and fixed tonight

- [x] **`sms.provider.ts` had silently reverted to its original fake
      stub** despite being replaced with real Africa's Talking code
      weeks ago. The `africastalking` npm package was also missing
      entirely. Both restored/installed, verified with a clean build
      and full passing test suite.
- [x] **Fake `GeocodingProvider` location text was leaking into real
      SMS/email messages** sent to real emergency contacts (a
      hardcoded, wrong street name). Fixed — messages now use a real,
      tappable Google Maps link built from actual GPS coordinates.

## Backend — still open

- [ ] **WhatsApp Business (Meta) registration** — create Business app
      at developers.facebook.com → add WhatsApp product → test with
      the 5 free registered numbers → submit `opa_emergency_alert`
      template under Utility category → complete business
      verification (2–10 business days) → generate a System User
      token → add `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID`.
- [ ] Voice webhook endpoint — blocked on deployment (needs a public URL).

## Deployment — separate future session, not tonight

- [ ] Provision Azure App Service (or Container Apps) for the API
- [ ] Provision Azure Database for PostgreSQL (managed)
- [ ] Generate real production `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`
- [ ] Run `prisma migrate deploy` against production
- [ ] Update `ALLOWED_ORIGINS`/CORS for the real API URL
- [ ] Point mobile app's `API_BASE_URL` at the deployed URL
- [ ] Website: deploy to Azure Static Web Apps, DNS, HTTPS, analytics, CI/CD

## Real, known gaps — not urgent, not forgotten

- [ ] Idempotency protection against duplicate notification sends
- [ ] No edit screen for emergency contacts
- [ ] Register screen has no show/hide password toggle
- [ ] Phone normalization in `contacts.tsx` defaults any unrecognized
      number to +234 — can mis-normalize a foreign number typed
      without its country code. Real, small bug, caught in review, not
      yet fixed.
- [ ] `isLoading` in `contacts.tsx` never resets to `true` on
      re-focus/refresh — minor UX gap, caught in review, not yet fixed.
- [ ] Nigeria-only account registration — deliberately left as-is
- [ ] Family Dashboard / parent-monitoring — not written up yet
- [ ] Direction-of-travel / movement intelligence — architecture
      exists, all three underlying providers (`PlacesProvider`,
      `GeocodingProvider`, `RoutingProvider`) confirmed fake/mock.
- [ ] Mobile evidence capture (audio/video/photo) — backend real, no mobile client
- [ ] No medical information fields anywhere in the schema
- [ ] Logo/brand mark — shelved

## Documentation status

- [x] `docs/architecture/system-overview.md`
- [x] `docs/architecture/incident-lifecycle.md`
- [x] `docs/architecture/emergency-intelligence-engine.md` — confirms
      all three location providers are fake, and documents tonight's
      fix
- [x] `docs/SPRINT_ROADMAP.md` — the real source of truth for sprint status
- [ ] `docs/architecture/notification-engine.md` — never saved
- [ ] `docs/architecture/survival-timeline.md` — never saved
- [ ] `docs/architecture/evidence-engine.md` — never saved
- [ ] `docs/architecture/journey-risk-intelligence.md` — saved once, never re-confirmed
- [x] `docs/future/ussd-fallback.md`
- [ ] ADRs — not started

## Website — v1 complete

Six pages live, linked, verified. Remaining: Pilot Partnership page,
expanded Security page, FAQ, Cookie Policy, animations, Azure deployment.

## A technique worth remembering

When a specific line or file repeatedly refuses to save correctly via
Notepad, use PowerShell directly:
`(Get-Content <path> -Raw).Replace('<exact text>', '<replacement>') | Set-Content <path>`
Verify with `Select-String -Path <path> -Pattern "<exact text>"`.

**New tonight:** never assume a previously-verified file is still
correct. Re-read critical files with `Get-Content` before trusting
their status, especially anything on the SOS/notification path — files
can silently revert between sessions with no build or test catching it
if the reverted version still compiles and type-checks.

## Where we stopped this session

The mobile SOS activation screen (Sprint 9 Pass 1) is built and was
run live, successfully, once — the first real end-to-end proof of
OPA's core promise. That same test surfaced two genuine production
bugs (a reverted fake SMS provider, fake location text in real
messages), both found and fixed tonight, verified by a clean build and
full passing test suite. Real SMS delivery is still blocked on
creating an Africa's Talking account — external setup, not a code
task, and confirmed not blocked by CAC completion. Next real work:
Africa's Talking signup, testing SOS's Cancel/error paths, then either
Sprint 10B (live-tracking page) or Sprint 9 Pass 2 (voice trigger).