"use client";
import { useRef, useState } from "react";
import {
  useOnboardingScope,
  signalOnboardingSession,
  type Scope,
} from "@/lib/onboarding-scope";
import { normalizeEnrollmentPhone } from "@/lib/enrollment-phone";
import { onboardingFetch } from "@/lib/onboarding-fetch";

type Invitation = {
  id: string;
  requestedRole: string;
  status: string;
  expiresAt: string;
  verifiedAt: string | null;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  lastResentAt: string | null;
  deliveries: {
    channel: string;
    status: string;
    lastAttemptAt: string | null;
  }[];
};
export default function Workspace() {
  const authority = useOnboardingScope();
  if (!authority.scope)
    return (
      <section role="status">
        <p>{authority.error}</p>
        <button onClick={authority.retry}>Retry authority check</button>
        <a href="/onboarding/login">Restore session</a>
      </section>
    );
  const scope = authority.scope;
  return (
    <ScopedWorkspace
      key={
        scope.actor.id +
        ":" +
        scope.actor.role +
        ":" +
        scope.facilities.map((f) => f.id).join(",")
      }
      scope={scope}
      invalidate={authority.invalidate}
    />
  );
}
function ScopedWorkspace({
  scope,
  invalidate,
}: {
  scope: Scope;
  invalidate: () => void;
}) {
  const [checkedAt, setCheckedAt] = useState(0);
  const facilities = scope.facilities;
  const [selection, setFacility] = useState("");
  const facility = facilities.some((f) => f.id === selection) ? selection : "";
  const [rows, setRows] = useState<Invitation[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const revision = useRef(0),
    retry = useRef<{ body: string; key: string } | null>(null);
  async function read(path: string, init?: RequestInit) {
    const headers = new Headers(init?.headers);
    headers.set("x-onboarding-actor", scope.actor.id + ":" + scope.actor.role);
    const response = await onboardingFetch(path, { ...init, headers });
    if ([401, 403].includes(response.status)) {
      invalidate();
      throw new Error("Current authority required.");
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Request failed.");
    return data;
  }
  async function load(id: string, after?: string) {
    const version = ++revision.current;
    setBusy(true);
    setMessage("");
    try {
      const data = await read(
        `facilities/${id}/invitations` + (after ? `?cursor=${after}` : ""),
      );
      if (version === revision.current) {
        setCheckedAt(Date.now());
        setRows((old) =>
          after ? [...old, ...data.invitations] : data.invitations,
        );
        setCursor(data.nextCursor);
      }
    } catch (error) {
      if (version === revision.current) {
        setRows([]);
        setMessage(error instanceof Error ? error.message : "Request failed.");
      }
    } finally {
      if (version === revision.current) setBusy(false);
    }
  }
  async function action(path: string, body: object, key?: string) {
    setBusy(true);
    setMessage("");
    try {
      const data = await read(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(key ? { "Idempotency-Key": key } : {}),
        },
        body: JSON.stringify(body),
      });
      await load(facility);
      setMessage(
        data.requestId
          ? `Request ${data.requestId}: ${data.status}`
          : "Updated.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Request failed. Retry with the same form to reuse the request key.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <p role="status">
        Authenticated account: {scope.actor.id} · {scope.actor.role} ·{" "}
        {scope.actor.role === "ADMIN"
          ? "Platform authority"
          : "Delegated onboarding"}
      </p>
      <div className="sa-actions">
        <a href="/onboarding/login">Restore session</a>
        <button
          className="sa-secondary"
          onClick={async () => {
            await fetch("/api/onboarding/logout", { method: "POST" });
            signalOnboardingSession();
            window.location.assign("/onboarding/login");
          }}
        >
          Sign out
        </button>
      </div>
      <label>
        Authorized facility
        <select
          value={facility}
          disabled={busy}
          onChange={(e) => {
            setFacility(e.target.value);
            setRows([]);
            setCursor(null);
            ++revision.current;
            if (e.target.value) void load(e.target.value);
          }}
        >
          <option value="">Select a facility</option>
          {facilities.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>
      {!facilities.length && <p>No authorized facilities are available.</p>}
      {message && (
        <p role="status" className="sa-notice">
          {message}
        </p>
      )}
      {facility && (
        <>
          <section className="sa-card">
            <h2>Invite staff</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                const role = String(form.get("role"));
                let phoneNumber: string;
                try {
                  phoneNumber = normalizeEnrollmentPhone(
                    String(form.get("phoneNumber") ?? ""),
                  );
                } catch {
                  setMessage(
                    "Enter a valid phone number. Use a country code outside Nigeria.",
                  );
                  return;
                }
                const body = {
                  facilityId: facility,
                  firstName: form.get("firstName"),
                  lastName: form.get("lastName"),
                  email: form.get("email"),
                  phoneNumber,
                };
                const serialized = JSON.stringify({ role, body });
                if (retry.current?.body !== serialized)
                  retry.current = {
                    body: serialized,
                    key: crypto.randomUUID(),
                  };
                void action(role, body, retry.current.key);
              }}
            >
              <fieldset disabled={busy}>
                <label>
                  Role
                  <select name="role">
                    <option value="operators">Facility Operator</option>
                    <option value="facility-admins">Facility Admin</option>
                  </select>
                </label>
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
                  Phone
                  <input
                    name="phoneNumber"
                    type="tel"
                    required
                    placeholder="+234…"
                  />
                </label>
                <button>Send invitation</button>
              </fieldset>
            </form>
            <p>
              Recipients must verify both email and phone. Retrying unchanged
              fields reuses the same request.
            </p>
          </section>
          <section className="sa-card">
            <h2>Staff invitation status</h2>
            <button disabled={busy} onClick={() => void load(facility)}>
              Refresh
            </button>
            <p>
              Invitation references are shown without protected personal
              details.
            </p>
            {rows.map((row) => {
              const pending = !row.acceptedAt && !row.revokedAt;
              const cooldown = Math.max(
                Date.parse(row.createdAt),
                Date.parse(row.lastResentAt ?? "") || 0,
                ...row.deliveries.map(
                  (d) => Date.parse(d.lastAttemptAt ?? "") || 0,
                ),
              );
              const resend =
                pending &&
                !row.verifiedAt &&
                checkedAt - cooldown >= 300000 &&
                !row.deliveries.some((d) =>
                  ["QUEUED", "SENDING"].includes(d.status),
                );
              return (
                <article key={row.id}>
                  <h3>
                    {row.requestedRole === "FACILITY_ADMIN"
                      ? "Facility Admin"
                      : "Facility Operator"}
                  </h3>
                  <p>{row.id}</p>
                  <p>
                    {row.status} · Expires{" "}
                    {new Date(row.expiresAt).toLocaleString()}
                  </p>
                  <p>
                    {row.deliveries
                      .map((d) => `${d.channel}: ${d.status}`)
                      .join(" · ")}
                  </p>
                  <div className="sa-actions">
                    <button
                      disabled={busy || !resend}
                      onClick={() =>
                        void action(
                          `facilities/${facility}/invitations/${row.id}/resend`,
                          { reason: "Customer requested invitation resend" },
                        )
                      }
                    >
                      Resend
                    </button>
                    <button
                      disabled={busy || !pending}
                      onClick={() => {
                        if (window.confirm("Revoke this pending invitation?"))
                          void action(
                            `facilities/${facility}/invitations/${row.id}/revoke`,
                            {
                              reason:
                                "Customer requested invitation revocation",
                            },
                          );
                      }}
                    >
                      Revoke invitation
                    </button>
                  </div>
                </article>
              );
            })}
            {!rows.length && <p>No staff invitations.</p>}
            {cursor && (
              <button
                disabled={busy}
                onClick={() => void load(facility, cursor)}
              >
                More invitations
              </button>
            )}
          </section>
        </>
      )}
    </>
  );
}
