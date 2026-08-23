import { describe, expect, it } from 'vitest';
import type { IncidentDetail } from '@/lib/operator-incident';

describe('website test harness', () => {
  it('resolves the @ alias into the website source tree', () => {
    const incident: Pick<IncidentDetail, 'id' | 'status'> = {
      id: 'incident-1',
      status: 'OPEN',
    };

    expect(incident.id).toBe('incident-1');
    expect(incident.status).toBe('OPEN');
  });
});
