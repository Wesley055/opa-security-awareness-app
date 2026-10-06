"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ActionForm } from "./action-form";
import type { OperationStore } from "@/lib/canonical-operations";

export function FirstFacilityAdmin({
  facilityId,
  store,
  transport,
  prerequisite,
  onDiagnostics,
  onSuccess,
}: {
  facilityId: string;
  store: OperationStore;
  transport: (path: string, init?: RequestInit) => Promise<Response>;
  prerequisite: string;
  onDiagnostics: () => void;
  onSuccess: () => void;
}) {
  const path = "facilities/" + facilityId + "/first-facility-admin";
  const owner = facilityId + ":first-admin";
  const operations = useSyncExternalStore(
    store.subscribe,
    store.snapshot,
    store.snapshot,
  );
  const result = operations[owner]?.result as
    { requestId?: string } | undefined;
  const requestId = result?.requestId;
  const [eligibility, setEligibility] = useState<{
    eligible: boolean;
    explanation: string;
  } | null>(null);
  const eligibilityScope = path + ":" + prerequisite;
  const [previousScope, setPreviousScope] = useState(eligibilityScope);
  if (previousScope !== eligibilityScope) {
    setPreviousScope(eligibilityScope);
    setEligibility(null);
  }
  const [delivery, setDelivery] = useState<Array<{
    channel: string;
    status: string;
    deliveryStatus: string;
  }> | null>(null);
  const [deliveryError, setDeliveryError] = useState("");
  const [deliveryRequest, setDeliveryRequest] = useState(requestId);
  if (deliveryRequest !== requestId) {
    setDeliveryRequest(requestId);
    setDelivery(null);
    setDeliveryError("");
  }
  useEffect(() => {
    if (prerequisite) return;
    let alive = true,
      pending = false,
      generation = 0;
    let controller: AbortController | undefined;
    const load = async (force = false) => {
      if (pending && !force) return;
      controller?.abort();
      controller = new AbortController();
      const current = ++generation;
      pending = true;
      try {
        const response = await transport(path, { signal: controller.signal });
        if (!response.ok) throw Error();
        const value = await response.json();
        if (alive && current === generation)
          setEligibility({
            eligible: value.eligible === true,
            explanation: String(
              value.explanation ?? "Current authority required.",
            ),
          });
      } catch {
        if (alive && current === generation)
          setEligibility({
            eligible: false,
            explanation:
              "Commissioning authority could not be confirmed. Refresh facility context or retry after the next authority check.",
          });
      } finally {
        if (current === generation) pending = false;
      }
    };
    void load();
    const interval = setInterval(() => void load(), 5000);
    const restore = () => {
      setEligibility(null);
      void load(true);
    };
    window.addEventListener("focus", restore);
    window.addEventListener("pageshow", restore);
    return () => {
      alive = false;
      controller?.abort();
      clearInterval(interval);
      window.removeEventListener("focus", restore);
      window.removeEventListener("pageshow", restore);
    };
  }, [path, prerequisite, transport]);
  useEffect(() => {
    if (!requestId || prerequisite) return;
    let alive = true;
    void (async () => {
      try {
        const response = await transport(
          "facilities/" + facilityId + "/delivery",
        );
        if (!response.ok) throw Error();
        const rows = await response.json();
        if (!Array.isArray(rows)) throw Error();
        if (alive) {
          setDelivery(
            rows
              .filter((r) => r.enrollmentId === requestId)
              .map((r) => ({
                channel: String(r.channel),
                status: String(r.status),
                deliveryStatus: String(r.deliveryStatus),
              })),
          );
          setDeliveryError("");
        }
      } catch {
        if (alive)
          setDeliveryError(
            "Delivery status could not be confirmed. Open Enrollment & Delivery for current diagnostics.",
          );
      }
    })();
    return () => {
      alive = false;
    };
  }, [facilityId, requestId, prerequisite, transport]);
  return (
    <div>
      <ActionForm
        title="Provision first Facility Administrator"
        owner={owner}
        path={path}
        store={store}
        prerequisite={
          prerequisite ||
          (!eligibility?.eligible
            ? eligibility?.explanation ||
              "Checking current commissioning authority…"
            : "")
        }
        confirmation
        onSuccess={onSuccess}
      >
        <p>
          Establish the customer&apos;s initial administrative authority for
          this facility. Available only during commissioning while no active
          Facility Administrator exists. Routine staffing transfers to the
          Facility Administrator after activation.
        </p>
        <p>
          Assigned active Technical Support with Standard Facility Support can
          perform this action without a Support Case or Temporary Elevation. The
          server fixes the role to Facility Administrator.
        </p>
        <label>
          First name
          <input name="firstName" required maxLength={100} />
        </label>
        <label>
          Last name
          <input name="lastName" required maxLength={100} />
        </label>
        <label>
          Email
          <input name="email" type="email" required />
        </label>
        <label>
          Phone in international format
          <input name="phoneNumber" type="tel" placeholder="+234…" required />
        </label>
      </ActionForm>
      {requestId && (
        <section aria-label="First Administrator enrollment result">
          <p>
            Enrollment reference: <code>{requestId}</code>
          </p>
          <p>
            Verification pending. The recipient must complete email and SMS
            ownership verification and normal enrollment at /enroll. No account
            activation is implied by this submission.
          </p>
          {delivery?.map((row) => (
            <p key={row.channel}>
              {row.channel}: {row.status} · confirmation: {row.deliveryStatus}
            </p>
          ))}
          {!delivery?.length && !deliveryError && (
            <p>Delivery status has not yet been confirmed.</p>
          )}
          {deliveryError && <p role="alert">{deliveryError}</p>}
          <p>
            Provider acceptance is not delivery confirmation or human action.
          </p>
          <button type="button" onClick={onDiagnostics}>
            Open Enrollment &amp; Delivery
          </button>
        </section>
      )}
    </div>
  );
}
