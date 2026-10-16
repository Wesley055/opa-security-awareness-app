"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { viewerSessionFetch } from "@/lib/viewer-session-fetch";
import { validReportWindow } from "@/lib/insight-contract";
import type { HeadOfficeSummary, Latency } from "@/lib/organization-insight";

const minutes = (l: Latency) =>
  l.meanMs === null ? "Unknown" : (l.meanMs / 60000).toFixed(1) + " min";

function Tile({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      {note ? <p className="mt-1 text-xs text-muted">{note}</p> : null}
    </div>
  );
}

/**
 * Head Office: aggregate figures across the signed-in organization's
 * branches. The organization comes from the account, never from this page.
 */
export function HeadOffice({
  transport,
}: {
  transport?: (path: string, init?: RequestInit) => Promise<Response>;
} = {}) {
  const [from, setFrom] = useState(() =>
    new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
  );
  const [to, setTo] = useState(() =>
    new Date(Date.now() + 86400000).toISOString().slice(0, 10),
  );
  const [region, setRegion] = useState("");
  const [live, setLive] = useState(false);
  const [summary, setSummary] = useState<HeadOfficeSummary | null>(null);
  const [message, setMessage] = useState("Choose a date window and load the Head Office view.");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);

  useEffect(() => {
    const invalidate = () => {
      generation.current++;
      setSummary(null);
      setLive(false);
      setMessage("Access changed. Load the view again to revalidate.");
    };
    window.addEventListener("opa:access-changed", invalidate);
    return () => window.removeEventListener("opa:access-changed", invalidate);
  }, []);

  async function load(quiet = false) {
    const current = ++generation.current;
    if (!validReportWindow(from, to)) {
      setMessage("Choose a valid date range of at most 366 days.");
      return;
    }
    if (!quiet) {
      setBusy(true);
      setMessage("Loading Head Office view…");
    }
    try {
      const query = new URLSearchParams({
        from: from + "T00:00:00.000Z",
        to: to + "T00:00:00.000Z",
      });
      if (region) query.set("region", region);
      const response = transport
        ? await transport("organization/insight?" + query, { cache: "no-store" })
        : await viewerSessionFetch("/api/organization/insight?" + query, {
            cache: "no-store",
          });
      if (current !== generation.current) return;
      if (!response.ok) {
        setSummary(null);
        setLive(false);
        setMessage(
          [401, 403].includes(response.status)
            ? "Head Office access is no longer authorized. Sign in again."
            : response.status === 400
              ? "This window cannot be reported. Narrow the date range or choose a region."
              : "Head Office reporting is temporarily unavailable. Retry without signing out.",
        );
        return;
      }
      const body = await response.json();
      if (current !== generation.current) return;
      setSummary(body.summary);
      setMessage(
        "Updated " +
          new Date(body.summary.observedAt).toLocaleTimeString() +
          (body.summary.branches.length ? "." : ". No active branches match this view."),
      );
    } catch {
      if (current === generation.current)
        setMessage("Head Office reporting is temporarily unavailable. Retry without signing out.");
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }

  // Live mode refreshes open incidents once a minute while the tab is visible.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => {
      if (!document.hidden) void loadRef.current(true);
    }, 60000);
    return () => clearInterval(timer);
  }, [live]);

  const t = summary?.totals;
  return (
    <section
      className="mx-auto min-h-full max-w-7xl bg-base p-4 text-ink sm:p-6"
      style={
        {
          "--color-base": "#121212",
          "--color-panel": "#1E252B",
          "--color-ink": "#FFFFFF",
        } as CSSProperties
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-protection">
            OPA Head Office
          </p>
          <h1 className="text-3xl font-bold">
            {summary?.organization.name ?? "Head Office"}
          </h1>
          <p className="mt-2 text-muted">
            All branches · aggregate figures only · UTC dates, end excluded.
          </p>
        </div>
        <form action="/api/operator/logout" method="post">
          <button className="min-h-11 rounded border border-line px-4">Sign out</button>
        </form>
      </div>

      <form
        className="my-6 flex flex-wrap items-end gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <label>
          From
          <input
            aria-label="From"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="block rounded border border-line bg-panel p-2"
          />
        </label>
        <label>
          Until (exclusive)
          <input
            aria-label="Until (exclusive)"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="block rounded border border-line bg-panel p-2"
          />
        </label>
        <label>
          Region
          <select
            aria-label="Region"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            className="block rounded border border-line bg-panel p-2"
          >
            <option value="">All regions</option>
            {(summary?.regions ?? []).map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={busy}
          className="min-h-11 rounded border border-line bg-[#FFB300] px-4 text-[#121212] disabled:opacity-60"
        >
          {busy ? "Loading…" : "Load view"}
        </button>
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            checked={live}
            disabled={!summary}
            onChange={(e) => setLive(e.target.checked)}
          />
          Live (refresh every minute)
        </label>
      </form>
      <p role="status">{message}</p>

      {summary && t && (
        <>
          <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Tile label="Open incidents now" value={t.openNow} note={t.branches + " branches"} />
            <Tile label="Incidents in window" value={t.incidentCount} note={t.staleUnresolved + " unresolved ≥ 24h"} />
            <Tile label="Acknowledgement time" value={minutes(t.acknowledgement)} note={t.acknowledgement.unknown + " not acknowledged or unknown"} />
            <Tile label="Overdue corrective actions" value={t.overdueActions} note={t.openActions + " open"} />
          </div>
          <div className="mt-6 overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[56rem] text-left text-sm">
              <caption className="sr-only">Branches</caption>
              <thead className="bg-panel">
                <tr>
                  {["Branch", "Region", "Open now", "Incidents", "Unresolved ≥ 24h", "Ack time", "Resolution time", "Delivered / accepted / failed", "Overdue actions"].map((h) => (
                    <th key={h} scope="col" className="p-3 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {summary.branches.map((b) => (
                  <tr key={b.facilityId} className="border-t border-line">
                    <th scope="row" className="p-3 font-semibold">{b.name}</th>
                    <td className="p-3">{b.region ?? "Not set"}</td>
                    <td className={"p-3 " + (b.openNow ? "font-bold text-[#FFB300]" : "")}>{b.openNow}</td>
                    <td className="p-3">{b.incidentCount}</td>
                    <td className="p-3">{b.staleUnresolved}</td>
                    <td className="p-3">{minutes(b.acknowledgement)}</td>
                    <td className="p-3">{minutes(b.resolution)}</td>
                    <td className="p-3">
                      {b.delivered} / {b.providerAccepted} / {b.failed}
                    </td>
                    <td className="p-3">{b.overdueActions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="mt-6 text-sm text-muted">
        Aggregates only: no incident details, residents, evidence or locations.
        Acknowledgement counts identified Command Center operators. Provider
        acceptance is not confirmed delivery. OPA staff do not have access to
        this view.
      </p>
    </section>
  );
}
