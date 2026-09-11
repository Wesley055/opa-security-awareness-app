import { ReportingShell } from '@/components/console/reporting-shell';
import { redirect } from 'next/navigation';
import { getSessionState } from '@/lib/operator-session';
import { getOperatorContext } from '@/lib/operator-context';
import { RetryButton } from '@/components/console/retry-button';
export const dynamic = 'force-dynamic';
export default async function ReportsPage() {
  const session = await getSessionState();
  if (session === 'none') redirect('/operator/login');
  if (session === 'refreshable') redirect('/api/operator/refresh');
  const result = await getOperatorContext();
  if (result.state === 'REJECTED') redirect('/api/operator/refresh');
  const role = result.state === 'READY' ? result.context.role : result.state === 'NO_FACILITY' ? result.role : null;
  if (['FACILITY_OPERATOR','FACILITY_ADMIN','ADMIN'].includes(role ?? '')) return <ReportingShell />;
  return <section className="mx-auto max-w-7xl p-6 text-ink"><h1 className="text-2xl font-bold">Reports / Analytics</h1><p role="status" className="mt-4">{result.state === 'UNAVAILABLE' ? 'Account context is temporarily unavailable.' : !['FACILITY_OPERATOR','FACILITY_ADMIN','ADMIN'].includes(role ?? '') ? 'This account cannot access institutional reports.' : 'Reporting is not enabled. Reports and analytics will appear here when the reporting service is available.'}</p>{result.state === 'UNAVAILABLE' ? <RetryButton /> : null}</section>;
}
