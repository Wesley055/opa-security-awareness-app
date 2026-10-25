import { useActiveIncidentStore } from '../src/store/activeIncidentStore';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { api } from '../src/services/api';
import { confirmSafeWalk, createSafeWalk, escalateSafeWalk, refreshSafeWalk, useSafeWalk, type DestinationKind, type SafeWalkStatus } from '../src/services/safewalk';
import { trackerDebugState } from '../src/services/journey-tracker';
import { FormScreen, P } from '../src/components/FormScreen';

interface Destination { kind: DestinationKind; label: string; latitude?: number; longitude?: number; placeId?: string; address?: string }
interface PlaceResult { placeId: string; name: string; address: string; latitude: number; longitude: number }
interface SavedPlace { label: string; latitude: number | null; longitude: number | null }
interface SafeWalkContact { contactId: string; name: string; relationship: string; safeWalk: 'NOT_ASKED' | 'WAITING' | 'READY' | 'DECLINED' | 'NUMBER_CHANGED' }

export const DURATIONS = [15, 30, 60, 120] as const;
const MAX_CONTACTS = 5;

/** People-first wording for every failure; never a raw status code. */
export function friendlyError(error: unknown, fallback: string): string {
  const response = (error as { response?: { status?: number; data?: { message?: string | string[] } } }).response;
  if (response?.status === 503) return "SafeWalk isn't available yet. Your journey was not started.";
  const message = response?.data?.message;
  // Only conflict, limit and "can't text this number" messages are written for people.
  if (typeof message === 'string' && [409, 422, 429].includes(response?.status ?? 0)) return message;
  if (!response) return 'No internet connection. Check your connection and try again.';
  return fallback;
}

export function minutesAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return 'No location received yet';
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  return minutes === 0 ? 'Location updated just now' : minutes === 1 ? 'Location updated 1 min ago' : `Location updated ${minutes} min ago`;
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default function SafeWalkScreen() {
  const { journey, error, refreshedAt } = useSafeWalk();
  useEffect(() => {
    void refreshSafeWalk();
  }, []);
  return (
    <FormScreen>
      <Text style={styles.title}>SafeWalk</Text>
      {error ? <P accessibilityRole="alert" style={styles.warning}>{error}</P> : null}
      {!refreshedAt ? <ActivityIndicator color="#fff" /> : journey ? <ActiveJourney journey={journey} /> : <PlanJourney />}
    </FormScreen>
  );
}

