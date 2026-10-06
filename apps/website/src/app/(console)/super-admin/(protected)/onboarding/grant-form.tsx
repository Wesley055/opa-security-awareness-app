"use client";
import { useState } from "react";
import { grantExpiry } from "@/lib/onboarding-grant";
type Facility = { id: string; name: string; isActive: boolean };
type Draft = { facilityId: string; expiresAt: string; reason: string };
export default function GrantForm({
  employee,
  facilities,
  busy,
  grant,
}: {
  employee: string;
  facilities: Facility[];
  busy: boolean;
  grant: (draft: Draft) => Promise<void>;
}) {
  const [duration, setDuration] = useState("4h"),
    [draft, setDraft] = useState<Draft | null>(null),
    [error, setError] = useState("");
  if (draft)
    return (
      <section aria-label="Review grant">
        <h3>Review bounded authority</h3>
        <dl>
          <dt>Employee</dt>
          <dd>{employee}</dd>
          <dt>Facility</dt>
          <dd>
            {facilities.find((f) => f.id === draft.facilityId)?.name} ·{" "}
            {draft.facilityId}
          </dd>
          <dt>Permission</dt>
          <dd>Staff onboarding only</dd>
          <dt>Expires</dt>
          <dd>{new Date(draft.expiresAt).toLocaleString()}</dd>
          <dt>Reason</dt>
          <dd>{draft.reason}</dd>
        </dl>
        <p>
          No incident, evidence or identity-resolution authority is granted.
        </p>
        {error && <p role="alert">{error}</p>}
        <button
          disabled={busy}
          onClick={() => {
            setDraft(null);
            setError("");
          }}
        >
          Back
        </button>
        <button
          disabled={busy}
          onClick={async () => {
            if (
              new Date(draft.expiresAt).getTime() <= Date.now() ||
              !facilities.some((f) => f.id === draft.facilityId && f.isActive)
            ) {
              setError(
                "Selection changed or expired. Go back and review again.",
              );
              return;
            }
            await grant(draft);
            setDraft(null);
          }}
        >
          Grant authority
        </button>
      </section>
    );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError("");
        const f = new FormData(e.currentTarget);
        try {
          setDraft({
            facilityId: String(f.get("facility")),
            expiresAt: grantExpiry(duration, String(f.get("expires") ?? "")),
            reason: String(f.get("reason")),
          });
        } catch {
          setError("Choose a valid future expiration.");
        }
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
          Duration
          <select
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          >
            <option value="4h">4 hours</option>
            <option value="8h">8 hours</option>
            <option value="24h">24 hours</option>
            <option value="3d">3 days</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        {duration === "custom" && (
          <label>
            Expiration (your local time)
            <input name="expires" type="datetime-local" required />
          </label>
        )}
        <label>
          Reason
          <select name="reason">
            <option>Temporary technical support coverage</option>
            <option>Approved customer onboarding assignment</option>
          </select>
        </label>
        <button>Review grant</button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
