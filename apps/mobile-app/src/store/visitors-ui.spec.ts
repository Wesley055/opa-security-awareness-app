import React from "react";
import { Text, TextInput, TouchableOpacity } from "react-native";
import VisitorsScreen from "../../app/visitors";
import { api } from "../services/api";

jest.mock("expo-router", () => ({ router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() } }));
jest.mock("@react-navigation/native", () => ({ useFocusEffect: (fn: () => void) => { const React = jest.requireActual("react"); React.useEffect(fn, []); } }));
jest.mock("../services/api", () => ({ api: { get: jest.fn(), post: jest.fn() } }));

interface Node { props: { children?: unknown; onPress?: () => void; onChangeText?: (v: string) => void; accessibilityLabel?: string }; findAllByType(type: unknown): Node[] }
const { create, act } = jest.requireActual("react-test-renderer") as {
  create(element: React.ReactElement): { root: Node; toJSON(): unknown; unmount(): void };
  act(fn: () => void | Promise<void>): Promise<void>;
};
const pass = { id: "p1", visitorName: "Chidi Okafor", destination: "Block C, House 12", status: "ISSUED", validFrom: "2026-10-18T08:00:00Z", validUntil: "2026-10-19T08:00:00Z", expectedMinutes: 240, checkedInAt: null, checkedOutAt: null, expectedExitAt: null, departureUnconfirmed: false };

it("creates a pass and shows the six-digit code to share", async () => {
  (api.get as jest.Mock).mockResolvedValue({ data: { passes: [] } });
  (api.post as jest.Mock).mockResolvedValue({ data: { code: "482913", pass } });
  let view!: ReturnType<typeof create>;
  await act(async () => { view = create(React.createElement(VisitorsScreen)); });
  const input = (label: string) => view.root.findAllByType(TextInput).find((n) => n.props.accessibilityLabel === label)!;
  await act(async () => { input("Visitor's name").props.onChangeText!("Chidi Okafor"); input("House, street or block").props.onChangeText!("Block C, House 12"); });
  const createButton = view.root.findAllByType(TouchableOpacity).find((n) => n.findAllByType(Text).some((t) => t.props.children === "Create pass"))!;
  await act(async () => { createButton.props.onPress!(); });
  expect(api.post).toHaveBeenCalledWith("/estate/passes", { visitorName: "Chidi Okafor", destination: "Block C, House 12" });
  const output = JSON.stringify(view.toJSON());
  expect(output).toContain("482");
  expect(output).toContain("913");
  expect(output).toContain("Share code");
  await act(async () => view.unmount());
});

it("rejects a phone that is not in international format before calling OPA", async () => {
  (api.get as jest.Mock).mockResolvedValue({ data: { passes: [] } });
  (api.post as jest.Mock).mockClear();
  let view!: ReturnType<typeof create>;
  await act(async () => { view = create(React.createElement(VisitorsScreen)); });
  const input = (label: string) => view.root.findAllByType(TextInput).find((n) => n.props.accessibilityLabel === label)!;
  await act(async () => { input("Visitor's name").props.onChangeText!("Ada"); input("Visitor's phone").props.onChangeText!("08012345678"); input("House, street or block").props.onChangeText!("House 4"); });
  const createButton = view.root.findAllByType(TouchableOpacity).find((n) => n.findAllByType(Text).some((t) => t.props.children === "Create pass"))!;
  await act(async () => { createButton.props.onPress!(); });
  expect(api.post).not.toHaveBeenCalled();
  expect(JSON.stringify(view.toJSON())).toContain("international format");
  await act(async () => view.unmount());
});
