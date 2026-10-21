"use client";
import { useCallback, useEffect, useState } from "react";
import { viewerSessionFetch } from "@/lib/viewer-session-fetch";

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
const input = "min-h-11 rounded-md border border-line bg-panel-2 px-2 text-ink";
const btn = "min-h-11 rounded-md border border-line px-4 text-sm font-medium text-ink hover:bg-panel-2 disabled:opacity-60";

/** My profile: shared by every institutional console. Name, role and facility are read-only. */
export function StaffProfile({ session, transport, onSignedOut }: { session: "operator" | "institutional"; transport?: Transport; onSignedOut: () => void }) {
  const fetcher: Transport = transport ?? ((p, i) => viewerSessionFetch(p, i));
  const root = session === "institutional" ? "profile" : "/api/operator/profile";
  const [p, setP] = useState<Profile | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

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
    if (file.size > 3 * 1024 * 1024) return setNotice("Photo must be 3 MB or smaller.");
    const form = new FormData();
    form.append("file", file);
    setBusy(true);
    const r = await fetcher(root + "/photo", { method: "POST", body: form });
    const data = await r.json().catch(() => null);
    setBusy(false);
    setNotice(r.ok ? (data?.status === "PENDING" ? "Photo uploaded. Your Facility Admin will review it." : "Photo updated.") : data?.error ?? "Upload failed.");
    if (r.ok) void load();
  }
  async function action(body: Record<string, string>, done: string) {
    setBusy(true);
    const r = await fetcher(root, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => null);
    setBusy(false);
    if (!r.ok) return setNotice(data?.error ?? "That did not work. Try again.");
    setNotice(done);
    setTimeout(onSignedOut, 1500);
  }

  if (!p) return <section className="text-ink"><h2 className="text-xl font-bold">My profile</h2><p role="status" className="mt-2">{notice || "Loading…"}</p></section>;
  return (
    <section aria-labelledby="profile-heading" className="grid gap-5 text-ink">
      <h2 id="profile-heading" className="text-xl font-bold">My profile</h2>
      {notice ? <p role="status" className="rounded-md border border-line bg-panel-2 px-3 py-2 text-sm">{notice}</p> : null}
      <div className="flex flex-wrap items-center gap-4">
        {p.photo.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.photo.url} alt="Your profile photo" className="h-24 w-24 rounded-full border border-line object-cover" />
        ) : (
          <div aria-hidden className="flex h-24 w-24 items-center justify-center rounded-full border border-line bg-panel-2 text-2xl font-bold">{(p.firstName[0] ?? "") + (p.lastName[0] ?? "")}</div>
        )}
        <div>
          <p className="text-lg font-semibold">{p.firstName} {p.lastName}</p>
          <p className="text-sm">{ROLE[p.role] ?? p.role}{p.facility ? ` · ${p.facility.name}` : ""}</p>
          <p className="text-xs text-muted">Your name is verified. Ask your administrator to correct it.</p>
        </div>
      </div>
      <div className="grid gap-2">
        <h3 className="font-semibold">Profile photo</h3>
        <p className="text-sm">{p.photo.status ? PHOTO[p.photo.status] : p.photoRequiredForDuty ? "Required to start a duty shift. You can always respond to emergencies without one." : "Optional."}</p>
        <label className="text-sm">
          <span className="sr-only">Choose a photo</span>
          <input type="file" accept="image/jpeg,image/png" disabled={busy} onChange={(e) => void upload(e.target.files?.[0])} />
        </label>
        <p className="text-xs text-muted">JPEG or PNG, up to 3 MB. Visible to staff of your facility, and to a resident you are helping during an SOS.</p>
      </div>
      <form className="grid max-w-md gap-2" onSubmit={(e) => { e.preventDefault(); if (next !== confirm) return setNotice("The new passwords do not match."); void action({ action: "password", currentPassword: current, newPassword: next }, "Password changed. You are signed out everywhere; sign in again with your new password."); }}>
        <h3 className="font-semibold">Change password</h3>
        <label className="grid gap-1 text-sm">Current password<input className={input} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></label>
        <label className="grid gap-1 text-sm">New password<input className={input} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} /></label>
        <label className="grid gap-1 text-sm">Confirm new password<input className={input} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></label>
        <button type="submit" className={btn} disabled={busy}>Change password</button>
        <p className="text-xs text-muted">Changing your password signs you out on every device.</p>
      </form>
      <div className="grid max-w-md gap-2">
        <h3 className="font-semibold">Sessions</h3>
        <button type="button" className={btn} disabled={busy} onClick={() => void action({ action: "sign-out-everywhere" }, "Signed out on every device, including this one.")}>Sign out on all devices</button>
        <p className="text-xs text-muted">Use this if you signed in on a shared or lost device.</p>
      </div>
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
