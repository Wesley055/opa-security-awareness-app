'use client';

import { useCallback, useMemo, useState } from 'react';
import type {
  FacilityAdminResident,
  FacilityAdminResidents,
  ResidentInvitation,
} from '@/lib/facility-admin-residents';

type InitialResult =
  | { state: 'READY'; data: FacilityAdminResidents }
  | { state: 'FORBIDDEN'; message: string }
  | { state: 'UNAVAILABLE'; message?: string }
  | { state: 'REJECTED' }
  | { state: 'INVALID'; message: string }
  | { state: 'CONFLICT'; message: string }
  | { state: 'NOT_FOUND'; message: string };

type FormState = {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
};

const emptyForm: FormState = {
  firstName: '',
  lastName: '',
  email: '',
  phoneNumber: '',
};

function fullName(resident: FacilityAdminResident) {
  return [resident.firstName, resident.lastName].filter(Boolean).join(' ') || 'Unnamed resident';
}

function statusLabel(status: string) {
  return status
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');
}

function invitationSummary(invitation: ResidentInvitation | undefined) {
  if (!invitation) return null;
  if (!invitation.latest) return 'No invitation delivery recorded.';
  return `${invitation.latest.channel} - ${statusLabel(invitation.latest.status)}`;
}

export function ResidentManagement({ initialResult }: { initialResult: InitialResult }) {
  const [data, setData] = useState<FacilityAdminResidents | null>(
    initialResult.state === 'READY' ? initialResult.data : null,
  );
  const [form, setForm] = useState<FormState>(emptyForm);
  const [showAdd, setShowAdd] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [showBulk, setShowBulk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(
    initialResult.state === 'FORBIDDEN'
      ? initialResult.message
      : initialResult.state === 'UNAVAILABLE'
        ? initialResult.message ?? 'Resident administration is temporarily unavailable.'
        : null,
  );
  const [invitations, setInvitations] = useState<Record<string, ResidentInvitation>>({});
  const [invitationBusy, setInvitationBusy] = useState<string | null>(null);

  const residents = data?.residents ?? [];

  const refreshResidents = useCallback(async () => {
    window.location.reload();
  }, []);

  async function createResident(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch('/api/operator/residents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const body = await response.json();

      if (!response.ok) {
        setError(body.error ?? 'Resident could not be added.');
        return;
      }

      setNotice('Resident added. OPA queued the activation invitation for delivery.');
      setForm(emptyForm);
      setShowAdd(false);
      await refreshResidents();
    } catch {
      setError('Resident could not be added. Check the connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  const parsedBulk = useMemo(() => {
    const lines = bulkText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return lines.map((line) => {
      const [firstName = '', lastName = '', email = '', phoneNumber = ''] =
        line.split(',').map((part) => part.trim());
      return { firstName, lastName, email, phoneNumber };
    });
  }, [bulkText]);

  async function createBulk(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (parsedBulk.length === 0 || parsedBulk.some((row) => !row.firstName || !row.lastName || !row.email || !row.phoneNumber)) {
      setError('Use one resident per line: First name, Last name, Email, Phone number.');
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch('/api/operator/residents/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ residents: parsedBulk }),
      });
      const body = await response.json();

      if (!response.ok) {
        setError(body.error ?? 'Residents could not be added.');
        return;
      }

      const result = body.result;
      setNotice(
        result.failed > 0
          ? `${result.queued} invitation(s) queued; ${result.failed} resident(s) failed. Review the entries and retry only the failed residents.`
          : `${result.queued} invitation(s) queued successfully.`,
      );
      setBulkText('');
      setShowBulk(false);
      await refreshResidents();
    } catch {
      setError('Residents could not be added. Check the connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function loadInvitation(userId: string) {
    setInvitationBusy(userId);
    setError(null);

    try {
      const response = await fetch(
        `/api/operator/residents/${encodeURIComponent(userId)}/invitation`,
        { cache: 'no-store' },
      );
      const body = await response.json();

      if (!response.ok) {
        setError(body.error ?? 'Invitation status could not be loaded.');
        return;
      }

      setInvitations((current) => ({ ...current, [userId]: body.invitation }));
    } catch {
      setError('Invitation status could not be loaded.');
    } finally {
      setInvitationBusy(null);
    }
  }

  async function resend(userId: string) {
    setInvitationBusy(userId);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(
        `/api/operator/residents/${encodeURIComponent(userId)}/invitation/resend`,
        { method: 'POST' },
      );
      const body = await response.json();

      if (!response.ok) {
        setError(body.error ?? 'Invitation could not be resent.');
        await loadInvitation(userId);
        return;
      }

      setNotice('Invitation queued for resend.');
      await loadInvitation(userId);
    } catch {
      setError('Invitation could not be resent.');
    } finally {
      setInvitationBusy(null);
    }
  }

  if (!data) {
    return (
      <section className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
        <h1 className="font-display text-2xl font-bold text-ink">Residents</h1>
        <p className="mt-4 max-w-prose text-sm text-muted">
          {error ?? 'Resident administration is temporarily unavailable.'}
        </p>
      </section>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-protection">
            Facility administration
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            Residents
          </h1>
          <p className="mt-2 text-sm text-muted">
            {residents.length} {residents.length === 1 ? 'resident' : 'residents'}
            <span aria-hidden="true"> &middot; </span>
            {data.facility.name}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => { setShowBulk((value) => !value); setShowAdd(false); }}
            className="min-h-10 rounded-md border border-line bg-panel px-4 py-2 text-sm font-medium text-ink transition hover:bg-panel-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-protection"
          >
            Bulk add
          </button>
          <button
            type="button"
            onClick={() => { setShowAdd((value) => !value); setShowBulk(false); }}
            className="min-h-10 rounded-md bg-protection px-4 py-2 text-sm font-bold text-white transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-protection"
          >
            Add resident
          </button>
        </div>
      </header>

      {notice ? (
        <p role="status" className="mt-5 rounded-lg border border-line bg-panel-2 px-4 py-3 text-sm text-ink">
          {notice}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-5 rounded-lg border border-line bg-panel px-4 py-3 text-sm text-ink">
          {error}
        </p>
      ) : null}

      {showAdd ? (
        <form onSubmit={createResident} className="mt-6 rounded-xl border border-line bg-panel p-4 sm:p-5">
          <h2 className="font-display text-lg font-bold text-ink">Add resident</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {([
              ['firstName', 'First name', 'text'],
              ['lastName', 'Last name', 'text'],
              ['email', 'Email', 'email'],
              ['phoneNumber', 'Phone number', 'tel'],
            ] as const).map(([key, label, type]) => (
              <label key={key} className="text-sm text-ink">
                <span className="mb-1.5 block font-medium">{label}</span>
                <input
                  required
                  type={type}
                  value={form[key]}
                  onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
                  className="min-h-11 w-full rounded-md border border-line bg-base px-3 py-2 text-ink outline-none focus:border-protection focus:ring-2 focus:ring-protection/30"
                />
              </label>
            ))}
          </div>
          <div className="mt-4 flex justify-end">
            <button disabled={busy} className="min-h-10 rounded-md bg-protection px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
              {busy ? 'Adding...' : 'Add and send invitation'}
            </button>
          </div>
        </form>
      ) : null}

      {showBulk ? (
        <form onSubmit={createBulk} className="mt-6 rounded-xl border border-line bg-panel p-4 sm:p-5">
          <h2 className="font-display text-lg font-bold text-ink">Bulk add residents</h2>
          <p className="mt-1 text-sm text-muted">
            One resident per line: First name, Last name, Email, Phone number. Maximum 200.
          </p>
          <textarea
            required
            rows={7}
            value={bulkText}
            onChange={(event) => setBulkText(event.target.value)}
            placeholder="Ada, Okafor, ada@example.com, +2348012345678"
            className="mt-4 w-full rounded-md border border-line bg-base px-3 py-2 font-mono text-sm text-ink outline-none focus:border-protection focus:ring-2 focus:ring-protection/30"
          />
          <div className="mt-3 flex items-center justify-between gap-4">
            <span className="text-xs text-muted">{parsedBulk.length} row(s)</span>
            <button disabled={busy} className="min-h-10 rounded-md bg-protection px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
              {busy ? 'Adding...' : 'Add residents'}
            </button>
          </div>
        </form>
      ) : null}

      <section className="mt-8 rounded-xl border border-line bg-panel">
        <div className="border-b border-line px-4 py-4 sm:px-5">
          <h2 className="font-display text-lg font-bold text-ink">Resident accounts</h2>
          <p className="mt-1 text-sm text-muted">
            Activation and invitation delivery are shown from OPA's current server state.
          </p>
        </div>

        {residents.length === 0 ? (
          <div className="px-4 py-10 text-center sm:px-5">
            <p className="font-display font-bold text-ink">No residents yet</p>
            <p className="mt-1 text-sm text-muted">Add the first resident to queue an activation invitation.</p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {residents.map((resident) => {
              const invitation = invitations[resident.id];
              const loading = invitationBusy === resident.id;
              const resendAvailableAt = invitation?.resendAvailableAt
                ? new Date(invitation.resendAvailableAt).toLocaleString()
                : null;

              return (
                <li key={resident.id} className="px-4 py-4 sm:px-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <p className="font-display font-bold text-ink">{fullName(resident)}</p>
                      <p className="mt-1 break-all text-sm text-muted">{resident.email}</p>
                      <p className="mt-0.5 text-sm text-muted">{resident.phoneNumber}</p>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        <span className="rounded-full border border-line bg-panel-2 px-2.5 py-1 text-ink">
                          {statusLabel(resident.accountStatus)}
                        </span>
                        {!resident.isActive ? (
                          <span className="rounded-full border border-line bg-panel-2 px-2.5 py-1 text-muted">
                            Inactive
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="lg:text-right">
                      {invitation ? (
                        <>
                          <p className="text-sm text-ink">{invitationSummary(invitation)}</p>
                          {resendAvailableAt ? (
                            <p className="mt-1 text-xs text-muted">Resend available {resendAvailableAt}</p>
                          ) : null}
                          <button
                            type="button"
                            disabled={!invitation.canResend || loading}
                            onClick={() => resend(resident.id)}
                            className="mt-2 min-h-10 rounded-md border border-line bg-panel-2 px-3 py-2 text-sm text-ink disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {loading ? 'Working...' : 'Resend invitation'}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          disabled={loading}
                          onClick={() => loadInvitation(resident.id)}
                          className="min-h-10 rounded-md border border-line bg-panel-2 px-3 py-2 text-sm text-ink disabled:opacity-50"
                        >
                          {loading ? 'Loading...' : 'Check invitation'}
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
