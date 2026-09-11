'use client';
import { useEffect, useState } from 'react';
import { viewerSessionFetch, setPresentationScope } from '@/lib/viewer-session-fetch';
import { RetryButton } from './retry-button';

// Presentation invalidation only. The API still authorizes every data request.
export function ContextBoundary({ initialScope, children }: { initialScope: string | null; children: React.ReactNode }) {
  const [blocked, setBlocked] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    setPresentationScope(initialScope);
    if (!initialScope) return () => setPresentationScope(null);
    let disposed = false;
    let pending = false;
    const invalidate = () => { if (!disposed) setBlocked(true); };
    const check = async () => {
      if (pending || disposed) return;
      pending = true;
      try {
        const response = await viewerSessionFetch('/api/operator/context', { cache: 'no-store' });
        if (disposed) return;
        if ([401,403,409].includes(response.status)) { invalidate(); return; }
        if (!response.ok) { setUnavailable(true); return; }
        const body = await response.json();
        if (disposed) return;
        if (!body.operator?.userId || !body.facility?.id) { setUnavailable(true); return; }
        if (body.operator.userId + ':' + body.facility.id + ':' + body.operator.role !== initialScope) invalidate();
        else setUnavailable(false);
      } catch { if (!disposed) setUnavailable(true); }
      finally { pending = false; }
    };
    const onVisible = () => { if (!document.hidden) void check(); };
    const timer = setInterval(() => { if (!document.hidden) void check(); }, 5000);
    window.addEventListener('opa:access-changed', invalidate);
    window.addEventListener('online', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => { setPresentationScope(null); disposed = true; clearInterval(timer); window.removeEventListener('opa:access-changed', invalidate); window.removeEventListener('online', onVisible); document.removeEventListener('visibilitychange', onVisible); };
  }, [initialScope]);
  if (blocked) return <section className="p-6 text-ink"><h1 className="text-xl font-bold">Account or facility changed</h1><p role="alert">Previous facility data has been cleared. Reload to verify current access.</p><RetryButton /></section>;
  return <>{unavailable ? <p role="status" className="p-4 text-ink">Facility context could not be refreshed. Displayed information may be stale.</p> : null}{children}</>;
}
