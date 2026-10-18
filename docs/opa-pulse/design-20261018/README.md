# OPA Pulse — founder review package

OPA Technologies Limited • design v1.0 • 18 October 2026 • DESIGN ONLY

Status: ready for founder design review; implementation is not authorized by this package. No live integrations, credentials, customer/employee data, product code, migrations or deployment changes are included. Every named customer, employee, amount and capability example is synthetic. Capability approval must use actual evidence before any customer delivery.

## Review route

1. [Product requirements](01-product-requirements.md): scope, measurable outcomes, lifecycle rules and build/buy decision.
2. [Architecture](02-architecture.md): independent identity/data plane, integrations, failure recovery and decisions.
3. [Data design](03-data-design.md) and [API contracts](04-api-contracts.md): entities, constraints, operations, events and examples.
4. [Permissions](05-permissions.md) and [UX specification](06-ux-specification.md): screen inventory, actions, states and role boundaries.
5. [Proposal system](07-proposal-system.md): five industry specifications, quotations, evidence, approval and export.
6. [Workflows](08-workflows.md), [analytics](09-analytics.md), [security](10-security.md).
7. [Implementation backlog](11-backlog-acceptance.md) and [risks/decisions/handover](12-risks-decisions-handover.md).
8. [Static UX review boards](ux-review.html): founder-facing visual compositions for command center, personal workspace, account, opportunity, proposal, mail, Academy and identity. These are design illustrations, not a functioning CRM or synthetic prototype.
9. [Traceability and verification](13-traceability.md): requested deliverables and acceptance coverage.
10. [Academy learning design](14-academy-learning-design.md): six role paths, content lifecycle, assessments and People/Proposal contracts.

## Isolation record

The existing OneDrive product workspace has an unborn `master` branch, no commits and no configured remote. Directory creation there did not persist. No source was staged, moved or modified. A separate local design repository was initialized in the permitted visualization workspace; an empty `design-base` commit anchors the dedicated `codex/opa-pulse-design-20261018` branch and `opa-pulse-design-review` Git worktree. This design repository is not a replacement for the product repository and has no production remote, hooks or CI. No merge or deployment is requested.

Tracker: [#42](https://github.com/Wesley055/opa-security-awareness-app/issues/42), [#45](https://github.com/Wesley055/opa-security-awareness-app/issues/45), [#41](https://github.com/Wesley055/opa-security-awareness-app/issues/41). Issue #36 physical EstateFlow E2E is independent; relative references to Sunday/tomorrow do not alter that schedule.

## Founder decisions before implementation

Approve custom Pulse shell with HubSpot compatibility versus licensed CRM first; approve commercial policy thresholds and retention defaults; nominate product-fact owners and security/privacy reviewers; confirm internal IdP/OPA People event authority and hosting region. These are explicit gates, not assumed decisions. Each specification uses proposed defaults so implementation can be estimated and reviewed without inventing production facts.
