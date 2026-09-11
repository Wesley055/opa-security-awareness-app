import 'server-only';
import { apiUrl, getAccessToken } from '@/lib/operator-session';
// Fixed caller-owned paths only. No browser-supplied upstream URL.
export async function consoleApi(path: string, method: 'GET' | 'POST' = 'GET', body?: unknown): Promise<{ status: number; data?: unknown; error?: string }> {
  const base = apiUrl(), token = await getAccessToken();
  if (!token) return { status: 401, error: 'Your session ended.' };
  if (!base) return { status: 503, error: 'The service is temporarily unavailable.' };
  try {
    const response = await fetch(base + path, { method, cache: 'no-store', signal: AbortSignal.timeout(10000), headers: { Authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!response.ok) {
      const status = [400,401,403,404,409,422].includes(response.status) ? response.status : 503;
      return { status, error: status === 401 ? 'Your session ended.' : status === 403 ? 'This account does not have access.' : status === 404 ? 'The requested record is unavailable.' : status === 409 ? 'This operation conflicts with current records. Verify the existing record before retrying.' : status === 400 || status === 422 ? 'Check the submitted fields and try again.' : 'The service is temporarily unavailable.' };
    }
    return { status: 200, data: await response.json() };
  } catch { return { status: 503, error: 'The service is temporarily unavailable. If you submitted a change, verify its outcome before retrying.' }; }
}
export function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