function ActiveJourney({ journey }: { journey: SafeWalkStatus }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [tracking, setTracking] = useState(trackerDebugState());
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => { setTracking(trackerDebugState()); setNow(Date.now()); }, 5000);
    return () => clearInterval(timer);
  }, []);
  const perform = async (work: () => Promise<unknown>, success = '') => {
    if (busy) return;
    setBusy(true); setMessage('');
    try { await work(); setMessage(success); }
    catch (e) { setMessage(friendlyError(e, 'That did not work. Try again.')); }
    finally { setBusy(false); }
  };
  if (journey.safeWalkEmergencyIncidentId) {
    return (
      <View style={styles.panel}>
        <Text style={styles.heading}>Emergency active</Text>
        <P>Your SafeWalk became an emergency alert. Use the emergency screen to manage it.</P>
        <Big label="Open emergency screen" onPress={() => router.push('/sos')} />
      </View>
    );
  }
  const arrived = !!journey.plan?.arrivalDetectedAt;
  const checkRequired = journey.safeWalkEscalation?.state === 'CHECK_REQUIRED';
  const overdue = journey.safeWalkEscalation?.state === 'ESCALATED';
  const capturing = tracking.running && tracking.sessionId === journey.id;
  const contacts = journey.plan?.contacts ?? 0;
  const guardians = journey.guardianGrants.filter((g) => !g.revokedAt).length;
  return (
    <>
      <View style={styles.panel}>
        <Text style={styles.label}>Going to</Text>
        <Text style={styles.heading}>{journey.destinationLabel}</Text>
        <P>Expected by {clock(journey.expectedArrivalAt)}</P>
        <P>{capturing ? minutesAgo(journey.lastFixReceivedAt, now) : 'Location is not being shared from this phone. Keep OPA open.'}</P>
        <P>{contacts + guardians === 0 ? 'Nobody will be alerted if you miss your arrival.' : `${contacts + guardians} ${contacts + guardians === 1 ? 'person' : 'people'} will get a text if you don't confirm.`}</P>
        {tracking.durableQueued > 0 ? <P>{`${tracking.durableQueued} location updates are saved and will send when you have internet.`}</P> : null}
        {!journey.safetyChecksEnabled ? <P style={styles.warning}>Missed-arrival checks are not switched on yet.</P> : null}
      </View>
      {arrived ? <P accessibilityRole="alert" style={styles.good}>You've arrived. Tap "I'm safe" to finish.</P> : null}
      {checkRequired ? <P accessibilityRole="alert" style={styles.warning}>Your arrival time has passed. Tap "I'm safe" now, or your contacts will be told.</P> : null}
      {overdue ? <P accessibilityRole="alert" style={styles.warning}>Your contacts have been told you haven't confirmed. Tap "I'm safe" if you are.</P> : null}
      {message ? <P accessibilityRole="alert" style={styles.warning}>{message}</P> : null}
      <Big label="I'm safe" disabled={busy} onPress={() => void perform(() => confirmSafeWalk('confirm-arrival'), 'Glad you are safe. Your SafeWalk has ended.')} />
      <TouchableOpacity
        accessibilityRole="button"
        disabled={busy}
        style={styles.sos}
        onPress={() => Alert.alert('Send an SOS?', 'This sends an emergency alert to your estate security and emergency contacts.', [
          { text: 'Back', style: 'cancel' },
          { text: 'Send SOS', style: 'destructive', onPress: () => void perform(async () => { await escalateSafeWalk(); if (useActiveIncidentStore.getState().activeIncident?.activationMode !== 'SILENT') router.push('/sos'); }) },
        ])}
      >
        <Text style={styles.sosText}>SOS</Text>
      </TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => Alert.alert('Cancel this SafeWalk?', 'Nobody will be told anything.', [
        { text: 'Keep going', style: 'cancel' },
        { text: 'Cancel SafeWalk', onPress: () => void perform(() => confirmSafeWalk('cancel-safewalk'), 'SafeWalk cancelled.') },
      ])}>
        <Text style={styles.link}>Cancel SafeWalk</Text>
      </TouchableOpacity>
    </>
  );
}

