# Commercial analytics and KPI dictionary

All metrics return metricVersion, event-time window [start,end), asOf, reporting timezone (Africa/Lagos default), currency basis, FX snapshot, permission scope, source revision, row coverage and missing-data reasons. Never aggregate different currencies without explicit conversion. Drill-down must reproduce numerator and denominator on authorized source IDs; aggregates are computed after ACL filtering. Filters persist visibly. Data lag appears beside values.

| KPI | Exact proposed definition | Sources / caveats |
|---|---|---|
| Open pipeline value | Sum net expected contract value of open opportunities with close_date within selected period, by currency | Opportunity current revision at asOf; exclude Lost/Won; separate missing close/value coverage |
| Weighted pipeline | Σ(open opportunity net amount × stage probability from pinned probability version) | Stage probabilities initially policy assumptions, not calibrated confidence |
| Sales forecast | Closed-Won booked net value in period + weighted open eligible value closing in period; show conservative/base/upside separately | Never add closed Won again to open pipeline; recurring run-rate and revenue forecasts are separate |
| Booked recurring MRR | Σ monthly-normalized recurring contract lines for signed contracts effective in period, separately flagged if service not active | Annual/12, quarterly/3; exclude setup/tax/pass-through; no billing evidence means booked, not recognized |
| Active contracted MRR | Σ monthly-normalized recurring lines for active subscriptions at asOf after effective cancellations/amendments | Contract/service dates; exclude future starts; label unbilled/delinquent separately |
| ARR | 12 × applicable MRR, with booked versus active label | Not total contract value, cash collected or accounting revenue |
| Recognized revenue | Only from approved finance ledger integration using its accounting period/rules | Unavailable until finance contract exists; do not estimate from deals |
| Win rate | Won / (Won + Lost) by final decision date in period | Open excluded; no decisions → unavailable; reopened deals counted at final closure as of snapshot, revision disclosed |
| Lead qualification | Leads first qualified / captured cohort, observed through selected cutoff | Deduplicated canonical lead IDs; show disqualified and still pending; no moving denominator |
| Stage conversion | Distinct opportunities entering next stage / cohort first entering source stage | Define forward progression; skips counted in explicit skipped-stage bucket, not fabricated intermediate visits |
| Sales cycle | Median and p75 elapsed calendar days from first Qualified entry to final Won | Won only, include n; losses separate; reopened time retained; show still-open age/right-censoring |
| Stage duration | Median/p75 sum time in each stage across visits through close/asOf | Re-entry does not reset accumulated duration; business-day view optional and labeled |
| Territory/rep attainment | Closed-Won net value attributed under effective-dated credit policy / dated target | Split credits sum 100%; historical transfers retain credit; separate current ownership pipeline |
| Stalled opportunity rate | Open opportunities with no meaningful logged activity for ≥14 days / all open | Meaningful = meeting held, substantive reviewed shared reply, stage evidence or completed action; opens excluded |
| Renewal risk | Active renewal within 90 days flagged by missing owner/action, negative confirmed signal or unresolved service/commercial issue | Reasons/evidence visible; missing data means unknown risk, not healthy |
| Renewal retention | Renewed contracts / eligible expiring contracts for matured renewal cohort | Auto-renew eligibility explicit; exclusions shown, early/undecided separate |
| GRR | (opening recurring value − churn − contraction) / opening recurring value | Same cohort/currency basis; expansion excluded; zero opening → unavailable |
| NRR | (opening recurring value − churn − contraction + expansion) / opening recurring value | Same customer cohort, acquisitions excluded; FX-neutral and reported FX views labeled |
| Pilot conversion | Signed paid production contracts / completed eligible pilot cohort at 30/90-day cutoff | Ongoing pilots and immature cohorts separate; synthetic free pilots not revenue |
| Product demand | Count distinct accounts with reviewed product interest / eligible scoped accounts, by industry | Separate stated interest, quoted and Won; one account/product/window counted once |
| Objections/features | Distinct opportunity/request counts by approved taxonomy and industry | Preserve evidence, allow multi-tag counts with overlap disclosure; sanitized GitHub counts not customer details |
| Proposal turnaround | Median business hours from complete brief to final independent approval | Incomplete brief/paused customer input shown separately; no hidden exclusion |
| Learning completion | Completed required module versions / assigned required module versions, by due date | Older passed version remains history, not completion of new required version |
| Mail workflow health | Sync age, queued/failed/unknown sends, reply follow-up completion | No tracking-pixel/open-rate inference, no employee private-mail surveillance |

## Health and confidence

Explainable opportunity-health score proposal: confirmed next action 25, recent meaningful engagement 25, buying committee evidence 20, valid package/quote facts 15, documented timing/budget 15. Display component evidence, missing inputs and rule version. Unknown is not zero. Manual override stores actor/reason/expiry and both raw/overridden values. Score is coaching aid, not automatic employee performance assessment.

Forecast confidence initially shows data coverage and scenario range, not an invented statistical probability. When ≥100 mature relevant outcomes exist, evaluate calibration by stage/industry, Brier score, reliability bins and out-of-time holdout; report n and drift. A predictive model must beat the stage baseline and pass privacy/fairness review before use. No 95% confidence label without an actual stated estimator and assumptions.

## Synthetic reconciliation examples

Three open NGN deals: 12m at 0.60, 8m at 0.25, 5m at 0.20 → pipeline 25m and weighted 10.2m. Add Won 4m in period → bookings forecast 14.2m. USD pipeline remains a separate series unless pinned FX selected. Do not add the 25m pipeline to 14.2m forecast.

Starting active MRR 1m; churn 100k; contraction 50k; expansion 200k → GRR 85%, NRR 105%; new customer MRR 300k excluded from both retention ratios. Annual recurring contract 2.4m yields 200k normalized MRR; setup 600k excluded. Won 6/Lost 4/Open 8 yields 60% decision win rate, not 33.3%.

Late records create a revised snapshot rather than silently overwriting a board pack. Export includes definitions, filters, permission scope, as-of and FX version. Leadership may compare own authorized aggregate with a different scoped report only when both scopes are explicitly shown.
