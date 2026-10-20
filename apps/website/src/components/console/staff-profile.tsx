"use client";
import { useCallback, useEffect, useState } from "react";
import { viewerSessionFetch } from "@/lib/viewer-session-fetch";
import { PASSWORD_MAX_LENGTH, PASSWORD_RULE_TEXT, passwordProblem } from "@/lib/password-rule";

type Transport = (path: string, init?: RequestInit) => Promise<Response>;
type Profile = {
  firstName: string;
  lastName: string;
  role: string;
  facility: { name: string; type: string } | null;
  photo: { status: "PENDING" | "APPROVED" | "REJECTED" | null; url: string | null; updatedAt: string | null };
  photoRequiredForDuty: boolean;
};
const ROLE: Record<string, string> = { FACILITY_ADMIN: "Facility Administrator", FACILITY_OPERATOR: "Facility Operator", TECHNICAL_SUPPORT: "OPA Technical Support", ADMIN: "OPA Super Admin", ORGANIZATION_ADMIN: "Head Office Administrator" };
const PHOTO: Record<string, string> = { PENDING: "Waiting for your Facility Admin to approve", APPROVED: "Approved", REJECTED: "Not approved. Upload a clear, front-facing photo." };
const input = "min-h-11 w-full max-w-md rounded-md border border-line bg-panel-2 px-2 text-ink";
const btn = "min-h-11 rounded-md border border-line px-4 text-sm font-medium text-ink hover:bg-panel-2 disabled:opacity-60";

