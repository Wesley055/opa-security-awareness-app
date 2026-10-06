import React from "react";
import { PasswordInput } from "./PasswordInput";
import { TextInput, TouchableOpacity } from "react-native";
jest.mock("react", () => ({
  ...jest.requireActual("react"),
  useState: jest.fn(),
}));
let visible = false;
beforeEach(() => {
  visible = false;
  (React.useState as jest.Mock).mockImplementation(() => [
    visible,
    (next: (value: boolean) => boolean) => {
      visible = next(visible);
    },
  ]);
});
function fields(props: Parameters<typeof PasswordInput>[0]) {
  const result = PasswordInput(props);
  const children = React.Children.toArray(
    result.props.children,
  ) as React.ReactElement<Record<string, unknown>>[];
  return {
    input: children.find((child) => child.type === TextInput)!,
    toggle: children.find((child) => child.type === TouchableOpacity)!,
  };
}
it("mobile visibility preserves controlled value, password-manager hints and does not submit", () => {
  const onSubmitEditing = jest.fn(),
    onChangeText = jest.fn();
  const props = {
    value: "ephemeral-" + Date.now(),
    textContentType: "password" as const,
    onSubmitEditing,
    onChangeText,
  };
  let view = fields(props);
  expect(view.input.props.secureTextEntry).toBe(true);
  expect(view.toggle.props.accessibilityLabel).toBe("Show password");
  (view.toggle.props.onPress as () => void)();
  view = fields(props);
  expect(view.input.props.secureTextEntry).toBe(false);
  expect(view.input.props.value).toBe(props.value);
  expect(view.input.props.textContentType).toBe("password");
  expect(view.toggle.props.accessibilityState).toEqual({
    expanded: true,
    disabled: false,
  });
  (view.toggle.props.onPress as () => void)();
  view = fields(props);
  expect(view.input.props.secureTextEntry).toBe(true);
  expect(onSubmitEditing).not.toHaveBeenCalled();
  expect(onChangeText).not.toHaveBeenCalled();
});
it("confirmation exposes equivalent accessible controls and honors disabled state", () => {
  const view = fields({
    accessibilityLabel: "Confirm password",
    textContentType: "newPassword",
    editable: false,
  });
  expect(view.input.props.accessibilityLabel).toBe("Confirm password");
  expect(view.input.props.secureTextEntry).toBe(true);
  expect(view.toggle.props.accessibilityRole).toBe("button");
  expect(view.toggle.props.disabled).toBe(true);
});
