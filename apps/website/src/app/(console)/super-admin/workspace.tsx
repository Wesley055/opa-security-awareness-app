"use client";
import { useEffect, useRef, useState } from "react";
import { superAdminFetch } from "@/lib/super-admin-fetch";
type Facility = {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  isVerified: boolean;
};
type Member = {
  id: string;
  role: string;
  isActive: boolean;
  accountStatus: string;
  membershipState: string;
};
type Invite = {
  id: string;
  requestedRole: string;
  status: string;
  expiresAt: string;
  deliveries: {
    id: string;
    channel: string;
    status: string;
    attemptCount: number;
  }[];
};
type Audit = {
  id: string;
  action: string;
  actorUserId: string;
  resourceId: string;
  createdAt: string;
  reason?: string;
};
const types = [
  "HOSPITAL",
  "POLICE_STATION",
  "FIRE_STATION",
  "SECURITY_PROVIDER",
  "NGO",
  "GOVERNMENT_AGENCY",
  "OTHER",
];
async function request(path: string, body?: unknown, key?: string) {
  const response = await superAdminFetch(
    path,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(key ? { "Idempotency-Key": key } : {}),
          },
          body: JSON.stringify(body),
        },
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Request unavailable.");
  return data;
}
function Field({
  name,
  label,
  type = "text",
}: {
  name: string;
  label: string;
  type?: string;
}) {
  return (
    <label>
      {label}
      <input
        name={name}
        type={type}
        required
        autoComplete="off"
        maxLength={160}
      />
    </label>
  );
}
export function CreateFacility() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [created, setCreated] = useState<Facility | null>(null);
  return (
    <section className="sa-card">
      <h2>Create facility</h2>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          const form = e.currentTarget;
          setBusy(true);
          setError("");
          try {
            const data = await request(
              "facilities",
              Object.fromEntries(new FormData(form)),
            );
            setCreated(data.facility);
            form.reset();
          } catch (err) {
            setError(
              err instanceof Error ? err.message : "Creation unavailable.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy}>
          <Field name="name" label="Facility name" />
          <label>
            Facility type
            <select name="type" required>
              {types.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <button>{busy ? "Creating…" : "Create facility"}</button>
        </fieldset>
      </form>
      {error && <p role="alert">{error}</p>}
      {created && (
        <p role="status">
          Created {created.name}.{" "}
          <a href={"/super-admin?facilityId=" + created.id}>Open facility</a>
        </p>
      )}
    </section>
  );
}
export default function Workspace() {
  const [facilities, setFacilities] = useState<Facility[]>([]),
    [directoryCursor, setDirectoryCursor] = useState<string | null>(null),
    [facility, setFacility] = useState<Facility | null>(null);
  const [members, setMembers] = useState<Member[]>([]),
    [invitations, setInvitations] = useState<Invite[]>([]),
    [events, setEvents] = useState<Audit[]>([]);
  const [cursors, setCursors] = useState<Record<string, string | null>>({}),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [reason, setReason] = useState("");
  const [revealed, setRevealed] = useState("");
  const invitationKey = useRef<{ payload: string; key: string } | null>(null),
    selection = useRef(0);
  async function loadDetail(id: string) {
    const generation = ++selection.current;
    setLoading(true);
    setError("");
    setRevealed("");
    setFacility(null);
    setMembers([]);
    setInvitations([]);
    setEvents([]);
    try {
      const [detail, m, i, a] = await Promise.all([
        request("facilities/" + id),
        request("facilities/" + id + "/members"),
        request("facilities/" + id + "/invitations"),
        request("facilities/" + id + "/audit"),
      ]);
      if (generation !== selection.current) return;
      setFacility(detail.facility);
      setMembers(m.members);
      setInvitations(i.invitations);
      setEvents(a.events);
      setCursors({
        members: m.nextCursor,
        invitations: i.nextCursor,
        audit: a.nextCursor,
      });
    } catch (err) {
      if (generation === selection.current)
        setError(err instanceof Error ? err.message : "Facility unavailable.");
    } finally {
      if (generation === selection.current) setLoading(false);
    }
  }
  useEffect(() => {
    let live = true;
    const initialId = new URLSearchParams(window.location.search).get(
      "facilityId",
    );
    request("facilities")
      .then((data) => {
        if (live) {
          setFacilities(data.facilities);
          setDirectoryCursor(data.nextCursor);
          if (initialId) return loadDetail(initialId);
        }
      })
      .catch((err) => {
        if (live) setError(err.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);
  async function mutate(path: string, body: unknown, key?: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await request(path, body, key);
      setNotice(
        data.requestId
          ? "Invitation " + data.requestId + ": " + data.status
          : "Access updated.",
      );
      if (facility) await loadDetail(facility.id);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action unavailable.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function more(kind: "members" | "invitations" | "audit") {
    if (!facility || !cursors[kind]) return;
    setBusy(true);
    try {
      const data = await request(
        "facilities/" + facility.id + "/" + kind + "?cursor=" + cursors[kind],
      );
      if (kind === "members") setMembers((rows) => [...rows, ...data.members]);
      if (kind === "invitations")
        setInvitations((rows) => [...rows, ...data.invitations]);
      if (kind === "audit") setEvents((rows) => [...rows, ...data.events]);
      setCursors((c) => ({ ...c, [kind]: data.nextCursor }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Page unavailable.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="sa-card">
        <h2>Facility directory</h2>
        {facilities.length === 0 && !loading && (
          <p>No facilities to display.</p>
        )}
        <div className="sa-actions">
          {facilities.map((f) => (
            <button
              className="sa-secondary"
              key={f.id}
              disabled={busy || loading}
              onClick={() => loadDetail(f.id)}
            >
              {f.name} · {f.isActive ? "Active" : "Suspended"}
            </button>
          ))}
        </div>
        {directoryCursor && (
          <button
            disabled={busy || loading}
            onClick={async () => {
              setBusy(true);
              try {
                const data = await request(
                  "facilities?cursor=" + directoryCursor,
                );
                setFacilities((rows) => [...rows, ...data.facilities]);
                setDirectoryCursor(data.nextCursor);
              } catch (err) {
                setError(
                  err instanceof Error ? err.message : "Directory unavailable.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            More facilities
          </button>
        )}
      </section>
      {loading && <p role="status">Loading facility records…</p>}
      {error && (
        <div className="sa-notice" role="alert">
          {error}{" "}
          <button onClick={() => window.location.reload()}>Reload</button>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {facility && (
        <>
          <section className="sa-card">
            <h2>{facility.name}</h2>
            <p>
              {facility.type.replaceAll("_", " ")} ·{" "}
              {facility.isActive ? "Active" : "Suspended"} ·{" "}
              {facility.isVerified ? "Verified" : "Unverified"}
            </p>
            <code>{facility.id}</code>
            <p>
              Personal details are protected. Use record IDs to identify
              memberships and invitations.
            </p>
          </section>
          <section className="sa-card">
            <h2>Invite a member or staff seat</h2>
            <p>
              Both email and phone ownership must be verified before membership
              becomes active. Invitations are delivered through OPA.
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (busy) return;
                const form = e.currentTarget;
                const values = Object.fromEntries(new FormData(form));
                const endpoint = String(values.seat);
                delete values.seat;
                const body = { ...values, facilityId: facility.id };
                const payload = JSON.stringify([endpoint, body]);
                if (invitationKey.current?.payload !== payload)
                  invitationKey.current = { payload, key: crypto.randomUUID() };
                if (await mutate(endpoint, body, invitationKey.current.key)) {
                  form.reset();
                  invitationKey.current = null;
                }
              }}
            >
              <fieldset disabled={busy || !facility.isActive}>
                <label>
                  Seat type
                  <select name="seat">
                    <option value="operators">Operator</option>
                    <option value="facility-admins">
                      Facility administrator
                    </option>
                    <option value="residents">Resident / member</option>
                  </select>
                </label>
                <div className="sa-fields">
                  <Field name="firstName" label="First name" />
                  <Field name="lastName" label="Last name" />
                  <Field name="email" label="Email" type="email" />
                  <Field
                    name="phoneNumber"
                    label="Phone number with country code"
                    type="tel"
                  />
                </div>
                <button>{busy ? "Queuing…" : "Send secure invitation"}</button>
              </fieldset>
            </form>
          </section>
          <section className="sa-card">
            <h2>Administrative reason</h2>
            <label>
              Required for access changes and invitation actions. Do not include
              personal details.
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
              />
            </label>
          </section>
          <section className="sa-card">
            <h2>Memberships and staff seats</h2>
            {members.length === 0 && (
              <p>No memberships yet. Pending invitations appear below.</p>
            )}
            {members.map((m) => (
              <article className="sa-notice" key={m.id}>
                <h3>{m.role.replaceAll("_", " ")}</h3>
                <code>{m.id}</code>
                <p>
                  {m.membershipState} · Account: {m.accountStatus}
                </p>
                <div className="sa-actions">
                  <button
                    disabled={
                      busy ||
                      !reason.trim() ||
                      (!m.isActive && m.accountStatus !== "ACTIVE")
                    }
                    onClick={() =>
                      mutate(
                        "facilities/" +
                          facility.id +
                          "/members/" +
                          m.id +
                          "/access",
                        {
                          reason,
                          action: m.isActive ? "suspend" : "reactivate",
                        },
                      )
                    }
                  >
                    {m.isActive ? "Suspend access" : "Reactivate access"}
                  </button>
                  <button
                    disabled={busy || !reason.trim()}
                    onClick={() =>
                      mutate(
                        "facilities/" +
                          facility.id +
                          "/members/" +
                          m.id +
                          "/access",
                        { reason, action: "revoke" },
                      )
                    }
                  >
                    Revoke membership
                  </button>
                </div>
              </article>
            ))}
            {cursors.members && (
              <button disabled={busy} onClick={() => more("members")}>
                More memberships
              </button>
            )}
          </section>
          <section className="sa-card">
            <h2>Invitations and enrollment</h2>
            {invitations.length === 0 && (
              <p>No invitations for this facility.</p>
            )}
            {invitations.map((i) => (
              <article className="sa-notice" key={i.id}>
                <h3>
                  {i.requestedRole.replaceAll("_", " ")} · {i.status}
                </h3>
                <code>{i.id}</code>
                <p>Expires {new Date(i.expiresAt).toLocaleString()}</p>
                {i.deliveries.map((d) => (
                  <p key={d.id}>
                    {d.channel}: {d.status} · {d.attemptCount} attempts
                  </p>
                ))}
                {!["ACCEPTED", "REVOKED"].includes(i.status) && (
                  <div className="sa-actions">
                    <button
                      disabled={
                        busy ||
                        !reason.trim() ||
                        i.status === "ACCEPTANCE_PENDING"
                      }
                      onClick={() =>
                        mutate(
                          "facilities/" +
                            facility.id +
                            "/invitations/" +
                            i.id +
                            "/resend",
                          { reason },
                        )
                      }
                    >
                      Resend invitation
                    </button>
                    <button
                      disabled={busy || !reason.trim()}
                      onClick={() =>
                        mutate(
                          "facilities/" +
                            facility.id +
                            "/invitations/" +
                            i.id +
                            "/revoke",
                          { reason },
                        )
                      }
                    >
                      Revoke invitation
                    </button>
                  </div>
                )}
              </article>
            ))}
            {cursors.invitations && (
              <button disabled={busy} onClick={() => more("invitations")}>
                More invitations
              </button>
            )}
          </section>
          <section className="sa-card">
            <h2>Protected identity reveal</h2>
            <p>
              Reveal one identifier for an authorized support case. Your current
              facility scope and a separate, unexpired PII grant are required.
              Each successful reveal is audited.
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (busy) return;
                setBusy(true);
                setError("");
                setRevealed("");
                try {
                  const data = await request(
                    "facilities/" + facility.id + "/reveal",
                    Object.fromEntries(new FormData(e.currentTarget)),
                  );
                  setRevealed(data.value);
                } catch (err) {
                  setError(
                    err instanceof Error ? err.message : "Reveal unavailable.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              <fieldset disabled={busy}>
                <Field name="identifierId" label="Protected identifier ID" />
                <Field name="caseReference" label="Case reference ID" />
                <label>
                  Purpose
                  <select name="purpose">
                    <option value="SUPPORT_CASE">Support case</option>
                    <option value="ACCOUNT_RECOVERY">Account recovery</option>
                  </select>
                </label>
                <button>Reveal one identifier</button>
              </fieldset>
            </form>
            {revealed && (
              <div className="sa-notice" role="status">
                {revealed}{" "}
                <button onClick={() => setRevealed("")}>Hide identifier</button>
              </div>
            )}
          </section>
          <section className="sa-card">
            <h2>Administrative audit</h2>
            {events.length === 0 && (
              <p>No administrative events for this facility.</p>
            )}
            {events.map((e) => (
              <article className="sa-notice" key={e.id}>
                <h3>{e.action}</h3>
                <p>{new Date(e.createdAt).toLocaleString()}</p>
                <p>
                  Actor: {e.actorUserId}
                  <br />
                  Target: {e.resourceId}
                </p>
                {e.reason && <p>Reason: {e.reason}</p>}
              </article>
            ))}
            {cursors.audit && (
              <button disabled={busy} onClick={() => more("audit")}>
                More audit events
              </button>
            )}
          </section>
        </>
      )}
    </>
  );
}
