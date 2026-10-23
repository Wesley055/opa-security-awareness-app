import { api } from './api';

export async function setEmergencySmsPreference(
  contactId: string,
  receivesEmergencySms: boolean,
): Promise<void> {
  await api.patch(`/emergency-contacts/${contactId}`, {
    receivesEmergencySms,
  });
}
