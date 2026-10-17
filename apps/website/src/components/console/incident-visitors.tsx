"use client";
import { useEffect, useState } from "react";
import { viewerSessionFetch } from "@/lib/viewer-session-fetch";

type Visitor = { visitorName: string; destination: string; status: string; checkedInAt: string | null; checkedOutAt: string | null };
const time = (v: string | null) => (v ? new Date(v).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" }) : "—");

/** EstateFlow context for responders. Renders nothing when there are no gate records. */
export function IncidentVisitors({ incidentId }: { incidentId: string }) {
  const [rows, setRows] = useState<Visitor[] | null>(null);
  useEffect(() => {
    let alive = true;
    viewerSessionFetch(`/api/estate/incidents/${incidentId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => alive && setRows(body?.visitors ?? []))
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
  }, [incidentId]);
  if (!rows || rows.length === 0) return null;
  return (
    <section aria-label="Visitors recorded for this household" className="mt-6 rounded-xl border border-[#FFB300] p-4">
      <h2 className="text-xl font-bold">Visitors recorded for this household</h2>
      <p className="text-sm text-muted">Gate records only: entry and exit as recorded by security, not confirmed presence.</p>
      <ul className="mt-2 space-y-1">
        {rows.map((v, i) => (
          <li key={i}>
            <span className="font-semibold">{v.visitorName}</span> → {v.destination} · in {time(v.checkedInAt)}
            {v.status === "CHECKED_IN" ? <span className="ml-2 font-bold text-[#FFB300]">Recorded inside</span> : ` · out ${time(v.checkedOutAt)}`}
          </li>
        ))}
      </ul>
    </section>
  );
}
