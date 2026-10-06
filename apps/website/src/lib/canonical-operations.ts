export type OperationState =
  | "VALIDATING"
  | "SUBMITTING"
  | "SUCCESS"
  | "VALIDATION_FAILURE"
  | "SERVER_FAILURE"
  | "RESULT_UNKNOWN"
  | "AUTHORITY_EXPIRED";
export type Operation = {
  owner: string;
  path: string;
  identity: string;
  fingerprint: string;
  state: OperationState;
  message: string;
  canReplay?: boolean;
  result?: unknown;
};
type Transport = (path: string, init?: RequestInit) => Promise<Response>;
const stores = new Map<string, OperationStore>();
export function operationStore(
  actor: string,
  transport: Transport,
  receiptPrefix = "operations/",
) {
  let store = stores.get(actor);
  if (!store) {
    store = new OperationStore(actor, transport, receiptPrefix);
    stores.set(actor, store);
  } else store.transport = transport;
  return store;
}
export class OperationStore {
  private operations: Record<string, Operation> = {};
  private listeners = new Set<() => void>();
  private locks = new Set<string>();
  private generation = 0;
  private payloads = new Map<string, object>();
  constructor(
    readonly actor: string,
    public transport: Transport,
    private receiptPrefix = "operations/",
  ) {
    try {
      const raw = sessionStorage.getItem("opa-operations:" + actor);
      if (raw) {
        const rows = JSON.parse(raw) as Record<string, Operation>;
        for (const [owner, row] of Object.entries(rows)) {
          if (
            typeof row.identity === "string" &&
            typeof row.path === "string" &&
            typeof row.fingerprint === "string"
          )
            this.operations[owner] = {
              ...row,
              state:
                row.state === "SUBMITTING" || row.state === "VALIDATING"
                  ? "RESULT_UNKNOWN"
                  : row.state,
              message:
                row.state === "SUBMITTING"
                  ? "Reconcile this operation before retrying."
                  : row.message,
            };
        }
      }
    } catch {
      /* In-memory reconciliation remains available if browser storage is blocked. */
    }
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.operations;
  private publish(owner: string, operation: Operation) {
    this.operations = { ...this.operations, [owner]: operation };
    try {
      sessionStorage.setItem(
        "opa-operations:" + this.actor,
        JSON.stringify(
          Object.fromEntries(
            Object.entries(this.operations).map(([id, row]) => [
              id,
              { ...row, result: undefined },
            ]),
          ),
        ),
      );
    } catch {
      /* No credentials or enrollment fields are stored. */
    }
    for (const listener of this.listeners) listener();
  }
  expire() {
    this.generation++;
    this.payloads.clear();
    for (const [owner, op] of Object.entries(this.operations))
      this.publish(owner, {
        ...op,
        result: undefined,
        state: ["SUBMITTING", "RESULT_UNKNOWN"].includes(op.state)
          ? "RESULT_UNKNOWN"
          : op.state === "SUCCESS"
            ? "SUCCESS"
            : "AUTHORITY_EXPIRED",
        canReplay: false,
        message:
          "Your authority changed. Current authorization must be confirmed before continuing.",
      });
  }
  clear(owner: string) {
    const op = this.operations[owner];
    if (this.locks.has(owner) || op?.state === "RESULT_UNKNOWN") return;
    this.operations = { ...this.operations };
    delete this.operations[owner];
    this.payloads.delete(owner);
    for (const listener of this.listeners) listener();
    try {
      sessionStorage.setItem(
        "opa-operations:" + this.actor,
        JSON.stringify(
          Object.fromEntries(
            Object.entries(this.operations).map(([id, row]) => [
              id,
              { ...row, result: undefined },
            ]),
          ),
        ),
      );
    } catch {
      /* Best effort; old receipts remain safe to reconcile. */
    }
  }
  async submit(
    owner: string,
    path: string,
    input: Record<string, unknown>,
    replay = false,
  ) {
    if (this.locks.has(owner)) return;
    const previous = this.operations[owner];
    if (
      previous?.state === "RESULT_UNKNOWN" &&
      (!replay || !previous.canReplay)
    ) {
      this.publish(owner, {
        ...previous,
        message:
          "Another operation is still being reconciled. Check its recorded result before retrying.",
      });
      return;
    }
    if (previous?.state === "SUCCESS" && !replay) {
      this.publish(owner, {
        ...previous,
        message:
          "This operation succeeded. Start a new action explicitly if another change is required.",
      });
      return;
    }
    this.locks.add(owner);
    const generation = this.generation;
    const identity =
      replay && previous ? previous.identity : crypto.randomUUID();
    const payload = {
      ...input,
      caseReference: input.caseReference || identity,
      correlationId: identity,
    };
    let operation: Operation = {
      owner,
      path,
      identity,
      fingerprint: "",
      state: "VALIDATING",
      message: "Validating this action…",
    };
    this.publish(owner, operation);
    try {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify([path, input])),
      );
      const fingerprint = Array.from(new Uint8Array(digest), (v) =>
        v.toString(16).padStart(2, "0"),
      ).join("");
      if (generation !== this.generation) return;
      if (replay && previous && fingerprint !== previous.fingerprint) {
        this.publish(owner, {
          ...previous,
          message:
            "Replay must use the same action and values. Re-enter the original form or reconcile it.",
        });
        return;
      }
      operation = {
        ...operation,
        fingerprint,
        state: "SUBMITTING",
        message: "Submitting this action…",
      };
      this.payloads.set(owner, payload);
      this.publish(owner, operation);
      const response = await this.transport(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": identity,
        },
        body: JSON.stringify(payload),
      });
      if (generation !== this.generation) return;
      if ([401, 403].includes(response.status)) {
        this.expire();
        return;
      }
      if (response.status >= 500) {
        this.publish(owner, {
          ...operation,
          state: "RESULT_UNKNOWN",
          message: "The server result is uncertain. Reconcile before retrying.",
        });
        return;
      }
      const result = await response.json();
      if (generation !== this.generation) return;
      this.publish(owner, {
        ...operation,
        state: response.ok ? "SUCCESS" : "SERVER_FAILURE",
        result,
        message: response.ok
          ? "Operation recorded successfully."
          : typeof result.error === "string"
            ? result.error
            : "The action was rejected. Review its prerequisites.",
      });
    } catch {
      if (generation === this.generation)
        this.publish(owner, {
          ...operation,
          state:
            operation.state === "SUBMITTING"
              ? "RESULT_UNKNOWN"
              : "VALIDATION_FAILURE",
          message:
            operation.state === "SUBMITTING"
              ? "The result is unknown. Reconcile before retrying."
              : "The action could not be prepared. Retry when the browser is ready.",
        });
    } finally {
      this.locks.delete(owner);
    }
  }
  async reconcile(owner: string) {
    const op = this.operations[owner];
    if (!op || this.locks.has(owner)) return;
    this.locks.add(owner);
    const generation = this.generation;
    try {
      const response = await this.transport(this.receiptPrefix + op.identity);
      if (generation !== this.generation) return;
      if ([401, 403].includes(response.status)) {
        this.expire();
        return;
      }
      if (!response.ok) throw Error();
      const result = await response.json();
      if (
        generation !== this.generation ||
        this.operations[owner]?.identity !== op.identity
      )
        return;
      if (result.status === "COMMITTED")
        this.publish(owner, {
          ...op,
          state: "SUCCESS",
          result: result.receipt,
          canReplay: false,
          message: "The server confirms this operation was recorded.",
        });
      else if (result.status === "NOT_RECORDED")
        this.publish(owner, {
          ...op,
          state: "RESULT_UNKNOWN",
          canReplay: true,
          message:
            "No commit is recorded yet. You may replay only the identical action with this operation identity.",
        });
      else throw Error();
    } catch {
      if (generation === this.generation)
        this.publish(owner, {
          ...op,
          message:
            "Reconciliation is unavailable. The original operation identity is preserved.",
        });
    } finally {
      this.locks.delete(owner);
    }
  }
}
