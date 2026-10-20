"use client";
import { useMemo, useState } from "react";

type Row = Record<string, unknown>;
type Category = "security" | "people" | "emergencies" | "reports" | "facility" | "access";

/**
 * Activity log: the facility's audit trail written for customers, not engineers.
 * Plain sentences, who did it by role, when, and whether anything needs attention.
 * Routine access records (who opened which report) are kept but hidden by default.
 * Internal identifiers are never shown; support can copy a reference on request.
 */
const EVENTS: Record<string, { text: string; category: Category; attention?: boolean }> = {
  STAFF_PHOTO_UPLOADED: { text: "Uploaded a profile photo", category: "people" },
  STAFF_PHOTO_APPROVED: { text: "Approved an operator's profile photo", category: "people" },
  STAFF_PHOTO_REJECTED: { text: "Rejected an operator's profile photo", category: "people" },
  RESIDENT_INVITATION_QUEUED: { text: "Invited a member", category: "people" },
  RESIDENT_ACTIVATED: { text: "A member activated their account", category: "people" },
  ENROLLMENT_REQUESTED: { text: "Created an invitation", category: "people" },
  ENROLLMENT_ACCEPTED: { text: "An invitation was accepted", category: "people" },
  INVITATION_RESENT: { text: "Re-sent an invitation", category: "people" },
  INVITATION_REVOKED: { text: "Cancelled an invitation", category: "people" },
  FACILITY_MEMBERSHIP_SUSPENDED: { text: "Suspended a member's access", category: "people", attention: true },
  FACILITY_MEMBERSHIP_RESTORED: { text: "Restored a member's access", category: "people" },
  STAFF_PASSWORD_CHANGED: { text: "Changed their password", category: "security" },
  STAFF_PASSWORD_RECOVERY_REQUESTED: { text: "Requested a password change code", category: "security" },
  STAFF_PASSWORD_RECOVERED: { text: "Changed their password using a verification code", category: "security" },
  STAFF_PASSWORD_RECOVERY_LOCKED: { text: "Password change blocked after repeated wrong codes", category: "security", attention: true },
  STAFF_SIGNED_OUT_EVERYWHERE: { text: "Signed out on all devices", category: "security" },
  LOCAL_PASSWORD_RESET: { text: "Reset their password by email link", category: "security" },
  SESSIONS_REVOKED: { text: "All sessions were signed out", category: "security" },
  AUTHENTICATION_FAILED: { text: "A sign-in attempt was refused", category: "security", attention: true },
  INCIDENT_RESOLVED: { text: "An emergency was resolved", category: "emergencies" },
  PROTECTED_DELIVERY_PROVISIONED: { text: "Emergency-contact alerts were enabled for this facility", category: "emergencies" },
  DUTY_SHIFT_STARTED: { text: "Started a duty shift", category: "reports" },
  DUTY_REPORT_SUBMITTED: { text: "Submitted a duty report", category: "reports" },
  DUTY_REPORT_ACKNOWLEDGED: { text: "Acknowledged a duty report", category: "reports" },
  DUTY_REPORT_SYSTEM_GENERATED: { text: "A shift ended without an operator report; OPA saved a backup summary", category: "reports", attention: true },
  AIR_GENERATED: { text: "Generated an after-incident report", category: "reports" },
  AIR_SUPERSEDED: { text: "Issued a corrected after-incident report", category: "reports" },
  FACILITY_CREATED: { text: "The facility was created", category: "facility" },
  FACILITY_RESPONSE_POLICY_CHANGED: { text: "Changed the emergency response policy", category: "facility" },
  INCIDENT_IDENTITY_VIEWED: { text: "Viewed a resident's name during an active emergency", category: "access" },
  SAFEWALK_EMERGENCY_READ: { text: "Viewed a SafeWalk emergency", category: "access" },
  EVIDENCE_AIR_LIST_READ: { text: "Viewed the incident reports list", category: "access" },
  EVIDENCE_INSIGHT_READ: { text: "Viewed an Insight report", category: "access" },
  EVIDENCE_ORGANIZATION_INSIGHT_READ: { text: "Viewed a Head Office Insight report", category: "access" },
  AIR_READ: { text: "Opened an after-incident report", category: "access" },
  AIR_EXPORTED_JSON: { text: "Exported an after-incident report", category: "access" },
};
const CATEGORY_LABEL: Record<Category, string> = {
  security: "Account security",
  people: "People",
  emergencies: "Emergencies",
  reports: "Reports",
  facility: "Facility settings",
  access: "Access records",
};
const ROLE: Record<string, string> = {
  FACILITY_ADMIN: "Facility Administrator",
  FACILITY_OPERATOR: "Facility Operator",
  TECHNICAL_SUPPORT: "OPA Technical Support",
  ADMIN: "OPA Super Admin",
  ORGANIZATION_ADMIN: "Head Office",
  USER: "Member",
  SYSTEM: "OPA (automatic)",
};

