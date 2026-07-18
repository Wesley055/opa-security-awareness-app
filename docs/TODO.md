# OPA — Working To-Do List

**Last updated:** this session. Read this before assuming anything is
done — verify against real files/tests, same as everything else in
this project. **See `docs/SPRINT_ROADMAP.md` for the authoritative
sprint-by-sprint status — this file is for granular, individual items.**

## Immediate — unblocks remaining verification

- [ ] Verify Push and Email notification delivery individually — both
      fired in parallel with the SMS confirmed working live, but
      neither was individually confirmed received.
- [ ] Test the SOS screen's Cancel path — never tested yet, only the
      full-countdown-to-activation path has been verified live.
- [ ] Test SOS error-handling paths — denied location permission,
      network failure during activation, repeated activations.
- [ ] Double-check a real `RESEND_API_KEY` is actually set in `.env` —
      never explicitly confirmed the way Azure and Africa's Talking
      credentials were tonight.

## Confirmed real this session

- [x] Real, live, end-to-end SMS delivery via Africa's Talking Sandbox
      — a genuine SOS activation produced a real message that arrived
      on a real phone with correct content and a working location link.
- [x] Parallel-notifications orchestrator refactor (SMS + WhatsApp +
      Email sent concurrently) — proven real by a live test.
- [x] Mobile SOS activation screen (Sprint 9 Pass 1) — built and run
      live successfully: real countdown, real GPS, real API call, real
      incident created, real notification triggered.
- [x] `sms.provider.ts` restored from a silently-reverted fake stub to
      the real Africa's Talking integration; `africastalking` npm
      package installed.
- [x] Fake `GeocodingProvider` location text removed from real
      SMS/email messages — replaced with a real Google Maps link built
      from actual GPS coordinates.
- [x] Legal entity name corrected sitewide: "OPA Technology Limited"
      (wrong) → "OPA Technologies Limited" (CAC-approved, correct) —
      fixed in Contact, Terms, and Privacy pages.
- [x] Azure Storage key rotated (routine hygiene, pasted in chat
      multiple times across sessions).
- [x] `opasafety.com` email DNS fixed — was showing "Incomplete setup"
      in Microsoft 365, traced to missing DNS records at Cloudflare,
      resolved via Microsoft's automated Cloudflare integration.
- [x] Real Africa's Talking Sandbox credentials obtained and verified
      working.

## Real, known gaps — not urgent, not forgotten

- [ ] **Enterprise Kit's Company Profile docx still says "OPA
      Technology Limited"** (singular "Technology") — the CAC-approved
      legal name is "OPA Technologies Limited" (plural). Website is
      already corrected. The docx needs regenerating, not patching,
      since it's a static file already downloaded.
- [ ] Idempotency protection against duplicate notification sends
- [ ] No edit screen for emergency contacts
- [ ] Register screen has no show/hide password toggle
- [ ] Phone normalization in `contacts.tsx` defaults any unrecognized
      number to +234 — can mis-normalize a foreign number typed
      without its country code.
- [ ] `isLoading` in `contacts.tsx` never resets to `true` on
      re-focus/refresh.
- [ ] Nigeria-only account registration — deliberately left as-is
- [ ] Family Dashboard / parent-monitoring — not written up yet
- [ ] Direction-of-travel / movement intelligence — all three
      underlying providers (`PlacesProvider`, `GeocodingProvider`,
      `RoutingProvider`) confirmed fake/mock; see
      docs/architecture/emergency-intelligence-engine.md
- [ ] Mobile evidence capture (audio/video/photo) — backend real, no mobile client
- [ ] No medical information fields anywhere in the schema
- [ ] Logo/brand mark — shelved

## Legal & compliance — real, not yet started

- [ ] **NDPC (Nigeria Data Protection Commission) registration** —
      required once processing personal data of 200+ people within any
      rolling 6-month window, a threshold a real pilot would likely
      cross quickly. Requires a completed CAC certificate number and a
      Nigerian-resident/citizen Data Protection Officer. Fee tiers by
      business size (~₦25,000 for small business). Connected to CAC
      completion, not separate.
- [ ] Legal review of Privacy Policy and Terms of Service — both
      explicitly marked as drafts pending this.
- [ ] Business liability insurance — flagged early in the project,
      never actioned.

## Backend — still open

- [ ] WhatsApp Business (Meta) registration — template submission and
      business verification pending.
- [ ] Voice webhook endpoint — blocked on deployment.

## Deployment — separate future session

- [ ] Provision Azure App Service (or Container Apps) for the API
- [ ] Provision Azure Database for PostgreSQL (managed)
- [ ] Generate real production JWT secrets
- [ ] Run `prisma migrate deploy` against production
- [ ] Update CORS for the real API URL
- [ ] Point mobile app's API base URL at the deployed URL
- [ ] Website: deploy to Azure Static Web Apps, DNS, HTTPS, analytics, CI/CD

## App store / launch — not started

- [ ] Apple Developer Program enrollment
- [ ] Google Play Console enrollment
- [ ] Payment gateway (Paystack/Flutterwave) — only once paid tiers exist

## Documentation status

- [x] `docs/architecture/system-overview.md`
- [x] `docs/architecture/incident-lifecycle.md`
- [x] `docs/architecture/emergency-intelligence-engine.md`
- [x] `docs/SPRINT_ROADMAP.md` — authoritative sprint status
- [ ] `docs/architecture/notification-engine.md` — never saved
- [ ] `docs/architecture/survival-timeline.md` — never saved
- [ ] `docs/architecture/evidence-engine.md` — never saved
- [ ] `docs/architecture/journey-risk-intelligence.md` — never re-confirmed
- [x] `docs/future/ussd-fallback.md`
- [ ] ADRs — not started

## A technique worth remembering

When a specific line or file repeatedly refuses to save correctly via
Notepad, use PowerShell directly:
`(Get-Content <path> -Raw).Replace('<exact text>', '<replacement>') | Set-Content <path>`
Verify with `Select-String -Path <path> -Pattern "<exact text>"`.

Never assume a previously-verified file is still correct — files can
silently revert between sessions with no build/test catching it if the
reverted version still compiles.

When reading back any file with special characters (em-dashes, ✅/🟡
symbols), use `Get-Content <path> -Encoding utf8` explicitly — plain
`Get-Content` can garble the display even when the file itself is fine.

## Where we stopped this session

The mobile SOS activation screen is built and was proven live,
successfully, end to end — the first real proof of OPA's core promise.
That test surfaced and led to fixing two genuine production bugs. Real
Africa's Talking Sandbox credentials are in place and confirmed
working. Infrastructure hygiene (Azure key rotation, email DNS, legal
entity name) is caught up. Next real work: verify Push/Email delivery
individually, test SOS's Cancel/error paths, then Sprint 10A (the
incident portal) or Sprint 9 Pass 2 (voice trigger).