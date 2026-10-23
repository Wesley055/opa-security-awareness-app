import React from "react";
import { Alert, TouchableOpacity } from "react-native";
import { router } from "expo-router";
import AccountScreen, { DELETION_WARNING } from "../../app/account";
import { useAuthStore } from "../store/authStore";
const { create, act } = jest.requireActual("react-test-renderer");
jest.mock("expo-router", () => ({
  router: { back: jest.fn() },
  Redirect: ({ href }: { href: string }) =>
    require("react").createElement(require("react-native").Text, null, href),
}));
jest.mock("../store/authStore", () => ({ useAuthStore: jest.fn() }));
const deletion = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  (useAuthStore as unknown as jest.Mock).mockReturnValue({
    isAuthenticated: true,
    isDeleting: false,
    deleteAccount: deletion,
  });
  deletion.mockResolvedValue(undefined);
});
it("requires deliberate destructive confirmation; cancellation makes no request", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  let view: ReturnType<typeof create>;
  await act(async () => {
    view = create(React.createElement(AccountScreen));
  });
  const button = view.root
    .findAllByType(TouchableOpacity)
    .find(
      (item: { props: { accessibilityLabel?: string } }) =>
        item.props.accessibilityLabel === "Delete Account",
    );
  await act(async () => button.props.onPress());
  expect(alert).toHaveBeenCalledWith(
    "Delete account permanently?",
    DELETION_WARNING,
    expect.any(Array),
    expect.any(Object),
  );
  expect(deletion).not.toHaveBeenCalled();
  await act(async () => alert.mock.calls[0]![2]![0]!.onPress?.());
  expect(deletion).not.toHaveBeenCalled();
  await act(async () => button.props.onPress());
  await act(async () => alert.mock.calls[1]![2]![1]!.onPress?.());
  expect(deletion).toHaveBeenCalledTimes(1);
  await act(async () => view.unmount());
  alert.mockRestore();
});
it("renders a login redirect after the authenticated state is cleared", async () => {
  (useAuthStore as unknown as jest.Mock).mockReturnValue({
    isAuthenticated: false,
  });
  let view: ReturnType<typeof create>;
  await act(async () => {
    view = create(React.createElement(AccountScreen));
  });
  expect(JSON.stringify(view.toJSON())).toContain("/(auth)/login");
  expect(router.back).not.toHaveBeenCalled();
  await act(async () => view.unmount());
});
