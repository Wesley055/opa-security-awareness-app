"use client";
import { useCallback, useEffect, useState } from "react";
import { viewerSessionFetch } from "@/lib/viewer-session-fetch";
import { DutyReportList, type DutyTotals } from "./duty-reports";

type Current = {
  shift: { id: string; startedAt: string } | null;
  photoApproved: boolean;
  reportsMissing: { shiftId: string; startedAt: string; endedAt: string }[];
  maxShiftHours: number;
};
type Preview = { totals: DutyTotals; sections: { key: string; [k: string]: number | string }[]; membersLabel: string };
type Item = { text: string; category: "HANDOVER" | "UNRESOLVED" | "OBSERVATION" };

const fmt = (iso: string) => new Date(iso).toLocaleString();
const btn = "min-h-11 rounded-md border border-line px-4 text-sm font-medium text-ink hover:bg-panel-2 disabled:opacity-60";
const primary = "min-h-11 rounded-md bg-[#e5484d] px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60";

async function post(body: unknown) {
  const r = await viewerSessionFetch("/api/operator/duty", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { ok: r.ok, data: await r.json().catch(() => ({})) };
}

/**
 * Operator duty shift and report. A duty shift is a reporting record only:
 * the incident queue and every emergency action work without one.
 */
export function DutyPanel() {
  const [current, setCurrent] = useState<Current | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [draft, setDraft] = useState<Item>({ text: "", category: "HANDOVER" });
  const [lateFor, setLateFor] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [listKey, setListKey] = useState(0);

  const load = useCallback(async () => {
    const r = await viewerSessionFetch("/api/operator/duty", { cache: "no-store" });
    const data = await r.json().catch(() => null);
    if (r.ok) setCurrent(data);
    else setNotice(data?.error ?? "Duty status is unavailable. Retry.");
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function start() {
    setBusy(true);
    const { ok, data } = await post({ action: "start" });
    setBusy(false);
    setNotice(ok ? "Duty shift started." : data.error ?? "Could not start the shift.");
    if (ok) void load();
  }
  async function loadPreview() {
    const r = await viewerSessionFetch("/api/operator/duty?view=preview", { cache: "no-store" });
    const data = await r.json().catch(() => null);
    if (r.ok) setPreview(data);
    else setNotice(data?.error ?? "Could not prepare the report.");
  }
  async function submit() {
    setBusy(true);
    const { ok, data } = await post({ action: "submit", notes, handoverItems: items, ...(lateFor ? { shiftId: lateFor } : {}) });
    setBusy(false);
    if (!ok) return setNotice(data.error ?? "The report was not submitted. Your notes are still here; try again.");
    setNotice(`Report submitted${data.late ? " (late)" : ""}. ${data.adminsNotified ? `Your Facility Admin${data.adminsNotified > 1 ? "s were" : " was"} emailed.` : "It is waiting in Duty Reports for your Facility Admin."}`);
    setNotes(""); setItems([]); setPreview(null); setLateFor(null); setListKey((k) => k + 1);
    void load();
  }
  function addItem() {
    if (!draft.text.trim()) return;
    setItems((x) => [...x, { ...draft, text: draft.text.trim() }].slice(0, 50));
    setDraft({ text: "", category: draft.category });
  }

  const writing = !!current?.shift || !!lateFor;
  return (
    <section aria-labelledby="duty-heading" className="mt-6 rounded-xl border border-line bg-panel p-5 text-ink">
      <h2 id="duty-heading" className="text-xl font-bold">Duty Reports</h2>
      <p className="mt-1 text-sm text-muted">What happened during your shift. Emergencies never wait for this: you can respond to every SOS with or without a shift.</p>
      {notice ? <p role="status" className="mt-3 rounded-md border border-line bg-panel-2 px-3 py-2 text-sm">{notice}</p> : null}

      {current?.reportsMissing.length ? (
        <div className="mt-4 rounded-md border border-[#e5484d]/50 bg-[#e5484d]/10 p-3 text-sm">
          <p className="font-semibold">Your report is still needed for {current.reportsMissing.length === 1 ? "a shift" : `${current.reportsMissing.length} shifts`} OPA closed after {current.maxShiftHours} hours.</p>
          <p className="text-muted">OPA generated a backup summary, but it does not replace your report.</p>
          {current.reportsMissing.map((m) => (
            <button key={m.shiftId} type="button" className={btn + " mt-2 mr-2"} onClick={() => { setLateFor(m.shiftId); setPreview(null); }}>
              Write report for {fmt(m.startedAt)}
            </button>
          ))}
        </div>
      ) : null}

      {current && !current.shift && !lateFor ? (
        <div className="mt-4">
          {!current.photoApproved ? <p className="mb-2 text-sm">A profile photo approved by your Facility Admin is needed to start a duty shift. <a className="underline" href="/operator/profile">Add or check your photo</a>.</p> : null}
          <button type="button" className={primary} disabled={busy || !current.photoApproved} onClick={() => void start()}>Start duty</button>
        </div>
      ) : null}

      {writing ? (
        <div className="mt-4 grid gap-3">
          {current?.shift && !lateFor ? <p className="text-sm">On duty since <strong>{fmt(current.shift.startedAt)}</strong>.</p> : null}
          {lateFor ? <p className="text-sm">Late report for the shift OPA closed. It will be marked as submitted late.</p> : null}
          {current?.shift && !lateFor ? (
            <div>
              <button type="button" className={btn} onClick={() => void loadPreview()}>Show what OPA has recorded so far</button>
              {preview ? (
                <dl className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
                  <div><dt className="text-muted">Raised</dt><dd>{preview.totals.raised}</dd></div>
                  <div><dt className="text-muted">Carried over</dt><dd>{preview.totals.carriedOver}</dd></div>
                  <div><dt className="text-muted">Acknowledged</dt><dd>{preview.totals.acknowledged}</dd></div>
                  <div><dt className="text-muted">Not acknowledged or unknown</dt><dd>{preview.totals.notAcknowledgedOrUnknown}</dd></div>
                  <div><dt className="text-muted">Still open</dt><dd>{preview.totals.stillOpenAtCutoff}</dd></div>
                </dl>
              ) : null}
            </div>
          ) : null}
          <label className="grid gap-1 text-sm">Observations and notes
            <textarea className="min-h-28 rounded-md border border-line bg-panel-2 p-2 text-ink" maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What should the next shift and your admin know?" />
          </label>
          <div className="grid gap-2 text-sm">
            <span>Handover and unresolved items</span>
            <div className="flex flex-wrap gap-2">
              <select aria-label="Item type" className="min-h-11 rounded-md border border-line bg-panel-2 px-2 text-ink" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as Item["category"] })}>
                <option value="HANDOVER">Handover</option>
                <option value="UNRESOLVED">Unresolved issue</option>
                <option value="OBSERVATION">Observation</option>
              </select>
              <input aria-label="Item" className="min-h-11 flex-1 rounded-md border border-line bg-panel-2 px-2 text-ink" maxLength={500} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addItem(); } }} />
              <button type="button" className={btn} onClick={addItem}>Add</button>
            </div>
            {items.length ? (
              <ul className="grid gap-1">
                {items.map((it, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 rounded-md border border-line px-2 py-1">
                    <span><span className="text-muted">{it.category === "HANDOVER" ? "Handover" : it.category === "UNRESOLVED" ? "Unresolved" : "Observation"}:</span> {it.text}</span>
                    <button type="button" className="text-xs underline" onClick={() => setItems((x) => x.filter((_, j) => j !== i))}>Remove</button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primary} disabled={busy} onClick={() => void submit()}>{lateFor ? "Submit late report" : "End duty and submit report"}</button>
            {lateFor ? <button type="button" className={btn} onClick={() => setLateFor(null)}>Cancel</button> : null}
          </div>
          <p className="text-xs text-muted">Your report goes to your facility&apos;s administrators. OPA routes it for you; you never need their email address.</p>
        </div>
      ) : null}

      <DutyReportList key={listKey} source="operator" />
    </section>
  );
}
