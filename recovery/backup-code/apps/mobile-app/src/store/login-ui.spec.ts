import React from "react";
import { Text, TextInput, TouchableOpacity } from "react-native";
import LoginScreen from "../../app/(auth)/login";
import { router } from "expo-router";
const mockLogin = jest.fn();
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn() },
}));
jest.mock("./authStore", () => ({
  useAuthStore: (select: (state: unknown) => unknown) =>
    select({ login: mockLogin }),
}));
const { create, act } = jest.requireActual("react-test-renderer");
async function renderLogin() {
  let view: any;
  await act(async () => {
    view = create(React.createElement(LoginScreen));
  });
  await act(async () => {
    view.root
      .findAllByType(TextInput)[0]
      .props.onChangeText("user@example.test");
    view.root
      .findAllByType(TextInput)[1]
      .props.onChangeText("existing-password-longer-than-12");
  });
  return view;
}
function submit(view: any) {
  return view.root
    .findAllByType(TouchableOpacity)
    .find((n: any) =>
      n.findAllByType(Text).some((t: any) => t.props.children === "Sign In"),
    );
}
beforeEach(() => mockLogin.mockReset());
it("has a visible Sign In button and permits existing long passwords", async () => {
  const view = await renderLogin();
  mockLogin.mockResolvedValueOnce(undefined);
  await act(async () => {
    await submit(view).props.onPress();
  });
  expect(mockLogin).toHaveBeenCalledWith(
    "user@example.test",
    "existing-password-longer-than-12",
  );
  expect(router.replace).toHaveBeenCalledWith("/");
  await act(async () => view.unmount());
}, 20000);
it.each([
  [{ response: { status: 401 } }, "Check your email"],
  [{ response: { status: 500 } }, "temporarily unavailable"],
  [new Error("offline"), "Check your connection"],
])(
  "shows a bounded actionable login error",
  async (error, message) => {
    const view = await renderLogin();
    mockLogin.mockRejectedValueOnce(error);
    await act(async () => {
      await submit(view).props.onPress();
    });
    expect(JSON.stringify(view.toJSON())).toContain(message);
    expect(submit(view).props.disabled).toBe(false);
    await act(async () => view.unmount());
  },
  20000,
);
it("blocks duplicate submission until the request settles", async () => {
  const view = await renderLogin();
  let finish!: () => void;
  mockLogin.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const button = submit(view);
  let first: Promise<void>, second: Promise<void>;
  await act(async () => {
    first = button.props.onPress();
    second = button.props.onPress();
  });
  expect(mockLogin).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish();
    await first!;
    await second!;
  });
  expect(submit(view).props.disabled).toBe(false);
  await act(async () => view.unmount());
}, 20000);
