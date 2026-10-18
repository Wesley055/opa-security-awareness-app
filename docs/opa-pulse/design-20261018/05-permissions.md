# Role and permission matrix

Legend: O = owned/assigned; T = approved team/territory; C = explicitly approved commercial organization scope; A = assigned content/learning audience; — = denied. All grants expire/review, require active employment and exclude payroll. Role does not itself override record restrictions. BD Manager and Sales Manager share management controls within their separate scopes.

| Capability | Sales Exec / BD | Sales/BD Manager | Commercial Ops | Executive | Support/Engineering | HR | Scoped Admin |
|---|---|---|---|---|---|---|---|
| Personal workspace/profile/security | O | O | O | O | O | O | O |
| CRM accounts/contacts/leads/deals read | O | T | C by grant | C by grant | Assigned handover | — | Metadata only |
| Create/edit commercial records | O | T | C | — by default | Handover fields | — | — |
| Assign owners/territories | — | T | C with manager approval | — | — | — | Apply approved grants |
| Bulk import / merge | Propose | Review T | C execute approved preview | — | — | — | — |
| Quote/proposal author | O | T | C | — | Technical section contribution | — | — |
| Proposal/discount approve | — | T within tier | Policy-specific reviewer | High tier if granted | Fact technical review only | — | — |
| Customer communications | Own mailbox + allowed records | Own mailbox + allowed records | Own mailbox + allowed records | Own mailbox + allowed records | Own mailbox if granted | Own mailbox if granted | Own mailbox if granted |
| Another employee private mailbox | — | — | — | — | — | — | — |
| Linked CRM communication snapshot | O ACL | T ACL | C ACL | C ACL | Assigned ACL | — | — |
| Revenue analytics/drilldown | O | T | C | C | Sanitized demand only | — | Security metadata only |
| Export customer PII | Request O | Approve T except own | Execute approved C | Request C | — | — | — |
| Academy consume/assessments | A/O | A/O | A/O | A/O | A/O | A/O | A/O |
| Academy author | Assigned author | Playbook owner | Templates/catalog owner | Strategy owner | Technical fact owner | HR modules | — |
| Approve Academy/facts | — | Assigned reviewer | Assigned reviewer | Assigned reviewer | Independent technical reviewer | Independent HR reviewer | — |
| Learning completion reporting | O | T progress summary | Assigned program aggregate | C aggregate | O or granted team | Onboarding summaries | No answers |
| Employment change / payroll | — | — | — | — | — | People only | — |
| Invite/revoke sessions/grants | Self sessions | Request T | — | — | — | People lifecycle authority | Scoped approved administration |
| Audit access | Own action receipts | T business events | C business events | C business summary | Own | Lifecycle summary | Security events by grant |

## Policy evaluation and oversight

Evaluate organization → current employee status/auth epoch → action grant → department/territory/object ACL → field policy → approval/step-up requirements. Any explicit deny wins. A manager can see permitted commercial performance and company-linked notes, never private mail or salary. An executive dashboard cannot drill through to records outside that executive's grant. Search snippets, counts, attachments, background jobs and AI context follow the same policy.

Sensitive account restrictions require explicit additional grant even inside a manager territory. Branch restrictions do not automatically widen parent account visibility. Multi-owner account teams use explicit dated memberships; default owner assignment does not transfer mailbox. When a manager changes, old team grants expire atomically and caches/search are invalidated with policy version.

No self-approval of grants, proposal release, content publication or exports. Delegates have explicit scope, start/end and alternate independent approver. If no eligible approver exists, block and surface configuration issue; never silently auto-approve.

## Proposed commercial approval limits

These defaults require founder approval before use. All customer-facing proposals require independent commercial review plus valid technical facts. Discounts ≤5% require scoped manager; >5–15% require manager and Commercial Ops; >15%, nonstandard liability, free pilot extension or custom feature commitment requires designated executive plus Ops. Planned capability inclusion additionally requires product owner and explicit non-commitment language. No requester may serve as their own approver; if roles overlap select an independent delegate. FX/tax overrides require Ops review. Limit calculation uses effective total concession including free months/waived setup, not only line discount.

Emergency security suspend is permitted to designated security administrator with reason and audit; it cannot grant data access or impersonation. Support uses consented screen sharing or metadata diagnostics, with no general impersonation function.
