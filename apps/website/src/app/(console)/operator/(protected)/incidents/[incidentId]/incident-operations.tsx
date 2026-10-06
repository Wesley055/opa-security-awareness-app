"use client";
import { useRef, useState } from "react";
import { viewerSessionFetch } from "@/lib/viewer-session-fetch";

export const operationLabels: Record<string, string> = {
  SEEN: "Seen",
  ACKNOWLEDGED: "Acknowledged",
  DISPATCHED: "Dispatched",
  RESPONSE_PROGRESS: "Response progress",
  ESCALATION: "Escalate response",
};
export function IncidentOperations({
  incidentId,
  enabled,
  refresh,
  denied,
}: {
  incidentId: string;
  enabled: boolean;
  refresh: () => Promise<unknown>;
  denied: () => void;
}) {
  const [type, setType] = useState("ACKNOWLEDGED");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const intent = useRef<{
    type: string;
    note: string;
    correlationId: string;
  } | null>(null);
  const submitting = useRef(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!enabled || submitting.current || !note.trim()) return;
    submitting.current = true;
    setBusy(true);
    setMessage("");
    // Preserve the idempotency reference across uncertain retries of the same intent.
    if (intent.current?.type !== type || intent.current.note !== note)
      intent.current = { type, note, correlationId: crypto.randomUUID() };
    try {
      const response = await viewerSessionFetch(
        "/api/operator/incidents/" +
          encodeURIComponent(incidentId) +
          "/operations",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(intent.current),
        },
      );
      if ([401, 403, 404].includes(response.status)) {
        denied();
        return;
      }
      if (!response.ok) {
        setMessage(
          "Operation was not confirmed. Review the refreshed incident before retrying.",
        );
        await refresh();
        return;
      }
      intent.current = null;
      setNote("");
      setMessage("Operation recorded. Refreshing canonical history.");
      await refresh();
    } catch {
      setMessage(
        "Result unknown. Refresh the incident before retrying; the same request reference will be retained.",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="rounded-xl border border-line bg-panel p-4 text-ink">
      <h2 className="text-xl font-bold">Incident operations</h2>
      <p className="mt-2 text-sm text-muted">
        Record response activity without changing the incident state. History is
        append-only.
      </p>
      {enabled ? (
        <form onSubmit={submit} className="mt-4 space-y-3">
          <label className="block">
            Operation
            <select
              className="block min-h-11 border border-line bg-panel p-2"
              value={type}
              disabled={busy}
              onChange={(e) => setType(e.target.value)}
            >
              {Object.entries(operationLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            Response note
            <textarea
              className="block w-full border border-line bg-panel p-2"
              required
              maxLength={500}
              value={note}
              disabled={busy}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <button
            className="min-h-11 rounded border border-line px-4"
            disabled={busy || !note.trim()}
          >
            {busy ? "Recording…" : "Record operation"}
          </button>
        </form>
      ) : (
        <p className="mt-3 text-sm">
          Operations are unavailable while the incident is closed or current
          updates cannot be confirmed.
        </p>
      )}
      {message && (
        <p role="status" className="mt-3 text-sm">
          {message}
        </p>
      )}
    </section>
  );
}
