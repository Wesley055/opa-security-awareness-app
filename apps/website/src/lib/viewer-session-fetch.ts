let presentationScope: string | null = null;
let revision = 0;
export function setPresentationScope(scope: string | null) { presentationScope = scope; revision++; }
async function checkScope(expected: string): Promise<Response | null> {
  const response = await viewerSessionFetch('/api/operator/context', { cache: 'no-store' });
  if (!response.ok) return response.status === 409 ? notify(new Response(null, { status: 403 })) : response;
  const body = await response.json();
  const actual = body.operator?.userId + ':' + body.facility?.id + ':' + body.operator?.role;
  return actual === expected ? null : notify(new Response(null, { status: 403 }));
}
let rotation: Promise<Response> | null = null;
function notify(response: Response) {
  if ((response.status === 401 || response.status === 403) && typeof window !== 'undefined') window.dispatchEvent(new Event('opa:access-changed'));
  return response;
}
export async function viewerSessionFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const expected = presentationScope, generation = revision;
  const scoped = expected && String(input) !== '/api/operator/context';
  if (scoped) { const refused = await checkScope(expected); if (refused) return refused; }
  const finish = async (response: Response) => {
    if (scoped && (generation !== revision || expected !== presentationScope)) return notify(new Response(null, { status: 403 }));
    if (scoped && response.ok) { const refused = await checkScope(expected); if (refused) return refused; }
    return notify(response);
  };
  const options = { ...init, signal: init?.signal ?? AbortSignal.timeout(15000) };
  const response = await fetch(input, options);
  if (response.status !== 401) return finish(response);
  if (!rotation) rotation = fetch('/api/operator/refresh', { method: 'POST', signal: AbortSignal.timeout(15000) }).finally(() => { rotation = null; });
  const rotated = await rotation;
  if (!rotated.ok) return notify(rotated);
  return finish(await fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(15000) }));
}
