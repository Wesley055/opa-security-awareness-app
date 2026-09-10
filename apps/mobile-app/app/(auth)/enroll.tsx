import { useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useAuthStore } from "../../src/store/authStore";

export default function EnrollmentScreen() {
  const params = useLocalSearchParams<{ requestId?: string }>();
  const [requestId, setRequestId] = useState(
    typeof params.requestId === "string" ? params.requestId : "",
  );
  const [emailCode, setEmailCode] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [acceptanceToken, setAcceptanceToken] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const verify = useAuthStore((s) => s.verifyEnrollment);
  const accept = useAuthStore((s) => s.acceptEnrollment);
  async function submit() {
    setError("");
    if (!consent) {
      setError("Confirm that you intend to accept this enrollment.");
      return;
    }
    setBusy(true);
    try {
      if (acceptanceToken) {
        await accept(
          requestId,
          acceptanceToken,
          email.trim().toLowerCase(),
          password,
        );
        setAcceptanceToken(null);
        router.replace("/");
      } else {
        const result = await verify({
          requestId: requestId.trim(),
          emailCode: emailCode.trim(),
          phoneCode: phoneCode.trim(),
          password,
          accept: true,
        });
        setPassword("");
        if (result.status === "ACCEPTED") router.replace("/");
        else {
          setAcceptanceToken(result.acceptanceToken);
          setEmailCode("");
          setPhoneCode("");
        }
      }
    } catch {
      setError(
        "Enrollment could not be completed. Check your codes or sign-in details and try again. Expired requests require a new enrollment request.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>
        {acceptanceToken
          ? "Sign in to accept enrollment"
          : "Verify your enrollment"}
      </Text>
      <Text style={styles.text}>
        {acceptanceToken
          ? "Ownership is verified. Sign in with your existing account password to accept. Enrollment cannot move an account between organizations."
          : "Your request is pending. No account or membership has been created. Enter the request ID and both codes sent to your email and phone. Choose a password for a new account."}
      </Text>
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {!acceptanceToken ? (
        <>
          <TextInput
            accessibilityLabel="Request ID"
            placeholder="Request ID"
            style={styles.input}
            value={requestId}
            onChangeText={setRequestId}
            autoCapitalize="none"
            editable={!busy}
          />
          <TextInput
            accessibilityLabel="Email code"
            placeholder="Email code"
            style={styles.input}
            value={emailCode}
            onChangeText={setEmailCode}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
          />
          <TextInput
            accessibilityLabel="Phone code"
            placeholder="Phone code"
            style={styles.input}
            value={phoneCode}
            onChangeText={setPhoneCode}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
          />
        </>
      ) : (
        <TextInput
          accessibilityLabel="Account email"
          placeholder="Account email"
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          editable={!busy}
        />
      )}
      <TextInput
        accessibilityLabel="Password"
        placeholder={
          acceptanceToken
            ? "Existing account password"
            : "New password (at least 12 characters)"
        }
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        editable={!busy}
      />
      <TouchableOpacity
        accessibilityRole="checkbox"
        accessibilityState={{ checked: consent }}
        onPress={() => setConsent(!consent)}
        disabled={busy}
      >
        <Text style={styles.text}>
          {consent ? "☑" : "☐"} I intend to accept enrollment for the
          organization named in these messages.
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        accessibilityRole="button"
        style={styles.button}
        onPress={submit}
        disabled={busy}
      >
        {busy ? (
          <ActivityIndicator />
        ) : (
          <Text>
            {acceptanceToken ? "Sign in and accept" : "Verify and accept"}
          </Text>
        )}
      </TouchableOpacity>
      <TouchableOpacity onPress={() => router.replace("/(auth)/login")}>
        <Text style={styles.text}>Return to sign in</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 24,
    gap: 16,
    backgroundColor: "#08111A",
    justifyContent: "center",
  },
  title: { fontSize: 26, color: "#FFFFFF" },
  text: { color: "#CBD5E1", lineHeight: 23 },
  input: {
    backgroundColor: "#FFFFFF",
    color: "#08111A",
    padding: 14,
    borderRadius: 8,
  },
  button: {
    backgroundColor: "#17C964",
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
  },
  error: { color: "#FF7B72" },
});
