\# OPA Backend — System Overview



\*\*Status: as-built, verified against real code and test runs as of this

document's date.\*\* This describes what exists and is tested — not the

full architecture vision (see the original `docs/ARCHITECTURE.md` for

that, written earlier against a different prototype backend and now

partially stale).



\## Stack



\- \*\*Framework:\*\* NestJS (TypeScript), modular structure under `src/modules/`

\- \*\*Database:\*\* PostgreSQL via Prisma ORM

\- \*\*Auth:\*\* JWT (access + refresh tokens), Passport strategy

\- \*\*File storage:\*\* Azure Blob Storage (evidence files)

\- \*\*SMS:\*\* Africa's Talking

\- \*\*Email:\*\* Resend

\- \*\*Push:\*\* Expo push API (not Firebase — the mobile app is Expo-managed,

&#x20; which issues its own token format and doesn't need a Firebase project)

\- \*\*Voice, WhatsApp:\*\* Coded, not yet live — voice needs a webhook

&#x20; endpoint not yet built; WhatsApp needs Meta template approval, pending



\## Modules (verified real, not just present in a file listing)



| Module | What it does | Status |

|---|---|---|

| `auth` | JWT login/register, refresh tokens | Real, tested |

| `users` | User lookup, includes `facilityId` for staff | Real |

| `incidents` | Direct incident CRUD (lower-level than the orchestrator) | Real, tested |

| `incident-orchestrator` | The real entry point for SOS activation — coordinates detection, intelligence, incident creation, notifications, and timeline in one call | Real, tested |

| `emergency-detection` | Trigger evaluation: voice phrase matching, confidence scoring, silent mode | Real |

| `emergency-intelligence` | Location/device data enrichment | Real |

| `notifications` | SMS/Push/Voice/WhatsApp/Email dispatch, persists every attempt | Real, tested |

| `incident-timeline` | Append-only, hash-chained event log per incident | Real, tested, wired into the orchestrator |

| `evidence` | File upload to Azure Blob, SHA-256 hashing, SAS-based downloads | Real, tested — not yet called automatically by the orchestrator |

| `facilities` | Facility-scoped incident queue for hospital staff | Real, tested |



\## Cross-cutting infrastructure



\- \*\*Correlation IDs \& structured request logging:\*\* `CorrelationIdMiddleware` + `RequestLoggingMiddleware`, applied globally in `app.module.ts`

\- \*\*Global exception handling:\*\* `GlobalExceptionFilter`, registered in `main.ts`

\- \*\*API documentation:\*\* Swagger, live at `/api/docs`

\- \*\*Access control pattern:\*\* guards re-read role/facility assignment from

&#x20; the database on every request rather than trusting the JWT — a token

&#x20; can be stale if a user's role changes after it was issued



\## What's real but not yet connected



Evidence upload works as a standalone endpoint but nothing in the

orchestrator calls it automatically — evidence capture from the mobile

app, once built, will need to call it directly.



\## What doesn't exist yet



Mobile app backend integration (zero lines of client code exist),

`api-flow.md` and `facility-routing.md` (deferred until a real client

exists to document against), ADRs, voice webhook, WhatsApp approval.

