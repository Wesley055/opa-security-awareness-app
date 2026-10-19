import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { router } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { api } from "../src/services/api";
import { FormScreen } from "../src/components/FormScreen";

type Pass = {
  id: string;
  visitorName: string;
  destination: string;
  status: "ISSUED" | "CHECKED_IN" | "CHECKED_OUT" | "DENIED" | "REVOKED" | "EXPIRED";
  validFrom: string;
  validUntil: string;
  expectedMinutes: number;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  expectedExitAt: string | null;
  departureUnconfirmed: boolean;
};

const PLACEHOLDER = "#64748B";
const DURATIONS: { label: string; minutes?: number }[] = [
  { label: "Estate default" },
  { label: "1 hour", minutes: 60 },
  { label: "2 hours", minutes: 120 },
  { label: "4 hours", minutes: 240 },
  { label: "8 hours", minutes: 480 },
  { label: "Overnight", minutes: 960 },
];
const STATUS: Record<Pass["status"], string> = {
  ISSUED: "Waiting at gate",
  CHECKED_IN: "Inside the estate",
  CHECKED_OUT: "Left",
  DENIED: "Entry denied",
  REVOKED: "Cancelled",
  EXPIRED: "Expired",
};
const when = (v: string | null) =>
  v ? new Date(v).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" }) : "—";

function apiMessage(error: unknown, fallback: string) {
  const data = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  const text = Array.isArray(data) ? data[0] : data;
  return typeof text === "string" ? text : fallback;
}

/**
 * EstateFlow for residents: invite a visitor and share a six-digit code.
 * The visitor only needs to say the code at the gate: no app, data or QR.
 */
