"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { viewerSessionFetch } from "@/lib/viewer-session-fetch";
import { validReportWindow } from "@/lib/insight-contract";
import type { InsightSummary } from "@/lib/insight-contract";
function Breakdown({
  title,
  values,
}: {
  title: string;
  values: Record<string, number>;
}) {
  return (
    <section className="rounded-xl border border-line bg-panel p-5">
      <h2 className="text-lg font-bold">{title}</h2>
      {Object.keys(values).length ? (
        <dl>
          {Object.entries(values).map(([key, value]) => (
            <div key={key} className="mt-2 flex justify-between gap-4">
              <dt>{key.replaceAll("_", " ")}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p>No recorded outcomes in this window.</p>
      )}
    </section>
  );
}
export function ReportingShell({
  transport,
  facilityId,
}: {
  transport?: (path: string, init?: RequestInit) => Promise<Response>;
  facilityId?: string;
} = {}) {
  const [from, setFrom] = useState(() =>
    new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
  );
  const [to, setTo] = useState(() =>
    new Date(Date.now() + 86400000).toISOString().slice(0, 10),
  );
  const [summary, setSummary] = useState<InsightSummary | null>(null);
  const [message, setMessage] = useState(
    "Choose a date window and load the report.",
  );
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    const lifecycle = generation;
    const invalidate = () => {
      generation.current++;
      setSummary(null);
      setBusy(false);
      setMessage("Report cleared. Revalidate access by loading it again.");
    };
    const visible = () => {
      if (!document.hidden) invalidate();
    };
    window.addEventListener("opa:access-changed", invalidate);
    window.addEventListener("opa-institutional-authority-lost", invalidate);
    window.addEventListener("focus", visible);
    window.addEventListener("pageshow", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      lifecycle.current++;
      window.removeEventListener(
        "opa-institutional-authority-lost",
        invalidate,
      );
      window.removeEventListener("opa:access-changed", invalidate);
      window.removeEventListener("focus", visible);
      window.removeEventListener("pageshow", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  async function load() {
    const current = ++generation.current;
    setSummary(null);
    if (!validReportWindow(from, to)) {
      setMessage("Choose a valid date range of at most 366 days.");
      return;
    }
    setBusy(true);
    setMessage("Loading authorized aggregate report…");
    try {
      const query = new URLSearchParams({
        from: from + "T00:00:00.000Z",
        to: to + "T00:00:00.000Z",
      });
      if (facilityId) query.set("facilityId", facilityId);
      const response = transport
        ? await transport("reports?" + query, { cache: "no-store" })
        : await viewerSessionFetch("/api/operator/reports?" + query, {
            cache: "no-store",
          });
      if (current !== generation.current) return;
      if (!response.ok) {
        setMessage(
          [401, 403, 404].includes(response.status)
            ? "Reporting access is no longer authorized. Reload to verify your account and facility."
            : response.status === 400
              ? "This window cannot be reported. Narrow the date range and retry."
              : "Reporting is temporarily unavailable. Retry without signing out.",
        );
        return;
      }
      const body = await response.json();
      if (current !== generation.current) return;
      setSummary(body.summary);
      setMessage(
        body.summary.incidentCount
          ? "Report loaded."
          : "No incidents in this date window.",
      );
    } catch {
      if (current === generation.current)
        setMessage(
          "Reporting is temporarily unavailable. Retry without signing out.",
        );
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  return (
    <section
      className="mx-auto max-w-7xl bg-base p-4 text-ink sm:p-6"
      style={
        {
          "--color-base": "#121212",
          "--color-panel": "#1E252B",
          "--color-ink": "#FFFFFF",
        } as CSSProperties
      }
    >
      <h1 className="text-3xl font-bold">Reports &amp; Analytics</h1>
      <p className="mt-2 text-muted">
        Current authorized facility · UTC dates · start included, end excluded.
        Maximum 366 days.
      </p>
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
            onChange={(e) => {
              generation.current++;
              setBusy(false);
              setFrom(e.target.value);
              setSummary(null);
            }}
            className="block rounded border border-line bg-panel p-2"
          />
        </label>
        <label>
          Until (exclusive)
          <input
            aria-label="Until (exclusive)"
            type="date"
            value={to}
            onChange={(e) => {
              generation.current++;
              setBusy(false);
              setTo(e.target.value);
              setSummary(null);
            }}
            className="block rounded border border-line bg-panel p-2"
          />
        </label>
        <button
          disabled={busy}
          className="min-h-11 rounded border border-line bg-[#FFB300] px-4 text-[#121212] focus-visible:outline-[#FFB300] disabled:opacity-60"
        >
          {busy ? "Loading…" : "Load report"}
        </button>
      </form>
      <p role="status">{message}</p>
      {summary && (
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <Breakdown
            title="Incidents"
            values={{
              Total: summary.incidentCount,
              Unresolved: summary.unresolved,
              "Unresolved for at least 24 hours": summary.staleUnresolved,
            }}
          />
          <section className="rounded-xl border border-line bg-panel p-5">
            <h2 className="text-lg font-bold">Resolution latency</h2>
            <p>
              {summary.resolutionMeanMs === null
                ? "Unknown"
                : (summary.resolutionMeanMs / 60000).toFixed(1) +
                  " minutes mean"}
            </p>
            <p>
              Known: {summary.resolutionKnown} · Unknown:{" "}
              {summary.resolutionUnknown}
            </p>
            <p>
              Acknowledgement latency is not enabled in this reporting contract.
            </p>
          </section>
          <Breakdown title="Notification outcomes" values={summary.delivery} />
          <section className="rounded-xl border border-line bg-panel p-5">
            <h2 className="text-lg font-bold">Evidence coverage</h2>
            <p>
              {summary.evidencePresent} / {summary.evidencePossible} source
              checks present
            </p>
            <p>{summary.missingEvidence} incidents without stored evidence</p>
            <p>
              {summary.missingClosureProvenance} closed incidents without
              closure provenance
            </p>
            <p>Coverage does not prove quality or regulatory compliance.</p>
          </section>
          <Breakdown title="Corrective actions" values={summary.actions} />
          <Breakdown title="Incident triggers" values={summary.byTrigger} />
          <Breakdown title="Activation sources" values={summary.bySource} />
          <Breakdown title="Activation modes" values={summary.byMode} />
          <Breakdown title="Daily incidents (UTC)" values={summary.byDay} />
        </div>
      )}
      <p className="mt-6 text-sm text-muted">
        Provider acceptance is not confirmed delivery. Structured versioned
        after-incident reports and JSON export are backend only.
        Corrective-action authoring is not enabled here. PDF, CSV and AI
        reporting are not enabled.
      </p>
    </section>
  );
}
