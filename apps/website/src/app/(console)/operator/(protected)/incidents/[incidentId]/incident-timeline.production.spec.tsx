import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { IncidentTimeline } from './incident-timeline';
it('distinguishes unavailable history from an authoritative empty history', () => {
  render(<IncidentTimeline events={[]} verification={null} available={false} stale />);
  expect(screen.getByText('Timeline could not be loaded.')).toBeTruthy();
  expect(screen.queryByText(/No timeline entries/)).toBeNull();
});
it('presents audit source, event and timestamp', () => {
  render(<IncidentTimeline events={[{ sequence: 1, type: 'INCIDENT_CREATED', occurredAt: '2026-09-09T12:00:00Z', source: 'MOBILE', display: {} }]} verification={{valid:true}} />);
  expect(screen.getByText(/Incident created/)).toBeTruthy(); expect(screen.getByText('Source: MOBILE')).toBeTruthy();
});
