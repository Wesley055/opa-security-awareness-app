import { PasswordInput } from "../../src/components/PasswordInput";
import { useState } from "react";
import {
  ActivityIndicator,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { FormScreen, P } from "../../src/components/FormScreen";
import { router, useLocalSearchParams } from "expo-router";
import { useAuthStore } from "../../src/store/authStore";
import { PASSWORD_RULE_TEXT, passwordProblem } from "../../src/utils/password-rule";

const PLACEHOLDER = "#64748B";

export default function EnrollmentScreen() {
  const params = useLocalSearchParams<{ requestId?: string }>();
  const [requestId, setRequestId] = useState(
    typeof params.requestId === "string" ? params.requestId : "",
  );
  const fromLink = typeof params.requestId === "string" && params.requestId.length > 0;
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
      password !== confirmPassword
    ) {
      setError("Passwords must match.");
      return;
    }
    if (!acceptanceToken && passwordProblem(password)) {
      setError(PASSWORD_RULE_TEXT);
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
    <FormScreen>
      <P accessibilityRole="header" style={styles.title}>
        {acceptanceToken
          ? "Sign in to accept enrollment"
          : "Accept your OPA invitation"}
      </P>
      <P>
        {acceptanceToken
          ? "Ownership is verified. Sign in with your existing account password to accept. Enrollment cannot move an account between organizations."
          : "We sent a 4-digit code to your email and another to your phone. Enter both, then choose your password."}
      </P>
      <TouchableOpacity onPress={() => router.push("/(auth)/activate")} disabled={busy}><P>Have an older short invitation code instead?</P></TouchableOpacity>
      {error ? (
        <P accessibilityRole="alert" style={styles.error}>
          {error}
        </P>
      ) : null}
      {!acceptanceToken ? (
        <>
          {!fromLink ? (
            <>
              <P>Invitation reference (in your SMS and email, e.g. OPA-3F9A1C)</P>
              <TextInput
                accessibilityLabel="Invitation reference"
                placeholder="OPA-XXXXXX"
                placeholderTextColor={PLACEHOLDER}
                style={styles.input}
                value={requestId}
                onChangeText={setRequestId}
                autoCapitalize="characters"
                autoCorrect={false}
                editable={!busy}
              />
            </>
          ) : null}
          <P>Code from your email</P>
          <TextInput
            accessibilityLabel="Email code"
            placeholder="4 digits"
            placeholderTextColor={PLACEHOLDER}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            style={styles.input}
            value={emailCode}
            onChangeText={setEmailCode}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
          />
          <P>Code from your phone (SMS)</P>
          <TextInput
            accessibilityLabel="Phone code"
            placeholder="4 digits"
            placeholderTextColor={PLACEHOLDER}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
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
          placeholderTextColor={PLACEHOLDER}
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
            : "New password"
        }
        placeholderTextColor={PLACEHOLDER}
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        editable={!busy}
      />
      {!acceptanceToken ? (
        <PasswordInput
          accessibilityLabel="Confirm password"
          placeholder="Confirm password"
          placeholderTextColor={PLACEHOLDER}
          style={styles.input}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          textContentType="newPassword"
          editable={!busy}
        />
      ) : null}
      {!acceptanceToken ? (
        <P style={styles.hint}>
          {PASSWORD_RULE_TEXT}
        </P>
      ) : (
        <TouchableOpacity
          onPress={() => router.push("/(auth)/forgot-password")}
          disabled={busy}
        >
          <P>Forgot password?</P>
        </TouchableOpacity>
      )}
      <TouchableOpacity
        accessibilityRole="checkbox"
        accessibilityState={{ checked: consent }}
        onPress={() => setConsent(!consent)}
        disabled={busy}
      >
        <P>
          {consent ? "☑" : "☐"} I accept this invitation.
        </P>
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
          <Text style={styles.buttonText}>
            {acceptanceToken
              ? "Sign in and accept"
              : "Verify and create my account"}
          </Text>
        )}
      </TouchableOpacity>
      <TouchableOpacity onPress={() => router.replace("/(auth)/login")}>
        <P>Return to sign in</P>
      </TouchableOpacity>
    </FormScreen>
  );
}
const styles = StyleSheet.create({
  title: { fontSize: 26, color: "#FFFFFF", fontWeight: "700" },
  input: {
    backgroundColor: "#FFFFFF",
    color: "#08111A",
    padding: 14,
    borderRadius: 8,
    fontSize: 16,
  },
  button: {
    backgroundColor: "#17C964",
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
  },
  error: { color: "#FF7B72" },
  hint: { color: "#94A3B8", fontSize: 13 },
  buttonText: { color: "#08111A", fontWeight: "700", fontSize: 16, textAlign: "center" },
});
