# OPA Proposal Studio and industry template specifications

## Governed template engine

One schema-driven composition engine: industry taxonomy → template version → typed sections → approved capability references + quote snapshot → approval snapshot → immutable DOCX/PDF artifacts. Adding healthcare later means registering an industry, input schema, section order, approved content and approval rules; no renderer rewrite. Unknown section types fail validation rather than silently disappearing.

Section types: cover, executive summary, needs/evidence, organization/site profile, outcomes, capability matrix, solution/package, architecture illustration, implementation schedule, responsibilities/RACI, pricing, assumptions/exclusions, support terms, risks, acceptance, signatures and appendix. Each section has stable ID, required flag, variables/schema, audience, allowed fact statuses, locale overrides, owner/review version and accessibility description. Visuals require licensed asset reference, alt text and evidence; no screenshot implies a capability is deployed.

Document metadata: proposal number PULSE-YYYY-sequence, institution/branch, author, approver, version, issue/expiry date, confidentiality, currency, template version and capability provenance manifest. Personal contact details included only when necessary. Template defaults are editable drafts, not signed commitments.

Canonical capability statuses:

| Status | Definition and required evidence | Customer treatment |
|---|---|---|
| DEPLOYED | Owner-attested release and environment/customer scope with operational evidence | Exact scoped claim only; not automatically available to every customer |
| VERIFIED | Reproducible test evidence/version/environment and independent reviewer | Tested claim; does not imply production deployment |
| PILOT | Limited evaluation scope, dates, success criteria and owner | Clearly limited availability, prerequisites and risk |
| PLANNED | Approved roadmap intent with no deployment guarantee | Separate future-options section, explicit non-commitment; product owner approval required |

Source labels LIVE map to DEPLOYED only when deployment evidence exists. IN DEVELOPMENT maps to PLANNED with maturityDetail=IN_DEVELOPMENT, never to VERIFIED. Store original label and mapping rationale. Unreviewed/expired facts are unavailable for customer insertion. No actual OPA capabilities have been certified in this package.

## Industry templates

All five inherit commercial/technical approval, evidence manifest, exact quote snapshot, accessibility/export checks and mandatory exclusions. Schedules below are illustrative relative weeks, contingent on discovery and owner approval, not delivery promises.

| Template | Required industry inputs and buying committee | Section emphasis and visuals | Package / schedule / approval specifics |
|---|---|---|---|
| Estates | Estate/management legal entity, sites/units, access model, connectivity survey, property manager, residents' representative and technical owner | Site topology, resident/management needs, approved capabilities by site, adoption/support plan, privacy boundaries | Modular per-site package with explicit unit assumptions; discovery W1, agreed configuration W2–3, supervised pilot W4, acceptance W5; no implied EstateFlow integration. Property/implementation owner reviews site assumptions |
| Schools | School group/campuses, staff/student populations as aggregate counts, safeguarding owner, school leadership/procurement/IT, term calendar | Campus needs, staff workflows, role restrictions, safeguarding/privacy responsibilities, training and escalation governance | Campus package plus approved staff training; discovery W1, policy review W2, pilot outside critical school periods W3–4, acceptance W5. No student PII in sample proposal, no safeguarding certification claim; designated privacy reviewer |
| Banking | Bank legal entity, branches, security/procurement/IT/risk committee, architecture review requirements, approved data boundaries | Branch hierarchy, integration constraints, audit/security evidence matrix, resilience assumptions, vendor due diligence and change controls | Per-branch or enterprise package from price book; discovery/due diligence W1–2, technical validation W3–4, controlled pilot W5–6, gated rollout plan after acceptance. No claim of CBN/regulatory approval, core-banking integration or residency without evidence; security/legal review |
| Oil and gas | Operator/contractor boundaries, onshore/offshore sites, connectivity constraints, HSE/procurement/IT/operations, worksite restrictions | Site/dependency map, connectivity assumptions, approved use cases, operational responsibilities, HSE and hazardous-area exclusions | Site package with explicit device/network prerequisites; survey W1–2, technical feasibility W3, supervised pilot W4–6, acceptance W7. No safety-critical control, hazardous-area certification, emergency response SLA or satellite capability inferred; HSE/technical review |
| Aviation | Airport/operator/airline entity, terminals/sites, airside/landside boundaries, security/IT/operations/procurement, approved change windows | Operational boundary diagrams, role/access governance, evidence-backed workflows, resilience and rollout constraints | Site/department package; discovery W1–2, security review W3–4, noncritical pilot W5–6, acceptance W7. No flight-control, airworthiness, aviation-security certification or safety-system integration claim; designated aviation-domain/security review |

Each template defines required variables, cardinality, validation, package eligibility, fact status filters and versioned module dependencies in metadata. Required unknown inputs render a blocking checklist, never generic confident prose. Customer requirements not met by an approved fact become gaps, assumptions or separately approved future options.

## Quote calculation

One currency per quote; ISO minor-unit rounding at line net and tax line using decimal half-up, sum rounded lines for total. quantity × unit_price → gross; line discount → net; applicable tax basis/rate from approved rule/version → tax; grand total = Σnet + Σtax. Show setup versus recurring charges, cadence, contract duration, renewal terms, taxes, withholding treatment assumptions and validity. Do not hardcode Nigerian tax rates or call a quote an invoice. Accountant must approve country/entity tax rules before use.

Example purely synthetic: 10 units × NGN 100,000.00 = NGN 1,000,000.00; 5% discount gives NGN 950,000.00 net. Tax is "pending approved rule", not zero; release blocked until resolved. FX appears only in an explicit alternate-currency quotation with source/date/rate and independently rounded totals. No hidden conversion of a customer's currency.

Policy computes total economic concession over full committed term, including free months, waived implementation and custom scope. Currency changes, tax/FX overrides, term changes or price-book expiry trigger recalculation and renewed approval. Quote validity proposed 30 days; facts/prices must remain valid at release and scheduled send.

## Approval and export

Draft → validated → independent technical/commercial review → approved content → render → artifact QA → release authorization → employee send. Reviewer sees diff, exact wording/evidence, discount tier and all artifact hashes. Document renders run without network in sandbox; templates are not arbitrary macros/scripts. Strip active content, external tracking and hidden comments before release. DOCX is macro-free; PDF is text-selectable, bookmarked and accessible to the renderer's supported standard (verify rather than promise unsupported tagging).

DOCX and PDF share canonical content snapshot; compare text, prices, sections, tables, headers/footers, page breaks, images, signature area and manifest. QA covers 1/10/30-page documents, long legal names, wrapped NGN amounts, African/Unicode names, empty optional sections and five template variants. Customer copy must not expose internal evidence URLs or private notes; internal manifest remains access-controlled. Delivery record pins exact attachment hashes/recipient set/time/provider status.

Editing the document offline creates an unapproved derivative. Re-upload requires scanning, new version and reapproval; a downloaded DOCX cannot be technically prevented from being edited, so only recorded approved artifacts may be sent through Pulse. Withdrawal blocks future release/sending and opens remediation tasks for already delivered versions.
