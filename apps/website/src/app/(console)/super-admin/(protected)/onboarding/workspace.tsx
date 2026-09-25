"use client";
import { useEffect, useRef, useState } from "react";
import { onboardingFetch } from "@/lib/onboarding-fetch";
type User = {
  id: string;
  role: string;
  isActive: boolean;
  accountStatus: string;
};
type Facility = { id: string; name: string; isActive: boolean };
type Grant = {
  id: string;
  facilityId: string;
  expiresAt: string;
  status: string;
  approvedByUserId: string;
};
export default function Delegation() {
  const [users, setUsers] = useState<User[]>([]),
    [facilities, setFacilities] = useState<Facility[]>([]),
    [employee, setEmployee] = useState(""),
    [grants, setGrants] = useState<Grant[]>([]);
  const [userCursor, setUserCursor] = useState<string | null>(null),
    [facilityCursor, setFacilityCursor] = useState<string | null>(null),
    [cursor, setCursor] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const revision = useRef(0);
  async function api(path: string, body?: object) {
    const response = await onboardingFetch(
      path,
      body
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : undefined,
      true,
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Request failed.");
    return data;
  }
  useEffect(() => {
    let active = true;
    Promise.all([api("employees"), api("facilities")])
      .then(([u, f]) => {
        if (active) {
          setUsers(u.users);
          setUserCursor(u.nextCursor);
          setFacilities(f.facilities);
          setFacilityCursor(f.nextCursor);
        }
      })
      .catch(() => {
        if (active)
          setMessage("Unable to load users or facilities. Reload to retry.");
      });
    return () => {
      active = false;
    };
  }, []);
  async function load(id: string, after?: string) {
    const version = ++revision.current;
    setBusy(true);
    setMessage("");
    try {
      const data = await api(
        `employees/${id}/grants` + (after ? `?cursor=${after}` : ""),
      );
      if (revision.current === version) {
        setGrants((old) => (after ? [...old, ...data.grants] : data.grants));
        setCursor(data.nextCursor);
      }
    } catch (error) {
      if (revision.current === version) {
        setGrants([]);
        setMessage(error instanceof Error ? error.message : "Request failed.");
      }
    } finally {
      if (revision.current === version) setBusy(false);
    }
  }
  async function mutate(path: string, body: object) {
    setBusy(true);
    setMessage("");
    try {
      await api(path, body);
      await load(employee);
      setMessage("Delegation updated.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Request failed. Refresh before retrying.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function more(kind: "employees" | "facilities", after: string) {
    setBusy(true);
    try {
      const data = await api(kind + "?cursor=" + after);
      if (kind === "employees") {
        setUsers((old) => [...old, ...data.users]);
        setUserCursor(data.nextCursor);
      } else {
        setFacilities((old) => [...old, ...data.facilities]);
        setFacilityCursor(data.nextCursor);
      }
    } catch {
      setMessage("Unable to load more records.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="sa-card">
        <h2>Employee</h2>
        <p>
          Select by the existing OPA user reference. Verify this reference
          against your employee record before granting access.
        </p>
        <label>
          Existing user
          <select
            disabled={busy}
            value={employee}
            onChange={(e) => {
              setEmployee(e.target.value);
              setGrants([]);
              setCursor(null);
              ++revision.current;
              if (e.target.value) void load(e.target.value);
            }}
          >
            <option value="">Select user</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.id} · {u.role} · {u.isActive ? u.accountStatus : "SUSPENDED"}
              </option>
            ))}
          </select>
        </label>
        {userCursor && (
          <button
            disabled={busy}
            onClick={() => void more("employees", userCursor)}
          >
            More users
          </button>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const id = String(new FormData(e.currentTarget).get("employee"));
            setEmployee(id);
            setGrants([]);
            void load(id);
          }}
        >
          <label>
            Or enter existing user reference
            <input
              name="employee"
              required
              pattern="[0-9a-fA-F-]{36}"
              disabled={busy}
            />
          </label>
          <button disabled={busy}>Select reference</button>
        </form>
      </section>
      {message && (
        <p role="status" className="sa-notice">
          {message}
        </p>
      )}
      {employee && (
        <>
          <section className="sa-card">
            <h2>Grant staff onboarding</h2>
            <p>Selected employee: {employee}</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void mutate(`employees/${employee}/grants`, {
                  facilityId: f.get("facility"),
                  expiresAt: new Date(String(f.get("expires"))).toISOString(),
                  reason: f.get("reason"),
                });
              }}
            >
              <fieldset disabled={busy}>
                <label>
                  Existing facility
                  <select name="facility" required>
                    <option value="">Select facility</option>
                    {facilities
                      .filter((f) => f.isActive)
                      .map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Expiration (your local time)
                  <input type="datetime-local" name="expires" required />
                </label>
                <label>
                  Reason
                  <select name="reason">
                    <option>Approved customer onboarding assignment</option>
                    <option>Temporary technical support coverage</option>
                  </select>
                </label>
                <button>Grant authority</button>
              </fieldset>
            </form>
            {facilityCursor && (
              <button
                disabled={busy}
                onClick={() => void more("facilities", facilityCursor)}
              >
                More facilities
              </button>
            )}
          </section>
          <section className="sa-card">
            <h2>Assignment history</h2>
            <div className="sa-actions">
              <button disabled={busy} onClick={() => void load(employee)}>
                Refresh grants
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      `Revoke all onboarding authority for ${employee}? Existing customer memberships remain unchanged.`,
                    )
                  )
                    void mutate(`employees/${employee}/revoke-all`, {
                      reason: "Employee onboarding authority offboarding",
                    });
                }}
              >
                Revoke all grants
              </button>
            </div>
            {grants.map((g) => (
              <article key={g.id}>
                <h3>
                  {facilities.find((f) => f.id === g.facilityId)?.name ??
                    g.facilityId}
                </h3>
                <p>
                  {g.status} · Expires {new Date(g.expiresAt).toLocaleString()}
                </p>
                <p>
                  Grant {g.id} · Approved by {g.approvedByUserId}
                </p>
                <button
                  disabled={busy || g.status === "REVOKED"}
                  onClick={() =>
                    void mutate(`employees/${employee}/grants/${g.id}/revoke`, {
                      reason: "Onboarding assignment ended",
                    })
                  }
                >
                  Revoke grant
                </button>
              </article>
            ))}
            {!grants.length && <p>No grants found.</p>}
            {cursor && (
              <button
                disabled={busy}
                onClick={() => void load(employee, cursor)}
              >
                More grants
              </button>
            )}
          </section>
        </>
      )}
    </>
  );
}
