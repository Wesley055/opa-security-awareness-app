"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { viewerSessionFetch } from "@/lib/viewer-session-fetch";

type GatePass = {
  passId: string;
  status: string;
  visitorName: string;
  visitorPhone: string | null;
  destination: string;
  validFrom: string;
  validUntil: string;
  checkedInAt: string | null;
  expectedExitAt: string | null;
  overdue: boolean;
  action: "ADMIT" | "EXIT" | "TOO_EARLY";
};
type GateEventRow = { id: string; type: string; occurredAt: string; destination: string | null; visitorName: string | null; note: string | null };
type Board = { observedAt: string; inside: GatePass[]; events: GateEventRow[] };

const time = (v: string | null) =>
  v ? new Date(v).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" }) : "—";
const EVENT_LABEL: Record<string, string> = {
  ENTRY: "Entered",
  EXIT: "Left",
  DENIED: "Denied",
  VERIFY_FAILED: "Wrong code",
  OVERSTAY: "Departure not confirmed",
  MANUAL_ENTRY: "Manual entry",
};

async function gate(body?: Record<string, unknown>) {
  const response = await viewerSessionFetch("/api/estate/gate", {
    method: body ? "POST" : "GET",
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}

/**
 * The gate, for a basic Android phone or a shared gatehouse computer:
 * type the visitor's six-digit code, confirm the person and house, admit or
 * deny. QR scanning is optional and not required for any step.
 */
export function GateConsole() {
  const [code, setCode] = useState("");
  const [found, setFound] = useState<GatePass | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const [manual, setManual] = useState("");
  const codeInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    // Bounded retry for reading only; gate decisions are never retried automatically.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await gate();
        if (r.ok) {
          setBoard(r.data as Board);
          setOffline(false);
          return;
        }
        if (r.status !== 503) return;
      } catch {
        /* network */
      }
      await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
    }
    setOffline(true);
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 30000);
    const goOnline = () => void refresh();
    const goOffline = () => setOffline(true);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [refresh]);

  async function act(body: Record<string, unknown>, success: string) {
    setBusy(true);
    setMessage(null);
    try {
      const r = await gate(body);
      if (!r.ok) {
        if (r.status === 503) setOffline(true);
        setMessage({ tone: "error", text: (r.data as { error?: string }).error ?? "The request was refused." });
        return null;
      }
      setOffline(false);
      setMessage({ tone: "ok", text: success });
      return r.data as { pass?: GatePass };
    } catch {
      setOffline(true);
      setMessage({ tone: "error", text: "No connection. Use the paper gate log, then record it here when the network returns." });
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setFound(null);
    const data = await act({ action: "verify", code }, "Code accepted. Check the visitor's name and the house.");
    if (data?.pass) {
      setFound(data.pass);
      if (data.pass.action === "TOO_EARLY")
        setMessage({ tone: "warn", text: "This visit has not started yet. Check the date with the resident." });
    }
  }

  async function decide(action: "admit" | "deny" | "exit", passId: string) {
    const labels = { admit: "Visitor admitted.", deny: "Entry denied and recorded.", exit: "Exit recorded." };
    const data = await act({ action, passId }, labels[action]);
    if (data) {
      setFound(null);
      setCode("");
      codeInput.current?.focus();
      void refresh();
    }
  }

  return (
    <section className="mx-auto max-w-3xl p-4 text-ink sm:p-6">
      <h1 className="text-2xl font-bold">Gate</h1>
      <p className="mt-1 text-muted">Ask the visitor for their 6-digit code. Then check their name and the house before you admit them.</p>

      {offline ? (
        <p role="alert" className="mt-4 rounded-lg border border-[#FFB300] p-3 text-[#FFB300]">
          No connection to OPA. Keep using the paper gate log. When the network returns, record those entries below.
        </p>
      ) : null}

      <form onSubmit={verify} className="mt-5 flex flex-wrap items-end gap-3">
        <label className="flex-1">
          Visitor code
          <input
            ref={codeInput}
            aria-label="Visitor code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            autoComplete="off"
            placeholder="6 digits"
            maxLength={9}
            required
            className="mt-1 block w-full rounded-lg border border-line bg-panel p-3 text-3xl tracking-[0.3em]"
          />
        </label>
        <button disabled={busy} className="min-h-14 rounded-lg bg-[#FFB300] px-6 text-lg font-bold text-[#121212] disabled:opacity-60">
          {busy ? "Checking…" : "Check code"}
        </button>
      </form>

      {message ? (
        <p role={message.tone === "error" ? "alert" : "status"} className={"mt-3 " + (message.tone === "ok" ? "text-protection" : message.tone === "warn" ? "text-[#FFB300]" : "text-[#FF7B72]")}>
          {message.text}
        </p>
      ) : null}

      {found ? (
        <div className="mt-4 rounded-xl border border-line bg-panel p-4">
          <p className="text-sm text-muted">Visitor</p>
          <p className="text-2xl font-bold">{found.visitorName}</p>
          {found.visitorPhone ? <p className="text-muted">Phone {found.visitorPhone}</p> : null}
          <p className="mt-2 text-sm text-muted">Going to</p>
          <p className="text-xl font-semibold">{found.destination}</p>
          <p className="mt-2 text-sm text-muted">
            {found.action === "EXIT"
              ? `Inside since ${time(found.checkedInAt)} · expected out ${time(found.expectedExitAt)}`
              : `Valid until ${new Date(found.validUntil).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" })} WAT`}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            {found.action === "EXIT" ? (
              <button disabled={busy} onClick={() => decide("exit", found.passId)} className="min-h-14 flex-1 rounded-lg bg-protection px-6 text-lg font-bold text-[#08111A]">
                Record exit
              </button>
            ) : (
              <>
                <button disabled={busy || found.action === "TOO_EARLY"} onClick={() => decide("admit", found.passId)} className="min-h-14 flex-1 rounded-lg bg-protection px-6 text-lg font-bold text-[#08111A] disabled:opacity-50">
                  Admit
                </button>
                <button disabled={busy} onClick={() => decide("deny", found.passId)} className="min-h-14 flex-1 rounded-lg border border-[#FF7B72] px-6 text-lg font-bold text-[#FF7B72]">
                  Deny
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}

      <h2 className="mt-8 text-xl font-bold">Recorded inside ({board?.inside.length ?? "…"})</h2>
      <p className="text-sm text-muted">Gate records only. A visitor is shown here until security records their exit.</p>
      <ul className="mt-3 space-y-2">
        {(board?.inside ?? []).map((p) => (
          <li key={p.passId} className={"flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 " + (p.overdue ? "border-[#FFB300]" : "border-line")}>
            <div>
              <p className="font-semibold">{p.visitorName} → {p.destination}</p>
              <p className="text-sm text-muted">
                In {time(p.checkedInAt)} · expected out {time(p.expectedExitAt)}
                {p.overdue ? <span className="ml-2 font-bold text-[#FFB300]">Departure not confirmed</span> : null}
              </p>
            </div>
            <button disabled={busy} onClick={() => decide("exit", p.passId)} className="min-h-11 rounded-lg border border-line px-4">
              Record exit
            </button>
          </li>
        ))}
        {board && board.inside.length === 0 ? <li className="text-muted">No visitors recorded inside.</li> : null}
      </ul>

      <h2 className="mt-8 text-xl font-bold">Manual entry</h2>
      <p className="text-sm text-muted">Use only when OPA could not verify, for example from the paper log after a network outage.</p>
      <form
        className="mt-2 flex flex-wrap gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await act({ action: "manual", note: manual }, "Manual entry recorded.")) {
            setManual("");
            void refresh();
          }
        }}
      >
        <input aria-label="Manual entry note" value={manual} onChange={(e) => setManual(e.target.value)} placeholder="e.g. 10:40 Musa (plumber) to Block C House 12, paper log" maxLength={200} className="min-h-11 flex-1 rounded-lg border border-line bg-panel p-2" />
        <button disabled={busy || manual.trim().length < 2} className="min-h-11 rounded-lg border border-line px-4">Record</button>
      </form>

      <h2 className="mt-8 text-xl font-bold">Today at the gate</h2>
      <ul className="mt-2 divide-y divide-line text-sm">
        {(board?.events ?? []).map((e) => (
          <li key={e.id} className="py-2">
            <span className="font-mono">{time(e.occurredAt)}</span> · {EVENT_LABEL[e.type] ?? e.type}
            {e.visitorName ? ` · ${e.visitorName}` : ""}
            {e.destination ? ` → ${e.destination}` : ""}
            {e.note && e.type === "MANUAL_ENTRY" ? ` · ${e.note}` : ""}
          </li>
        ))}
        {board && board.events.length === 0 ? <li className="py-2 text-muted">Nothing recorded yet today.</li> : null}
      </ul>
    </section>
  );
}
