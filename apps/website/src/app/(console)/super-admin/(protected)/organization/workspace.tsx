"use client";
import { OrganizationHierarchy, FacilityHierarchyDetail, type GovernanceFacility } from "@/components/institutional/organization-hierarchy";
import { AccountRecovery } from "@/components/institutional/account-recovery";
import { useEffect, useMemo, useRef, useState } from "react";
import { superAdminFetch } from "@/lib/super-admin-fetch";
import { operationStore } from "@/lib/canonical-operations";
import { ActionForm } from "@/components/institutional/action-form";
import {
  supportCapabilities,
  sensitiveCapabilities,
  globalCapabilities,
} from "@/lib/support-administration";
import "@/components/institutional/console.css";
type Facility = GovernanceFacility;
type Employee = {
  id: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  accountStatus: string;
  supportEmployment: { state: string } | null;
  supportGrants: Array<{
    id: string;
    capability: string;
    revokedAt: string | null;
    expiresAt: string | null;
  }>;
};
type Overview = {
  actor: { id: string; role: string };
  organizations: Array<{ id: string; name: string }>;
  facilities: Facility[];
  assignments: Array<{ id: string; actorUserId: string; facilityId: string }>;
  elevations: Array<{
    id: string;
    actorUserId: string;
    facilityId: string;
    capability: string;
    expiresAt: string;
  }>;
  employmentCount: number;
  openIncidents: number;
};
type Invitation = {
  id: string;
  revokedAt: string | null;
  expiresAt: string;
  deliveries: Array<{
    channel: string;
    status: string;
    deliveryStatus: string;
    failureCategory: string | null;
  }>;
};
export default function GovernanceWorkspace({
  initial = "Platform Overview",
}: {
  initial?: string;
}) {
  const [overview, setOverview] = useState<Overview | null>(null),
    [employees, setEmployees] = useState<Employee[]>([]),
    [invitations, setInvitations] = useState<Invitation[]>([]),
    [readiness, setReadiness] = useState<{
      sms?: { state: string };
      email?: { state: string };
    }>({}),
    [readState, setReadState] = useState("INITIAL_LOADING"),
    [confirmed, setConfirmed] = useState(false),
    [message, setMessage] = useState("");
  const pending = useRef(false),
    alive = useRef(true),
    generation = useRef(0);
  const [section, setSection] = useState(initial),
    [facilityId, setFacilityId] = useState(""),
    [supportId, setSupportId] = useState(""),
    [capability, setCapability] = useState("STAFF_READ"),
    [cases, setCases] = useState<
      Array<{
        id: string;
        reference: string;
        category: string;
        assignedToUserId: string;
        status: string;
      }>
    >([]);
  useEffect(() => {
    let alive = true;
    if (facilityId)
      void superAdminFetch("organization/facilities/" + facilityId + "/cases")
        .then(async (response) => {
          const rows = response.ok ? await response.json() : [];
          if (alive) setCases(rows);
        })
        .catch(() => {});
    return () => {
      alive = false;
    };
  }, [facilityId, overview]);
  const actor = overview?.actor?.id ?? "";
  const [caseScope, setCaseScope] = useState("");
  const nextCaseScope = actor + ":" + facilityId;
  if (caseScope !== nextCaseScope) {
    setCaseScope(nextCaseScope);
    setCases([]);
  }
  const [previousActor, setPreviousActor] = useState(actor);
  const transport = useMemo(
    () =>
      (path: string, init: RequestInit = {}) =>
        superAdminFetch(path, {
          ...init,
          headers: {
            ...Object.fromEntries(new Headers(init.headers)),
            "x-platform-actor": actor,
          },
        }),
    [actor],
  );
  const store = useMemo(
    () =>
      operationStore(
        "platform:" + actor,
        transport,
        "organization/operations/",
      ),
    [actor, transport],
  );
  const facility =
      actor === previousActor
        ? overview?.facilities.find((f) => f.id === facilityId)
        : undefined,
    employee =
      actor === previousActor
        ? employees.find((e) => e.id === supportId)
        : undefined;
  async function refresh() {
    if (pending.current) return;
    pending.current = true;
    const current = generation.current;
    if (!overview) setReadState("INITIAL_LOADING");
    try {
      const [a, b, c] = await Promise.all([
        superAdminFetch("organization/overview"),
        superAdminFetch("support/employees"),
        superAdminFetch("support/readiness"),
      ]);
      if (!a.ok || !b.ok)
        throw Error("Current platform authority or service unavailable.");
      const next = (await a.json()) as Overview,
        workforce = await b.json(),
        services = c.ok ? await c.json() : {};
      if (!alive.current || current !== generation.current) return;
      if (
        !next.actor?.id ||
        next.actor.role !== "ADMIN" ||
        ![
          next.organizations,
          next.facilities,
          next.assignments,
          next.elevations,
          workforce.employees,
          workforce.invitations,
        ].every(Array.isArray)
      )
        throw Error(
          "Platform response is incomplete. Current authority could not be confirmed.",
        );
      setConfirmed(true);
      setOverview((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
      );
      setEmployees(workforce.employees);
      setInvitations(workforce.invitations);
      setReadiness(services);
      setReadState("READY");
      setMessage("");
    } catch (err) {
      if (alive.current && current === generation.current) {
        setConfirmed(false);
        setReadState("READ_UNAVAILABLE");
        setMessage(
          err instanceof Error ? err.message : "Current authority unavailable.",
        );
      }
    } finally {
      if (current === generation.current) pending.current = false;
    }
  }
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  });
  const refreshAfterMutation = () => {
    generation.current++;
    pending.current = false;
    void refreshRef.current();
  };
  if (previousActor !== actor) {
    if (previousActor) {
      setSupportId("");
      setFacilityId("");
      setCases([]);
    }
    setPreviousActor(actor);
  }
  useEffect(() => {
    alive.current = true;
    const lost = () => {
        pending.current = false;
        generation.current++;
        setConfirmed(false);
        setOverview(null);
        setEmployees([]);
        setInvitations([]);
        setReadState("AUTHORITY_EXPIRED");
      },
      focus = () => {
        void refreshRef.current();
      };
    window.addEventListener("opa-super-admin-authority-lost", lost);
    window.addEventListener("focus", focus);
    window.addEventListener("pageshow", focus);
    const timer = setInterval(() => {
      if (document.visibilityState !== "hidden") void refreshRef.current();
    }, 10000);
    let disposed = false;
    void Promise.resolve().then(() => {
      if (!disposed) void refreshRef.current();
    });
    const visibility = () => {
      if (document.visibilityState === "visible") focus();
    };
    const storage = (event: StorageEvent) => {
      if (event.key === "opa-super-admin-session") {
        lost();
        void refreshRef.current();
      }
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("storage", storage);
    const invalidate = () => {
      disposed = true;
      generation.current++;
      pending.current = false;
    };
    return () => {
      alive.current = false;
      invalidate();
      clearInterval(timer);
      window.removeEventListener("opa-super-admin-authority-lost", lost);
      window.removeEventListener("focus", focus);
      window.removeEventListener("pageshow", focus);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("storage", storage);
    };
  }, []);
  useEffect(() => () => store.expire(), [store]);
  const blocked = !overview
    ? "Current Super Admin authority is required."
    : !confirmed
      ? "Revalidating current platform session."
      : "";
  const targetBlocked =
    blocked || (!employee ? "Select a Technical Support employee." : "");
  const grantBlocked =
    targetBlocked ||
    (employee?.supportEmployment?.state !== "ACTIVE" ||
    !employee?.isActive ||
    employee?.accountStatus !== "ACTIVE"
      ? "An active account and ACTIVE employment are required."
      : !facility
        ? "Select a facility."
        : "");
  const deliveryBlocked =
    readiness.sms?.state !== "CONFIGURED" ||
    readiness.email?.state !== "CONFIGURED";
  return (
    <section className="ic-console" key={actor}>
      <h1>OPA Platform Governance</h1>
      <p>
        Super Admin governs organizations, facilities and the OPA workforce.
        Customer Facility Admins own routine institutional staffing.
      </p>
      <p role="status">
        {readState === "INITIAL_LOADING"
          ? "Loading platform context…"
          : readState === "READY"
            ? "Platform context confirmed"
            : message}
      </p>
      <button onClick={() => void refresh()}>Refresh current state</button>
      <nav>
        {[
          "Platform Overview",
          "Organizations",
          "Facilities",
          "OPA Workforce",
          "Temporary Access",
          "Delivery & Communications",
          "Security & Audit",
          "Platform Health",
          "Recovery",
        ].map((item) => (
          <button
            key={item}
            onClick={() => setSection(item)}
            aria-current={section === item ? "page" : undefined}
          >
            {item}
          </button>
        ))}
      </nav>
      {overview && (
        <>
          <section hidden={section !== "Platform Overview"}>
            <div className="ic-grid">
              <article className="ic-card">
                <h2>Organizations and facilities</h2>
                <p>
                  {overview.organizations.length} organizations ·{" "}
                  {overview.facilities.length} facilities shown
                </p>
              </article>
              <article className="ic-card">
                <h2>OPA workforce</h2>
                <p>{overview.employmentCount} ACTIVE employments</p>
              </article>
              <article className="ic-card">
                <h2>Incident operations</h2>
                <p>{overview.openIncidents} OPEN incidents</p>
                <p>Use facility oversight to review response evidence.</p>
              </article>
            </div>
          </section>
          <section hidden={section !== "Organizations"}>
            <ActionForm
              title="Create organization"
              owner="organization:create"
              path="organization/organizations"
              store={store}
              prerequisite={blocked}
              onSuccess={refreshAfterMutation}
            >
              <label>
                Organization name
                <input name="name" required maxLength={160} />
              </label>
            </ActionForm>
            <OrganizationHierarchy key={actor} organizations={overview.organizations} facilities={overview.facilities} store={store} blocked={blocked} onSuccess={refreshAfterMutation} />
          </section>
          <div className="ic-grid">
            <label>
              Facility
              <select
                value={facility?.id ?? ""}
                onChange={(e) => setFacilityId(e.target.value)}
              >
                <option value="">Select a facility</option>
                {overview.facilities.map((f) => (
                  <option value={f.id} key={f.id}>
                    {f.name} · {f.operationalState}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Technical Support employee
              <select
                value={employee?.id ?? ""}
                onChange={(e) => setSupportId(e.target.value)}
              >
                <option value="">Select an employee</option>
                {employees.map((e) => (
                  <option value={e.id} key={e.id}>
                    {e.firstName} {e.lastName} ·{" "}
                    {e.supportEmployment?.state ?? "NOT APPOINTED"}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <section hidden={section !== "Facilities"}>
            <p>
              <a href="/super-admin/facilities/new">Create facility</a> ·{" "}
              <a href="/super-admin">
                Facility directory and membership oversight
              </a>
            </p>
            {facility && (
              <>
                <ActionForm
                  title="Change facility lifecycle"
                  owner={facility.id + ":lifecycle"}
                  path={"organization/facilities/" + facility.id + "/lifecycle"}
                  store={store}
                  prerequisite={blocked}
                  confirmation
                  onSuccess={refreshAfterMutation}
                >
                  <p>
                    Current state: {facility.operationalState}. Suspension and
                    decommissioning revoke support assignments and elevations.
                    Decommissioning cannot be undone by ordinary reactivation.
                  </p>
                  <label>
                    Requested lifecycle
                    <select name="state">
                      <option>COMMISSIONING</option>
                      <option>OPERATIONAL</option>
                      <option>SUSPENDED</option>
                      <option>DECOMMISSIONED</option>
                    </select>
                  </label>
                </ActionForm>
                <FacilityHierarchyDetail facility={facility} />
                {!facility.organizationId && <p>Unassociated facility. <button type="button" onClick={() => setSection("Organizations")}>Open Organizations to attach this facility</button></p>}
                <ActionForm
                  title="Assign OPA Support owner"
                  owner={facility.id + ":assignment"}
                  path={
                    "organization/facilities/" + facility.id + "/assignment"
                  }
                  store={store}
                  context={{ supportId: employee?.id }}
                  prerequisite={grantBlocked}
                  confirmation
                  onSuccess={refreshAfterMutation}
                >
                  <p>
                    Reassignment revokes the previous owner and previous
                    elevations, retaining history.
                  </p>
                </ActionForm>
                <ActionForm
                  title="Revoke OPA Support Assignment"
                  owner={facility.id + ":revoke-assignment"}
                  path={
                    "organization/facilities/" + facility.id + "/assignment"
                  }
                  store={store}
                  prerequisite={blocked}
                  confirmation
                  onSuccess={refreshAfterMutation}
                />
                <p>
                  Current owner:{" "}
                  {(() => {
                    const assignment = overview.assignments.find(
                      (a) => a.facilityId === facility.id,
                    );
                    const owner = employees.find(
                      (e) => e.id === assignment?.actorUserId,
                    );
                    return owner
                      ? owner.firstName + " " + owner.lastName
                      : "Unassigned";
                  })()}
                </p>
              </>
            )}
          </section>
          <section hidden={section !== "OPA Workforce"}>
            <ActionForm
              title="Invite Technical Support"
              owner="workforce:invite"
              path="support/invitations"
              store={store}
              prerequisite={
                blocked ||
                (deliveryBlocked
                  ? "SMS and email must be configured before sending an invitation."
                  : "")
              }
              onSuccess={refreshAfterMutation}
            >
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
                <input name="phoneNumber" type="tel" required />
              </label>
            </ActionForm>
            {employee && (
              <>
                <h2>
                  {employee.firstName} {employee.lastName}
                </h2>
                <p>
                  Employment:{" "}
                  {employee.supportEmployment?.state ?? "NOT APPOINTED"}.
                  Employment does not expire.
                </p>
                <div className="ic-grid">
                  {["ACTIVE", "SUSPENDED", "ENDED"].map((state) => (
                    <ActionForm
                      key={state}
                      title={
                        state === "ACTIVE"
                          ? "Activate / reactivate employment"
                          : state === "SUSPENDED"
                            ? "Suspend employment"
                            : "End employment"
                      }
                      owner={employee.id + ":employment:" + state}
                      path={"support/employees/" + employee.id + "/employment"}
                      store={store}
                      context={{ state }}
                      prerequisite={
                        targetBlocked ||
                        (employee.supportEmployment?.state === "ENDED"
                          ? "Ended employment cannot be reactivated here."
                          : employee.supportEmployment?.state === state
                            ? "Employment already has this state."
                            : "")
                      }
                      confirmation
                      onSuccess={refreshAfterMutation}
                    />
                  ))}
                </div>
                <ActionForm
                  title="Grant Standard Facility Support permissions"
                  owner={employee.id + ":" + facilityId + ":profile"}
                  path={"organization/employees/" + employee.id + "/profile"}
                  store={store}
                  context={{ facilityId }}
                  prerequisite={grantBlocked}
                  onSuccess={refreshAfterMutation}
                >
                  <p>
                    Facility and staff diagnostics, first Facility Admin
                    provisioning, enrollment support, delivery diagnostics,
                    Command Center diagnostics and audit read. Requires a
                    separate OPA Support Assignment. No automatic plaintext
                    identity or exceptional intervention authority.
                  </p>
                </ActionForm>
                <details>
                  <summary>Advanced permissions</summary>
                  <ActionForm
                    title="Grant explicit permission"
                    owner={employee.id + ":advanced"}
                    path={"support/employees/" + employee.id + "/grants"}
                    store={store}
                    context={{
                      capability,
                      ...(!globalCapabilities.includes(capability)
                        ? { facilityId }
                        : {}),
                    }}
                    prerequisite={
                      targetBlocked ||
                      (!globalCapabilities.includes(capability)
                        ? grantBlocked
                        : "")
                    }
                    confirmation
                    onSuccess={refreshAfterMutation}
                  >
                    <label>
                      Permission
                      <select
                        value={capability}
                        onChange={(e) => setCapability(e.target.value)}
                      >
                        {supportCapabilities.map((c) => (
                          <option key={c} value={c}>
                            {c.toLowerCase().replaceAll("_", " ")}
                          </option>
                        ))}
                      </select>
                    </label>
                    {sensitiveCapabilities.includes(capability) && (
                      <label>
                        Required expiry
                        <input
                          name="expiresAt"
                          type="datetime-local"
                          required
                        />
                      </label>
                    )}
                    <p>
                      Sensitive actions still require their separate elevation
                      or Identity Access Grant.
                    </p>
                  </ActionForm>
                </details>
                <ActionForm
                  title="Revoke all support permissions"
                  owner={employee.id + ":revoke-all"}
                  path={"support/employees/" + employee.id + "/revoke-all"}
                  store={store}
                  prerequisite={targetBlocked}
                  confirmation
                  onSuccess={refreshAfterMutation}
                >
                  <p>
                    Employment and historical audit remain. Every current
                    permission is revoked.
                  </p>
                </ActionForm>
                <h3>Current permission records</h3>
                {employee.supportGrants
                  .filter((g) => !g.revokedAt)
                  .map((g) => (
                    <ActionForm
                      key={g.id}
                      title={
                        "Revoke " +
                        g.capability.toLowerCase().replaceAll("_", " ")
                      }
                      owner={g.id + ":revoke"}
                      path={"support/grants/" + g.id + "/revoke"}
                      store={store}
                      prerequisite={blocked}
                      confirmation
                      onSuccess={refreshAfterMutation}
                    >
                      <p>
                        {g.expiresAt
                          ? "Expires " + g.expiresAt
                          : "Persistent while employment and required assignment remain valid"}
                      </p>
                    </ActionForm>
                  ))}
              </>
            )}
            <h2>Pending workforce invitations</h2>
            {invitations.map((inv) => (
              <article className="ic-card" key={inv.id}>
                <p>
                  {inv.revokedAt
                    ? "REVOKED"
                    : new Date(inv.expiresAt) < new Date()
                      ? "EXPIRED"
                      : "Enrollment pending"}
                </p>
                {inv.deliveries.map((d) => (
                  <p key={d.channel}>
                    {d.channel}: {d.status} · {d.deliveryStatus}
                    {d.failureCategory ? " · " + d.failureCategory : ""}
                  </p>
                ))}
                {!inv.revokedAt && (
                  <ActionForm
                    title="Review workforce invitation"
                    owner={inv.id + ":recovery"}
                    path={"support/invitations/" + inv.id + "/action"}
                    store={store}
                    prerequisite={blocked}
                    confirmation
                    onSuccess={refreshAfterMutation}
                  >
                    <label>
                      Action
                      <select name="action">
                        <option value="revoke">Revoke</option>
                        <option value="resend" disabled={deliveryBlocked}>
                          Resend both channels
                        </option>
                      </select>
                    </label>
                    {deliveryBlocked && (
                      <p>
                        Resend blocked: SMS or email configuration is missing.
                        No provider request will be attempted.
                      </p>
                    )}
                  </ActionForm>
                )}
                <details>
                  <summary>Invitation reference</summary>
                  {inv.id}
                </details>
              </article>
            ))}
          </section>
          <section hidden={section !== "Temporary Access"}>
            <h2>Temporary Elevation</h2>
            <p>
              Exceptional actions require an assigned employee, exact facility,
              current Support Case and a separate job permission.
            </p>
            <ActionForm
              title="Approve Temporary Elevation"
              owner={supportId + ":" + facilityId + ":elevation"}
              path="organization/elevations"
              store={store}
              context={{ supportId, facilityId }}
              prerequisite={grantBlocked}
              confirmation
              onSuccess={refreshAfterMutation}
            >
              <label>
                Support Case reference
                <select name="caseReference" required>
                  <option value="">Select this employee’s open case</option>
                  {cases
                    .filter(
                      (c) =>
                        c.assignedToUserId === supportId &&
                        ["OPEN", "INVESTIGATING"].includes(c.status),
                    )
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.reference} · {c.category}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Exact authority
                <select name="capability">
                  {[
                    "STAFF_RECOVER_ACCESS",
                    "FACILITY_ADMIN_DEPROVISION",
                    "RESIDENT_SUPPORT_OVERRIDE",
                    "INCIDENT_RESOLVE",
                    "STAFF_PROVISION",
                  ].map((c) => (
                    <option key={c} value={c}>
                      {c.toLowerCase().replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Starts
                <input name="startsAt" type="datetime-local" required />
              </label>
              <label>
                Expires
                <input name="expiresAt" type="datetime-local" required />
              </label>
            </ActionForm>
            {overview.elevations.map((e) => (
              <ActionForm
                key={e.id}
                title="Revoke Temporary Elevation"
                owner={e.id + ":revoke"}
                path={"organization/elevations/" + e.id + "/revoke"}
                store={store}
                prerequisite={blocked}
                confirmation
                onSuccess={refreshAfterMutation}
              >
                <p>
                  {e.capability.toLowerCase().replaceAll("_", " ")} · expires{" "}
                  {e.expiresAt}
                </p>
              </ActionForm>
            ))}
          </section>
          <section
            hidden={
              !["Delivery & Communications", "Platform Health"].includes(
                section,
              )
            }
          >
            <h2>Delivery readiness</h2>
            <p>
              SMS / Africa&apos;s Talking:{" "}
              {readiness.sms?.state.replaceAll("_", " ") ?? "UNKNOWN"}
            </p>
            <p>
              Email / Resend:{" "}
              {readiness.email?.state.replaceAll("_", " ") ?? "UNKNOWN"}
            </p>
            <p>
              Configured means settings are present; credentials and delivery
              remain unverified until observed.
            </p>
          </section>
          <section hidden={!["Security & Audit", "Recovery"].includes(section)}>
            <AccountRecovery
              key={actor}
              transport={transport}
              store={store}
              blocked={blocked}
              onSuccess={refreshAfterMutation}
            />
            <p>
              <a href="/super-admin">
                Open facility governance, audit and controlled membership
                recovery
              </a>
            </p>
            <p>
              History is retained. Employment, assignment and permission
              revocation remove authority without deleting identities.
            </p>
          </section>
        </>
      )}
    </section>
  );
}
