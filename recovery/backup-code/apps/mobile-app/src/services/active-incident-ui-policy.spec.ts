import {
  homeEmergencyAction,
  sosInitialMode,
} from './active-incident-ui-policy';

const openIncident = { id: 'incident-1', status: 'OPEN' as const };

describe('active incident UI policy', () => {
  it('keeps Home user-controlled while exposing the active emergency', () => {
    expect(homeEmergencyAction(openIncident)).toBe('OPEN_ACTIVE_INCIDENT');
  });

  it('keeps normal SOS activation available when no emergency is open', () => {
    expect(homeEmergencyAction(null)).toBe('ACTIVATE_SOS');
  });

  it('opens SOS in activated mode for an existing OPEN incident', () => {
    expect(sosInitialMode(openIncident)).toBe('activated');
  });

  it('uses countdown only when there is no existing OPEN incident', () => {
    expect(sosInitialMode(null)).toBe('countdown');
  });
});