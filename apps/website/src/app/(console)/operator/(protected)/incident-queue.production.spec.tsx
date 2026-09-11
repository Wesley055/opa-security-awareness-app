import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { IncidentQueue } from './incident-queue';
const incident = { id: 'incident', status: 'ACTIVE', trigger: 'SOS_BUTTON', latitude: null, longitude: null, address: null, createdAt: '2026-09-09T12:00:00Z', lastTriggeredAt: null, retriggerCount: 2, resolvedAt: null, user: { firstName: 'Test', lastName: 'Resident' } };
function queue() { render(<IncidentQueue initialIncidents={[incident]} initialNextCursor={null} initialHasMore={false} initialServerTime="2026-09-09T12:00:00Z" />); }
afterEach(() => vi.unstubAllGlobals());
it('explicitly labels unavailable location and backend severity', () => { queue(); expect(screen.getByText('Location unavailable')).toBeTruthy(); expect(screen.getByText(/Severity: not provided/)).toBeTruthy(); });
it('removes incident identities on forbidden refresh', async () => {
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'raw secret exception' }),{status:403})));
  queue(); fireEvent.click(screen.getByRole('button',{name:'Refresh queue'}));
  await waitFor(() => expect(screen.queryByText('Test Resident')).toBeNull());
  expect(screen.queryByText('raw secret exception')).toBeNull();
});
it('keeps last known incidents while stating outage', async () => {
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(null,{status:503})));
  queue(); fireEvent.click(screen.getByRole('button',{name:'Refresh queue'}));
  expect(await screen.findByText('Not updating')).toBeTruthy(); expect(screen.getByText('Test Resident')).toBeTruthy();
});
it('does not interpret malformed success as an empty queue', async () => {
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{}')));
  queue(); fireEvent.click(screen.getByRole('button',{name:'Refresh queue'}));
  expect(await screen.findByText('Not updating')).toBeTruthy(); expect(screen.getByText('Test Resident')).toBeTruthy();
});
