import { Stack, useRouter, useSegments } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';
import { useAuthStore } from '../src/store/authStore';
import { stopTracking } from '../src/services/journey-tracker';
import {
  dismissProtectionReadyNotification,
  ensureProtectionReadyNotification,
  isLockScreenSosResponse,
} from '../src/services/lock-screen-sos';

export default function RootLayout() {
  const { isAuthenticated, isLoading, checkAuth } = useAuthStore();
  const segments = useSegments();
  const router = useRouter();

  /*
   * A notification action may arrive before auth hydration finishes on a
   * cold start. Remember only that an OPA SOS action is pending; routing is
   * allowed only after the authenticated state is known.
   */
  const pendingLockScreenSosRef = useRef(false);

  useEffect(() => {
    checkAuth();
  }, []);

  /*
   * Lock-screen emergency entry point.
   *
   * Listener handles warm/background launches.
   * getLastNotificationResponseAsync handles a cold process start.
   *
   * Neither path activates an incident directly. They route into /sos so
   * there remains exactly one activation implementation.
   */
  useEffect(() => {
    let alive = true;

    const rememberResponse = (
      response: Notifications.NotificationResponse | null,
    ): void => {
      if (
        alive &&
        response !== null &&
        isLockScreenSosResponse(response)
      ) {
        pendingLockScreenSosRef.current = true;
      }
    };

    const subscription =
      Notifications.addNotificationResponseReceivedListener(
        rememberResponse,
      );

    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        rememberResponse(response);
      })
      .catch((error: unknown) => {
        console.log(
          '[lock-screen-sos] could not read last notification response',
          error,
        );
      });

    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);

  /*
   * Auth hydration is load-bearing here. Never route an emergency action
   * through an unauthenticated/cold-start state.
   */
  useEffect(() => {
    if (isLoading) {
      return;
    }

    if (!isAuthenticated) {
      pendingLockScreenSosRef.current = false;
      void dismissProtectionReadyNotification();
      return;
    }

    void ensureProtectionReadyNotification();

    if (pendingLockScreenSosRef.current) {
      pendingLockScreenSosRef.current = false;

      if (segments[0] !== 'sos') {
        router.push('/sos');
      }
    }
  }, [isAuthenticated, isLoading, router, segments]);

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (isAuthenticated && inAuthGroup) {
      router.replace('/');
    }
  }, [isAuthenticated, isLoading, segments]);

  // ADR-010 Decision 3: the tracker is STARTED from app/sos.tsx after a
  // successful activation. This layout only ever stops it, and keying on
  // isAuthenticated covers forceLogout for free.
  //
  // THE isLoading GUARD IS LOAD-BEARING. This comment used to say the
  // false-on-cold-start pass was harmless because stopTracking is
  // idempotent. THAT WAS TRUE AND IS NOT ANY MORE: stopTracking now calls
  // stopBackgroundCapture, which DELETES the SecureStore session key and
  // UNREGISTERS the OS location task - and it does so UNCONDITIONALLY,
  // because TaskManager and SecureStore survive JS-context restarts so a
  // stale task can exist with no local module state to detect it.
  //
  // Without this guard, every cold start during an ACTIVE emergency would
  // tear down background capture before auth hydration finishes, and every
  // later fix would be discarded with 'no active session'. Silent, and
  // indistinguishable from background capture never having worked.
  //
  //   isLoading true                  -> do nothing, hydration in progress
  //   false + not authenticated       -> stop, and clean stale OS state
  //   false + authenticated           -> leave active tracking alone
  //
  // isLoading is in the dependency array so the effect re-runs when
  // hydration completes and a genuine logout still tears down.
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      void stopTracking();
    }
  }, [isAuthenticated, isLoading]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)/login" />
      <Stack.Screen name="index" />
    </Stack>
  );
}