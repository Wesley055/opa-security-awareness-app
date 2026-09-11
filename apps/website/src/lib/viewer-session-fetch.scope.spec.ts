import { afterEach, expect, it, vi } from 'vitest';
import { setPresentationScope, viewerSessionFetch } from './viewer-session-fetch';
afterEach(() => { setPresentationScope(null); vi.unstubAllGlobals(); });
const context = (id: string) => new Response(JSON.stringify({operator:{userId:'user',role:'FACILITY_OPERATOR'},facility:{id}}));
it('rejects a changed scope before a mutation is sent', async () => {
  setPresentationScope('user:old:FACILITY_OPERATOR');
  const fetcher=vi.fn().mockResolvedValue(context('new')); vi.stubGlobal('fetch',fetcher);
  const result=await viewerSessionFetch('/api/operator/residents',{method:'POST'});
  expect(result.status).toBe(403); expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0][0]).toBe('/api/operator/context');
});
it('discards a response when context changed during the request', async () => {
  setPresentationScope('user:old:FACILITY_OPERATOR');
  const fetcher=vi.fn().mockResolvedValueOnce(context('old')).mockResolvedValueOnce(new Response(JSON.stringify({residents:['private']}))).mockResolvedValueOnce(context('new')); vi.stubGlobal('fetch',fetcher);
  const result=await viewerSessionFetch('/api/operator/residents'); expect(result.status).toBe(403); expect(await result.text()).not.toContain('private');
});
it('does not make a mutation when context is unavailable', async () => {
  setPresentationScope('user:old:FACILITY_OPERATOR'); const fetcher=vi.fn().mockResolvedValue(new Response(null,{status:503}));vi.stubGlobal('fetch',fetcher);
  expect((await viewerSessionFetch('/api/operator/residents',{method:'POST'})).status).toBe(503);expect(fetcher).toHaveBeenCalledTimes(1);
});