function describe(action: string) {
  const known = EVENTS[action];
  if (known) return known;
  // Unknown future events: readable sentence, filed with access records unless clearly otherwise.
  const words = action.toLowerCase().replaceAll("_", " ");
  return { text: words.charAt(0).toUpperCase() + words.slice(1), category: (/read|viewed|export/.test(words) ? "access" : "facility") as Category };
}
function who(r: Row): string {
  const role = typeof r.actorRole === "string" ? r.actorRole : null;
  if (role && ROLE[role]) return ROLE[role];
  if (r.actorUserId && r.actorUserId === r.resourceId) return "The account holder";
  return "OPA (automatic)";
}
function when(v: unknown): { date: string; time: string } {
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return { date: "", time: "" };
  return { date: d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }), time: d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) };
}

export function ActivityLog({ rows, supportView = false }: { rows: Row[]; supportView?: boolean }) {
  const [filter, setFilter] = useState<Category | "all">("all");
  const [showAccess, setShowAccess] = useState(false);
  const [limit, setLimit] = useState(25);
  const [copied, setCopied] = useState("");

  const items = useMemo(
    () =>
      rows
        .filter((r) => typeof r.action === "string")
        .map((r) => ({ r, ...describe(String(r.action)) }))
        .sort((a, b) => Date.parse(String(b.r.createdAt)) - Date.parse(String(a.r.createdAt))),
    [rows],
  );
  const visible = items.filter((i) => (filter === "all" ? showAccess || i.category !== "access" : i.category === filter));
  const attention = items.filter((i) => i.attention).length;
  const hiddenAccess = items.filter((i) => i.category === "access").length;

  if (!items.length) return <p className="ic-muted">No activity recorded yet.</p>;
  return (
    <div className="ic-activity">
      <p>
        {attention ? <strong>{attention} item{attention === 1 ? "" : "s"} may need your attention. </strong> : null}
        Showing who did what and when at this facility. Records cannot be edited or deleted.
      </p>
      <div className="ic-chips" role="group" aria-label="Filter activity">
        {(["all", "security", "people", "emergencies", "reports", "facility", "access"] as const).map((c) => (
          <button key={c} type="button" aria-pressed={filter === c} className={filter === c ? "ic-chip ic-chip-on" : "ic-chip"} onClick={() => { setFilter(c); setLimit(25); }}>
            {c === "all" ? "All activity" : CATEGORY_LABEL[c]}
          </button>
        ))}
      </div>
      {filter === "all" && hiddenAccess ? (
        <label className="ic-muted">
          <input type="checkbox" checked={showAccess} onChange={(e) => setShowAccess(e.target.checked)} /> Include {hiddenAccess} routine access record{hiddenAccess === 1 ? "" : "s"} (who opened reports and records)
        </label>
      ) : null}
      <table className="ic-table">
        <thead>
          <tr><th scope="col">When</th><th scope="col">Activity</th><th scope="col">By</th>{supportView ? <th scope="col"><span className="sr-only">Reference</span></th> : null}</tr>
        </thead>
        <tbody>
          {visible.slice(0, limit).map(({ r, text, attention: flag, category }, i) => {
            const t = when(r.createdAt);
            return (
              <tr key={String(r.id ?? i)} className={flag ? "ic-row-attention" : undefined}>
                <td><span>{t.date}</span><br /><span className="ic-muted">{t.time}</span></td>
                <td>
                  {flag ? <span className="ic-flag">Needs attention</span> : null}
                  {text}
                  <br /><span className="ic-muted">{CATEGORY_LABEL[category]}</span>
                </td>
                <td>{who(r)}</td>
                {supportView ? (
                  <td>
                    <button type="button" className="ic-link" onClick={() => { void navigator.clipboard?.writeText(String(r.id)); setCopied(String(r.id)); }}>
                      {copied === String(r.id) ? "Copied" : "Copy reference"}
                    </button>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
      {!visible.length ? <p className="ic-muted">Nothing in this category yet.</p> : null}
      {visible.length > limit ? <button type="button" className="ic-chip" onClick={() => setLimit((n) => n + 25)}>Show more ({visible.length - limit} older)</button> : null}
    </div>
  );
}

/** Plain key/value view for support details, without raw JSON or full identifiers. */
export function PlainDetails({ value }: { value: unknown }) {
  if (!value || typeof value !== "object") return <p className="ic-muted">No further details.</p>;
  const entries = Object.entries(value as Row).filter(([, v]) => v !== null && v !== undefined && typeof v !== "object" && !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(String(v)));
  if (!entries.length) return <p className="ic-muted">No further details.</p>;
  return (
    <dl className="ic-details">
      {entries.map(([k, v]) => (
        <div key={k}>
          <dt>{k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase())}</dt>
          <dd>{/At$/.test(k) && !Number.isNaN(Date.parse(String(v))) ? new Date(String(v)).toLocaleString() : String(v).replaceAll("_", " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())}</dd>
        </div>
      ))}
    </dl>
  );
}
