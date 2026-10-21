"use client";
import { useCallback, useEffect, useState } from "react";
import { viewerSessionFetch } from "@/lib/viewer-session-fetch";

export type DutyTotals = { raised: number; carriedOver: number; acknowledged: number; notAcknowledgedOrUnknown: number; stillOpenAtCutoff: number };
type Row = {
  shiftId: string;
  operatorName: string;
  startedAt: string;
  endedAt: string | null;
  status: "IN_PROGRESS" | "SUBMITTED" | "SUBMITTED_LATE" | "OPERATOR_REPORT_MISSING";
  operatorReport: { id: string; submittedAt: string; late: boolean; acknowledged: boolean } | null;
  systemReport: { id: string; generatedAt: string; label: string } | null;
  totals: DutyTotals | null;
};
type IncidentRef = { id: string; reference: string; trigger: string; status: string; raisedAt: string; acknowledged: boolean; resolvedAt: string | null };
type Detail = {
  id: string;
  origin: "OPERATOR_SUBMITTED" | "SYSTEM_GENERATED";
  label: string;
  operatorName: string;
  submittedAt: string;
  sourceCutoff: string;
  document: { window: { from: string; to: string }; membersLabel: string; totals: DutyTotals; incidents: { raised: IncidentRef[]; carriedOver: IncidentRef[] }; sections: { key: string; [k: string]: number | string }[] };
  notes: string | null;
  handoverItems: { text: string; category: string }[];
  acknowledgedAt: string | null;
  changedSinceReport: string[];
};
type Transport = (path: string, init?: RequestInit) => Promise<Response>;

const STATUS: Record<Row["status"], string> = {
  IN_PROGRESS: "On duty",
  SUBMITTED: "Submitted",
  SUBMITTED_LATE: "Submitted late",
  OPERATOR_REPORT_MISSING: "Operator report missing",
};
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");
const enumText = (s: string) => s.replaceAll("_", " ").toLowerCase();

/**
 * Duty Reports list and detail, shared by the operator console (own reports)
 * and the Facility Admin's Reports & Analytics (all reports, acknowledge).
 */
