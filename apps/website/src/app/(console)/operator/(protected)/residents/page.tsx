import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { fetchFacilityAdminResidents } from '@/lib/facility-admin-residents';
import { getOperatorContext } from '@/lib/operator-context';
import { getSessionState } from '@/lib/operator-session';
import { ResidentManagement } from './resident-management';

export const metadata: Metadata = {
  title: 'Residents | OPA Viewer',
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = 'force-dynamic';

export default async function FacilityAdminResidentsPage() {
  const state = await getSessionState();

  if (state === 'refreshable') redirect('/api/operator/refresh');
  if (state === 'none') redirect('/operator/login');

  const context = await getOperatorContext();

  if (context.state === 'REJECTED') redirect('/api/operator/refresh');
  if (context.state === 'READY' && context.context.role !== 'FACILITY_ADMIN') {
    redirect('/operator');
  }

  const result = await fetchFacilityAdminResidents();

  if (result.state === 'REJECTED') redirect('/api/operator/refresh');

  return <ResidentManagement initialResult={result} />;
}
