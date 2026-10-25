/**
 * How an alert reached OPA (emergency delivery, release 48). Display only.
 * The API sends a typed summary; older API builds send nothing, which reads
 * as the signed-in app.
 */
export type DeliverySummary = {
  channel: 'APP' | 'SMS' | 'USSD' | string;
  channels: string[];
  verification: 'APP_SIGNED_IN' | 'SMS_SIGNED' | 'SMS_NUMBER_ONLY' | 'USSD_NUMBER' | string;
  pressedAt: string | null;
};

export type LocationReport = {
  source: 'SAVED_PLACE' | 'TYPED_LANDMARK' | 'LAST_APP_FIX' | string;
  label?: string;
  description?: string | null;
  landmark?: string;
  latitude?: string | null;
  longitude?: string | null;
  recordedAt?: string;
  ageMinutes?: number;
  reportedAt: string;
};

export type DeliveryDetail = DeliverySummary & { locations?: LocationReport[]; canCall?: boolean | null };

export function channelLabel(channel: string): string {
  return channel === 'SMS' ? 'SMS (no internet)' : channel === 'USSD' ? 'USSD' : 'OPA app';
}

/** One plain sentence: how far to trust who sent it. */
export function verificationNote(verification: string): string {
  switch (verification) {
    case 'SMS_SIGNED':
      return 'Verified: signed by the person’s registered phone.';
    case 'SMS_NUMBER_ONLY':
      return 'Not verified: from the registered number, without the phone’s signature. Confirm if you can.';
    case 'USSD_NUMBER':
      return 'From the registered number (reported by the mobile network). Not proof of identity: confirm if you can.';
    default:
      return 'Signed in to the OPA app.';
  }
}

export function locationReportLine(r: LocationReport): string {
  if (r.source === 'SAVED_PLACE')
    return `Saved place: ${r.label ?? 'unnamed'}${r.description ? ` (${r.description})` : ''}${r.latitude && r.longitude ? `, pin ${r.latitude}, ${r.longitude}` : ''}`;
  if (r.source === 'TYPED_LANDMARK') return `Typed landmark, not verified: ${r.landmark ?? ''}`;
  if (r.source === 'LAST_APP_FIX')
    return `Last app position${typeof r.ageMinutes === 'number' ? `, ${r.ageMinutes} min old` : ''}: ${r.latitude}, ${r.longitude}`;
  return 'Location reported';
}

/** Emergency assurance: who among the alerted contacts confirmed, by relationship only. */
export interface AssuranceDetail {
  contactsAlerted: number;
  contactsConfirmed: { relationship: string; at: string; via: string }[];
  remindersSent: number;
  callsPlaced: number;
  securityEscalatedAt: string | null;
  facilityAdminsAlerted: number;
}

export function assuranceSummary(a: AssuranceDetail): string {
  if (!a.contactsAlerted) return "No emergency contacts were texted.";
  const n = a.contactsConfirmed.length;
  if (n === 0) {
    const steps = [a.remindersSent ? "reminder sent" : "", a.callsPlaced ? `${a.callsPlaced} call${a.callsPlaced === 1 ? "" : "s"} placed` : ""].filter(Boolean).join(", ");
    return `No contact has confirmed seeing the alert yet (${a.contactsAlerted} texted${steps ? `; ${steps}` : ""}).`;
  }
  return `${n} of ${a.contactsAlerted} contacts confirmed seeing the alert.`;
}
