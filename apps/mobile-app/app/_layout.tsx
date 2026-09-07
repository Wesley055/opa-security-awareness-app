import { Stack, useRouter, useSegments } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { useEffect, useRef } from 'react';
import { useAuthStore } from '../src/store/authStore';
import { stopTracking } from '../src/services/journey-tracker';
import {
  ensureVoiceProtectionMicrophonePermission,
  processVoiceTrigger,
  startVoiceProtection,
  stopVoiceProtection,
} from '../src/services/voice-protection-service';
import {
  processOpaProtectionTrigger,
} from '../src/services/opa-protection-trigger-processor';
import {
  processSosTrigger,
} from '../src/services/sos-protection-service';
import {
  getVoiceProtectionConfig,
  isVoiceProtectionReady,
} from '../src/services/voice-protection-config';
import {
  acknowledgeClaimedOpaProtectionTrigger,
  addOpaVoiceTriggerListener,
  claimPendingOpaProtectionTrigger,
  configureOpaVoiceProvider,
  releasePendingOpaProtectionTrigger,
  startOpaProtectionService,
  stopOpaProtectionService,
} from '../modules/opa-protection';
import {
  ensureProtectionNotificationPermission,
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
      return;
    }

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

  /*
   * OPA's native protection service is owned by the authenticated OPA
   * lifecycle. It is provider-neutral: Picovoice remains a separate voice
   * provider and does not own this Android foreground-service boundary.
   *
   * Deliberately no React cleanup callback: component/activity teardown must
   * not stop native protection. The service stops when authenticated OPA
   * protection state ends, not merely because the React lifecycle changes.
   */
  useEffect(() => {
    if (isLoading || Platform.OS !== 'android') {
      return;
    }

    if (!isAuthenticated) {
      void (async () => {
        /*
         * Clean both ownership boundaries on logout. The JS stop also handles
         * a legacy owner that survived an upgrade or development reload.
         */
        await stopVoiceProtection();
        await stopOpaProtectionService();
      })().catch((error: unknown) => {
        console.log(
          '[opa-protection] authenticated shutdown failed',
          error,
        );
      });

      return;
    }

    const config = getVoiceProtectionConfig();

    void (async () => {
      /*
       * Android microphone ownership order is load-bearing:
       *
       * 1. release legacy JS VoiceProcessor ownership
       * 2. obtain RECORD_AUDIO while the app is eligible
       * 3. persist native provider configuration
       * 4. start OPA Protection Service
       *
       * Never start native capture before step 1 completes.
       */
      await stopVoiceProtection();

      if (
        !isVoiceProtectionReady(config) ||
        config.accessKey === null
      ) {
        console.log(
          '[opa-protection] native voice configuration incomplete',
        );
        return;
      }

      const microphoneGranted =
        await ensureVoiceProtectionMicrophonePermission();

      if (!microphoneGranted) {
        console.log(
          '[opa-protection] microphone permission not granted',
        );
        return;
      }

      /*
       * Denial degrades notification visibility only. Protection continues.
       */
      await ensureProtectionNotificationPermission();

      await configureOpaVoiceProvider({
        enabled: true,
        provider: config.provider,
        accessKey: config.accessKey,
        keywordAssetName:
          'help-help_en_android_v4_0_0.ppn',
        phrase: config.phrase,
        sensitivity: config.sensitivity,
      });

      await startOpaProtectionService();
    })().catch((error: unknown) => {
      console.log(
        '[opa-protection] authenticated startup failed',
        error,
      );
    });
  }, [isAuthenticated, isLoading]);
  /*
   * Native voice detections use one durable provider-neutral consumer.
   *
   * Live native events and startup recovery share the same processing path.
   * A trigger is acknowledged only after a terminal application result.
   * RETRY leaves the durable native record intact.
   *
   * Removing this listener does not stop the Android protection service.
   */
  useEffect(() => {
    if (isLoading || !isAuthenticated) {
      return;
    }

    let active = true;

    /*
     * Native events are queue-change signals only.
     *
     * The native layer persists each trigger before emitting an event. JavaScript
     * therefore always consumes the durable FIFO head rather than processing the
     * event envelope directly. This prevents a newer trigger from overtaking an
     * older unacknowledged trigger.
     */
    let drainPromise: Promise<void> | null = null;

    const processPendingProtectionTrigger = async (
      event: Parameters<
        typeof processOpaProtectionTrigger
      >[0],
      acknowledge: (
        triggerId: string,
      ) => Promise<boolean>,
    ): Promise<'ACK' | 'RETRY'> => {
      try {
        return await processOpaProtectionTrigger(
          event,
          {
            processVoiceTrigger,
            processSosTrigger,
            acknowledge,
          },
        );
      } catch (error: unknown) {
        /*
         * Preserve native durability on unexpected processing or bridge
         * failures.
         */
        console.log(
          '[opa-protection] native trigger processing failed',
          error,
        );

        return 'RETRY';
      }
    };
    let drainRequested = false;
    let retryBlocked = false;

    const startPendingVoiceTriggerDrain =
      (): Promise<void> => {
        if (drainPromise !== null) {
          return drainPromise;
        }

        retryBlocked = false;

        const currentDrain = (async () => {
          try {
            while (active) {
              drainRequested = false;

              while (active) {
                const claim =
                  await claimPendingOpaProtectionTrigger(
                    'foreground-react',
                  );

                if (!active) {
                  if (claim !== null) {
                    await releasePendingOpaProtectionTrigger(
                      claim.id,
                      claim.claimToken,
                    );
                  }

                  return;
                }

                if (claim === null) {
                  break;
                }

                const disposition =
                  await processPendingProtectionTrigger(
                    claim,
                    (triggerId) =>
                      acknowledgeClaimedOpaProtectionTrigger(
                        triggerId,
                        claim.claimToken,
                      ),
                  );

                if (disposition === 'RETRY') {
                  const released =
                    await releasePendingOpaProtectionTrigger(
                      claim.id,
                      claim.claimToken,
                    );

                  if (!released) {
                    console.log(
                      '[opa-protection] native trigger claim release failed',
                    );
                  }

                  retryBlocked = true;
                  return;
                }
              }

              if (!drainRequested) {
                return;
              }
            }
          } catch (error: unknown) {
            retryBlocked = true;

            console.log(
              '[opa-protection] pending native trigger drain failed',
              error,
            );
          }
        })();

        drainPromise = currentDrain;

        void currentDrain.finally(() => {
          if (drainPromise !== currentDrain) {
            return;
          }

          drainPromise = null;

          if (
            active &&
            drainRequested &&
            !retryBlocked
          ) {
            void startPendingVoiceTriggerDrain();
          }
        });

        return currentDrain;
      };

    const requestPendingVoiceTriggerDrain = () => {
      if (!active) {
        return;
      }

      drainRequested = true;

      if (drainPromise === null) {
        void startPendingVoiceTriggerDrain();
      }
    };

    /*
     * Listener is installed before the initial durable drain. Native events
     * are wake signals only; the persisted FIFO remains the source of truth.
     */
    const subscription =
      addOpaVoiceTriggerListener(() => {
        requestPendingVoiceTriggerDrain();
      });

    requestPendingVoiceTriggerDrain();

    return () => {
      active = false;
      subscription.remove();
    };
  }, [isAuthenticated, isLoading]);

  /*
   * Voice protection is owned by the authenticated app lifecycle.
   * Provider/native details remain isolated behind the service boundary.
   */
  /*
   * Android microphone ownership belongs exclusively to OPA Protection
   * Service. The JavaScript provider remains available behind the existing
   * provider boundary for non-Android/future fallback use.
   */
  useEffect(() => {
    if (isLoading || Platform.OS === 'android') {
      return;
    }

    if (!isAuthenticated) {
      void stopVoiceProtection();
      return;
    }

    void startVoiceProtection().catch((error: unknown) => {
      console.log(
        '[voice-protection] authenticated startup failed',
        error,
      );
    });

    return () => {
      void stopVoiceProtection();
    };
  }, [isAuthenticated, isLoading]);
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)/login" />
      <Stack.Screen name="index" />
    </Stack>
  );
}