/** My profile: shared by every institutional console. Name, role and facility are read-only. */
export function StaffProfile({ session, transport, onSignedOut }: { session: "operator" | "institutional"; transport?: Transport; onSignedOut: () => void }) {
  const fetcher: Transport = transport ?? ((p, i) => viewerSessionFetch(p, i));
  const root = session === "institutional" ? "profile" : "/api/operator/profile";
  const [p, setP] = useState<Profile | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [changing, setChanging] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [formError, setFormError] = useState("");
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [recovery, setRecovery] = useState<{ channels: string[]; phoneHint: string; smsSent: boolean; emailSent: boolean | null } | null>(null);
  const [smsCode, setSmsCode] = useState("");
  const [emailCode, setEmailCode] = useState("");

  const load = useCallback(async () => {
    const r = await fetcher(root, { cache: "no-store" });
    const data = await r.json().catch(() => null);
    if (r.ok) setP(data);
    else setNotice(data?.error ?? "Your profile is unavailable. Retry.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root]);
  useEffect(() => { void load(); }, [load]);

  async function upload(file: File | undefined) {
    if (!file) return;
    if (!["image/jpeg", "image/png"].includes(file.type)) return setNotice("Use a JPEG or PNG photo.");
    if (file.size > 3 * 1024 * 1024) return setNotice("Photo must be 3 MB or smaller.");
    const form = new FormData();
    form.append("file", file);
    setBusy(true);
    const r = await fetcher(root + "/photo", { method: "POST", body: form });
    const data = await r.json().catch(() => null);
    setBusy(false);
    setNotice(r.ok ? (data?.status === "PENDING" ? "Photo uploaded. Your Facility Admin will review it." : "Photo updated.") : data?.error ?? "Upload failed. Try again.");
    if (r.ok) void load();
  }

  function cancelChange() {
    setChanging(false); setCurrent(""); setNext(""); setConfirm(""); setFormError("");
    setRecovery(null); setSmsCode(""); setEmailCode("");
  }

  async function startRecovery() {
    setBusy(true); setFormError("");
    const r = await fetcher(root, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "recovery-start" }) });
    const data = await r.json().catch(() => null);
    setBusy(false);
    if (!r.ok) return setFormError(data?.error ?? "Could not send a code. Try again.");
    setRecovery(data); setCurrent(""); setSmsCode(""); setEmailCode("");
    if (!data.smsSent || data.emailSent === false) setFormError("A code could not be delivered. Request a new code, or use Forgot password on the sign-in page.");
  }

  /** Checked here first for quick feedback; the server re-checks everything. */
  function validate(): string | null {
    if (recovery) {
      if (!/^\d{6}$/.test(smsCode)) return "Enter the 6-digit code sent to your phone.";
      if (recovery.channels.includes("EMAIL") && !/^\d{6}$/.test(emailCode)) return "Enter the 6-digit code sent to your email.";
    } else if (!current) return "Enter your current password.";
    const problem = passwordProblem(next);
    if (problem) return problem;
    if (next !== confirm) return "The new passwords do not match.";
    if (!recovery && next === current) return "Choose a new password that is different from your current one.";
    return null;
  }

  async function changePassword() {
    const problem = validate();
    setFormError(problem ?? "");
    if (problem) return;
    setBusy(true);
    const body = recovery
      ? { action: "recovery-complete", smsCode, ...(recovery.channels.includes("EMAIL") ? { emailCode } : {}), newPassword: next }
      : { action: "password", currentPassword: current, newPassword: next };
    const r = await fetcher(root, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => null);
    setBusy(false);
    if (!r.ok) {
      setFormError(data?.error ?? "Your password was not changed. Try again.");
      setCurrent(""); setSmsCode(""); setEmailCode("");
      return;
    }
    cancelChange();
    setNotice("Password changed. For your security you are now signed out on every device. Sign in with your new password.");
    setTimeout(onSignedOut, 2500);
  }

  async function signOutEverywhere() {
    setBusy(true);
    const r = await fetcher(root, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sign-out-everywhere" }) });
    const data = await r.json().catch(() => null);
    setBusy(false);
    if (!r.ok) return setNotice(data?.error ?? "That did not work. Try again.");
    setNotice("Signed out on every device, including this one.");
    setTimeout(onSignedOut, 1500);
  }

  if (!p) return <section className="text-ink"><h2 className="text-xl font-bold">My profile</h2><p role="status" className="mt-2">{notice || "Loading…"}</p></section>;
  const photoNote = p.photo.status ? PHOTO[p.photo.status] : p.photoRequiredForDuty ? "Required to start duty. Emergency response remains available." : "Optional.";
  return (
    <section aria-labelledby="profile-heading" className="grid max-w-2xl gap-6 text-ink">
      <h2 id="profile-heading" className="text-xl font-bold">My profile</h2>
      {notice ? <p role="status" className="rounded-md border border-line bg-panel-2 px-3 py-2 text-sm">{notice}</p> : null}

      <div className="flex flex-wrap items-center gap-4">
        {p.photo.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.photo.url} alt="Your profile photo" className="h-24 w-24 rounded-full border border-line object-cover" />
        ) : (
          <div aria-hidden className="flex h-24 w-24 items-center justify-center rounded-full border border-line bg-panel-2 text-2xl font-bold">{((p.firstName[0] ?? "") + (p.lastName[0] ?? "")).toUpperCase()}</div>
        )}
        <div>
          <p className="text-lg font-semibold">{p.firstName} {p.lastName}</p>
          <p className="text-sm">{ROLE[p.role] ?? p.role}{p.facility ? ` · ${p.facility.name}` : ""}</p>
          <p className="text-xs text-muted">Your name is verified. Ask your administrator to correct it.</p>
        </div>
      </div>

      <section aria-labelledby="photo-heading" className="grid gap-2 rounded-xl border border-line p-4">
        <h3 id="photo-heading" className="font-semibold">Profile photo</h3>
        <p className="text-sm">{photoNote}</p>
        <div>
          <label className={btn + " inline-flex cursor-pointer items-center" + (busy ? " pointer-events-none opacity-60" : "")}>
            {p.photo.url ? "Update photo" : "Add photo"}
            <input type="file" accept="image/jpeg,image/png" className="sr-only" disabled={busy} onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
        </div>
        <p className="text-xs text-muted">JPEG or PNG · Max 3 MB. Visible to staff of your facility, and to a resident you are helping during an SOS.</p>
      </section>

      <section aria-labelledby="security-heading" className="grid gap-4 rounded-xl border border-line p-4">
        <h3 id="security-heading" className="font-semibold">Account security</h3>

        {!changing ? (
          <div>
            <button type="button" className={btn} onClick={() => setChanging(true)}>Change password</button>
          </div>
        ) : (
          <form className="grid gap-2" noValidate onSubmit={(e) => { e.preventDefault(); void changePassword(); }}>
            {!recovery ? (
              <>
                <label className="grid gap-1 text-sm">Current password<input className={input} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus /></label>
                <div><button type="button" className="text-sm underline" disabled={busy} onClick={() => void startRecovery()}>Forgot your current password? Get a code instead</button></div>
              </>
            ) : (
              <>
                <p className="text-sm">
                  We sent a 6-digit code to your phone ending <strong>{recovery.phoneHint}</strong>
                  {recovery.channels.includes("EMAIL") ? " and another to your email. Both are needed for your role." : "."} Codes expire in 10 minutes.
                </p>
                <label className="grid gap-1 text-sm">Code from your phone<input className={input} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={smsCode} onChange={(e) => setSmsCode(e.target.value.replace(/\D/g, ""))} autoFocus /></label>
                {recovery.channels.includes("EMAIL") ? (
                  <label className="grid gap-1 text-sm">Code from your email<input className={input} inputMode="numeric" maxLength={6} value={emailCode} onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, ""))} /></label>
                ) : null}
                <div className="flex flex-wrap gap-3 text-sm">
                  <button type="button" className="underline" disabled={busy} onClick={() => void startRecovery()}>Send a new code</button>
                  <button type="button" className="underline" disabled={busy} onClick={() => { setRecovery(null); setFormError(""); }}>I remember my password</button>
                </div>
              </>
            )}
            <label className="grid gap-1 text-sm">New password<input className={input} type="password" autoComplete="new-password" maxLength={PASSWORD_MAX_LENGTH} value={next} onChange={(e) => setNext(e.target.value)} aria-describedby="password-rule" /></label>
            <p id="password-rule" className="text-xs text-muted">{PASSWORD_RULE_TEXT}</p>
            <label className="grid gap-1 text-sm">Confirm new password<input className={input} type="password" autoComplete="new-password" maxLength={PASSWORD_MAX_LENGTH} value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
            {formError ? <p role="alert" className="text-sm font-semibold text-[#ff6b6b]">{formError}</p> : null}
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="min-h-11 rounded-md bg-[#e5484d] px-4 text-sm font-semibold text-white disabled:opacity-60" disabled={busy}>{busy ? "Checking…" : "Validate & change password"}</button>
              <button type="button" className={btn} onClick={cancelChange} disabled={busy}>Cancel</button>
            </div>
            <p className="text-xs text-muted">After the change you are signed out on every device and sign in again with the new password.</p>
          </form>
        )}

        <div className="grid gap-2 border-t border-line pt-4">
          <h4 className="text-sm font-semibold">Active sessions</h4>
          <p className="text-sm text-muted">Signed in on a shared or lost device? Sign out everywhere.</p>
          {!confirmSignOut ? (
            <div><button type="button" className={btn} onClick={() => setConfirmSignOut(true)}>Sign out on all devices</button></div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm">This also signs you out here.</span>
              <button type="button" className="min-h-11 rounded-md bg-[#e5484d] px-4 text-sm font-semibold text-white disabled:opacity-60" disabled={busy} onClick={() => void signOutEverywhere()}>Yes, sign out everywhere</button>
              <button type="button" className={btn} onClick={() => setConfirmSignOut(false)}>Cancel</button>
            </div>
          )}
        </div>
      </section>
    </section>
  );
}