function PlanJourney() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchNote, setSearchNote] = useState('');
  const [saved, setSaved] = useState<SavedPlace[]>([]);
  const [describing, setDescribing] = useState(false);
  const [description, setDescription] = useState('');
  const [destination, setDestination] = useState<Destination | null>(null);
  const [minutes, setMinutes] = useState<number>(30);
  const [otherMinutes, setOtherMinutes] = useState('');
  const [contacts, setContacts] = useState<SafeWalkContact[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [guardianCode, setGuardianCode] = useState('');
  const [showGuardian, setShowGuardian] = useState(false);
  const [myCode, setMyCode] = useState('');
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const near = useRef<{ lat: number; lng: number } | null>(null);

  const loadContacts = useCallback(async () => {
    try {
      const { data } = await api.get<SafeWalkContact[]>('/safewalk/contacts');
      setContacts(data);
      setChosen((list) => list.filter((id) => data.some((c) => c.contactId === id && c.safeWalk === 'READY')));
    } catch {
      setContacts([]);
    }
  }, []);

  useEffect(() => {
    void loadContacts();
    api.get<{ places: SavedPlace[] }>('/emergency-delivery/saved-places').then(({ data }) => setSaved(data.places.filter((p) => p.latitude !== null && p.longitude !== null))).catch(() => setSaved([]));
    void Location.getLastKnownPositionAsync().then((p) => { if (p) near.current = { lat: p.coords.latitude, lng: p.coords.longitude }; }).catch(() => undefined);
  }, [loadContacts]);

  // Search after a short pause in typing, so each keystroke is not a request.
  useEffect(() => {
    if (destination || describing || query.trim().length < 3) { setResults([]); return; }
    const timer = setTimeout(async () => {
      setSearching(true); setSearchNote('');
      try {
        const params: Record<string, string | number> = { q: query.trim() };
        if (near.current) { params.lat = near.current.lat; params.lng = near.current.lng; }
        const { data } = await api.get<PlaceResult[]>('/safewalk/places', { params });
        setResults(data);
        if (!data.length) setSearchNote('No places found. Try a landmark, bus stop or market, or describe it instead.');
      } catch (e) {
        setResults([]);
        setSearchNote(friendlyError(e, "Search isn't working right now. Choose a saved place or describe where you're going."));
      } finally {
        setSearching(false);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [query, destination, describing]);

  const invite = async (contact: SafeWalkContact) => {
    try {
      const { data } = await api.post<{ sent: boolean }>('/safewalk/contacts/' + contact.contactId + '/invite');
      Alert.alert('SafeWalk contact', data.sent ? `We texted ${contact.name}. They need to reply YES before they can be alerted.` : `We couldn't text ${contact.name} right now. Try again later.`);
    } catch (e) {
      Alert.alert('SafeWalk contact', friendlyError(e, 'Could not send the invitation. Try again.'));
    }
    await loadContacts();
  };

  const duration = otherMinutes.trim() ? Number(otherMinutes) : minutes;

  const start = async () => {
    if (busy) return;
    setMessage('');
    const target: Destination | null = describing ? (description.trim().length >= 2 ? { kind: 'DESCRIPTION', label: description.trim() } : null) : destination;
    if (!target) { setMessage('Choose where you are going.'); return; }
    if (!Number.isInteger(duration) || duration < 1 || duration > 1440) { setMessage('Choose how long the journey takes (1 minute to 24 hours).'); return; }
    const code = guardianCode.trim();
    if (code && !/^[A-Za-z0-9][A-Za-z0-9 -]{6,10}[A-Za-z0-9]$/.test(code)) { setMessage('That guardian code does not look right. It has 8 letters and numbers.'); return; }
    setBusy(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) throw new Error('OPA needs your location to protect this journey. Allow location and try again.');
      await createSafeWalk({
        destinationKind: target.kind,
        destinationLabel: target.label.slice(0, 160),
        ...(target.latitude !== undefined && target.longitude !== undefined ? { destinationLatitude: target.latitude, destinationLongitude: target.longitude } : {}),
        ...(target.placeId ? { placeId: target.placeId } : {}),
        ...(target.kind === 'DESCRIPTION' ? { destinationDescription: target.label.slice(0, 160) } : {}),
        expectedArrivalAt: new Date(Date.now() + duration * 60_000).toISOString(),
        contactIds: chosen,
        guardianCodes: code ? [code] : [],
      });
    } catch (e) {
      setMessage(e instanceof Error && !(e as { response?: unknown }).response ? e.message : friendlyError(e, 'Your SafeWalk did not start. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <P style={styles.note}>Set up before you move. Don't use while driving.</P>

      <View style={styles.panel}>
        <Text style={styles.heading}>Where are you going?</Text>
        {destination ? (
          <View style={styles.chosen}>
            <Text style={styles.chosenText}>{destination.label}</Text>
            {destination.address ? <P>{destination.address}</P> : null}
            <TouchableOpacity accessibilityRole="button" onPress={() => { setDestination(null); setQuery(''); }}><Text style={styles.link}>Change</Text></TouchableOpacity>
          </View>
        ) : describing ? (
          <>
            <TextInput accessibilityLabel="Describe where you are going" style={styles.input} placeholder="Aunty's house near Oja" placeholderTextColor="#667085" value={description} onChangeText={setDescription} maxLength={160} />
            <P>OPA can't detect arrival for a description, so you'll be asked when your time is up.</P>
            <TouchableOpacity accessibilityRole="button" onPress={() => setDescribing(false)}><Text style={styles.link}>Search for a place instead</Text></TouchableOpacity>
          </>
        ) : (
          <>
            <TextInput accessibilityLabel="Search for a place" style={styles.input} placeholder="Landmark, bus stop or market" placeholderTextColor="#667085" value={query} onChangeText={setQuery} autoCorrect={false} />
            {searching ? <ActivityIndicator color="#fff" /> : null}
            {results.map((r) => (
              <TouchableOpacity key={r.placeId} accessibilityRole="button" style={styles.result} onPress={() => { setDestination({ kind: 'PLACE', label: r.name, address: r.address, latitude: r.latitude, longitude: r.longitude, placeId: r.placeId }); setResults([]); }}>
                <Text style={styles.resultName}>{r.name}</Text>
                {r.address ? <Text style={styles.resultAddress}>{r.address}</Text> : null}
              </TouchableOpacity>
            ))}
            {searchNote ? <P>{searchNote}</P> : null}
            {saved.length ? <View style={styles.row}>{saved.map((p) => <Chip key={p.label} label={p.label} onPress={() => setDestination({ kind: 'SAVED_PLACE', label: p.label, latitude: p.latitude!, longitude: p.longitude! })} />)}</View> : null}
            <View style={styles.row}>
              <Chip label="Describe it instead" onPress={() => setDescribing(true)} />
            </View>
          </>
        )}
      </View>

      <View style={styles.panel}>
        <Text style={styles.heading}>How long will it take?</Text>
        <View style={styles.row}>
          {DURATIONS.map((m) => <Chip key={m} label={m < 60 ? `${m} min` : m === 60 ? '1 hour' : '2 hours'} selected={!otherMinutes && minutes === m} onPress={() => { setMinutes(m); setOtherMinutes(''); }} />)}
        </View>
        <TextInput accessibilityLabel="Other, in minutes" style={styles.input} placeholder="Other (minutes)" placeholderTextColor="#667085" value={otherMinutes} onChangeText={(t) => setOtherMinutes(t.replace(/[^0-9]/g, ''))} keyboardType="number-pad" maxLength={4} />
      </View>

      <View style={styles.panel}>
        <Text style={styles.heading}>Who should we text if you don't confirm?</Text>
        {contacts.length === 0 ? <P>Add emergency contacts first, then come back.</P> : null}
        {contacts.map((c) => (
          <View key={c.contactId} style={styles.contact}>
            <View style={{ flex: 1 }}>
              <Text style={styles.resultName}>{c.name}</Text>
              <Text style={styles.resultAddress}>{c.safeWalk === 'READY' ? 'Ready' : c.safeWalk === 'WAITING' ? 'Waiting for them to reply YES' : c.safeWalk === 'DECLINED' ? 'Said no to SafeWalk texts' : c.safeWalk === 'NUMBER_CHANGED' ? 'Number changed: ask again' : 'Not asked yet'}</Text>
            </View>
            {c.safeWalk === 'READY' ? (
              <Chip label={chosen.includes(c.contactId) ? 'Chosen' : 'Choose'} selected={chosen.includes(c.contactId)} onPress={() => setChosen((list) => list.includes(c.contactId) ? list.filter((x) => x !== c.contactId) : list.length >= MAX_CONTACTS ? list : [...list, c.contactId])} />
            ) : c.safeWalk === 'DECLINED' ? null : (
              <Chip label="Ask" onPress={() => void invite(c)} />
            )}
          </View>
        ))}
        <TouchableOpacity accessibilityRole="button" onPress={() => router.push('/contacts')}><Text style={styles.link}>Manage emergency contacts</Text></TouchableOpacity>
      </View>

      <TouchableOpacity accessibilityRole="button" onPress={() => setShowGuardian((v) => !v)}><Text style={styles.link}>{showGuardian ? 'Hide OPA guardian code' : 'Add an OPA guardian with a code (optional)'}</Text></TouchableOpacity>
      {showGuardian ? (
        <View style={styles.panel}>
          <TextInput accessibilityLabel="Guardian code" style={styles.input} placeholder="e.g. K7PM 3XQA" placeholderTextColor="#667085" value={guardianCode} onChangeText={setGuardianCode} autoCapitalize="characters" maxLength={11} />
          <P>Someone with OPA can give you their code from their own SafeWalk screen.</P>
          <TouchableOpacity accessibilityRole="button" onPress={async () => { try { const { data } = await api.post<{ code: string }>('/safewalk/guardian-code'); setMyCode(data.code.length === 8 ? data.code.slice(0, 4) + ' ' + data.code.slice(4) : data.code); } catch (e) { Alert.alert('Guardian code', friendlyError(e, 'Could not create a code.')); } }}>
            <Text style={styles.link}>Get my own code to give someone</Text>
          </TouchableOpacity>
          {myCode ? <P selectable style={styles.code}>{myCode}</P> : null}
          {myCode ? <P>Works once, for 10 minutes. Only give it to the person choosing you.</P> : null}
        </View>
      ) : null}

      {message ? <P accessibilityRole="alert" style={styles.warning}>{message}</P> : null}
      <Big label={busy ? 'Starting…' : 'Start SafeWalk'} disabled={busy} onPress={() => void start()} />

      <TouchableOpacity accessibilityRole="button" onPress={() => setShowPrivacy((v) => !v)}><Text style={styles.link}>How SafeWalk protects your privacy</Text></TouchableOpacity>
      {showPrivacy ? (
        <P>Your journey is private. Estate security cannot see it. Only the people you choose get a text, and only if you don't confirm you're safe. It is not an emergency alert: for an emergency, press SOS. While SafeWalk is on, OPA records your location, also when the phone is locked if you allow it.</P>
      ) : null}
    </>
  );
}

function Chip({ label, onPress, selected }: { label: string; onPress: () => void; selected?: boolean }) {
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityState={{ selected: !!selected }} onPress={onPress} style={[styles.chip, selected && styles.chipSelected]}>
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Big({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <TouchableOpacity accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.big, disabled && { opacity: 0.6 }]}>
      <Text style={styles.bigText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  title: { color: '#fff', fontSize: 30, fontWeight: '700' },
  heading: { color: '#fff', fontSize: 21, fontWeight: '600' },
  label: { color: '#98A2B3', fontSize: 14 },
  panel: { padding: 16, backgroundColor: '#1d2939', borderRadius: 12, gap: 12 },
  input: { padding: 14, borderRadius: 8, backgroundColor: '#fff', color: '#101828', fontSize: 16 },
  warning: { color: '#fdb022' },
  good: { color: '#6CE9A6' },
  note: { color: '#fdb022' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: '#98A2B3' },
  chipSelected: { backgroundColor: '#fff', borderColor: '#fff' },
  chipText: { color: '#fff', fontSize: 16 },
  chipTextSelected: { color: '#101828', fontWeight: '600' },
  chosen: { gap: 6 },
  chosenText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  result: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#344054' },
  resultName: { color: '#fff', fontSize: 16, fontWeight: '600' },
  resultAddress: { color: '#98A2B3', fontSize: 14 },
  contact: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  link: { color: '#84CAFF', fontSize: 16, paddingVertical: 6 },
  code: { color: '#fff', fontSize: 28, fontWeight: '700', letterSpacing: 3 },
  big: { backgroundColor: '#12B76A', borderRadius: 14, paddingVertical: 20, alignItems: 'center' },
  bigText: { color: '#fff', fontSize: 22, fontWeight: '700' },
  sos: { alignSelf: 'center', borderWidth: 2, borderColor: '#F04438', borderRadius: 30, paddingVertical: 10, paddingHorizontal: 28 },
  sosText: { color: '#F04438', fontSize: 18, fontWeight: '700' },
});
