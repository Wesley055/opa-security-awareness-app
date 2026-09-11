'use client';

import { useEffect, useState } from 'react';
import { viewerSessionFetch } from '@/lib/viewer-session-fetch';

type Evidence = { id: string; type: string; createdAt: string; capturedAt: string | null; fileAvailable: boolean; status?: string; receivedAt?: string | null; sizeBytes?: string | null; integrity?: string };
type Result = { state: 'loading' | 'ready' | 'forbidden' | 'error'; rows: Evidence[]; page?: number; hasNext?: boolean };

async function readEvidence(incidentId: string, signal?: AbortSignal, page = 0): Promise<Result> {
  try {
    const timeout = AbortSignal.timeout(15000);
    const response = await viewerSessionFetch(
      '/api/operator/incidents/' + encodeURIComponent(incidentId) + '/evidence?page=' + page,
      { cache: 'no-store', signal: signal ? AbortSignal.any([signal, timeout]) : timeout },
    );
    if (!response.ok) return { state: response.status === 401 || response.status === 403 ? 'forbidden' : 'error', rows: [] };
    const body = await response.json();
    if (!Array.isArray(body.evidence)) return { state: 'error', rows: [] };
    return { state: 'ready', rows: body.evidence, page, hasNext: body.hasNext === true };
  } catch {
    return { state: 'error', rows: [] };
  }
}

export function EvidenceAvailability({ incidentId }: { incidentId: string }) {
  const [downloadState, setDownloadState] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [result, setResult] = useState<Result>({ state: 'loading', rows: [] });

  useEffect(() => {
    const controller = new AbortController();
    readEvidence(incidentId, controller.signal).then(value => {
      if (!controller.signal.aborted) setResult(value);
    });
    return () => controller.abort();
  }, [incidentId]);

  const refresh = (page = result.page ?? 0) => {
    setResult({ state: 'loading', rows: [] });
    void readEvidence(incidentId, undefined, page).then(setResult);
  };

  const download = async (row: Evidence) => {
    setDownloading(row.id); setDownloadState('Authorizing and verifying the evidence file…');
    try {
      const response = await viewerSessionFetch('/api/operator/incidents/'+encodeURIComponent(incidentId)+'/evidence/'+encodeURIComponent(row.id)+'/download', {cache:'no-store',signal:AbortSignal.timeout(45000)});
      if (!response.ok) { setDownloadState(response.status===410?'Evidence access expired. Request access again.':response.status===409?'Integrity verification failed. The file was not released.':response.status===401||response.status===403?'Evidence access is no longer authorized.':'Evidence download is unavailable. Retry to request fresh access.'); return; }
      if(response.headers.get('X-OPA-Evidence-Integrity')!=='matches-recorded-sha256'){setDownloadState('Evidence integrity could not be verified.');return;}
      const blob=await response.blob(),url=URL.createObjectURL(blob),anchor=document.createElement('a');
      anchor.href=url;anchor.download=response.headers.get('Content-Disposition')?.match(/filename="([a-z.]+)"/)?.[1]??'evidence.bin';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      setDownloadState('Download prepared. File bytes match the recorded SHA-256 digest. This does not independently establish authenticity.');
    } catch { setDownloadState('Evidence download did not complete. Request fresh access and retry.'); }
    finally { setDownloading(null); }
  };

  const message = result.state === 'loading'
    ? 'Checking evidence…'
    : result.state === 'forbidden'
      ? 'Evidence access is unavailable for this account.'
      : result.state === 'error'
        ? 'Evidence could not be checked. Availability is unknown.'
        : result.rows.length === 0
          ? 'No evidence has been recorded.'
          : 'Each download is authorized again and verified against the recorded file digest.';

  return (
    <section className="rounded-xl border border-line bg-panel p-4 text-ink">
      <h2 className="text-xl font-bold">Evidence availability</h2>
      <p role="status" className="mt-2 text-sm text-muted">{message}</p>
      {result.state === 'ready' ? (
        <ul className="mt-3 space-y-2">
          {result.rows.map(row => (
            <li key={row.id} className="text-sm">
              {row.type.replaceAll('_', ' ')} · {row.fileAvailable ? 'File recorded' : 'File unavailable'}
              <p className="text-xs text-muted">Recorded: {row.createdAt}</p>
              <p className="text-xs text-muted">Captured: {row.capturedAt ?? 'Not provided'} · Received: {row.receivedAt ?? 'Not provided'}</p>
              <p className="text-xs text-muted">Integrity: {row.integrity==='RECORDED_HASH'?'Recorded digest available; download verification pending':'Recorded digest unavailable'}</p>
              <button type="button" disabled={!row.fileAvailable || row.integrity!=='RECORDED_HASH' || downloading!==null} className="mt-2 min-h-11 rounded-md border border-line px-3 disabled:opacity-50" onClick={()=>void download(row)}>{downloading===row.id?'Verifying…':'Download verified evidence'}</button>
            </li>
          ))}
        </ul>
      ) : null}
      {result.state === 'ready' && ((result.page ?? 0) > 0 || result.hasNext) ? <nav aria-label="Evidence pages" className="mt-3 flex flex-wrap items-center gap-3"><button type="button" disabled={!result.page} className="min-h-11 rounded-md border border-line px-3 disabled:opacity-50" onClick={() => refresh((result.page ?? 0) - 1)}>Previous evidence</button><span>Page {(result.page ?? 0) + 1}</span><button type="button" disabled={!result.hasNext} className="min-h-11 rounded-md border border-line px-3 disabled:opacity-50" onClick={() => refresh((result.page ?? 0) + 1)}>Next evidence</button></nav> : null}
      {downloadState ? <p role="status" className="mt-3 text-sm">{downloadState}</p> : null}
      {result.state !== 'forbidden' ? (
        <button type="button" disabled={result.state === 'loading'} onClick={() => refresh()}
          className="mt-3 min-h-11 rounded-md border border-line px-4 disabled:opacity-50">
          Refresh evidence
        </button>
      ) : null}
    </section>
  );
}
