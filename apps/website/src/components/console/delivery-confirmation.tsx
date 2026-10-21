"use client";
import { useEffect, useState } from "react";
import { viewerSessionFetch } from "@/lib/viewer-session-fetch";
import {
  deliveryPage,
  type DeliveryPage,
  type DeliverySnapshot,
} from "@/lib/delivery-confirmation";

export function DeliveryConfirmation({
  incidentId,
  snapshot = { state: "BACKEND_BLOCKED" },
}: {
  incidentId?: string;
  snapshot?: DeliverySnapshot;
}) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<{
    page: DeliveryPage | null;
    state: "loading" | "ready" | "error" | "forbidden";
    incidentId?: string;
  }>({
    page: snapshot.state === "READY" ? snapshot.page : null,
    state: snapshot.state === "READY" ? "ready" : "loading",
    incidentId,
  });
  useEffect(() => {
    if (!incidentId) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await viewerSessionFetch(
          "/api/operator/incidents/" +
            encodeURIComponent(incidentId) +
            "/deliveries" +
            (cursor ? "?after=" + encodeURIComponent(cursor) : ""),
          {
            cache: "no-store",
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(15000),
            ]),
          },
        );
        if (!response.ok) {
          if (!controller.signal.aborted)
            setResult({
              page: null,
              state: [401, 403, 404].includes(response.status)
                ? "forbidden"
                : "error",
              incidentId,
            });
          return;
        }
        const page = deliveryPage(await response.json());
        if (!controller.signal.aborted)
          setResult({ page, state: page ? "ready" : "error", incidentId });
      } catch {
        if (!controller.signal.aborted)
          setResult({ page: null, state: "error", incidentId });
      }
    })();
    return () => controller.abort();
  }, [incidentId, cursor, refresh]);
  const current =
    result.incidentId === incidentId
      ? result
      : { page: null, state: "loading" };
  const page = current.page;
  const load = (after: string | null) => {
    setResult({ page: null, state: "loading", incidentId });
    setCursor(after);
    setRefresh((x) => x + 1);
  };
  return (
    <section className="rounded-xl border border-line bg-panel p-4">
      <h2 className="text-xl font-bold">Delivery confirmation</h2>
      <p className="mt-2 text-sm text-muted">
        Provider acceptance does not prove delivery or reading. SMS delivery
        confirmation is unavailable because authenticated provider receipts are
        not supported.
      </p>
      {current.state !== "ready" ? (
        <p role="status" className="mt-3">
          {!incidentId
            ? "Delivery records are unavailable."
            : current.state === "loading"
              ? "Checking delivery…"
              : current.state === "forbidden"
                ? "Delivery access is unavailable for this account."
                : "Delivery could not be checked. Outcome is unknown."}
        </p>
      ) : page?.items.length === 0 ? (
        <p className="mt-3">No notification attempts are recorded.</p>
      ) : (
        <ul className="mt-3 space-y-4">
          {page?.items.map((row) => {
            const proven =
              row.status === "DELIVERED" &&
              row.channel === "EMAIL" &&
              row.receiptAuthentication === "PROVIDER_SIGNATURE" &&
              row.deliveredAt;
            return (
              <li key={row.id} className="rounded-lg border border-line p-3">
                <p>
                  {row.channel} · {row.recipient.maskedIdentity}
                </p>
                <p>
                  Status:{" "}
                  {row.status === "DELIVERED" && !proven
                    ? "Delivery proof unavailable"
                    : row.status.replaceAll("_", " ")}
                </p>
                {proven ? (
                  <p className="text-sm">
                    Confirmed by the recipient’s mail server; reading is not
                    established.
                  </p>
                ) : null}
                <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                  {[
                    ["Queued", row.queuedAt],
                    ["First attempt", row.firstAttemptAt],
                    ["Latest attempt", row.lastAttemptAt],
                    ["Provider accepted", row.providerAcceptedAt],
                    ["Delivered", proven ? row.deliveredAt : null],
                    ["Failure classification", row.failureCategory],
                    ["Attempts", row.attemptCount],
                    ["Retries", row.retryCount],
                    ["Retry scheduled", row.retryScheduledAt],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value ?? "Not established"}</dd>
                    </div>
                  ))}
                </dl>
                {row.hasUnconfirmedOutcome ? (
                  <p className="mt-2">Final delivery outcome is unconfirmed.</p>
                ) : null}
                {!row.historyComplete ? (
                  <p className="mt-2">
                    Historical attempt evidence is incomplete.
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {incidentId && current.state !== "forbidden" ? (
        <div className="mt-3 flex gap-3">
          <button
            type="button"
            disabled={current.state === "loading"}
            onClick={() => load(cursor)}
            className="min-h-11 rounded-md border border-line px-3"
          >
            Refresh delivery
          </button>
          {cursor ? (
            <button
              type="button"
              onClick={() => load(null)}
              className="min-h-11 rounded-md border border-line px-3"
            >
              First page
            </button>
          ) : null}
          {page?.nextCursor ? (
            <button
              type="button"
              onClick={() => load(page.nextCursor)}
              className="min-h-11 rounded-md border border-line px-3"
            >
              Next deliveries
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
