export interface SosActivationMessageInput {
  status: string;
  notifications?: { queued: number; dispatched: boolean };
}

export interface SosActivationMessage {
  detail: string;
  warning: string | null;
}

export function getSosActivationMessage(
  result: SosActivationMessageInput | null | undefined,
): SosActivationMessage {
  if (!result) {
    return {
      detail: 'Emergency activated',
      warning: null,
    };
  }

  const isRetrigger = result.status === 'INCIDENT_RETRIGGERED';

  return {
    detail: isRetrigger
      ? 'Your existing emergency alert remains active'
      : 'Emergency activated',
    warning:
      !isRetrigger && result.notifications?.queued === 0
        ? 'No emergency-contact alerts were queued. Add an emergency contact so someone can be notified. Your SOS is active and location tracking continues.'
        : null,
  };
}