import { useSafeWalk } from '../src/services/safewalk';
import { Alert } from 'react-native';
import { startSafeWalkReconciliation } from '../src/services/safewalk';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';
import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../src/store/authStore';
import { startActiveIncidentReconciliation } from '../src/services/active-incident-reconciliation';
import { startTracking, stopTracking } from '../src/services/journey-tracker';
import {
  ensureVoiceProtectionMicrophonePermission,
  startVoiceProtection,
  stopVoiceProtection,
} from '../src/services/voice-protection-service';
import {
  getVoiceProtectionConfig,
  isVoiceProtectionReady,
} from '../src/services/voice-protection-config';
import {
  addOpaVoiceTriggerListener,
  configureOpaVoiceProvider,
  startOpaProtectionService,
  stopOpaProtectionService,
} from '../modules/opa-protection';
import {
  ensureProtectionNotificationPermission,
  isLockScreenSosResponse,
} from '../src/services/lock-screen-sos';

import { runHeadlessProtectionWorker } from '../src/services/headless-sos-worker';
import { isForegroundExecutionAllowed } from '../src/services/foreground-execution';
import { useActiveIncidentStore } from '../src/store/activeIncidentStore';

export default function RootLayout() {
  const { isAuthenticated, isLoading, checkAuth } = useAuthStore();
  const [appState, setAppState] = useState(AppState.currentState);
  const activeIncident = useActiveIncidentStore(state => state.activeIncident);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    return () => subscription.remove();
  }, []);
  const segments = useSegments();
  const router = useRouter();

  /*
   * A notification action may arrive before auth hydration finishes on a
   * cold start. Remember only that an OPA SOS action is pending; routing is
   * allowed only after the authenticated state is known.
   */
  const pendingLockScreenSosRef = useRef(false);
  const safeWalkJourney = useSafeWalk(state => state.journey);
  const lastSafeWalkPrompt = useRef<string | null>(null);
  useEffect(() => {
    if (!isAuthenticated) { lastSafeWalkPrompt.current = null; return; }
    if (appState !== 'active' || safeWalkJourney?.safeWalkEscalation?.state !== 'CHECK_REQUIRED' || lastSafeWalkPrompt.current === safeWalkJourney.id) return;
    lastSafeWalkPrompt.current = safeWalkJourney.id;
    Alert.alert('SafeWalk safety check', 'Your expected arrival has passed. Open SafeWalk to confirm your safety.', [{ text: 'Open SafeWalk', onPress: () => router.push('/safewalk') }]);
  }, [isAuthenticated, appState, safeWalkJourney?.id, safeWalkJourney?.safeWalkEscalation?.state, router]);

  useEffect(() => startActiveIncidentReconciliation(), []);
  useEffect(() => startSafeWalkReconciliation(), []);

  useEffect(() => {
    void checkAuth();
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

    if (!isForegroundExecutionAllowed()) return;

    if (pendingLockScreenSosRef.current) {
      pendingLockScreenSosRef.current = false;

      if (segments[0] !== 'sos') {
        router.push('/sos');
      }
    }
  }, [isAuthenticated, isLoading, router, segments, appState]);

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (isAuthenticated && inAuthGroup) {
      router.replace('/');
    }
  }, [isAuthenticated, isLoading, segments]);

  // Tracking starts only after activation in an eligible foreground lifecycle.
  // Logout still tears it down; auth hydration must never stop existing capture.
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
   * Cleanup cancels only pending setup, never native protection. The service stops when authenticated OPA
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

    if (!isForegroundExecutionAllowed()) return;
    let alive = true;
    const eligible = () => alive && isForegroundExecutionAllowed();
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
      if (!eligible()) return;

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
      if (!eligible()) return;
      await ensureProtectionNotificationPermission();
      if (!eligible()) return;

      await configureOpaVoiceProvider({
        enabled: true,
        provider: config.provider,
        accessKey: config.accessKey,
        keywordAssetName:
          'help-help_en_android_v4_0_0.ppn',
        phrase: config.phrase,
        sensitivity: config.sensitivity,
      });

      if (eligible()) await startOpaProtectionService();
    })().catch((error: unknown) => {
      console.log(
        '[opa-protection] authenticated startup failed',
        error,
      );
    });
    return () => { alive = false; };
  }, [isAuthenticated, isLoading, appState]);
  /* React and HeadlessJS claim the same native FIFO through one worker.
   * Consumer identity never grants interactive execution: actual lifecycle does.
   * Auth/routing/MainActivity are not prerequisites for a native headless wake. */
  useEffect(() => {
    if (isLoading || !isAuthenticated || Platform.OS !== 'android') return;
    const subscription = addOpaVoiceTriggerListener(() => {
      void runHeadlessProtectionWorker('foreground-react');
    });
    void runHeadlessProtectionWorker('foreground-react');
    return () => subscription.remove();
  }, [isAuthenticated, isLoading, appState]);

  // Activation and exact ACK finish independently of foreground tracking.
  useEffect(() => {
    if (isLoading || !isAuthenticated || !activeIncident || !isForegroundExecutionAllowed()) return;
    void startTracking().catch(() => {
      console.log('[opa-protection] foreground tracking unavailable');
    });
  }, [isAuthenticated, isLoading, activeIncident?.id, appState]);

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
      <Stack.Screen name="sos" options={{ animation: 'none' }} />
    </Stack>
  );
}
