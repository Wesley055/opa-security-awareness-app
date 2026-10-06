import { useState } from "react";
import {
  Text,
  TextInput,
  TouchableOpacity,
  View,
  StyleSheet,
  type TextInputProps,
} from "react-native";

/** Visibility is local and never changes the controlled credential value. */
export function PasswordInput(props: Omit<TextInputProps, "secureTextEntry">) {
  const [visible, setVisible] = useState(false);
  return (
    <View style={styles.field}>
      <TextInput
        {...props}
        accessibilityLabel={props.accessibilityLabel ?? props.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry={!visible}
      />
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={visible ? "Hide password" : "Show password"}
        accessibilityState={{
          expanded: visible,
          disabled: props.editable === false,
        }}
        disabled={props.editable === false}
        onPress={() => setVisible((value) => !value)}
      >
        <Text style={styles.toggle}>
          {visible ? "Hide password" : "Show password"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}
const styles = StyleSheet.create({
  field: { marginBottom: 12 },
  toggle: { color: "#17C964", paddingVertical: 10 },
});
