import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const calls: { body?: Record<string, unknown> }[] = [];
const pass = {
  passId: "33333333-3333-4333-8333-333333333333", status: "ISSUED", visitorName: "Chidi Okafor", visitorPhone: "•••• 5678",
  destination: "Block C, House 12", validFrom: new Date().toISOString(), validUntil: new Date(Date.now() + 3600e3).toISOString(),
  checkedInAt: null, expectedExitAt: null, overdue: false, action: "ADMIT",
};
vi.mock("@/lib/viewer-session-fetch", () => ({
  viewerSessionFetch: vi.fn(async (_url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ body });
    const data = !body ? { observedAt: new Date().toISOString(), inside: [], events: [] }
      : body.action === "verify" ? { pass } : { pass: { ...pass, status: "CHECKED_IN" } };
    return new Response(JSON.stringify(data), { status: 200 });
  }),
}));
import { GateConsole } from "./gate-console";
afterEach(() => { cleanup(); calls.length = 0; });

it("lets a guard check a typed code, see the visitor and house, then admit", async () => {
  render(<GateConsole />);
  fireEvent.change(screen.getByLabelText("Visitor code"), { target: { value: "482 913" } });
  fireEvent.click(screen.getByRole("button", { name: "Check code" }));
  expect(await screen.findByText("Chidi Okafor")).toBeInTheDocument();
  expect(screen.getByText("Block C, House 12")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Admit" }));
  await waitFor(() => expect(screen.getByText("Visitor admitted.")).toBeInTheDocument());
  expect(calls.map((c) => c.body?.action).filter(Boolean)).toEqual(["verify", "admit"]);
  expect(calls.find((c) => c.body?.action === "admit")?.body?.passId).toBe(pass.passId);
});

it("never needs a camera: there is no QR requirement on the gate screen", () => {
  render(<GateConsole />);
  expect(screen.queryByText(/scan/i)).toBeNull();
  expect(screen.getByLabelText("Visitor code")).toHaveAttribute("inputmode", "numeric");
});
