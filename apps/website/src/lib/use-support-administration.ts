"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { adminJson } from "./admin-request";
import type { SupportDirectory } from "./support-administration";
export type Outcome =
  | "IDLE"
  | "VALIDATING"
  | "SUBMITTING"
  | "SUCCESS"
  | "VALIDATION_FAILURE"
  | "SERVER_FAILURE"
  | "RESULT_UNKNOWN"
  | "AUTHORITY_EXPIRED";
export type Operation = {
  state: Outcome;
  message: string;
  resource: string;
  path?: string;
  body?: Record<string, unknown>;
  key?: string;
  fingerprint?: string;
  reconciled?: boolean;
  reconciling?: boolean;
};
const base = "/api/super-admin/support/";
export function useSupportAdministration() {
  const [now, setNow] = useState(() => Date.now());
  const [directory, setDirectory] = useState<SupportDirectory | null>(null);
  const [readState, setReadState] = useState("INITIAL_LOADING");
  const [error, setError] = useState("");
  const [operations, setOperations] = useState<Record<string, Operation>>({});
  const currentDirectory = useRef<SupportDirectory | null>(null),
    lease = useRef(0),
    generation = useRef(0),
    mounted = useRef(true);
  const actor = useRef<string | undefined>(undefined);
  const ops = useRef<Record<string, Operation>>({}),
    pending = useRef<Promise<boolean> | null>(null),
    abort = useRef<AbortController | null>(null);
  const publish = useCallback((id: string, value: Operation) => {
    const next = { ...ops.current };
    if (value.state === "SUCCESS")
      for (const [other, op] of Object.entries(next))
        if (
          other !== id &&
          op.resource === value.resource &&
          op.state === "SUCCESS"
        )
          next[other] = {
            ...op,
            fingerprint: undefined,
            key: undefined,
            body: undefined,
          };
    ops.current = { ...next, [id]: value };
    if (mounted.current) setOperations(ops.current);
  }, []);
  const clearAuthority = useCallback(() => {
    lease.current = 0;
    currentDirectory.current = null;
    generation.current++;
    abort.current?.abort();
    pending.current = null;
    setDirectory(null);
    setReadState("AUTHORITY_EXPIRED");
    setError("Session expired or Super Admin authority denied. Sign in again.");
  }, []);
  const refresh = useCallback((): Promise<boolean> => {
    if (pending.current) return pending.current;
    if (Object.values(ops.current).some((o) => o.state === "SUBMITTING"))
      return Promise.resolve(false);
    const version = generation.current;
    const controller = new AbortController();
    abort.current = controller;
    setReadState(
      currentDirectory.current ? "BACKGROUND_REFRESHING" : "INITIAL_LOADING",
    );
    const job = (async () => {
      try {
        const { status, body } = await adminJson(
          base + "employees",
          { signal: controller.signal },
          10000,
        );
        if (!mounted.current || version !== generation.current) return false;
        if (status === 401 || status === 403) {
          clearAuthority();
          return false;
        }
        if (
          status !== 200 ||
          !Array.isArray(body.employees) ||
          !Array.isArray(body.facilities) ||
          !Array.isArray(body.invitations)
        )
          throw Error(
            "Support directory unavailable. Refresh to revalidate authority.",
          );
        const next = body as unknown as SupportDirectory;
        if (actor.current && next.actor?.id !== actor.current) {
          ops.current = {};
          setOperations({});
        }
        actor.current = next.actor?.id;
        currentDirectory.current = body as unknown as SupportDirectory;
        lease.current = Date.now() + 30000;
        setDirectory(currentDirectory.current);
        setReadState("READY");
        setError("");
        return true;
      } catch (err) {
        if (mounted.current && version === generation.current) {
          setReadState(
            currentDirectory.current && Date.now() < lease.current
              ? "READY"
              : "UNAVAILABLE",
          );
          setError(
            err instanceof Error ? err.message : "Directory unavailable",
          );
        }
        return false;
      }
    })();
    pending.current = job;
    void job.finally(() => {
      if (pending.current === job) pending.current = null;
    });
    return job;
  }, [clearAuthority]);
  const dispose = useCallback(() => {
    mounted.current = false;
    generation.current++;
    abort.current?.abort();
    pending.current = null;
  }, []);
  useEffect(() => {
    mounted.current = true;
    const restore = () => {
      if (Date.now() >= lease.current && currentDirectory.current)
        setReadState("UNAVAILABLE");
      void refresh();
    };
    const visible = () => {
      if (!document.hidden) restore();
    };
    const timer = setInterval(visible, 15000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    window.addEventListener("focus", restore);
    window.addEventListener("pageshow", restore);
    document.addEventListener("visibilitychange", visible);
    void refresh();
    return () => {
      dispose();
      clearInterval(timer);
      clearInterval(clock);
      window.removeEventListener("focus", restore);
      window.removeEventListener("pageshow", restore);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refresh, dispose]);
  const reasonDisabled = (resource: string, own?: string) => {
    if (
      !directory ||
      ["AUTHORITY_EXPIRED", "INITIAL_LOADING", "UNAVAILABLE"].includes(
        readState,
      ) ||
      Date.now() >= lease.current
    )
      return error || "Confirm current Super Admin authority first.";
    const conflict = Object.entries(ops.current).find(
      ([id, o]) =>
        o.resource === resource &&
        ["SUBMITTING", "RESULT_UNKNOWN"].includes(o.state) &&
        !(id === own && o.state === "RESULT_UNKNOWN" && o.reconciled),
    );
    return conflict
      ? conflict[1].state === "SUBMITTING"
        ? "A conflicting action for this record is submitting."
        : "Resolve the uncertain action for this record before another mutation."
      : "";
  };
  const validation = (id: string, resource: string, message: string) => {
    if (
      ops.current[id]?.state === "SUBMITTING" ||
      ops.current[id]?.state === "RESULT_UNKNOWN"
    )
      return;
    publish(id, { state: "VALIDATION_FAILURE", resource, message });
  };
  async function mutate(
    id: string,
    resource: string,
    path: string,
    fields: Record<string, unknown>,
    reason: string,
    caseReference: string,
  ) {
    if (reasonDisabled(resource, id)) return;
    if (!reason.trim() || reason.trim().length > 500) {
      validation(id, resource, "Enter a reason between 1 and 500 characters.");
      return;
    }
    if (
      caseReference &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        caseReference,
      )
    ) {
      validation(id, resource, "Case reference must be a UUID or left blank.");
      return;
    }
    const fingerprint = JSON.stringify([
      path,
      fields,
      reason.trim(),
      caseReference,
    ]);
    const previous = ops.current[id];
    if (
      previous?.state === "RESULT_UNKNOWN" &&
      (!previous.reconciled || fingerprint !== previous.fingerprint)
    )
      return;
    if (previous?.state === "SUCCESS" && fingerprint === previous.fingerprint)
      return;
    const key =
      previous?.fingerprint === fingerprint && previous.key
        ? previous.key
        : crypto.randomUUID();
    const body =
      previous?.fingerprint === fingerprint && previous.body
        ? previous.body
        : {
            ...fields,
            reason: reason.trim(),
            caseReference: caseReference || crypto.randomUUID(),
            correlationId: key,
          };
    const op: Operation = {
      state: "SUBMITTING",
      resource,
      path,
      body,
      key,
      fingerprint,
      message: "Submitting one reviewed request.",
    };
    publish(id, op);
    generation.current++;
    abort.current?.abort();
    pending.current = null;
    const version = generation.current;
    try {
      const { status, body: result } = await adminJson(base + path, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify(body),
      });
      if (!mounted.current) return;
      if (status === 401 || status === 403) {
        clearAuthority();
        publish(id, {
          ...op,
          state: "AUTHORITY_EXPIRED",
          message: "Session expired or authority denied. Sign in again.",
        });
        return;
      }
      if (status >= 500) throw Error("Uncertain result");
      if (status >= 400) {
        publish(id, {
          ...op,
          state: status === 400 ? "VALIDATION_FAILURE" : "SERVER_FAILURE",
          message:
            typeof result.error === "string"
              ? result.error
              : "Request rejected. Review this action and retry.",
        });
        return;
      }
      if (path === "invitations" && typeof result.requestId !== "string")
        throw Error("Missing receipt");
      publish(id, {
        ...op,
        state: "SUCCESS",
        message:
          typeof result.requestId === "string"
            ? "Invitation created; delivery queued, not confirmed. Reference: " +
              result.requestId
            : "Action recorded. Reference: " + String(result.id ?? key),
      });
    } catch {
      if (mounted.current)
        publish(id, {
          ...op,
          state: "RESULT_UNKNOWN",
          message:
            "Result unknown. The request may have reached the server. Reconcile this operation before retrying.",
        });
    } finally {
      if (mounted.current && version <= generation.current && lease.current)
        void refresh();
    }
  }
  async function reconcile(id: string) {
    const op = ops.current[id];
    if (!op?.key || op.state !== "RESULT_UNKNOWN" || op.reconciling) return;
    publish(id, { ...op, reconciling: true });
    try {
      const { status, body } = await adminJson(
        base + "operations/" + op.key,
        {},
        10000,
      );
      if (status === 401 || status === 403) {
        clearAuthority();
        publish(id, {
          ...op,
          state: "AUTHORITY_EXPIRED",
          message: "Authority expired. Sign in again.",
          reconciling: false,
        });
        return;
      }
      if (status !== 200) throw Error();
      const receipt = body.receipt as { resourceId?: string } | null;
      if (body.status === "COMMITTED" && receipt?.resourceId)
        publish(id, {
          ...op,
          state: "SUCCESS",
          message:
            "Server confirmed the committed operation. Reference: " +
            receipt.resourceId,
          reconciling: false,
        });
      else if (body.status === "NOT_RECORDED")
        publish(id, {
          ...op,
          reconciled: true,
          reconciling: false,
          message:
            "No committed receipt recorded. Only an identical replay with the retained idempotency reference is permitted; no changed request.",
        });
      else throw Error();
      await refresh();
    } catch {
      publish(id, {
        ...op,
        reconciling: false,
        message:
          "Result remains unknown; reconciliation failed. Do not resubmit.",
      });
    }
  }
  async function retry(id: string) {
    const op = ops.current[id];
    if (op?.state !== "RESULT_UNKNOWN" || !op.reconciled || !op.fingerprint)
      return;
    const [path, fields, reason, reference] = JSON.parse(op.fingerprint) as [
      string,
      Record<string, unknown>,
      string,
      string,
    ];
    await mutate(id, op.resource, path, fields, reason, reference);
  }
  return {
    now,
    directory,
    readState,
    error,
    operations,
    refresh,
    reasonDisabled,
    mutate,
    reconcile,
    retry,
    validation,
  };
}
