import { useActiveIncidentStore } from '../src/store/activeIncidentStore';
import { useEffect, useState } from 'react';
import { Alert, Button, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { api } from '../src/services/api';
import { confirmSafeWalk, createSafeWalk, escalateSafeWalk, refreshSafeWalk, useSafeWalk } from '../src/services/safewalk';
import { trackerDebugState } from '../src/services/journey-tracker';

export default function SafeWalkScreen() {
  const { journey, error, refreshedAt } = useSafeWalk();
  const [destination, setDestination] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [minutes, setMinutes] = useState('30');
  const [codes, setCodes] = useState('');
  const [pairing, setPairing] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [notices, setNotices] = useState<{ id: string; message: string }[]>([]);
  const [tracking, setTracking] = useState(trackerDebugState());
  useEffect(() => {
    void refreshSafeWalk();
    const timer = setInterval(() => setTracking(trackerDebugState()), 3000);
    return () => clearInterval(timer);
  }, []);
  const perform = async (work: () => Promise<unknown>, success = '') => {
    if (busy) return;
    setBusy(true); setMessage('');
    try { await work(); setMessage(success); }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Request failed. Check your connection and retry.'); }
    finally { setBusy(false); }
  };
  const start = () => perform(async () => {
    const lat = Number(latitude), lon = Number(longitude), duration = Number(minutes);
    if (!destination.trim() || !latitude.trim() || !longitude.trim() || !Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lon) || Math.abs(lon) > 180 || !Number.isFinite(duration) || duration <= 0 || duration > 1440) throw new Error('Enter a destination, valid destination coordinates, and an arrival estimate of 1–1440 minutes.');
    const guardianCodes = codes.split(/[\s,]+/).filter(Boolean);
    if (guardianCodes.length > 5 || guardianCodes.some(code => !/^[a-f0-9]{64}$/.test(code))) throw new Error('Enter up to five guardian pairing codes.');
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) throw new Error('Location permission is needed to start journey tracking.');
    await createSafeWalk({ destinationLabel: destination.trim(), destinationLatitude: lat, destinationLongitude: lon, expectedArrivalAt: new Date(Date.now() + duration * 60_000).toISOString(), guardianCodes });
  });
  return <ScrollView contentContainerStyle={styles.page}>
    <Text style={styles.title}>SafeWalk</Text>
    <Text style={styles.copy}>Your journey is private. Facility operators cannot monitor normal journeys. Missed arrival prompts a safety check and then a non-emergency alert to your selected guardians.</Text>
    {error && <Text accessibilityRole="alert" style={styles.warning}>{error}</Text>}
    {message ? <Text accessibilityRole="alert" style={styles.warning}>{message}</Text> : null}
    {busy && <Text style={styles.copy}>Saving…</Text>}
    {!refreshedAt && <Text style={styles.copy}>Loading your current journey…</Text>}
    {journey ? <View style={styles.panel}>
      <Text style={styles.heading}>{journey.destinationLabel}</Text>
      <Text style={styles.copy}>Expected arrival: {new Date(journey.expectedArrivalAt).toLocaleString()}</Text>
      <Text style={styles.copy}>Status: {journey.safeWalkEmergencyIncidentId ? 'Emergency activated' : journey.safeWalkEscalation?.state === 'ESCALATED' ? 'Overdue — selected guardian escalation processed' : journey.safetyConfirmedAt ? 'Safety confirmed' : journey.status === 'ACTIVE' ? 'Journey active' : 'Journey started'}</Text>
      <Text style={styles.copy}>{tracking.running && tracking.sessionId === journey.id ? 'Location capture is running on this device.' : 'Location tracking is unavailable on this device.'}</Text>
      <Text style={styles.copy}>Last server upload: {journey.lastFixReceivedAt ? new Date(journey.lastFixReceivedAt).toLocaleString() : 'None yet'}. Upload time does not prove that a location is current.</Text>
      <Text style={styles.copy}>Buffered fixes: {tracking.durableQueued}. {tracking.durabilityFault || tracking.replayFault ? 'Location upload needs attention. Keep the app open and retry your connection.' : 'Offline fixes use the existing device queue and replay when connectivity returns.'}</Text>
      {!journey.safetyChecksEnabled && <Text accessibilityRole="alert" style={styles.warning}>Automated safety checks are not enabled on this server.</Text>}
      {journey.safeWalkNotices?.map(n => <Text key={n.id} style={styles.copy}>{n.kind === 'GUARDIAN_OVERDUE' ? 'Guardian alert' : 'Safety check'}: {n.deliveryStatus.replaceAll('_', ' ').toLowerCase()}{n.cancelledAt ? ' (further sends stopped)' : ''}</Text>)}
      <Text style={styles.copy}>Selected guardians: {journey.guardianGrants.filter(g => !g.revokedAt).length}. A queued alert does not prove delivery.</Text>
      {journey.safeWalkEscalation?.state === 'CHECK_REQUIRED' && <Text accessibilityRole="alert" style={styles.warning}>Please confirm you are safe. Arrival has not been confirmed. Respond by {journey.safeWalkEscalation.responseDueAt ? new Date(journey.safeWalkEscalation.responseDueAt).toLocaleTimeString() : 'the response deadline'}.</Text>}
      {!journey.safeWalkEmergencyIncidentId ? <>
        <Button disabled={busy} title="I have arrived" onPress={() => void perform(() => confirmSafeWalk('confirm-arrival'), 'Arrival confirmed. Journey completed.')} />
        <Button disabled={busy} title="I am safe" onPress={() => void perform(() => confirmSafeWalk('confirm-safety'), 'Safety confirmed.')} />
        <Button disabled={busy} title="Cancel journey" onPress={() => void perform(() => confirmSafeWalk('cancel-safewalk'), 'Journey cancelled.')} />
        <Button disabled={busy} color="#b42318" title="Escalate emergency" onPress={() => Alert.alert('Activate an emergency?', 'This creates or links your emergency Incident and authorizes necessary emergency context for responders. Your earlier private route stays private.', [{ text: 'Back', style: 'cancel' }, { text: 'Activate emergency', style: 'destructive', onPress: () => void perform(async () => { await escalateSafeWalk(); if (useActiveIncidentStore.getState().activeIncident?.activationMode !== 'SILENT') router.push('/sos'); }) }])} />
        <TextInput style={styles.input} placeholder="Guardian pairing code" placeholderTextColor="#667085" value={codes} onChangeText={setCodes} autoCapitalize="none" />
        <Button disabled={busy} title="Add selected guardian" onPress={() => void perform(async () => { await api.post('/safewalk/sessions/' + journey.id + '/guardians', { code: codes.trim() }); setCodes(''); await refreshSafeWalk(); })} />
        {journey.guardianGrants.filter(g => !g.revokedAt).map((g, index) => <Button key={g.id} disabled={busy} title={'Remove guardian ' + (index + 1)} onPress={() => void perform(async () => { await api.post('/safewalk/sessions/' + journey.id + '/guardians/' + g.id + '/revoke'); await refreshSafeWalk(); })} />)}
      </> : <Button title="Open emergency controls" onPress={() => router.push('/sos')} />}
    </View> : refreshedAt && <View style={styles.panel}>
      <Text style={styles.heading}>Plan your journey</Text>
      <TextInput accessibilityLabel="Destination" style={styles.input} placeholder="Destination label" placeholderTextColor="#667085" value={destination} onChangeText={setDestination} />
      <TextInput accessibilityLabel="Destination latitude" style={styles.input} placeholder="Destination latitude" placeholderTextColor="#667085" value={latitude} onChangeText={setLatitude} keyboardType="numbers-and-punctuation" />
      <TextInput accessibilityLabel="Destination longitude" style={styles.input} placeholder="Destination longitude" placeholderTextColor="#667085" value={longitude} onChangeText={setLongitude} keyboardType="numbers-and-punctuation" />
      <Text style={styles.copy}>Minutes until expected arrival</Text>
      <TextInput accessibilityLabel="Arrival estimate in minutes" style={styles.input} value={minutes} onChangeText={setMinutes} keyboardType="number-pad" />
      <TextInput accessibilityLabel="Selected guardian pairing codes" style={styles.input} placeholder="Selected guardian codes, separated by commas" placeholderTextColor="#667085" value={codes} onChangeText={setCodes} multiline autoCapitalize="none" />
      <Text style={styles.copy}>Guardians generate a pairing code below and share it with you. Without selected guardians, no guardian alert is sent. During this SafeWalk, OPA saves your location while the app is closed or your phone is locked if background location permission is enabled. Otherwise capture is limited to foreground availability. You can cancel the journey at any time. Your normal route stays private.</Text>
      <Button disabled={busy || !!error} title="Start private SafeWalk" onPress={() => void start()} />
    </View>}
    <View style={styles.panel}>
      <Text style={styles.heading}>Guardian tools</Text>
      <Button disabled={busy} title="Generate my pairing code" onPress={() => void perform(async () => { const { data } = await api.post('/safewalk/guardian-code'); setPairing(data.code); })} />
      {pairing ? <Text selectable style={styles.copy}>{pairing}{'\n'}Share this code only with the person selecting you. It expires in 10 minutes.</Text> : null}
      <Button disabled={busy} title="Check my SafeWalk notices" onPress={() => void perform(async () => setNotices((await api.get('/safewalk/notices')).data))} />
      {notices.map(notice => <Text key={notice.id} style={styles.copy}>{notice.message}</Text>)}
    </View>
    <Button disabled={busy} title="Refresh status" onPress={() => void perform(() => refreshSafeWalk())} />
  </ScrollView>;
}
const styles = StyleSheet.create({ page: { padding: 24, gap: 16, backgroundColor: '#101828', flexGrow: 1 }, title: { color: '#fff', fontSize: 30, fontWeight: '700' }, heading: { color: '#fff', fontSize: 21, fontWeight: '600' }, copy: { color: '#eaecf0', fontSize: 16, lineHeight: 23 }, panel: { padding: 16, backgroundColor: '#1d2939', borderRadius: 12, gap: 14 }, input: { padding: 14, borderRadius: 8, backgroundColor: '#fff', color: '#101828', fontSize: 16 }, warning: { color: '#fdb022', fontSize: 16, lineHeight: 23 } });
