import { getSosActivationMode, setSosActivationMode, SILENT_SOS_NOTICE } from '../src/services/silent-sos';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Switch,
  ScrollView,
  Platform,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { useAuthStore } from '../src/store/authStore';
import { useActiveIncidentStore } from '../src/store/activeIncidentStore';
import { homeEmergencyAction } from '../src/services/active-incident-ui-policy';

export default function HomeScreen() {
  const { user, isLoading, isAuthenticated, logout } = useAuthStore();

  const activeIncident = useActiveIncidentStore(
    (state) => state.activeIncident,
  );

  const [sosMode, setSosMode] = useState(getSosActivationMode);
  const [modeSaving, setModeSaving] = useState(false);
  const [modeError, setModeError] = useState<string | null>(null);
  const changeMode = async (enabled: boolean) => {
    if (modeSaving) return;
    setModeSaving(true);
    setModeError(null);
    try {
      const mode = enabled ? 'SILENT' : 'STANDARD';
      await setSosActivationMode(mode);
      setSosMode(mode);
    } catch { setModeError('Could not save Silent SOS. Your previous setting remains in effect.'); }
    finally { setModeSaving(false); }
  };

  const emergencyAction = homeEmergencyAction(activeIncident);

  const [backgroundLocationGranted, setBackgroundLocationGranted] =
    useState<boolean | null>(null);

  const requestingBackgroundRef = useRef(false);

  useEffect(() => {
    if (isLoading || !isAuthenticated) {
      setBackgroundLocationGranted(null);
      return;
    }

    let cancelled = false;

    void Location.getBackgroundPermissionsAsync()
      .then((permission) => {
        if (!cancelled) {
          setBackgroundLocationGranted(permission.granted);
        }
      })
      .catch((error: unknown) => {
        console.log(
          '[background-location] permission state read failed',
          error,
        );

        if (!cancelled) {
          setBackgroundLocationGranted(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, isLoading]);

  const requestBackgroundLocation = (): void => {
    if (requestingBackgroundRef.current) return;

    Alert.alert(
      'Background location for emergency safety',
      'OPA uses your location during an active emergency so your emergency contacts can receive continuing location updates even when the app is not on screen or your phone is locked. Background location is used for active emergency safety tracking. You can continue using SOS if you do not allow this permission, but location updates may be limited while OPA is in the background.',
      [
        {
          text: 'Not now',
          style: 'cancel',
        },
        {
          text: 'Continue',
          onPress: () => {
            if (requestingBackgroundRef.current) return;

            requestingBackgroundRef.current = true;

            void (async () => {
              try {
                const foreground =
                  await Location.getForegroundPermissionsAsync();

                if (!foreground.granted) {
                  Alert.alert(
                    'Location permission needed',
                    'Enable location for OPA first. Background safety tracking can then be enabled from this screen.',
                  );
                  return;
                }

                const background =
                  await Location.requestBackgroundPermissionsAsync();

                setBackgroundLocationGranted(background.granted);

                if (!background.granted) {
                  Alert.alert(
                    'Background location not enabled',
                    'OPA will continue to allow SOS. Location tracking will fall back to the available foreground tracking while background location is not permitted.',
                  );
                }
              } catch (error: unknown) {
                console.log(
                  '[background-location] permission request failed',
                  error,
                );

                Alert.alert(
                  'Could not enable background location',
                  'OPA will continue to allow SOS using the location access currently available.',
                );
              } finally {
                requestingBackgroundRef.current = false;
              }
            })();
          },
        },
      ],
    );
  };

  if (isLoading) {
    return (
      <View style={styles.container}>

        <Text style={styles.text}>Loading...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: '#08111A' }} contentContainerStyle={[styles.container, { flex: 0, flexGrow: 1, paddingVertical: 24 }]}>
      <Text style={styles.logo}>OPA</Text>
      <TouchableOpacity touchSoundDisabled={sosMode === 'SILENT'} accessibilityRole="button" onPress={() => router.push('/safewalk')} style={{ padding: 16 }}><Text style={{ color: '#fff', fontSize: 18 }}>SafeWalk · Private journey</Text></TouchableOpacity>

      <Text style={styles.welcome}>
        Welcome, {user?.firstName ?? 'there'}
      </Text>

      {emergencyAction === 'OPEN_ACTIVE_INCIDENT' ? (
        <>
          <TouchableOpacity touchSoundDisabled={sosMode === 'SILENT'}
            style={[styles.activeIncidentButton, activeIncident?.activationMode === 'SILENT' && { backgroundColor: '#232E36', paddingVertical: 12 }]}
            onPress={() => router.push('/sos')}
            activeOpacity={0.85}
          >
            <Text style={[styles.activeIncidentButtonTitle, activeIncident?.activationMode === 'SILENT' && { fontSize: 16, fontWeight: '500' }]}>
              {activeIncident?.activationMode === 'SILENT' ? 'Safety controls' : 'Emergency Active'}
            </Text>

            <Text style={styles.activeIncidentButtonText}>
              Open emergency details
            </Text>
          </TouchableOpacity>

          <Text style={styles.sosHint}>
            Your location may still be shared until the emergency is ended.
          </Text>
        </>
      ) : (
        <>
          <TouchableOpacity touchSoundDisabled={sosMode === 'SILENT'}
            style={styles.sosButton}
            onPress={() => router.push('/sos')}
            activeOpacity={0.85}
          >
            <Text style={styles.sosButtonText}>SOS</Text>
          </TouchableOpacity>

          <Text style={styles.sosHint}>
            Tap to activate an emergency
          </Text>
        </>
      )}

      {Platform.OS === 'android' ? <View style={{ padding: 12 }}>
        <Text style={styles.text}>Silent SOS · this device</Text>
        <Switch accessibilityLabel="Silent SOS" value={sosMode === 'SILENT'} disabled={modeSaving || !!activeIncident} onValueChange={(enabled) => void changeMode(enabled)} />
        <Text style={styles.sosHint}>{SILENT_SOS_NOTICE}</Text>
        {modeError ? <Text style={styles.sosHint}>{modeError}</Text> : null}
      </View> : null}

      <View style={styles.secondaryActions}>
        {backgroundLocationGranted === false ? (
          <TouchableOpacity touchSoundDisabled={sosMode === 'SILENT'}
            style={styles.backgroundLocationButton}
            onPress={requestBackgroundLocation}
          >
            <Text style={styles.backgroundLocationButtonTitle}>
              Enable background safety tracking
            </Text>

            <Text style={styles.backgroundLocationButtonText}>
              Helps OPA continue location updates during an active emergency
              when the app is not on screen.
            </Text>
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity touchSoundDisabled={sosMode === 'SILENT'}
          style={styles.contactsButton}
          onPress={() => router.push('/contacts')}
        >
          <Text style={styles.contactsButtonText}>
            Emergency Contacts
          </Text>
        </TouchableOpacity>

        <TouchableOpacity touchSoundDisabled={sosMode === 'SILENT'}
          style={styles.button}
          onPress={() => { void logout(); }}
        >
          <Text style={styles.buttonText}>
            Log out
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#08111A',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  text: {
    color: '#FFFFFF',
    fontSize: 16,
  },
  logo: {
    fontSize: 40,
    fontWeight: '900',
    color: '#17C964',
    marginBottom: 8,
  },
  welcome: {
    fontSize: 18,
    color: '#FFFFFF',
    marginBottom: 48,
  },
  sosButton: {
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: '#FF5A36',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#FF5A36',
    shadowOpacity: 0.4,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  activeIncidentButton: {
    width: '100%',
    backgroundColor: '#FF5A36',
    borderRadius: 12,
    paddingVertical: 20,
    paddingHorizontal: 18,
    alignItems: 'center',
  },
  activeIncidentButtonTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '900',
  },
  activeIncidentButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    marginTop: 6,
  },
  sosButtonText: {
    color: '#FFFFFF',
    fontSize: 36,
    fontWeight: '900',
    letterSpacing: 2,
  },
  sosHint: {
    color: '#8B949E',
    fontSize: 13,
    marginTop: 16,
    marginBottom: 48,
  },
  secondaryActions: {
    width: '100%',
    gap: 12,
  },
  backgroundLocationButton: {
    backgroundColor: '#17212B',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  backgroundLocationButtonTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  backgroundLocationButtonText: {
    color: '#AAB6C2',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },
  button: {
    backgroundColor: '#232E36',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  contactsButton: {
    backgroundColor: '#17C964',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  contactsButtonText: {
    color: '#08111A',
    fontWeight: '700',
  },
});
