import React from "react";
import { Text, TextInput, TouchableOpacity } from "react-native";
import { router } from "expo-router";
import LoginScreen from "../../app/(auth)/login";
import EnrollmentScreen from "../../app/(auth)/enroll";
import ActivateScreen from "../../app/(auth)/activate";
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({ requestId: "opaque-request-reference" }),
}));
jest.mock("./authStore", () => ({
  useAuthStore: (select: (state: unknown) => unknown) =>
    select({
      login: jest.fn(),
      verifyEnrollment: jest.fn(),
      acceptEnrollment: jest.fn(),
      activate: jest.fn(),
    }),
}));
interface Node {
  props: {
    children?: unknown;
    onPress?: () => void;
    accessibilityLabel?: string;
    value?: string;
  };
  findAllByType(type: unknown): Node[];
}
const { create, act } = jest.requireActual("react-test-renderer") as {
  create(element: React.ReactElement): {
    root: Node;
    toJSON(): unknown;
    unmount(): void;
  };
  act(fn: () => void | Promise<void>): Promise<void>;
};
it("offers dual-proof enrollment as the primary institutional invitation destination", async () => {
  let view!: ReturnType<typeof create>;
  await act(async () => {
    view = create(React.createElement(LoginScreen));
  });
  const button = view.root
    .findAllByType(TouchableOpacity)
    .find((node) =>
      node
        .findAllByType(Text)
        .some(
          (text) =>
            text.props.children === "Accept an institutional invitation",
        ),
    );
  expect(button).toBeDefined();
  await act(async () => {
    button!.props.onPress!();
  });
  expect(router.push).toHaveBeenCalledWith("/(auth)/enroll");
  await act(async () => view.unmount());
});
it("prefills only the request reference and visibly labels both proof fields", async () => {
  let view!: ReturnType<typeof create>;
  await act(async () => {
    view = create(React.createElement(EnrollmentScreen));
  });
  expect(
    view.root
      .findAllByType(TextInput)
      .find((node) => node.props.accessibilityLabel === "Invitation reference")
      ?.props.value,
  ).toBe("opaque-request-reference");
  const output = JSON.stringify(view.toJSON());
  expect(output).toContain("Email verification code");
  expect(output).toContain("Phone verification code");
  expect(output).toContain("older short invitation code");
  await act(async () => view.unmount());
});
it("preserves legacy activation while clearly identifying its different credential", async () => {
  let view!: ReturnType<typeof create>;
  await act(async () => {
    view = create(React.createElement(ActivateScreen));
  });
  const output = JSON.stringify(view.toJSON());
  expect(output).toContain("Activate an older invitation code");
  expect(output).toContain(
    "New institutional invitation: verify email and phone",
  );
  await act(async () => view.unmount());
});
