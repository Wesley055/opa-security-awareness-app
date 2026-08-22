import * as Notifications from 'expo-notifications';

export const OPA_PROTECTION_CHANNEL = 'opa-protection';
export const OPA_PROTECTION_CATEGORY = 'opa-protection-ready';
export const OPA_TRIGGER_SOS_ACTION = 'OPA_TRIGGER_SOS';

const OPA_NOTIFICATION_KIND = 'opa-protection-ready';

function isOpaProtectionNotification(
  notification: Notifications.Notification,
): boolean {
  return (
    notification.request.content.data?.opaKind ===
    OPA_NOTIFICATION_KIND
  );
}

/**
 * Registers the Android channel and action category used by the lock-screen
 * emergency entry point.
 *
 * This does NOT activate an incident. The action only routes into the existing
 * /sos flow, which remains the single owner of location acquisition,
 * confirmation, activation and startTracking().
 */
export async function configureLockScreenSos(): Promise<void> {
  await Notifications.setNotificationCategoryAsync(
    OPA_PROTECTION_CATEGORY,
    [
      {
        identifier: OPA_TRIGGER_SOS_ACTION,
        buttonTitle: 'SOS',
        options: {
          opensAppToForeground: true,
        },
      },
    ],
  );

  await Notifications.setNotificationChannelAsync(
    OPA_PROTECTION_CHANNEL,
    {
      name: 'OPA Protection',
      importance: Notifications.AndroidImportance.MAX,
      lockscreenVisibility:
        Notifications.AndroidNotificationVisibility.PUBLIC,
    },
  );
}

/**
 * Ensures at most one OPA Protection Ready notification is presented.
 *
 * Android 13+ requires notification permission. We request it only after the
 * authenticated application has finished hydrating.
 */
export async function ensureProtectionReadyNotification(): Promise<void> {
  const current = await Notifications.getPermissionsAsync();

  let granted =
    current.granted ||
    current.ios?.status ===
      Notifications.IosAuthorizationStatus.PROVISIONAL;

  if (!granted) {
    const requested = await Notifications.requestPermissionsAsync();

    granted =
      requested.granted ||
      requested.ios?.status ===
        Notifications.IosAuthorizationStatus.PROVISIONAL;
  }

  if (!granted) {
    console.log(
      '[lock-screen-sos] notification permission not granted',
    );
    return;
  }

  await configureLockScreenSos();

  const presented =
    await Notifications.getPresentedNotificationsAsync();

  if (presented.some(isOpaProtectionNotification)) {
    return;
  }

  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'OPA Protection Ready',
      body: 'Tap SOS to start an emergency alert.',
      data: {
        opaKind: OPA_NOTIFICATION_KIND,
      },
      categoryIdentifier: OPA_PROTECTION_CATEGORY,
      sticky: true,
      autoDismiss: false,
      priority: Notifications.AndroidNotificationPriority.MAX,
    },
    trigger: null,
  });
}

/**
 * Removes only OPA's pre-SOS protection notification.
 *
 * The emergency location foreground-service notification is owned by
 * expo-location and is intentionally untouched.
 */
export async function dismissProtectionReadyNotification(): Promise<void> {
  const presented =
    await Notifications.getPresentedNotificationsAsync();

  const ids = presented
    .filter(isOpaProtectionNotification)
    .map((notification) => notification.request.identifier);

  await Promise.all(
    ids.map((identifier) =>
      Notifications.dismissNotificationAsync(identifier),
    ),
  );
}

export function isLockScreenSosResponse(
  response: Notifications.NotificationResponse,
): boolean {
  return (
    response.actionIdentifier === OPA_TRIGGER_SOS_ACTION &&
    response.notification.request.content.data?.opaKind ===
      OPA_NOTIFICATION_KIND
  );
}