export default function VisitorsScreen() {
  const [passes, setPasses] = useState<Pass[] | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [destination, setDestination] = useState("");
  const [duration, setDuration] = useState<number | undefined>(undefined);
  const [tomorrow, setTomorrow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [issued, setIssued] = useState<{ code: string; pass: Pass } | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<{ passes: Pass[] }>("/estate/passes");
      setPasses(data.passes);
      setError("");
    } catch (e) {
      setPasses([]);
      setError(apiMessage(e, "Could not load your visitor passes. Check your connection."));
    }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function share(code: string, pass: Pass) {
    await Share.share({
      message: `OPA visitor pass for ${pass.visitorName}: code ${code}. Tell the gate this code. Going to ${pass.destination}. Valid until ${when(pass.validUntil)} WAT.`,
    });
  }

  async function create() {
    setError("");
    if (name.trim().length < 2 || !destination.trim()) {
      setError("Enter the visitor's name and the house or block they are visiting.");
      return;
    }
    const cleanPhone = phone.replace(/[\s-]/g, "");
    if (cleanPhone && !/^\+[1-9]\d{7,14}$/.test(cleanPhone)) {
      setError("Enter the phone in international format, e.g. +2348012345678, or leave it empty.");
      return;
    }
    setBusy(true);
    try {
      const start = new Date();
      if (tomorrow) {
        start.setDate(start.getDate() + 1);
        start.setHours(7, 0, 0, 0);
      }
      const { data } = await api.post<{ code: string; pass: Pass }>("/estate/passes", {
        visitorName: name.trim(),
        ...(cleanPhone ? { visitorPhone: cleanPhone } : {}),
        destination: destination.trim(),
        ...(tomorrow ? { validFrom: start.toISOString() } : {}),
        ...(duration ? { expectedMinutes: duration } : {}),
      });
      setIssued(data);
      setName("");
      setPhone("");
      void load();
    } catch (e) {
      setError(apiMessage(e, "The pass was not created. Check your connection and try again."));
    } finally {
      setBusy(false);
    }
  }

  async function newCode(pass: Pass) {
    try {
      const { data } = await api.post<{ code: string; pass: Pass }>(`/estate/passes/${pass.id}/code`);
      setIssued(data);
    } catch (e) {
      Alert.alert("No new code", apiMessage(e, "Try again."));
    }
  }

  function cancel(pass: Pass) {
    Alert.alert("Cancel this pass?", `${pass.visitorName} will not be able to enter with this code.`, [
      { text: "Keep" },
      {
        text: "Cancel pass",
        style: "destructive",
        onPress: async () => {
          try {
            await api.post(`/estate/passes/${pass.id}/revoke`);
            void load();
          } catch (e) {
            Alert.alert("Not cancelled", apiMessage(e, "Try again."));
          }
        },
      },
    ]);
  }

  return (
    <FormScreen>
      <Text style={styles.title}>Visitors</Text>
      <Text style={styles.text}>Create a pass, then share the 6-digit code with your visitor. They tell the code to security at the gate.</Text>

      {issued ? (
        <View style={styles.codeCard}>
          <Text style={styles.text}>Code for {issued.pass.visitorName}</Text>
          <Text accessibilityLabel={`Visitor code ${issued.code.split("").join(" ")}`} style={styles.code}>
            {issued.code.slice(0, 3)} {issued.code.slice(3)}
          </Text>
          <Text style={styles.hint}>Shown once. If it is lost, create a new code below.</Text>
          <TouchableOpacity style={styles.button} onPress={() => void share(issued.code, issued.pass)}>
            <Text style={styles.buttonText}>Share code (SMS, WhatsApp…)</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setIssued(null)}>
            <Text style={styles.link}>Done</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <Text style={styles.section}>New visitor pass</Text>
      <TextInput style={styles.input} placeholder="Visitor's name" placeholderTextColor={PLACEHOLDER} value={name} onChangeText={setName} accessibilityLabel="Visitor's name" editable={!busy} />
      <TextInput style={styles.input} placeholder="Visitor's phone (optional)" placeholderTextColor={PLACEHOLDER} value={phone} onChangeText={setPhone} keyboardType="phone-pad" accessibilityLabel="Visitor's phone" editable={!busy} />
      <TextInput style={styles.input} placeholder="House, street or block" placeholderTextColor={PLACEHOLDER} value={destination} onChangeText={setDestination} accessibilityLabel="House, street or block" editable={!busy} />
      <Text style={styles.text}>How long will they stay?</Text>
      <View style={styles.chips}>
        {DURATIONS.map((d) => (
          <TouchableOpacity key={d.label} accessibilityRole="radio" accessibilityState={{ selected: duration === d.minutes }} onPress={() => setDuration(d.minutes)} style={[styles.chip, duration === d.minutes && styles.chipOn]}>
            <Text style={duration === d.minutes ? styles.chipTextOn : styles.chipText}>{d.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.chips}>
        {[false, true].map((t) => (
          <TouchableOpacity key={String(t)} accessibilityRole="radio" accessibilityState={{ selected: tomorrow === t }} onPress={() => setTomorrow(t)} style={[styles.chip, tomorrow === t && styles.chipOn]}>
            <Text style={tomorrow === t ? styles.chipTextOn : styles.chipText}>{t ? "Tomorrow" : "Today"}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <TouchableOpacity style={styles.button} onPress={() => void create()} disabled={busy}>
        {busy ? <ActivityIndicator /> : <Text style={styles.buttonText}>Create pass</Text>}
      </TouchableOpacity>

      <Text style={styles.section}>Your passes</Text>
      {passes === null ? <ActivityIndicator /> : null}
      {passes?.length === 0 ? <Text style={styles.hint}>No visitor passes yet.</Text> : null}
      {passes?.map((p) => (
        <View key={p.id} style={styles.pass}>
          <Text style={styles.passName}>{p.visitorName} → {p.destination}</Text>
          <Text style={p.departureUnconfirmed ? styles.warn : styles.text}>
            {p.departureUnconfirmed ? "Departure not confirmed by the gate" : STATUS[p.status]}
            {p.status === "CHECKED_IN" ? ` · in ${when(p.checkedInAt)} · expected out ${when(p.expectedExitAt)}` : ""}
            {p.status === "ISSUED" ? ` · valid until ${when(p.validUntil)}` : ""}
          </Text>
          {p.status === "ISSUED" ? (
            <View style={styles.row}>
              <TouchableOpacity onPress={() => void newCode(p)}><Text style={styles.link}>New code</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => cancel(p)}><Text style={styles.danger}>Cancel pass</Text></TouchableOpacity>
            </View>
          ) : null}
        </View>
      ))}

      <TouchableOpacity onPress={() => router.back()}>
        <Text style={styles.link}>Back</Text>
      </TouchableOpacity>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 26, color: "#FFFFFF", fontWeight: "700" },
  section: { fontSize: 18, color: "#FFFFFF", fontWeight: "700", marginTop: 12 },
  text: { color: "#CBD5E1", fontSize: 16 },
  hint: { color: "#94A3B8", fontSize: 13 },
  warn: { color: "#FFB300", fontWeight: "700" },
  error: { color: "#FF7B72" },
  input: { backgroundColor: "#FFFFFF", color: "#08111A", padding: 14, borderRadius: 8, fontSize: 16 },
  button: { backgroundColor: "#17C964", padding: 16, borderRadius: 8, alignItems: "center" },
  buttonText: { color: "#08111A", fontWeight: "700", fontSize: 16, textAlign: "center" },
  link: { color: "#5EEAD4", paddingVertical: 8, fontSize: 16 },
  danger: { color: "#FF7B72", paddingVertical: 8, fontSize: 16 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderColor: "#334155", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  chipOn: { backgroundColor: "#17C964", borderColor: "#17C964" },
  chipText: { color: "#CBD5E1" },
  chipTextOn: { color: "#08111A", fontWeight: "700" },
  codeCard: { borderWidth: 2, borderColor: "#17C964", borderRadius: 12, padding: 16, gap: 8 },
  code: { color: "#FFFFFF", fontSize: 44, fontWeight: "800", letterSpacing: 6, textAlign: "center" },
  pass: { borderWidth: 1, borderColor: "#334155", borderRadius: 10, padding: 12, gap: 4 },
  passName: { color: "#FFFFFF", fontWeight: "700", fontSize: 16 },
  row: { flexDirection: "row", gap: 24 },
});
