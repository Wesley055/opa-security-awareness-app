import { NextResponse } from 'next/server';
import { consoleApi, object } from '@/lib/console-api';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, { params }: { params: Promise<{ incidentId: string }> }) {
  const { incidentId } = await params;
  const page = Number(new URL(request.url).searchParams.get('page') ?? '0');
  if (!Number.isSafeInteger(page) || page < 0 || page > 100000) return NextResponse.json({error:'Invalid evidence page.'}, {status:400});
  const result = await consoleApi('/incidents/' + encodeURIComponent(incidentId) + '/evidence');
  const headers = { 'Cache-Control': 'no-store, private', 'Referrer-Policy': 'no-referrer' };
  if (result.status !== 200) return NextResponse.json({ error: result.error }, { status: result.status, headers });
  if (!Array.isArray(result.data) || !result.data.every(row => object(row) && typeof row.id === 'string' && typeof row.type === 'string' && typeof row.createdAt === 'string')) return NextResponse.json({ error: 'Evidence availability could not be checked.' }, { status: 503, headers });
  // Never expose storage keys, SAS URLs, raw metadata, or uploader identity.
  return NextResponse.json({ page, hasNext: (page + 1) * 50 < result.data.length, evidence: result.data.slice(page * 50, (page + 1) * 50).map(row => ({ id: row.id.slice(0,128), type: row.type.slice(0,32), createdAt: row.createdAt.slice(0,40), capturedAt: typeof row.capturedAt === 'string' ? row.capturedAt.slice(0,40) : null, fileAvailable: row.status === 'STORED' && typeof row.storageKey === 'string' && row.storageKey.length > 0, status: typeof row.status === 'string' ? row.status.slice(0,32) : 'UNKNOWN', receivedAt: typeof row.uploadedAt === 'string' ? row.uploadedAt.slice(0,40) : null, sizeBytes: typeof row.sizeBytes === 'string' || typeof row.sizeBytes === 'number' ? String(row.sizeBytes).slice(0,30) : null, integrity: typeof row.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(row.sha256) ? 'RECORDED_HASH' : 'UNAVAILABLE' })) }, { headers });
}
