import { PasswordInput } from "../../src/components/PasswordInput";
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
  const [confirmPassword, setConfirmPassword] = useState("");
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
    if (
      !acceptanceToken &&
      (password.length < 12 || password !== confirmPassword)
    ) {
      setError("Choose and confirm the same password, at least 12 characters.");
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
        setConfirmPassword("");
        if (result.status === "ACCEPTED") router.replace("/");
        else {
          setAcceptanceToken(result.acceptanceToken);
          setEmailCode("");
          setPhoneCode("");
        }
      }
    } catch (error) {
      setError(
        error &&
          typeof error === "object" &&
          "response" in error &&
          error.response
          ? "Enrollment was not accepted. Check your codes or sign-in details. Expired requests require a new enrollment."
          : "Enrollment result is unknown. Try signing in with your chosen password, or open the original enrollment link and choose Resume before retrying.",
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
          : "Accept your institutional invitation"}
      </Text>
      <Text style={styles.text}>
        {acceptanceToken
          ? "Ownership is verified. Sign in with your existing account password to accept. Enrollment cannot move an account between organizations."
          : "Your request is pending. No account or membership has been created. Open the enrollment link in your invitation to prefill its reference, or enter that reference below. Enter both codes sent to your email and phone. Choose and confirm your password. Both proofs and your chosen credential must be accepted before the account is active."}
      </Text>
      <TouchableOpacity onPress={() => router.push("/(auth)/activate")} disabled={busy}><Text style={styles.text}>Have an older short invitation code instead?</Text></TouchableOpacity>
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {!acceptanceToken ? (
        <>
          <Text style={styles.text}>Invitation reference from your message</Text>
          <TextInput
            accessibilityLabel="Invitation reference"
            placeholder="Invitation reference"
            style={styles.input}
            value={requestId}
            onChangeText={setRequestId}
            autoCapitalize="none"
            editable={!busy}
          />
          <Text style={styles.text}>Email verification code</Text>
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
          <Text style={styles.text}>Phone verification code</Text>
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
      <PasswordInput
        textContentType={acceptanceToken ? "password" : "newPassword"}
        accessibilityLabel="Password"
        placeholder={
          acceptanceToken
            ? "Existing account password"
            : "New password (at least 12 characters)"
        }
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        editable={!busy}
      />
      {!acceptanceToken ? (
        <PasswordInput
          accessibilityLabel="Confirm password"
          placeholder="Confirm password"
          style={styles.input}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          textContentType="newPassword"
          editable={!busy}
        />
      ) : (
        <TouchableOpacity
          onPress={() => router.push("/(auth)/forgot-password")}
          disabled={busy}
        >
          <Text style={styles.text}>Forgot password?</Text>
        </TouchableOpacity>
      )}
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
            {acceptanceToken
              ? "Sign in and accept"
              : "Verify and activate account"}
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
