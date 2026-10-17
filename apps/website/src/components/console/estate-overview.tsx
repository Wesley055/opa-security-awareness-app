"use client";
import { useCallback, useEffect, useState } from "react";
import { viewerSessionFetch } from "@/lib/viewer-session-fetch";

type Overview = {
  observedAt: string;
  estate: string;
  settings: { visitorDefaultMinutes: number; overstayGraceMinutes: number };
  totals: { inside: number; entriesToday: number; issuedToday: number; departureUnconfirmed: number; openIncidents: number };
  recent: { type: string; occurredAt: string; destination: string | null; note: string | null }[];
};
const LABEL: Record<string, string> = { ENTRY: "Visitor entered", EXIT: "Visitor left", DENIED: "Entry denied", OVERSTAY: "Departure not confirmed", MANUAL_ENTRY: "Manual gate entry" };
const at = (v: string) => new Date(v).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });

function Tile({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className={"rounded-xl border bg-panel p-4 " + (warn && value ? "border-[#FFB300]" : "border-line")}>
      <p className="text-sm text-muted">{label}</p>
      <p className={"mt-1 text-3xl font-bold " + (warn && value ? "text-[#FFB300]" : "")}>{value}</p>
    </div>
  );
}

/** The estate administrator's landing page: what is happening at the estate now. */
export function EstateOverview() {
  const [data, setData] = useState<Overview | null>(null);
  const [message, setMessage] = useState("Loading…");
  const [visit, setVisit] = useState(""), [grace, setGrace] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await viewerSessionFetch("/api/estate/admin", { cache: "no-store" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) return setMessage(body.error ?? "Estate overview is unavailable.");
      setData(body);
      setVisit(String(body.settings.visitorDefaultMinutes));
      setGrace(String(body.settings.overstayGraceMinutes));
      setMessage("Updated " + new Date(body.observedAt).toLocaleTimeString("en-GB", { timeZone: "Africa/Lagos" }) + " WAT");
    } catch {
      setMessage("No connection. Retry when the network returns.");
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => !document.hidden && void load(), 60000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  const t = data?.totals;
  return (
    <section className="mx-auto max-w-6xl p-4 text-ink sm:p-6">
      <h1 className="text-2xl font-bold">{data?.estate ?? "Estate"} overview</h1>
      <p role="status" className="mt-1 text-sm text-muted">{message}</p>
      {t ? (
        <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-5">
          <Tile label="Open incidents" value={t.openIncidents} warn />
          <Tile label="Visitors recorded inside" value={t.inside} />
          <Tile label="Departures not confirmed" value={t.departureUnconfirmed} warn />
          <Tile label="Entries today" value={t.entriesToday} />
          <Tile label="Passes issued today" value={t.issuedToday} />
        </div>
      ) : null}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="text-lg font-bold">Recent gate activity</h2>
          <ul className="mt-2 divide-y divide-line text-sm">
            {(data?.recent ?? []).map((e, i) => (
              <li key={i} className="py-2">
                {at(e.occurredAt)} · {LABEL[e.type] ?? e.type}
                {e.destination ? ` → ${e.destination}` : ""}
                {e.type === "MANUAL_ENTRY" && e.note ? ` · ${e.note}` : ""}
              </li>
            ))}
            {data && data.recent.length === 0 ? <li className="py-2 text-muted">No gate activity yet.</li> : null}
          </ul>
        </div>
        <form
          className="rounded-xl border border-line bg-panel p-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await viewerSessionFetch("/api/estate/admin", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ visitorDefaultMinutes: Number(visit), overstayGraceMinutes: Number(grace) }),
            });
            const body = await r.json().catch(() => ({}));
            setMessage(r.ok ? "Visitor settings saved." : body.error ?? "Settings were not saved.");
            if (r.ok) void load();
          }}
        >
          <h2 className="text-lg font-bold">Visitor settings</h2>
          <label className="mt-3 block">
            Default visit length (minutes)
            <input aria-label="Default visit length" inputMode="numeric" value={visit} onChange={(e) => setVisit(e.target.value)} className="mt-1 block w-full rounded border border-line bg-base p-2" />
          </label>
          <label className="mt-3 block">
            Grace before &quot;departure not confirmed&quot; (minutes)
            <input aria-label="Overstay grace" inputMode="numeric" value={grace} onChange={(e) => setGrace(e.target.value)} className="mt-1 block w-full rounded border border-line bg-base p-2" />
          </label>
          <p className="mt-2 text-xs text-muted">Residents can set a different length per visit (deliveries, contractors, overnight guests).</p>
          <button className="mt-3 min-h-11 rounded border border-line px-4">Save settings</button>
        </form>
      </div>
    </section>
  );
}
