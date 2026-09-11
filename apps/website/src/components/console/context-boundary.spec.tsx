import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ContextBoundary } from './context-boundary';
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('clears previous tenant content when authoritative context changes', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ operator: { userId: 'user', role: 'FACILITY_OPERATOR' }, facility: { id: 'new' } }))));
  render(<ContextBoundary initialScope="user:old:FACILITY_OPERATOR"><p>Old resident</p></ContextBoundary>);
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(screen.queryByText('Old resident')).toBeNull();
  expect(screen.getByText('Account or facility changed')).toBeTruthy();
});
it('removes private content on access revocation', () => {
  render(<ContextBoundary initialScope="user:old:FACILITY_OPERATOR"><p>Private roster</p></ContextBoundary>);
  act(() => { window.dispatchEvent(new Event('opa:access-changed')); });
  expect(screen.queryByText('Private roster')).toBeNull();
});
it('marks outage as stale without claiming reassignment', async () => {
  vi.useFakeTimers(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
  render(<ContextBoundary initialScope="user:old:FACILITY_OPERATOR"><p>Last known data</p></ContextBoundary>);
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(screen.getByText('Last known data')).toBeTruthy();
  expect(screen.getByText(/Displayed information may be stale/)).toBeTruthy();
});
