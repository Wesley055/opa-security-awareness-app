import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  BackHandler,
} from 'react-native';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { api } from '../src/services/api';

const COUNTDOWN_SECONDS = 5;

type ScreenState = 'countdown' | 'activating' | 'activated' | 'error';

interface ActivationResult {
  status: string;
  contactsNotified?: number;
  incident?: { id: string } | null;
}

export default function SosScreen() {
  const [screenState, setScreenState] = useState<ScreenState>('countdown');
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ActivationResult | null>(null);

  const locationRef = useRef<{ latitude: number; longitude: number; accuracy: number | null } | null>(null);
  const cancelledRef = useRef(false);

  // Start fetching location immediately, in parallel with the countdown,
  // so it's already available the moment the countdown completes —
  // avoids adding location-fetch latency on top of the confirmation delay.
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setErrorMessage('Location permission is required to activate an SOS.');
          setScreenState('error');
          return;
        }
        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        locationRef.current = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        };
      } catch {
        setErrorMessage('Could not get your location. Check that location services are enabled.');
        setScreenState('error');
      }
    })();
  }, []);

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
    setScreenState('activating');

    if (!locationRef.current) {
      setErrorMessage('Location was not available in time. Please try again.');
      setScreenState('error');
      return;
    }

    try {
      const { data } = await api.post('/incident-orchestrator/activate', {
        triggerType: 'SOS_BUTTON',
        mode: 'CONFIRMATION',
        userConfirmed: true,
        latitude: locationRef.current.latitude,
        longitude: locationRef.current.longitude,
        accuracy: locationRef.current.accuracy ?? undefined,
      });

      setResult(data);
      setScreenState('activated');
    } catch (err: unknown) {
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

  const handleCancel = () => {
    // Cancelling during the countdown never calls the API — the
    // backend's own design treats a rejected/cancelled trigger as
    // something that should leave no trace, so there's nothing to
    // record here either.
    cancelledRef.current = true;
    router.back();
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
        <TouchableOpacity
          style={styles.retryButton}
          onPress={() => {
            setErrorMessage(null);
            setSecondsLeft(COUNTDOWN_SECONDS);
            setScreenState('countdown');
          }}
        >
          <Text style={styles.retryButtonText}>Try Again</Text>
        </TouchableOpacity>
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
        {result?.contactsNotified ?? 0} contact{result?.contactsNotified === 1 ? '' : 's'} notified
      </Text>
      {result?.incident?.id ? (
        <Text style={styles.incidentId}>Incident ID: {result.incident.id}</Text>
      ) : null}
      <TouchableOpacity style={styles.doneButton} onPress={() => router.replace('/')}>
        <Text style={styles.doneButtonText}>Done</Text>
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
});