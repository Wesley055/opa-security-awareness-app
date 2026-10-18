# Requirements traceability and verification record

| Requested deliverable / scope | Primary artifact | Future acceptance |
|---|---|---|
| PRD / enterprise outcomes | 01-product-requirements.md | B00, T10, T23 |
| Software architecture / isolated boundaries | 02-architecture.md | B01, T04/T09 |
| Database / API design | 03-data-design.md, 04-api-contracts.md | B01, T01–T09/T28 |
| Roles / territory / manager boundaries | 05-permissions.md | B04, T05–T07/T21 |
| Complete screens / accessible UX | 06-ux-specification.md, ux-review.html | B02, T27 |
| Proposal engine / five industries / DOCX/PDF | 07-proposal-system.md | B11–B12, T12–T15 |
| Auditable workflow automation / human send approval | 08-workflows.md | B16, T08/T17/T22 |
| KPI / forecast / intelligence | 09-analytics.md | B18–B19, T23–T24/T26 |
| Security / privacy / retention / audit | 10-security.md | B20, T01–T09/T25–T26 |
| Phased backlog / acceptance / automated tests and estimates | 11-backlog-acceptance.md, 15-delivery-estimates-testing.md | B00–B21, T01–T31 |
| Dependencies / risks / decisions | 12-risks-decisions-handover.md | D02 final; remaining gates D01–D09/R01–R20 |
| GitHub progress and handover | Issues #41/#42/#45 + handover record | Verify posted comment IDs and branch manifest |
| Mail two-way / templates / schedule / privacy | 02/03/04/06/08/10 | B13–B15, T16–T19 |
| Academy / six employee role paths / approvals | 01/03/04/06/07/08 | B09–B10, T20–T21 |
| Unique identity / profiles / immediate revocation | 02/03/04/05/06/10 | B03–B05, T01–T09 |
| OPA-native intake / email-calendar / GitHub / Connect | 02/04/08 | B08/B15, T28 |
| Final proprietary CRM authority / no third-party CRM dependency | README, 01/02/03/04/11/12/15 | B00/B01, T29–T31 |
| Isolation / no implementation or deploy | README and Git file manifest | Verify only design artifacts on dedicated branch |

Verification distinguishes design checks from implementation tests. This package can be checked for required files, links, screen IDs, industry coverage, workflows, formula arithmetic and Git isolation. The runtime, provider, accessibility and DOCX/PDF acceptance scenarios are specified, not executed against a nonexistent application. Static HTML boards have no executable business logic or network dependencies.

Design review does not certify current OPA capabilities, financial/legal policies, production infrastructure or mailbox consent. All examples are synthetic. Known limitations and implementation gates are explicitly recorded in the risk register.
