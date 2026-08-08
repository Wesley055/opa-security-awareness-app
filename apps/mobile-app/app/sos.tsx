import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  BackHandler,
  Linking,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { api } from '../src/services/api';
import {
  startTracking,
  stopTracking,
  cleanNonNegative,
} from '../src/services/journey-tracker';

const COUNTDOWN_SECONDS = 5;
const LOCATION_TIMEOUT_MS = 15000;
const MAX_LOCATION_AGE_MS = 60000;

type ScreenState = 'countdown' | 'activating' | 'activated' | 'error';

interface ActivationResult {
  status: string;
  notifications?: { queued: number; dispatched: boolean };
  incident?: { id: string } | null;
}

interface FixedLocation {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  acquiredAt: number;
}

export default function SosScreen() {
  const [screenState, setScreenState] = useState<ScreenState>('countdown');
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ActivationResult | null>(null);
  // True when the OS will no longer show the permission dialog (Android
  // "don't ask again" after repeated denials). In this state "Try Again"
  // cannot recover - the user must enable location in Settings.
  const [permissionBlocked, setPermissionBlocked] = useState(false);
  // Set while a close request is in flight, so a second tap cannot fire a
  // duplicate PATCH. Also drives the button labels.
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const locationRef = useRef<FixedLocation | null>(null);
  const cancelledRef = useRef(false);
  const activatingRef = useRef(false);
  const locationPromiseRef = useRef<Promise<void> | null>(null);
  // Incremented on every retry. A location request tagged with an older
  // generation will not overwrite locationRef, so a late-resolving stale
  // request can't clobber a newer attempt.
  const locationGenRef = useRef(0);
  // True while this component is mounted. Guards against setState after
  // the user has left the screen mid-request.
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Acquire location. Reusable so it runs on mount AND on "Try Again".
  // Returns a promise the activation step can await, so a fast countdown
  // never fires before the location request has had a chance to resolve.
  const acquireLocation = useCallback(async (): Promise<void> => {
    const gen = locationGenRef.current;
    try {
      const { status, canAskAgain } = await Location.requestForegroundPermissionsAsync();
      if (gen !== locationGenRef.current || !mountedRef.current) return;
      if (status !== 'granted') {
        if (!canAskAgain) {
          // Android "don't ask again" - the dialog will never reappear,
          // so retrying is pointless. Direct the user to Settings.
          setPermissionBlocked(true);
          setErrorMessage(
            'Location permission is blocked. Please enable location for OPA in your device Settings to use SOS.',
          );
        } else {
          setPermissionBlocked(false);
          setErrorMessage('Location permission is required to activate an SOS.');
        }
        setScreenState('error');
        return;
      }
      // Race the location request against a timeout so a device that
      // never returns a fix fails cleanly instead of hanging forever.
      const position = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('location-timeout')), LOCATION_TIMEOUT_MS),
        ),
      ]);
      // Ignore a result from a superseded (older) request, or if unmounted.
      if (gen !== locationGenRef.current || !mountedRef.current) return;
      locationRef.current = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        acquiredAt: Date.now(),
      };
    } catch {
      if (gen !== locationGenRef.current || !mountedRef.current) return;
      setErrorMessage('Could not get your location. Check that location services are enabled.');
      setScreenState('error');
    }
  }, []);

  // Start fetching location immediately, in parallel with the countdown,
  // so it's already available the moment the countdown completes.
  useEffect(() => {
    locationPromiseRef.current = acquireLocation();
  }, [acquireLocation]);

  // Prevent the hardware back button from silently leaving this screen
  // mid-countdown without an explicit cancel.
  useEffect(() => {
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (screenState === 'countdown') {
        handleCancel();
        return true;
      }
      return false;
    });
    return () => handler.remove();
  }, [screenState]);

  const activate = useCallback(async () => {
    // Guard against a cancel that raced the countdown, and against
    // double-firing if activate is somehow invoked more than once.
    if (cancelledRef.current || activatingRef.current) {
      return;
    }
    activatingRef.current = true;
    setScreenState('activating');

    // If the location request is still in flight, wait for it rather
    // than immediately failing because the countdown won the race.
    if (!locationRef.current && locationPromiseRef.current) {
      await locationPromiseRef.current;
    }

    // Re-check cancellation / mount after any await.
    if (cancelledRef.current || !mountedRef.current) {
      activatingRef.current = false;
      return;
    }

    if (!locationRef.current) {
      setErrorMessage('Location was not available in time. Please try again.');
      setScreenState('error');
      activatingRef.current = false;
      return;
    }

    // If the fix is stale (activation was delayed), re-acquire before
    // sending, so we never dispatch an old GPS position.
    if (Date.now() - locationRef.current.acquiredAt > MAX_LOCATION_AGE_MS) {
      locationRef.current = null;
      locationGenRef.current += 1;
      locationPromiseRef.current = acquireLocation();
      await locationPromiseRef.current;
      if (cancelledRef.current || !mountedRef.current) {
        activatingRef.current = false;
        return;
      }
      if (!locationRef.current) {
        setErrorMessage('Could not refresh your location. Please try again.');
        setScreenState('error');
        activatingRef.current = false;
        return;
      }
    }

    try {
      const { data } = await api.post('/incident-orchestrator/activate', {
        triggerType: 'SOS_BUTTON',
        mode: 'CONFIRMATION',
        userConfirmed: true,
        latitude: locationRef.current.latitude,
        longitude: locationRef.current.longitude,
        accuracy: cleanNonNegative(locationRef.current.accuracy),
      });
      if (!mountedRef.current) return;
      setResult(data);
      setScreenState('activated');
      void startTracking();
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      const responseMessage =
        typeof err === 'object' && err !== null && 'response' in err
          ? (err as { response?: { data?: { message?: string | string[] } } }).response?.data
              ?.message
          : undefined;
      setErrorMessage(
        Array.isArray(responseMessage)
          ? responseMessage.join('\n')
          : responseMessage ?? 'Could not activate SOS. Check your connection and try again.',
      );
      setScreenState('error');
    } finally {
      activatingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (screenState !== 'countdown') return;
    if (secondsLeft <= 0) {
      activate();
      return;
    }
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [screenState, secondsLeft, activate]);

  /**
   * Ends the emergency. RESOLVED means the subject is safe; CANCELLED means
   * the activation was accidental.
   *
   * THE ORDER MATTERS. stopTracking() runs only AFTER the server has
   * accepted the close. If the request fails the tracker keeps running,
   * because the emergency is still open and the app must not stop sharing
   * location on the strength of a request that did not land.
   *
   * stopTracking() is idempotent and attempts a final best-effort flush;
   * fixes that never got a 2xx stay in SQLite and replay on the next start.
   * So no part of the record is lost by stopping here.
   */
  const closeIncident = useCallback(
    async (action: 'resolve' | 'cancel') => {
      const incidentId = result?.incident?.id;
      if (!incidentId || closing) return;

      setClosing(true);
      setCloseError(null);

      try {
        await api.patch(`/incidents/${incidentId}/${action}`, {
          reason: action === 'resolve' ? 'USER_SAFE' : 'FALSE_ALARM',
        });
        stopTracking();
        if (!mountedRef.current) return;
        router.replace('/');
      } catch (err: unknown) {
        const status =
          typeof err === 'object' && err !== null && 'response' in err
            ? (err as { response?: { status?: number } }).response?.status
            : undefined;

        // 409 is CONVERGENCE, not failure: the server is telling us the
        // incident is already terminal. The state the user wanted is the
        // state that exists, so stop tracking and leave as normal.
        if (status === 409) {
          stopTracking();
          if (!mountedRef.current) return;
          Alert.alert('Already ended', 'This emergency has already ended.', [
            { text: 'OK', onPress: () => router.replace('/') },
          ]);
          return;
        }

        if (!mountedRef.current) return;
        setCloseError(
          'Could not end the emergency. Your location is still being shared. Please try again.',
        );
      } finally {
        if (mountedRef.current) {
          setClosing(false);
        }
      }
    },
    [result, closing],
  );

  const confirmClose = (action: 'resolve' | 'cancel') => {
    const message =
      action === 'resolve'
        ? "Tell OPA you're safe? This ends the emergency and stops sharing your location."
        : 'Mark this as a false alarm? This ends the emergency and stops sharing your location.';

    Alert.alert(action === 'resolve' ? "I'm safe" : 'False alarm', message, [
      { text: 'Not yet', style: 'cancel' },
      {
        text: action === 'resolve' ? "I'm safe" : 'False alarm',
        style: 'destructive',
        onPress: () => void closeIncident(action),
      },
    ]);
  };

  const handleCancel = () => {
    // Cancelling during the countdown never calls the API - the
    // backend's own design treats a rejected/cancelled trigger as
    // something that should leave no trace, so there's nothing to
    // record here either.
    cancelledRef.current = true;
    router.back();
  };

  // "Try Again" resets state AND re-acquires location. The original bug
  // was that retry reset the countdown without re-fetching location, so
  // locationRef stayed null and every retry failed the same way.
  // Bumping the generation invalidates any still-pending prior request.
  const handleRetry = () => {
    cancelledRef.current = false;
    activatingRef.current = false;
    locationRef.current = null;
    locationGenRef.current += 1;
    setPermissionBlocked(false);
    setErrorMessage(null);
    setSecondsLeft(COUNTDOWN_SECONDS);
    setScreenState('countdown');
    locationPromiseRef.current = acquireLocation();
  };

  // When permission is permanently blocked, the only path forward is the
  // device Settings, where the user can re-enable location for OPA.
  const handleOpenSettings = () => {
    Linking.openSettings();
  };

  if (screenState === 'countdown') {
    return (
      <View style={styles.container}>
        <Text style={styles.countdownLabel}>Activating SOS in</Text>
        <Text style={styles.countdownNumber}>{secondsLeft}</Text>
        <Text style={styles.countdownSub}>
          Your emergency contacts will be notified with your location.
        </Text>
        <TouchableOpacity style={styles.cancelButton} onPress={handleCancel}>
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (screenState === 'activating') {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#FF5A36" />
        <Text style={styles.statusText}>Activating...</Text>
      </View>
    );
  }

  if (screenState === 'error') {
    return (
      <View style={styles.container}>
        <Text style={styles.errorTitle}>Something went wrong</Text>
        <Text style={styles.errorMessage}>{errorMessage}</Text>
        {permissionBlocked ? (
          <TouchableOpacity style={styles.retryButton} onPress={handleOpenSettings}>
            <Text style={styles.retryButtonText}>Open Settings</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
            <Text style={styles.retryButtonText}>Try Again</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backLink}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // activated
  return (
    <View style={styles.container}>
      <Text style={styles.activatedIcon}>OPA</Text>
      <Text style={styles.activatedTitle}>Emergency Activated</Text>
      <Text style={styles.activatedDetail}>
        {result?.notifications?.queued === undefined
          ? 'Emergency activated'
          : result.notifications.queued === 0
            ? 'Your existing emergency alert remains active'
            : `${result.notifications.queued} alert${result.notifications.queued === 1 ? '' : 's'} queued`}
      </Text>
      {result?.incident?.id ? (
        <Text style={styles.incidentId}>Incident ID: {result.incident.id}</Text>
      ) : null}

      {closeError ? <Text style={styles.closeError}>{closeError}</Text> : null}

      {/*
        Only rendered when there is an incident to close. A deduplicated
        re-trigger DOES return the incident, so these appear there too -
        which is the case that matters most, since that screen reads
        "your existing emergency alert remains active".
      */}
      {result?.incident?.id ? (
        <>
          <TouchableOpacity
            style={[styles.safeButton, closing && styles.buttonDisabled]}
            disabled={closing}
            onPress={() => confirmClose('resolve')}
          >
            <Text style={styles.safeButtonText}>
              {closing ? 'Ending...' : "I'm safe"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.falseAlarmButton, closing && styles.buttonDisabled]}
            disabled={closing}
            onPress={() => confirmClose('cancel')}
          >
            <Text style={styles.falseAlarmButtonText}>False alarm</Text>
          </TouchableOpacity>
        </>
      ) : null}

      {/*
        Done LEAVES THE EMERGENCY OPEN. It is not a way to end one - the two
        buttons above are. It was the green primary before this screen had
        any way to close an incident; it is now a text link, because the
        action that matters is "I'm safe" and three filled buttons would
        bury it. Kept because a user may want to put the phone down while
        the emergency continues.
      */}
      <TouchableOpacity onPress={() => router.replace('/')}>
        <Text style={styles.backLink}>Done - keep the emergency active</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#08111A',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  countdownLabel: {
    color: '#8B949E',
    fontSize: 16,
    marginBottom: 8,
  },
  countdownNumber: {
    color: '#FF5A36',
    fontSize: 96,
    fontWeight: '900',
    marginBottom: 16,
  },
  countdownSub: {
    color: '#C9D1D9',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 48,
  },
  cancelButton: {
    backgroundColor: '#232E36',
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 40,
  },
  cancelButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 16,
  },
  statusText: {
    color: '#FFFFFF',
    fontSize: 16,
    marginTop: 16,
  },
  errorTitle: {
    color: '#FF5A36',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 12,
  },
  errorMessage: {
    color: '#C9D1D9',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 32,
  },
  retryButton: {
    backgroundColor: '#17C964',
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 40,
    marginBottom: 16,
  },
  retryButtonText: {
    color: '#08111A',
    fontWeight: '700',
    fontSize: 16,
  },
  backLink: {
    color: '#8B949E',
    fontSize: 14,
    paddingVertical: 8,
    paddingHorizontal: 16,
    textAlign: 'center',
  },
  activatedIcon: {
    color: '#17C964',
    fontSize: 32,
    fontWeight: '900',
    marginBottom: 16,
  },
  activatedTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
  },
  activatedDetail: {
    color: '#C9D1D9',
    fontSize: 15,
    marginBottom: 4,
  },
  incidentId: {
    color: '#5B6B76',
    fontSize: 12,
    fontFamily: 'monospace',
    marginBottom: 32,
  },
  doneButton: {
    backgroundColor: '#17C964',
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 48,
    marginTop: 16,
  },
  doneButtonText: {
    color: '#08111A',
    fontWeight: '700',
    fontSize: 16,
  },
  // "I'm safe" is the primary action on this screen. It takes the green the
  // Done button used to carry.
  safeButton: {
    backgroundColor: '#17C964',
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 48,
    marginTop: 8,
    minWidth: 220,
    alignItems: 'center',
  },
  safeButtonText: {
    color: '#08111A',
    fontWeight: '700',
    fontSize: 16,
  },
  falseAlarmButton: {
    backgroundColor: '#232E36',
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 48,
    marginTop: 12,
    minWidth: 220,
    alignItems: 'center',
  },
  falseAlarmButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 16,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  // Uses the alert colour, not the muted one: this text says location is
  // STILL being shared, which the user needs to notice.
  closeError: {
    color: '#FF5A36',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
  },
});
