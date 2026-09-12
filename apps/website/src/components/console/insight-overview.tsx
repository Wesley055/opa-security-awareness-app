import type { InsightResult } from '@/lib/insight-overview';
const duration = (value: number | null) => value === null ? 'UNKNOWN' : Math.round(value / 1000) + ' seconds';
export function InsightOverview({ result }: { result: InsightResult }) {
  if (result.state !== 'READY') return <section aria-label="OPA Insight" className="mx-auto max-w-7xl p-4 sm:p-6">
    <h2 className="text-2xl font-bold">OPA Insight</h2><p role="status" className="mt-2">
      {result.state === 'DENIED' ? 'A reporting facility is required for this account.' : 'Reporting is temporarily unavailable. Please retry.'}
    </p></section>;
  const s = result.summary;
  const areas = [
    { title: 'Executive', items: [['Incidents', s.incidentCount], ['Unresolved', s.unresolved], ['Mean resolution time', duration(s.resolutionMeanMs)]] },
    { title: 'Operations', items: [['Incident acknowledgement time', duration(s.acknowledgementMeanMs)], ['Confirmed delivered', s.confirmedDelivered], ['Provider accepted, unconfirmed', s.providerAccepted]] },
    { title: 'Risk', items: [['Unresolved for at least 24 hours', s.staleUnresolved], ['Overdue corrective actions', s.overdueActions]] },
    { title: 'Evidence', items: [['Recorded coverage checks', s.evidencePresent + ' / ' + s.evidencePossible], ['Incidents without stored evidence', s.missingEvidence]] },
  ];
  return <section aria-label="OPA Insight" className="mx-auto max-w-7xl p-4 sm:p-6">
    <h2 className="text-2xl font-bold">OPA Insight</h2>
    <p className="mt-2 text-sm text-muted">Your facility · incidents created in the last 30 days. UNKNOWN means the source does not establish a value.</p>
    <div className="mt-4 grid gap-4 sm:grid-cols-2">{areas.map(area => <section key={area.title} className="rounded-xl border border-line bg-panel p-5">
      <h3 className="text-xl font-bold">{area.title}</h3><dl className="mt-3 space-y-3">{area.items.map(([label, value]) => <div key={label} className="flex flex-wrap justify-between gap-2">
        <dt>{label}</dt><dd className="font-semibold">{value}</dd></div>)}</dl>
    </section>)}</div>
    <p className="mt-3 text-sm text-muted">Coverage indicates recorded fields, not evidence quality or regulatory compliance. Provider acceptance does not establish handset delivery.</p>
  </section>;
}
