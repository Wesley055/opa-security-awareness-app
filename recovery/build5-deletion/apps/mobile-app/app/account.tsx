import { useRef, useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
} from "react-native";
import { Redirect, router } from "expo-router";
import axios from "axios";
import { useAuthStore } from "../src/store/authStore";

export const DELETION_WARNING =
  "Deleting your account ends your access to OPA. Personal account information will be deleted or de-identified under our retention policy. Certain emergency, security and audit records may be retained where required. This cannot be undone.";
export default function AccountScreen() {
  const { isAuthenticated, isDeleting, deleteAccount } = useAuthStore();
  const confirming = useRef(false);
  const [error, setError] = useState<string | null>(null);
  if (!isAuthenticated) return <Redirect href="/(auth)/login" />;
  const confirm = () => {
    if (confirming.current || isDeleting) return;
    confirming.current = true;
    Alert.alert(
      "Delete account permanently?",
      DELETION_WARNING,
      [
        {
          text: "Cancel",
          style: "cancel",
          onPress: () => {
            confirming.current = false;
          },
        },
        {
          text: "Delete Account",
          style: "destructive",
          onPress: () => {
            setError(null);
            void deleteAccount()
              .catch((cause: unknown) => {
                const status = axios.isAxiosError(cause)
                  ? cause.response?.status
                  : undefined;
                setError(
                  status === 409
                    ? "Finish any active emergency, journey or SafeWalk guardian responsibility before deleting your account."
                    : status === 403
                      ? "This account requires organizational offboarding. Contact your organization administrator."
                      : "Deletion could not be confirmed. Please try again.",
                );
              })
              .finally(() => {
                confirming.current = false;
              });
          },
        },
      ],
      {
        cancelable: true,
        onDismiss: () => {
          confirming.current = false;
        },
      },
    );
  };
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <TouchableOpacity
        accessibilityRole="button"
        onPress={() => router.back()}
      >
        <Text style={styles.back}>Back</Text>
      </TouchableOpacity>
      <Text style={styles.title}>Account</Text>
      <Text style={styles.copy}>{DELETION_WARNING}</Text>
      <Text style={styles.copy}>
        Resolve any active SOS or SafeWalk before continuing.
      </Text>
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Delete Account"
        disabled={isDeleting}
        onPress={confirm}
        style={styles.button}
      >
        <Text style={styles.buttonText}>
          {isDeleting ? "Deleting…" : "Delete Account"}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: "#08111A",
    padding: 24,
    paddingTop: 64,
    gap: 20,
  },
  title: { fontSize: 28, fontWeight: "700", color: "#FFFFFF" },
  copy: { color: "#FFFFFF", lineHeight: 22 },
  back: { color: "#17C964", paddingVertical: 12 },
  error: { color: "#FF9C9C" },
  button: { backgroundColor: "#a11919", padding: 16, borderRadius: 8 },
  buttonText: { color: "#fff", textAlign: "center", fontWeight: "700" },
});
