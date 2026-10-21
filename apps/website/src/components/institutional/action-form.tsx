"use client";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { normalizeEnrollmentPhone } from "@/lib/enrollment-phone";
import type { OperationStore } from "@/lib/canonical-operations";
export function ActionForm({
  title,
  owner,
  path,
  store,
  context = {},
  prerequisite,
  children,
  confirmation = false,
  onSuccess,
}: {
  title: string;
  owner: string;
  path: string;
  store: OperationStore;
  context?: Record<string, unknown>;
  prerequisite?: string;
  children?: ReactNode;
  confirmation?: boolean;
  onSuccess?: () => void;
}) {
  const operations = useSyncExternalStore(
      store.subscribe,
      store.snapshot,
      store.snapshot,
    ),
    operation = operations[owner];
  const [validationError, setValidationError] = useState("");
  const [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const pending =
      operation?.state === "SUBMITTING" || operation?.state === "VALIDATING",
    unknown = operation?.state === "RESULT_UNKNOWN";
  const disabled =
    prerequisite ||
    (!reason.trim()
      ? "Reason required."
      : confirmation && !confirmed
        ? "Confirm this sensitive action."
        : pending
          ? "This action is still being submitted."
          : unknown && !operation.canReplay
            ? "Reconcile the previous result before retrying."
            : operation?.state === "SUCCESS"
              ? "This action is complete. Start a new action explicitly if needed."
              : "");
  return (
    <form
      className="ic-card"
      onSubmit={async (e) => {
        e.preventDefault();
        if (disabled) return;
        const values: Record<string, unknown> = Object.fromEntries(
          new FormData(e.currentTarget),
        );
        setValidationError("");
        try {
          if (!e.currentTarget.checkValidity())
            throw new Error("Complete the required fields using valid values.");
          for (const name of ["firstName", "lastName"])
            if (name in values && !String(values[name]).trim())
              throw new Error("A name cannot be blank.");
          if (
            typeof values.expiresAt === "string" &&
            values.expiresAt &&
            new Date(values.expiresAt).getTime() <= Date.now()
          )
            throw new Error("Expiry must be in the future.");
          if (typeof values.phoneNumber === "string")
            values.phoneNumber = normalizeEnrollmentPhone(values.phoneNumber);
          for (const key of [
            "acknowledgementSeconds",
            "dispatchSeconds",
            "progressSeconds",
            "unattendedSeconds",
            "closureSeconds",
          ]) {
            if (values[key] !== undefined) {
              const number = Number(values[key]);
              if (!Number.isInteger(number) || number < 1 || number > 604800)
                throw new Error(
                  "Response intervals must be whole seconds from 1 to 604800.",
                );
              values[key] = number;
            }
          }
          delete values.confirm;
          for (const key of ["expiresAt", "startsAt"])
            if (typeof values[key] === "string" && values[key])
              values[key] = new Date(String(values[key])).toISOString();
          if (values.facilityAdminUserId === "")
            delete values.facilityAdminUserId;
        } catch (error) {
          setValidationError(
            error instanceof Error
              ? error.message
              : "Review the entered values.",
          );
          return;
        }
        await store.submit(
          owner,
          path,
          {
            ...values,
            ...context,
            ...(values.passed !== undefined
              ? { passed: values.passed === "true" }
              : {}),
            reason,
          },
          Boolean(unknown && operation?.canReplay),
        );
        if (store.snapshot()[owner]?.state === "SUCCESS") onSuccess?.();
      }}
    >
      <h3>{title}</h3>
      {children}
      <label>
        Reason for this action
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          required
        />
      </label>
      {confirmation && (
        <label>
          <input
            name="confirm"
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />{" "}
          I confirm this reviewed action.
        </label>
      )}
      <button
        type="submit"
        data-destructive={
          /^(End |Suspend |Revoke |Deprovision )/.test(title) || undefined
        }
        disabled={Boolean(disabled)}
      >
        {unknown && operation?.canReplay ? "Replay identical action" : title}
      </button>
      {validationError && <p role="alert">{validationError}</p>}
      {disabled && <p className="ic-muted">{disabled}</p>}
      {operation && (
        <div role="status">
          <strong>{operation.state.replaceAll("_", " ")}</strong>
          <p>{operation.message}</p>
          {operation.state === "RESULT_UNKNOWN" && (
            <button type="button" onClick={() => void store.reconcile(owner)}>
              Check recorded result
            </button>
          )}
          {operation.state === "SUCCESS" && (
            <button type="button" onClick={() => store.clear(owner)}>
              Start a new action
            </button>
          )}
          <details>
            <summary>Operation details</summary>
            <code>{operation.identity}</code>
            {operation.result !== undefined && (
              <pre>{JSON.stringify(operation.result, null, 2)}</pre>
            )}
          </details>
        </div>
      )}
    </form>
  );
}
