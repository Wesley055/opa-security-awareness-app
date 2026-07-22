# OPA — Commercial Roadmap

**Purpose:** The engineering roadmap (docs/SPRINT_ROADMAP.md) tracks build
dependencies. THIS doc tracks REVENUE milestones — what a paying customer
buys, and which engineering foundations gate it. Keep both in sync.

**Core sequencing insight (founder decision):** Everything revenue-critical
depends on Sprint 10. Command Center needs Sprint 10A; SafeWalk needs Sprint
10B + the Journey Session primitive. So Sprint 10 is not a detour from
revenue — it IS the revenue foundation. Build dispatch hardening, then ALL
of Sprint 10, then the revenue products.

**Honesty guardrail (non-negotiable, same standard as website/marketing):**
Every item below lists what it ACTUALLY does at MVP. Sell only what exists.
A commercial roadmap makes over-claiming easy (it's a list of things to
sell) — so the honesty rule matters MORE here, not less. No selling
hospital integration, AI dispatch, or coordination that isn't built.

---

## REVENUE MODEL
B2B / institutional, per-seat or enterprise subscription. Confirmed as OPA's
highest-revenue path by the market analysis (mandated lone-worker safety,
high renewal). Consumers = later/retention, not the near-term cheque-writer.

---

## REVENUE RELEASE 0 — Hospital Pilot  [available NOW]
- **Customer:** first hospital (Lagos targets already identified).
- **Buys:** a controlled pilot of OPA's emergency alerting.
- **Actually does today:** SOS -> alerts trusted contacts with live location
  via the proven synchronous path. NOT coordination, NOT dispatch to
  hospitals/responders (not built).
- **Engineering gate:** none new — runs on the already-proven path.
- **Purpose:** first cash + validates the B2B relationship + product feedback.
- **Honesty:** pilot participants must understand the service limitations
  (no "replaces emergency services", no auto-dispatch).

## REVENUE RELEASE 1 — Command Center MVP  [first RECURRING revenue]
- **Customer:** hospitals, security firms, universities, corporations, NGOs.
- **Buys:** SaaS subscription (per-seat) to monitor & manage incidents.
- **MVP scope (minimum before someone pays):** org login/accounts, live
  incident list, incident map, incident detail view, acknowledge incident,
  search/filter, basic reporting. NOT every future feature.
- **Actually does at MVP:** operators SEE and ACKNOWLEDGE real incidents from
  their org's users. (Not AI routing, not predictive anything — later.)
- **Engineering gates:** dispatch hardening (reliable delivery) + Sprint 10A
  (Incident Portal — the incident-viewing foundation Command Center extends).
- **Note:** Command Center IS the institutional version of Sprint 10A. 10A
  builds incident-viewing; Command Center is the multi-user org product on top.

## REVENUE RELEASE 2 — SafeWalk MVP  [lone-worker per-seat revenue]
- **Customer:** corporations, campuses, logistics, field/healthcare/utility
  workers, NGO field teams, security patrols.
- **Buys:** per-user or enterprise subscription for journey safety monitoring.
- **MVP scope:** start/active/end journey session, expected route/ETA or
  check-in interval, missed check-in -> escalation, org policies.
- **Actually does at MVP:** monitors a journey, escalates on missed check-in.
  Advisory/observable-facts only — NO impairment detection, NO enforcement.
- **Engineering gates:** Sprint 10B (Live Tracking) + the Journey Session
  primitive that comes out of 10B. This is genuinely several foundations
  away — the path is direct but not short. Don't insert non-revenue work
  in front of it.

## REVENUE RELEASE 3 — Premium / AI  [later, clearly not-yet-built]
- Advanced analytics, compliance reporting, smart responder recommendations,
  predictive routing, AI dispatch. ALL target architecture, none built.
- Do NOT sell or market these as current until they exist.

---

## THE SEQUENCE (dependency-honest, revenue-aligned)
Dispatch hardening (Phases 1-4)
  -> Sprint 10A (Incident Portal)  ===> unlocks Command Center MVP (Release 1)
  -> Sprint 10B (Live Tracking + Journey Session) ===> unlocks SafeWalk (Release 2)
  -> then Command Center MVP, then SafeWalk MVP (the revenue products)
Release 0 (hospital pilot) runs in PARALLEL now on the synchronous path —
first cash while the foundations build.

## CHECK (use this to guard priority)
Before starting ANY new work, ask: does this advance a Revenue Release, or
is it a detour? Everything between here and Sprint 10B done should be on the
dispatch -> 10A -> 10B line. Non-revenue-path work waits.
