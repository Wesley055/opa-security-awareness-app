import type { ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  type TextProps,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const BACKGROUND = "#08111A";

/**
 * Form screen that stays readable on every phone: clear of the status bar and
 * the navigation bar (Android edge-to-edge), scrolls above the keyboard, and
 * starts at the top so nothing is pushed off-screen on small or large-font phones.
 */
export function FormScreen({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom", "left", "right"]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/**
 * Body text without a fixed line height and with Android's simple line
 * breaking. A fixed lineHeight plus a bold or enlarged system font cuts off
 * the last line on many Android phones (seen on Samsung with bold font).
 */
export function P({ style, ...props }: TextProps) {
  return <Text textBreakStrategy="simple" maxFontSizeMultiplier={1.8} style={[styles.p, style]} {...props} />;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BACKGROUND },
  flex: { flex: 1 },
  content: { flexGrow: 1, padding: 24, paddingTop: 16, paddingBottom: 32, gap: 14 },
  p: { color: "#CBD5E1", fontSize: 16 },
});
