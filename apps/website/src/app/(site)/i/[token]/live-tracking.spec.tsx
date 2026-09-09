import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LiveTracking } from './live-tracking';

describe('locationless emergency alert', () => {
  it('keeps the alert visible without a fake map or location', () => {
    const { container } = render(<LiveTracking token="test" initial={{ state: 'VALID', serverTime: '2026-09-09T01:00:00Z', incident: { personName: 'Test Person', status: 'OPEN', triggeredAt: '2026-09-09T01:00:00Z', location: null, retriggerCount: 0, lastRetriggeredAt: null } }} />);
    expect(screen.getByText('Test Person may be in danger')).toBeTruthy();
    expect(screen.getByText('Location unavailable. The emergency alert is active.')).toBeTruthy();
    expect(container.querySelector('iframe')).toBeNull();
    expect(screen.queryByText('Open in Maps')).toBeNull();
  });
});