export function DutyReportList({ source, transport }: { source: "operator" | "admin"; transport?: Transport }) {
  const fetcher: Transport = transport ?? ((p, i) => viewerSessionFetch(p, i));
  const base = source === "admin" ? "duty-reports" : "/api/operator/duty/reports";
  const [rows, setRows] = useState<Row[] | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const r = await fetcher(base, { cache: "no-store" });
    const data = await r.json().catch(() => null);
    if (r.ok && Array.isArray(data)) setRows(data);
    else setNotice(data?.error ?? "Duty reports are unavailable. Retry.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);
  useEffect(() => { void load(); }, [load]);

  async function open(id: string) {
    const r = await fetcher(`${base}/${id}`, { cache: "no-store" });
    const data = await r.json().catch(() => null);
    if (r.ok) setDetail(data);
    else setNotice(data?.error ?? "Could not open the report.");
  }
  async function acknowledge(id: string) {
    const r = await fetcher(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "acknowledge", id }) });
    const data = await r.json().catch(() => null);
    if (!r.ok) return setNotice(data?.error ?? "Could not acknowledge.");
    setNotice("Report acknowledged. The report itself is unchanged.");
    void load();
    void open(id);
  }

  const missing = rows?.filter((r) => r.status === "OPERATOR_REPORT_MISSING").length ?? 0;
  const unacknowledged = rows?.filter((r) => r.operatorReport && !r.operatorReport.acknowledged).length ?? 0;

  return (
    <div className="mt-5">
      <h3 className="text-lg font-bold">{source === "admin" ? "Duty Reports" : "My duty reports"}</h3>
      {source === "admin" && rows ? (
        <p className="mt-1 text-sm">
          {unacknowledged} waiting for acknowledgement · {missing} operator report{missing === 1 ? "" : "s"} missing
        </p>
      ) : null}
      {notice ? <p role="status" className="mt-2 text-sm">{notice}</p> : null}
      {rows && rows.length === 0 ? <p className="mt-2 text-sm text-muted">No duty shifts yet.</p> : null}
      {rows?.length ? (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead><tr className="text-muted"><th className="py-1 pr-3">Operator</th><th className="pr-3">Shift</th><th className="pr-3">Status</th><th className="pr-3">Incidents</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.shiftId} className="border-t border-line align-top">
                  <td className="py-2 pr-3">{r.operatorName}</td>
                  <td className="pr-3">{fmt(r.startedAt)} → {r.endedAt ? fmt(r.endedAt) : "now"}</td>
                  <td className="pr-3">
                    {STATUS[r.status]}
                    {r.operatorReport?.acknowledged ? " · acknowledged" : r.operatorReport ? " · not yet acknowledged" : ""}
                    {r.systemReport ? <span className="block text-xs text-muted">OPA backup summary on file</span> : null}
                  </td>
                  <td className="pr-3">{r.totals ? `${r.totals.raised} raised, ${r.totals.carriedOver} carried over` : "—"}</td>
                  <td className="whitespace-nowrap">
                    {r.operatorReport ? <button type="button" className="underline" onClick={() => void open(r.operatorReport!.id)}>Open report</button> : null}
                    {r.systemReport ? <button type="button" className="ml-3 underline" onClick={() => void open(r.systemReport!.id)}>OPA backup</button> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {detail ? (
        <article aria-label="Duty report" className="mt-4 rounded-lg border border-line p-4 text-sm">
          <p className={detail.origin === "SYSTEM_GENERATED" ? "font-semibold text-[#e5484d]" : "font-semibold"}>{detail.label}</p>
          <p className="mt-1">Operator: {detail.operatorName} · Shift {fmt(detail.document.window.from)} → {fmt(detail.document.window.to)} · Records up to {fmt(detail.sourceCutoff)}</p>
          {detail.changedSinceReport.length ? <p className="mt-1">Changed since this report: {detail.changedSinceReport.join(", ")}. Open the incident for its current state.</p> : null}
          <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            <div><dt className="text-muted">Raised</dt><dd>{detail.document.totals.raised}</dd></div>
            <div><dt className="text-muted">Carried over</dt><dd>{detail.document.totals.carriedOver}</dd></div>
            <div><dt className="text-muted">Acknowledged</dt><dd>{detail.document.totals.acknowledged}</dd></div>
            <div><dt className="text-muted">Not acknowledged or unknown</dt><dd>{detail.document.totals.notAcknowledgedOrUnknown}</dd></div>
            <div><dt className="text-muted">Still open at end</dt><dd>{detail.document.totals.stillOpenAtCutoff}</dd></div>
          </dl>
          {[["Raised this shift", detail.document.incidents.raised], ["Carried over", detail.document.incidents.carriedOver]].map(([title, list]) =>
            (list as IncidentRef[]).length ? (
              <div key={title as string} className="mt-3">
                <h4 className="font-semibold">{title as string}</h4>
                <ul className="mt-1 grid gap-1">
                  {(list as IncidentRef[]).map((i) => (
                    <li key={i.id}>{i.reference} · {enumText(i.trigger)} · {fmt(i.raisedAt)} · {i.acknowledged ? "acknowledged" : "not acknowledged or unknown"} · {i.resolvedAt ? "resolved" : "still open"}</li>
                  ))}
                </ul>
              </div>
            ) : null,
          )}
          {detail.document.sections.map((s) =>
            s.key === "visitors" ? (
              <p key="v" className="mt-3">Visitors: {s.entries} entries, {s.exits} exits, {s.denied} denied, {s.overstays} departures not confirmed{Number(s.manualEntries) ? `, ${s.manualEntries} manual entries` : ""}</p>
            ) : s.key === "safewalk" ? (
              <p key="s" className="mt-3">SafeWalk: {s.started} journeys started, {s.emergencies} emergencies</p>
            ) : null,
          )}
          {detail.origin === "OPERATOR_SUBMITTED" ? (
            <>
              <h4 className="mt-3 font-semibold">Operator notes</h4>
              <p className="whitespace-pre-wrap">{detail.notes || "None."}</p>
              {detail.handoverItems.length ? (
                <>
                  <h4 className="mt-3 font-semibold">Handover and unresolved items</h4>
                  <ul className="list-disc pl-5">{detail.handoverItems.map((h, i) => <li key={i}>{enumText(h.category)}: {h.text}</li>)}</ul>
                </>
              ) : null}
            </>
          ) : (
            <p className="mt-3">OPA generated this from recorded events only. It contains no operator observations, and the operator&apos;s own report is still required.</p>
          )}
          <p className="mt-3 text-xs text-muted">Counts come from the same records as OPA Insight. A duty report never changes an incident or its evidence.</p>
          {source === "admin" && detail.origin === "OPERATOR_SUBMITTED" ? (
            detail.acknowledgedAt ? <p className="mt-3">Acknowledged {fmt(detail.acknowledgedAt)}.</p> : <button type="button" className="mt-3 min-h-11 rounded-md bg-[#e5484d] px-4 font-semibold text-white" onClick={() => void acknowledge(detail.id)}>Acknowledge report</button>
          ) : null}
          <button type="button" className="ml-3 mt-3 underline" onClick={() => setDetail(null)}>Close</button>
        </article>
      ) : null}
    </div>
  );
}