/** Facility Admin: operator photos waiting for approval. */
export function StaffPhotoReview({ transport }: { transport: Transport }) {
  const [rows, setRows] = useState<{ userId: string; name: string; url: string | null; uploadedAt: string | null }[] | null>(null);
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    const r = await transport("staff-photos", { cache: "no-store" });
    const data = await r.json().catch(() => null);
    if (r.ok && Array.isArray(data)) setRows(data);
    else setNotice(data?.error ?? "Photo reviews are unavailable.");
  }, [transport]);
  useEffect(() => { void load(); }, [load]);
  async function review(userId: string, action: "approve" | "reject") {
    const r = await transport("staff-photos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, action }) });
    setNotice(r.ok ? (action === "approve" ? "Photo approved." : "Photo rejected; the operator was asked for a new one.") : "Could not save the review.");
    void load();
  }
  return (
    <section aria-labelledby="photo-review" className="mt-6 text-ink">
      <h3 id="photo-review" className="text-lg font-bold">Operator photos to review</h3>
      {notice ? <p role="status" className="text-sm">{notice}</p> : null}
      {rows && !rows.length ? <p className="text-sm text-muted">Nothing waiting.</p> : null}
      <ul className="mt-2 grid gap-3">
        {rows?.map((r) => (
          <li key={r.userId} className="flex flex-wrap items-center gap-3">
            {r.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={r.url} alt={`Photo uploaded by ${r.name}`} className="h-16 w-16 rounded-full border border-line object-cover" />
            ) : null}
            <span>{r.name}</span>
            <button type="button" className={btn} onClick={() => void review(r.userId, "approve")}>Approve</button>
            <button type="button" className={btn} onClick={() => void review(r.userId, "reject")}>Reject</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
