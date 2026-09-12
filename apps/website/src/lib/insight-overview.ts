import 'server-only';
import { apiUrl, getAccessToken } from '@/lib/operator-session';

export type InsightSummary = {
  incidentCount: number; unresolved: number; staleUnresolved: number;
  resolutionMeanMs: number | null; acknowledgementMeanMs: number | null;
  evidencePresent: number; evidencePossible: number; missingEvidence: number;
  overdueActions: number; confirmedDelivered: number; providerAccepted: number;
};
export type InsightResult = { state: 'READY'; summary: InsightSummary } | { state: 'UNAVAILABLE' | 'DENIED' | 'REJECTED' };
const row = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const count = (v: unknown): number => { if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error('Invalid count'); return v; };
const latency = (v: unknown) => v === null ? null : count(v);
export function parseInsight(value: unknown): InsightSummary {
  const data = row(value), metrics = row(data.metrics), actions = row(data.correctiveActions);
  if (data.schemaVersion !== 1) throw new Error('Unknown reporting version');
  if (!metrics.notificationOutcomes || typeof metrics.notificationOutcomes !== 'object' || Array.isArray(metrics.notificationOutcomes)) throw new Error('Missing delivery outcomes');
  const coverage = row(metrics.evidenceCompleteness), delivery = row(metrics.notificationOutcomes);
  return { incidentCount: count(metrics.incidentCount), unresolved: count(metrics.unresolved), staleUnresolved: count(metrics.staleUnresolved),
    resolutionMeanMs: latency(row(metrics.resolutionLatency).meanMs), acknowledgementMeanMs: latency(row(metrics.acknowledgementLatency).meanMs),
    evidencePresent: count(coverage.present), evidencePossible: count(coverage.possible), missingEvidence: count(metrics.missingEvidence),
    overdueActions: count(actions.overdue), confirmedDelivered: count(delivery.DELIVERED ?? 0), providerAccepted: count(delivery.PROVIDER_ACCEPTED ?? 0) };
}
export async function loadInsightOverview(): Promise<InsightResult> {
  const base = apiUrl(), token = await getAccessToken();
  if (!base) return { state: 'UNAVAILABLE' };
  if (!token) return { state: 'REJECTED' };
  const to = new Date(), from = new Date(+to - 30 * 86400000);
  const query = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
  try {
    const response = await fetch(base + '/internal/insight/overview?' + query, {
      headers: { Authorization: 'Bearer ' + token }, cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (response.status === 401) return { state: 'REJECTED' };
    if ([403, 404].includes(response.status)) return { state: 'DENIED' };
    if (!response.ok) return { state: 'UNAVAILABLE' };
    return { state: 'READY', summary: parseInsight(await response.json()) };
  } catch { return { state: 'UNAVAILABLE' }; }
}
