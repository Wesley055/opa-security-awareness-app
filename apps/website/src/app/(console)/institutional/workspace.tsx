"use client";
import {
  ConsoleIdentity,
  ConsoleStatus,
  roleLabel,
} from "@/components/console/identity";
import { SafeWalkProtection } from "@/components/console/safewalk-protection";
import { ReportingShell } from "@/components/console/reporting-shell";
import { PasswordInput } from "@/components/auth/password-input";
import { FirstFacilityAdmin } from "@/components/institutional/first-facility-admin";
import { MemberOversight } from "@/components/institutional/member-oversight";
import { useInvitationRoles } from "@/components/institutional/use-invitation-roles";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { institutionalFetch } from "@/lib/institutional-fetch";
import {
  useInstitutionalContext,
  type InstitutionalContext,
} from "@/lib/use-institutional-context";
import { operationStore } from "@/lib/canonical-operations";
import { ActionForm } from "@/components/institutional/action-form";
import "@/components/institutional/console.css";
type Row = Record<string, unknown>;
function savedSelection(actor: string): {
  facility?: string;
  supportCase?: string;
} {
  try {
    const value = JSON.parse(
      sessionStorage.getItem("opa-console-selection:" + actor) || "{}",
    );
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return {
      facility: typeof value.facility === "string" ? value.facility : undefined,
      supportCase:
        typeof value.supportCase === "string" ? value.supportCase : undefined,
    };
  } catch {
    return {};
  }
}
export default function Workspace() {
  const authority = useInstitutionalContext();
  const [signing, setSigning] = useState(false),
    [error, setError] = useState("");
  const signingRef = useRef(false);
  async function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (signingRef.current) return;
    authority.expire();
    signingRef.current = true;
    setSigning(true);
    setError("");
    const form = e.currentTarget;
    try {
      const body = Object.fromEntries(new FormData(form));
      const response = await institutionalFetch("login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok)
        throw Error(
          "Sign-in was not accepted. Check your account and employment or membership state.",
        );
      form.reset();
      try {
        localStorage.setItem("opa-institutional-session", crypto.randomUUID());
      } catch {}
      await authority.refresh(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in unavailable.");
    } finally {
      signingRef.current = false;
      setSigning(false);
    }
  }
  return (
    <main className="ic-console">
      <h1>OPA Institutional Command Center</h1>
      {authority.message && <p role="status">{authority.message}</p>}
      {error && <p role="alert">{error}</p>}
      {authority.context ? (
        <Console
          key={authority.context.actor.id + authority.context.actor.role}
          context={authority.context}
          canMutate={authority.canMutate}
          refresh={() => void authority.refresh()}
          logout={async () => {
            authority.expire();
            try {
              const response = await institutionalFetch("logout", {
                method: "POST",
              });
              if (!response.ok) throw Error("Sign-out rejected");
              try {
                localStorage.setItem(
                  "opa-institutional-session",
                  crypto.randomUUID(),
                );
              } catch {}
            } catch {
              setError(
                "Local workspace closed. Server sign-out could not be confirmed; retry before sharing this browser.",
              );
            }
          }}
        />
      ) : authority.state === "INITIAL_LOADING" ? (
        <p role="status">Loading current session…</p>
      ) : (
        <form className="ic-card" onSubmit={login}>
          <h2>Institutional sign-in</h2>
          <label>
            Email
            <input name="email" type="email" autoComplete="username" required />
          </label>
          <label>
            Password
            <PasswordInput
              aria-label="Password"
              name="password"

              autoComplete="current-password"
              required
            />
          </label>
          <button disabled={signing}>
            {signing ? "Signing in…" : "Sign in"}
          </button>
          <a href="/forgot-password">Forgot password / recover access</a>
          <p>
            Local sign-in for Technical Support, Facility Admin and Operator
            accounts. Restoring a session does not reset your password.
          </p>
          <button type="button" onClick={() => void authority.refresh(true)}>
            Check current session
          </button>
        </form>
      )}
    </main>
  );
}
function Console({
  context,
  canMutate,
  refresh,
  logout,
}: {
  context: InstitutionalContext;
  canMutate: boolean;
  refresh: () => void;
  logout: () => Promise<void>;
}) {
  const actor = context.actor.id + ":" + context.actor.role,
    role = context.actor.role;
  const transport = useMemo(
    () =>
      (path: string, init: RequestInit = {}) =>
        institutionalFetch(path, {
          ...init,
          headers: {
            ...Object.fromEntries(new Headers(init.headers)),
            "x-institutional-actor": actor,
          },
        }),
    [actor],
  );
  const store = useMemo(
    () => operationStore(actor, transport),
    [actor, transport],
  );
  const [selected, setSelected] = useState(
      () =>
        savedSelection(actor).facility ??
        (role === "FACILITY_ADMIN" && context.facilities.length === 1
          ? context.facilities[0].id
          : ""),
    ),
    [section, setSection] = useState("Overview"),
    [caseId, setCaseId] = useState(
      () => savedSelection(actor).supportCase ?? "",
    ),
    [data, setData] = useState<Record<string, unknown>>({}),
    [readNotice, setReadNotice] = useState("");
  const facility = context.facilities.find((f) => f.id === selected),
    effectiveSelected = facility?.id ?? "",
    base = "facilities/" + effectiveSelected;
  const generation = useRef(0);
  useEffect(() => {
    try {
      sessionStorage.setItem(
        "opa-console-selection:" + actor,
        JSON.stringify({ facility: selected, supportCase: caseId }),
      );
    } catch {}
  }, [actor, selected, caseId]);

  const scopeKey = JSON.stringify(
    [...context.facilities]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((f) => [f.id, [...f.capabilities].sort()]),
  );

  if (selected && !facility) {
    setSelected("");
    setCaseId("");
  }
  const [inviteRole, setInviteRole] = useState("");
  const [readAt, setReadAt] = useState(() => Date.now());
  const [dataScope, setDataScope] = useState("");
  const nextDataScope = effectiveSelected + ":" + scopeKey;
  if (dataScope !== nextDataScope) {
    setDataScope(nextDataScope);
    setData({});
  }
  useEffect(() => () => store.expire(), [store, scopeKey]);
  async function load() {
    if (!facility) return;
    const current = ++generation.current;

    try {
      const results = await Promise.all(
        [
          "members",
          "cases",
          "commissioning",
          "enrollments",
          "delivery",
          "audit",
          "incidents",
          "oversight",
        ].map(async (name) => {
          const response = await transport(base + "/" + name);
          if (!response.ok && ![401, 403].includes(response.status))
            throw Error("Facility service unavailable");
          return [name, response.ok ? await response.json() : null] as const;
        }),
      );
      const readiness = await transport("readiness");
      const providerReadiness = readiness.ok ? await readiness.json() : null;
      if (current !== generation.current) return;
      setReadAt(Date.now());
      setData({
        ...Object.fromEntries(results),
        readiness: providerReadiness,
      });
      setReadNotice("");
    } catch {
      if (current === generation.current)
        setReadNotice(
          "Facility information could not be refreshed. Retry; your form remains intact.",
        );
    }
  }
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  useEffect(() => {
    let disposed = false,
      pending = false;
    const read = async () => {
      if (pending || disposed || !effectiveSelected) return;
      pending = true;
      try {
        await loadRef.current();
      } finally {
        pending = false;
      }
    };
    const visible = () => {
      if (document.visibilityState === "visible") void read();
    };
    void Promise.resolve().then(() => {
      if (!disposed) void read();
    });
    const timer = setInterval(visible, 15000);
    window.addEventListener("focus", visible);
    window.addEventListener("pageshow", visible);
    document.addEventListener("visibilitychange", visible);
    const invalidate = () => {
      generation.current++;
    };
    return () => {
      disposed = true;
      invalidate();
      clearInterval(timer);
      window.removeEventListener("focus", visible);
      window.removeEventListener("pageshow", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [effectiveSelected, transport, scopeKey]);
  const rows = (name: string) =>
    Array.isArray(data[name]) ? (data[name] as Row[]) : [];
  const cases = rows("cases"),
    members = rows("members"),
    commissioning = data.commissioning as
      | {
          facility?: { operationalState?: string };
          gates?: string[];
          trainingGates?: string[];
          readiness?: { ready: boolean; missing: string[] };
        }
      | undefined;
  const currentCase = cases.find(
    (c) =>
      c.id === caseId && ["OPEN", "INVESTIGATING"].includes(String(c.status)),
  );
  if (
    caseId &&
    (data.cases === null || Array.isArray(data.cases)) &&
    !currentCase
  )
    setCaseId("");
  const cap = (name: string) =>
    role === "ADMIN" ||
    role === "FACILITY_ADMIN" ||
    Boolean(facility?.capabilities.includes(name));
  const prerequisite = !canMutate
    ? "Revalidating current authority."
    : !facility
      ? "Select an assigned facility."
      : "";
  const supportContext =
    role === "TECHNICAL_SUPPORT" && !currentCase
      ? "Select an open assigned Support Case."
      : "";
  const invitation = useInvitationRoles(
    transport,
    facility?.id ?? "",
    String(currentCase?.id ?? ""),
    canMutate &&
      Boolean(facility) &&
      (role !== "TECHNICAL_SUPPORT" || Boolean(currentCase)),
  );
  const mutationContext = {
    ...(currentCase ? { caseReference: currentCase.id } : {}),
  };
  const readiness = data.readiness as
    { sms?: { state: string }; email?: { state: string } } | undefined;
  const deliveryBlocked =
    readiness?.sms?.state !== "CONFIGURED" ||
    readiness?.email?.state !== "CONFIGURED";
  const sections =
    role === "TECHNICAL_SUPPORT"
      ? [
          "Overview",
          "My Facilities",
          "Commissioning",
          "Support Cases",
          "SafeWalk Protection",
          "Enrollment & Delivery",
          "Service Health",
          "Audit",
          "Temporary Access",
        ]
      : [
          "Overview",
          "People",
          "Invitations",
          "Command Center",
          "SafeWalk Protection",
          "Reports & Analytics",
          "Audit",
          "OPA Support",
        ];
  return (
    <>
      <header>
        <h2>
          {role === "TECHNICAL_SUPPORT"
            ? "OPA Support Console"
            : role === "FACILITY_ADMIN"
              ? "Facility Administration"
              : role === "FACILITY_OPERATOR"
                ? "Operator workspace"
                : "Platform institutional oversight"}
        </h2>
        <ConsoleIdentity
          name={context.actor.name}
          role={role}
          scope={
            facility?.name ||
            (context.facilities.length === 1
              ? context.facilities[0].name
              : role === "ADMIN"
                ? "Bounded platform oversight"
                : "Select an authorized facility")
          }
        />
        {role === "ADMIN" && (
          <a href="/super-admin/organization">
            Open platform governance and recovery
          </a>
        )}
        <button
          onClick={() => {
            try {
              sessionStorage.removeItem("opa-console-selection:" + actor);
            } catch {}
            void logout();
          }}
        >
          Sign out
        </button>
      </header>
      {role === "FACILITY_OPERATOR" ? (
        <div>
          <form action="/api/institutional/operator-handoff" method="post">
            <button type="submit">Open Command Center</button>
          </form>
          <p>
            Emergency response authority does not include institutional
            administration.
          </p>
        </div>
      ) : (
        <>
          <nav aria-label="Institutional workspace">
            {sections.map((name) => (
              <button
                key={name}
                aria-current={section === name ? "page" : undefined}
                onClick={() => setSection(name)}
              >
                {name}
              </button>
            ))}
          </nav>
          {role === "FACILITY_ADMIN" && (
            <div className="ic-actions" aria-label="Primary facility actions">
              <button
                onClick={() => {
                  setInviteRole("USER");
                  setSection("Invitations");
                }}
              >
                Invite Resident
              </button>
              <button
                onClick={() => {
                  setInviteRole("FACILITY_OPERATOR");
                  setSection("Invitations");
                }}
              >
                Invite Operator
              </button>
            </div>
          )}
          <label>
            {role === "TECHNICAL_SUPPORT"
              ? "My assigned facilities"
              : "Authorized facility"}
            <select
              value={effectiveSelected}
              onChange={(e) => {
                generation.current++;
                setSelected(e.target.value);
                setData({});
                setCaseId("");
              }}
            >
              <option value="">Select a facility</option>
              {context.facilities.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          {!context.facilities.length && (
            <p>
              No facility is available under your current assignment and
              permissions. Contact Super Admin.
            </p>
          )}
          {facility && (
            <section key={facility.id}>
              <h2>{facility.name}</h2>
              <p>
                {commissioning?.facility?.operationalState?.replaceAll(
                  "_",
                  " ",
                ) || "Operational readiness not yet confirmed"}
              </p>
              <button onClick={() => void load()}>
                Refresh facility context
              </button>
              {readNotice && <p role="status">{readNotice}</p>}
              {(role === "TECHNICAL_SUPPORT" || section === "OPA Support") && (
                <label>
                  Support Case context
                  <select
                    value={currentCase ? caseId : ""}
                    onChange={(e) => setCaseId(e.target.value)}
                  >
                    <option value="">Select an open case</option>
                    {cases
                      .filter((c) =>
                        ["OPEN", "INVESTIGATING"].includes(String(c.status)),
                      )
                      .map((c) => (
                        <option key={String(c.id)} value={String(c.id)}>
                          {String(c.reference)} · {String(c.category)}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              {section === "SafeWalk Protection" &&
                (!selected ? (
                  <p role="status">
                    Select an authorized facility. Private journeys are never
                    listed.
                  </p>
                ) : role === "TECHNICAL_SUPPORT" && !currentCase ? (
                  <p role="status">
                    Select a current assigned Support Case. Current employment,
                    assignment and Incident Support Read permission are
                    required.
                  </p>
                ) : (
                  <SafeWalkProtection
                    key={actor + ":" + selected + ":" + caseId}
                    endpoint={
                      "safewalk?" +
                      new URLSearchParams({
                        facilityId: selected,
                        ...(role === "TECHNICAL_SUPPORT"
                          ? { caseReference: caseId }
                          : {}),
                      })
                    }
                    transport={transport}
                    incidentLinks={false}
                  />
                ))}
              {section === "Reports & Analytics" &&
                (role === "TECHNICAL_SUPPORT" ? (
                  <p role="status">
                    Aggregate reports require institutional reporting authority.
                    Support audit diagnostics do not grant aggregate reporting
                    access.
                  </p>
                ) : !selected ? (
                  <p role="status">
                    Select an authorized facility to load aggregate reports.
                  </p>
                ) : (
                  <ReportingShell
                    key={actor + ":" + selected}
                    facilityId={selected}
                    transport={transport}
                  />
                ))}
              <section
                hidden={
                  !["Overview", "My Facilities", "Service Health"].includes(
                    section,
                  )
                }
              >
                <div className="ic-grid">
                  {role === "FACILITY_ADMIN" && (
                    <article className="ic-card">
                      <h3>People and invitations</h3>
                      <p>
                        Residents in loaded records:{" "}
                        {Array.isArray(data.members)
                          ? members.filter((m) => m.role === "USER").length
                          : "Unavailable"}
                      </p>
                      <p>
                        Operators in loaded records:{" "}
                        {Array.isArray(data.members)
                          ? members.filter(
                              (m) => m.role === "FACILITY_OPERATOR",
                            ).length
                          : "Unavailable"}
                      </p>
                      <p>
                        Pending invitations in loaded records:{" "}
                        {Array.isArray(data.enrollments)
                          ? rows("enrollments").filter(
                              (r) =>
                                !r.acceptedAt &&
                                !r.revokedAt &&
                                (!r.expiresAt ||
                                  Date.parse(String(r.expiresAt)) > readAt),
                            ).length
                          : "Unavailable"}
                      </p>
                      <p className="ic-muted">
                        Loaded records may be limited; these are not
                        facility-wide totals.
                      </p>
                    </article>
                  )}
                  <article className="ic-card">
                    <h3>Responsibility</h3>
                    <p>
                      {role === "TECHNICAL_SUPPORT"
                        ? "Commission this facility and resolve technical support cases. Routine staffing belongs to its Facility Admin."
                        : "Manage customer membership and Operators, review response evidence and escalate technical issues to OPA Support."}
                    </p>
                  </article>
                  <article className="ic-card">
                    <h3>Delivery services</h3>
                    <p>
                      SMS:{" "}
                      {readiness?.sms?.state?.replaceAll("_", " ") || "UNKNOWN"}
                    </p>
                    <p>
                      Email:{" "}
                      {readiness?.email?.state?.replaceAll("_", " ") ||
                        "UNKNOWN"}
                    </p>
                    <p>
                      Configured means required settings are present. It does
                      not prove credentials or delivery.
                    </p>
                  </article>
                  <article className="ic-card">
                    <h3>Attention required</h3>
                    <p>
                      {commissioning?.readiness?.ready
                        ? "Required commissioning evidence is recorded."
                        : "Commissioning requires review."}
                    </p>
                    <p>
                      {
                        cases.filter(
                          (c) =>
                            c.status === "OPEN" || c.status === "INVESTIGATING",
                        ).length
                      }{" "}
                      open support cases
                    </p>
                  </article>
                </div>
              </section>
              <section
                hidden={!["Support Cases", "OPA Support"].includes(section)}
              >
                {role === "TECHNICAL_SUPPORT" && (
                  <p>
                    Manage cases assigned to you below. A Support Case is not
                    required to provision the first Facility Administrator
                    during commissioning.
                  </p>
                )}
                <details open={role !== "TECHNICAL_SUPPORT"}>
                  <summary>
                    {role === "TECHNICAL_SUPPORT"
                      ? "Record a new support issue (optional)"
                      : "Request OPA assistance"}
                  </summary>
                  <ActionForm
                    title={
                      role === "TECHNICAL_SUPPORT"
                        ? "Record a support issue"
                        : "Get OPA Support"
                    }
                    owner={facility.id + ":case"}
                    path={base + "/cases"}
                    store={store}
                    prerequisite={
                      prerequisite ||
                      (!cap("STAFF_READ")
                        ? "Support Case access permission required."
                        : "")
                    }
                    onSuccess={() => void load()}
                  >
                    <label>
                      Issue category
                      <select name="category">
                        <option>Commissioning</option>
                        <option>Command Center access</option>
                        <option>Enrollment and delivery</option>
                        <option>Incident routing</option>
                        <option>Account access</option>
                      </select>
                    </label>
                    <label>
                      Issue summary
                      <textarea name="summary" required maxLength={500} />
                    </label>
                    <label>
                      Priority
                      <select name="priority">
                        <option>NORMAL</option>
                        <option>HIGH</option>
                        <option>CRITICAL</option>
                        <option>LOW</option>
                      </select>
                    </label>
                  </ActionForm>
                </details>
                {currentCase && (
                  <ActionForm
                    title="Update Support Case"
                    owner={facility.id + ":case-state:" + caseId}
                    path={base + "/cases/" + caseId + "/state"}
                    store={store}
                    context={{ caseReference: caseId }}
                    prerequisite={prerequisite}
                    onSuccess={() => void load()}
                  >
                    <label>
                      Case status
                      <select name="status">
                        <option>INVESTIGATING</option>
                        <option>RESOLVED</option>
                        <option>CLOSED</option>
                      </select>
                    </label>
                  </ActionForm>
                )}
                <ReadRows rows={cases} />
              </section>
              <section
                hidden={
                  ![
                    "Commissioning",
                    "Operations Oversight",
                    "Command Center",
                  ].includes(section)
                }
              >
                <ActionForm
                  title="Set facility response policy"
                  owner={facility.id + ":response-policy"}
                  path={base + "/response-policy"}
                  store={store}
                  context={mutationContext}
                  prerequisite={
                    prerequisite ||
                    supportContext ||
                    (!cap("STAFF_PROVISION")
                      ? "Facility policy permission required."
                      : "")
                  }
                  onSuccess={() => void load()}
                >
                  <p>
                    Enter approved whole-second response intervals. Unattended
                    must be at least acknowledgement, and closure at least
                    unattended.
                  </p>
                  {[
                    ["acknowledgementSeconds", "Acknowledgement"],
                    ["dispatchSeconds", "Dispatch after acknowledgement"],
                    [
                      "progressSeconds",
                      "Progress after dispatch or latest progress",
                    ],
                    ["unattendedSeconds", "Unattended incident"],
                    ["closureSeconds", "Closure review"],
                  ].map(([name, label]) => (
                    <label key={name}>
                      {label} (seconds)
                      <input
                        name={name}
                        type="number"
                        min={1}
                        max={604800}
                        step={1}
                        required
                      />
                    </label>
                  ))}
                </ActionForm>
              </section>
              <section hidden={section !== "Commissioning"}>
                {role === "TECHNICAL_SUPPORT" && (
                  <FirstFacilityAdmin
                    key={facility.id}
                    facilityId={facility.id}
                    store={store}
                    transport={transport}
                    prerequisite={
                      prerequisite ||
                        (!cap("STAFF_PROVISION") ? "Standard Facility Support provisioning permission required." : "") ||
                      (deliveryBlocked
                        ? "SMS and email must be configured before sending invitations."
                        : "")
                    }
                    onDiagnostics={() => setSection("Enrollment & Delivery")}
                    onSuccess={() => void load()}
                  />
                )}
                <p>
                  Record observed evidence. Existing Facility Admin protection
                  is independent of these readiness gates.
                </p>
                <ActionForm
                  title="Record commissioning evidence"
                  owner={facility.id + ":evidence"}
                  path={base + "/commissioning/evidence"}
                  store={store}
                  context={mutationContext}
                  prerequisite={
                    prerequisite ||
                    supportContext ||
                    (!cap("STAFF_PROVISION")
                      ? "Commissioning permission required."
                      : "")
                  }
                  onSuccess={() => void load()}
                >
                  <label>
                    Gate
                    <select name="gate">
                      {[
                        ...(commissioning?.gates ?? []),
                        ...(commissioning?.trainingGates ?? []),
                      ].map((g) => (
                        <option key={g} value={g}>
                          {g.replaceAll("_", " ")}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Observed result
                    <select name="passed">
                      <option value="true">Passed</option>
                      <option value="false">Failed / needs attention</option>
                    </select>
                  </label>
                  <label>
                    Evidence / observation
                    <textarea name="evidence" maxLength={1000} required />
                  </label>
                  <label>
                    Facility Admin for training
                    <select name="facilityAdminUserId">
                      <option value="">Not a training gate</option>
                      {members
                        .filter((m) => m.role === "FACILITY_ADMIN")
                        .map((m) => (
                          <option key={String(m.id)} value={String(m.id)}>
                            {String(m.name ?? "Facility Admin")} ·{" "}
                            {String(m.membershipState)}
                          </option>
                        ))}
                    </select>
                  </label>
                </ActionForm>
                <ActionForm
                  title="Update commissioning state"
                  owner={facility.id + ":lifecycle"}
                  path={base + "/lifecycle"}
                  store={store}
                  context={mutationContext}
                  prerequisite={prerequisite || supportContext}
                  confirmation
                  onSuccess={() => {
                    void load();
                    refresh();
                  }}
                >
                  <label>
                    Requested state
                    <select name="state">
                      <option>COMMISSIONING</option>
                      <option>OPERATIONAL</option>
                    </select>
                  </label>
                </ActionForm>
              </section>
              <section
                hidden={
                  ![
                    "Enrollment & Delivery",
                    "People",
                    "Invitations",
                    "Residents",
                    "Operators",
                    "Commissioning",
                  ].includes(section)
                }
              >
                {(role !== "FACILITY_ADMIN" || section !== "People") &&
                  (role !== "TECHNICAL_SUPPORT" ||
                    section !== "Commissioning") &&
                  (role === "FACILITY_ADMIN" ||
                    role === "ADMIN" ||
                    role === "TECHNICAL_SUPPORT") && (
                    <ActionForm
                      title={
                        role === "TECHNICAL_SUPPORT"
                          ? "OPA support assistance"
                          : "Invite institutional member"
                      }
                      owner={facility.id + ":invite"}
                      path={base + "/invitations"}
                      store={store}
                      context={mutationContext}
                      prerequisite={
                        prerequisite ||
                        supportContext ||
                        (!invitation.roles.length
                          ? invitation.explanation
                          : deliveryBlocked
                            ? "SMS and email must be configured before sending invitations."
                            : "")
                      }
                      onSuccess={() => void load()}
                    >
                      <p>
                        Normal responsibility: Facility Admin provisions
                        Operators and Residents. OPA support assistance requires
                        an assigned open Support Case, explicit permission and
                        Temporary Elevation for exceptional staffing. No role
                        choice grants authority.
                      </p>
                      <p>{invitation.explanation}</p>
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
                        <input name="email" required type="email" />
                      </label>
                      <label>
                        Phone in international format
                        <input
                          name="phoneNumber"
                          type="tel"
                          placeholder="+234…"
                          required
                        />
                      </label>
                      <label>
                        Membership
                        <InvitationRoleSelect
                          roles={invitation.roles}
                          preferred={inviteRole}
                        />
                      </label>
                    </ActionForm>
                  )}
                <div hidden={role === "FACILITY_ADMIN" && section !== "People"}>
                  <h3>Current institutional members</h3>
                  <p>
                    Masked identity, role and status are shown by default. Up to
                    100 members are returned; identifiers and provenance are
                    under Details.
                  </p>
                  <ReadRows rows={members} />
                  {members.map((member) => {
                    const resident = member.role === "USER",
                      facilityAdmin = member.role === "FACILITY_ADMIN";
                    const allowed =
                      role === "FACILITY_ADMIN" ||
                      role === "ADMIN" ||
                      cap(
                        resident
                          ? "RESIDENT_SUPPORT_OVERRIDE"
                          : facilityAdmin
                            ? "FACILITY_ADMIN_DEPROVISION"
                            : "OPERATOR_MANAGE",
                      ) ||
                      (!resident && cap("STAFF_RECOVER_ACCESS"));
                    return (
                      <ActionForm
                        key={String(member.id)}
                        title="Review member access"
                        owner={facility.id + ":member:" + member.id}
                        path={base + "/members/" + member.id + "/access"}
                        store={store}
                        context={mutationContext}
                        prerequisite={
                          prerequisite ||
                          supportContext ||
                          (!allowed
                            ? "An explicit permission and any required Temporary Elevation are needed."
                            : "")
                        }
                        confirmation
                        onSuccess={() => void load()}
                      >
                        <p>
                          {String(member.displayIdentity ?? "Protected member")}{" "}
                          · {roleLabel(String(member.role))} ·{" "}
                          {String(member.membershipState)}
                        </p>
                        <label>
                          Access action
                          <select name="action">
                            <option value="suspend">Suspend membership</option>
                            <option value="revoke">
                              Deprovision membership
                            </option>
                            <option value="restore">
                              Restore membership where policy permits
                            </option>
                            <option value="recover">
                              Invalidate sessions for reviewed recovery
                            </option>
                          </select>
                        </label>
                        <p>
                          Identity and history are retained. The last active
                          Facility Admin cannot be removed.
                        </p>
                        <details>
                          <summary>Member reference</summary>
                          {String(member.id)}
                        </details>
                      </ActionForm>
                    );
                  })}
                </div>
                <div hidden={role === "FACILITY_ADMIN" && section === "People"}>
                  <h3>Enrollment and delivery</h3>
                  <ReadRows rows={rows("enrollments")} />
                  <ReadRows rows={rows("delivery")} />
                  {rows("enrollments")
                    .filter((r) => !r.acceptedAt && !r.revokedAt)
                    .map((r) => (
                      <ActionForm
                        key={String(r.id)}
                        title="Review invitation action"
                        owner={facility.id + ":invitation:" + r.id}
                        path={base + "/invitations/" + r.id + "/action"}
                        store={store}
                        context={mutationContext}
                        prerequisite={
                          prerequisite ||
                          supportContext ||
                          (!cap("ENROLLMENT_RETRY")
                            ? "Enrollment support permission required."
                            : "")
                        }
                        confirmation
                        onSuccess={() => void load()}
                      >
                        <label>
                          Invitation action
                          <select name="action">
                            <option value="revoke">Revoke</option>
                            <option value="resend" disabled={deliveryBlocked}>
                              Resend both channels
                            </option>
                          </select>
                        </label>
                        {deliveryBlocked && (
                          <p>
                            Resend unavailable: SMS or email is not configured.
                            Revocation remains available.
                          </p>
                        )}
                        <details>
                          <summary>Invitation reference</summary>
                          {String(r.id)}
                        </details>
                      </ActionForm>
                    ))}
                </div>
              </section>
              <section hidden={section !== "Audit"}>
                <h3>Facility audit</h3>
                <ReadRows rows={rows("audit")} />
              </section>
              <section
                hidden={
                  !["Command Center", "Operations Oversight"].includes(section)
                }
              >
                <h3>Incident operations</h3>
                <p>
                  Recorded response facts do not establish personnel motive.
                </p>
                <ReadRows rows={rows("incidents")} />
                <MemberOversight
                  members={members}
                  oversight={data.oversight as Row | undefined}
                />
                <h3>Response policy and exceptions</h3>
                <ReadRows
                  rows={data.oversight ? [data.oversight as Row] : []}
                />
                {role === "FACILITY_ADMIN" &&
                  rows("incidents")
                    .filter((r) => r.status === "OPEN")
                    .map((r) => (
                      <ActionForm
                        key={String(r.id)}
                        title="Resolve incident institutionally"
                        owner={facility.id + ":resolve:" + r.id}
                        path={"incidents/" + r.id + "/institutional-resolution"}
                        store={store}
                        context={mutationContext}
                        prerequisite={prerequisite}
                        confirmation
                        onSuccess={() => void load()}
                      >
                        <p>
                          Preserves incident history, response events and
                          evidence. The resident’s own safety confirmation
                          remains available.
                        </p>
                        <details>
                          <summary>Incident reference</summary>
                          {String(r.id)}
                        </details>
                      </ActionForm>
                    ))}
                {role === "FACILITY_ADMIN" && (
                  <p>
                    Institutional resolution requires a reviewed reason.
                    Operators cannot resolve or cancel incidents.
                  </p>
                )}
              </section>
              <section hidden={section !== "Temporary Access"}>
                <h3>Sensitive access</h3>
                <ReadRows
                  rows={(context.elevations ?? [])
                    .filter((e) => e.facilityId === facility.id)
                    .map((e) => ({
                      ...e,
                      reference: e.capability.replaceAll("_", " "),
                      status: e.revokedAt
                        ? "REVOKED"
                        : "APPROVAL RECORDED — CHECK START AND EXPIRY",
                    }))}
                />
                <p>
                  Each operation independently checks the current assignment,
                  permission, case and approval. A listed approval alone does
                  not authorize access.
                </p>
                <p>
                  Ask Super Admin to approve exceptional authority for the
                  selected Support Case. Assignment and job permissions alone do
                  not permit incident intervention, high-risk recovery or
                  plaintext identity access.
                </p>
                <p>
                  Protected identity always requires a separate current Identity
                  Access Grant.
                </p>
              </section>
            </section>
          )}
        </>
      )}
    </>
  );
}
function ReadRows({ rows }: { rows: Row[] }) {
  return rows.length ? (
    <div className="ic-grid">
      {rows.map((r, index) => (
        <article className="ic-card" key={String(r.id ?? index)}>
          <p>
            {String(
              r.displayIdentity ??
                r.reference ??
                r.role ??
                r.action ??
                r.channel ??
                "Record",
            ).replaceAll("_", " ")}
          </p>
          <p>
            <ConsoleStatus
              value={String(
                r.status ?? r.membershipState ?? r.deliveryStatus ?? "UNKNOWN",
              )}
            />
          </p>
          {Boolean(r.displayIdentity) && (
            <p>
              {roleLabel(String(r.role))} · Account: {String(r.accountStatus)} ·{" "}
              {r.isActive ? "Enabled" : "Suspended"}
            </p>
          )}
          <details>
            <summary>Details and provenance</summary>
            <pre>{JSON.stringify(r, null, 2)}</pre>
          </details>
        </article>
      ))}
    </div>
  ) : (
    <p className="ic-muted">
      No records available under your current scope and permissions.
    </p>
  );
}

export function InvitationRoleSelect({
  roles,
  preferred = "",
}: {
  roles: string[];
  preferred?: string;
}) {
  return (
    <select
      name="role"
      required
      defaultValue={roles.includes(preferred) ? preferred : ""}
      key={roles.join(":") + preferred}
    >
      <option value="" disabled>
        Select an authorized membership role
      </option>
      {roles.map((value) => (
        <option key={value} value={value}>
          {value === "USER"
            ? "Resident"
            : value === "FACILITY_OPERATOR"
              ? "Operator"
              : "Facility Admin"}
        </option>
      ))}
    </select>
  );
}
