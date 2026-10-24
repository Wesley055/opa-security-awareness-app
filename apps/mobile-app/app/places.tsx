import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import * as Location from 'expo-location';
import { api } from '../src/services/api';
import { FormScreen, P } from '../src/components/FormScreen';

interface Place {
  label: string;
  description: string;
  latitude: number | null;
  longitude: number | null;
}

const EMPTY: Place = { label: '', description: '', latitude: null, longitude: null };

/**
 * Saved places (emergency delivery, release 48). Offered on the USSD SOS
 * menu ("1 Home"), so a person on any phone can say where they are with one
 * key. A pin is optional and is shown to responders as a saved place, never
 * as live GPS.
 */
export default function PlacesScreen() {
  const [places, setPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      api
        .get<{ places: (Place & { description: string | null })[] }>('/emergency-delivery/saved-places')
        .then(({ data }) => alive && setPlaces(data.places.map((p) => ({ ...p, description: p.description ?? '' }))))
        .catch(() => alive && Alert.alert('Saved places', 'Could not load your saved places.'))
        .finally(() => alive && setLoading(false));
      return () => {
        alive = false;
      };
    }, []),
  );

  const update = (i: number, change: Partial<Place>) => setPlaces((list) => list.map((p, j) => (j === i ? { ...p, ...change } : p)));

  const pinHere = async (i: number) => {
    setLocating(i);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Location', 'Allow location to save where you are now.');
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      update(i, { latitude: Number(position.coords.latitude.toFixed(6)), longitude: Number(position.coords.longitude.toFixed(6)) });
    } catch {
      Alert.alert('Location', 'Could not get your location. Try again outside or near a window.');
    } finally {
      setLocating(null);
    }
  };

  const save = async () => {
    const cleaned = places.filter((p) => p.label.trim());
    setSaving(true);
    try {
      await api.put('/emergency-delivery/saved-places', {
        places: cleaned.map((p) => ({
          label: p.label.trim(),
          ...(p.description.trim() ? { description: p.description.trim() } : {}),
          ...(p.latitude !== null && p.longitude !== null ? { latitude: p.latitude, longitude: p.longitude } : {}),
        })),
      });
      Alert.alert('Saved places', 'Saved.', [{ text: 'OK', onPress: () => router.back() }]);
    } catch (error) {
      const message = (error as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
      Alert.alert('Saved places', Array.isArray(message) ? message.join('\n') : message ?? 'Could not save. Try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading)
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#17C964" />
      </View>
    );

  return (
    <FormScreen>
      <TouchableOpacity accessibilityRole="button" onPress={() => router.back()}>
        <Text style={styles.back}>Back</Text>
      </TouchableOpacity>
      <Text style={styles.title}>Saved places</Text>
      <P>
        Places you often are, like Home, Work or Farm. If you send an SOS by USSD (*code#), you can choose one with a
        single key so security knows where to go. Up to 4.
      </P>
      {places.map((p, i) => (
        <View key={i} style={styles.card}>
          <Text style={styles.label}>Name</Text>
          <TextInput style={styles.input} value={p.label} maxLength={24} placeholder="e.g. Home" placeholderTextColor="#64748B" onChangeText={(label) => update(i, { label })} />
          <Text style={styles.label}>How to find it</Text>
          <TextInput style={styles.input} value={p.description} maxLength={160} placeholder="e.g. Bk 30, behind the central mosque" placeholderTextColor="#64748B" onChangeText={(description) => update(i, { description })} />
          <TouchableOpacity accessibilityRole="button" style={styles.secondary} onPress={() => pinHere(i)} disabled={locating !== null}>
            <Text style={styles.secondaryText}>
              {locating === i ? 'Getting location...' : p.latitude !== null ? 'Pinned. Update to where I am now' : "I'm here, pin this place"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" onPress={() => setPlaces((list) => list.filter((_, j) => j !== i))}>
            <Text style={styles.remove}>Remove</Text>
          </TouchableOpacity>
        </View>
      ))}
      {places.length < 4 ? (
        <TouchableOpacity accessibilityRole="button" style={styles.secondary} onPress={() => setPlaces((list) => [...list, { ...EMPTY }])}>
          <Text style={styles.secondaryText}>Add a place</Text>
        </TouchableOpacity>
      ) : null}
      <TouchableOpacity accessibilityRole="button" style={styles.primary} onPress={save} disabled={saving}>
        <Text style={styles.primaryText}>{saving ? 'Saving...' : 'Save'}</Text>
      </TouchableOpacity>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: '#08111A', alignItems: 'center', justifyContent: 'center' },
  back: { color: '#17C964', paddingVertical: 12, fontSize: 16 },
  title: { color: '#FFFFFF', fontSize: 26, fontWeight: '700' },
  card: { borderWidth: 1, borderColor: '#1E293B', borderRadius: 10, padding: 14, gap: 8 },
  label: { color: '#CBD5E1', fontSize: 14 },
  input: { borderWidth: 1, borderColor: '#334155', borderRadius: 8, color: '#FFFFFF', paddingHorizontal: 12, minHeight: 48, fontSize: 16 },
  secondary: { borderWidth: 1, borderColor: '#334155', borderRadius: 8, padding: 14, alignItems: 'center' },
  secondaryText: { color: '#FFFFFF', fontSize: 16 },
  remove: { color: '#FF9C9C', paddingVertical: 8 },
  primary: { backgroundColor: '#17C964', borderRadius: 8, padding: 16, alignItems: 'center' },
  primaryText: { color: '#08111A', fontWeight: '700', fontSize: 16 },
});
