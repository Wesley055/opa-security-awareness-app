import { describe, expect, it } from 'vitest';
import { assuranceSummary, channelLabel, locationReportLine, verificationNote } from './delivery-labels';

describe('delivery labels', () => {
  it('names each route plainly', () => {
    expect(channelLabel('APP')).toBe('OPA app');
    expect(channelLabel('SMS')).toBe('SMS (no internet)');
    expect(channelLabel('USSD')).toBe('USSD');
  });

  it('never presents a number-only alert as verified', () => {
    expect(verificationNote('SMS_NUMBER_ONLY')).toMatch(/^Not verified/);
    expect(verificationNote('USSD_NUMBER')).toMatch(/Not proof of identity/);
    expect(verificationNote('SMS_SIGNED')).toMatch(/^Verified/);
  });

  it('labels every location with its source and age, never as live', () => {
    expect(locationReportLine({ source: 'SAVED_PLACE', label: 'Home', description: 'Bk 30', reportedAt: '' })).toBe('Saved place: Home (Bk 30)');
    expect(locationReportLine({ source: 'TYPED_LANDMARK', landmark: 'near the mosque', reportedAt: '' })).toBe('Typed landmark, not verified: near the mosque');
    expect(locationReportLine({ source: 'LAST_APP_FIX', latitude: '6.48', longitude: '3.36', ageMinutes: 25, reportedAt: '' })).toBe('Last app position, 25 min old: 6.48, 3.36');
  });
});

describe("assuranceSummary", () => {
  const base = { contactsAlerted: 2, contactsConfirmed: [], remindersSent: 0, callsPlaced: 0, securityEscalatedAt: null, facilityAdminsAlerted: 0 };
  it("says plainly when nobody has confirmed, and what OPA did", () => {
    expect(assuranceSummary(base)).toBe("No contact has confirmed seeing the alert yet (2 texted).");
    expect(assuranceSummary({ ...base, remindersSent: 2, callsPlaced: 1 })).toBe("No contact has confirmed seeing the alert yet (2 texted; reminder sent, 1 call placed).");
  });
  it("counts confirmations", () => {
    expect(assuranceSummary({ ...base, contactsConfirmed: [{ relationship: "Sister", at: "2026-10-25T12:03:00Z", via: "SMS_REPLY" }] })).toBe("1 of 2 contacts confirmed seeing the alert.");
  });
});
