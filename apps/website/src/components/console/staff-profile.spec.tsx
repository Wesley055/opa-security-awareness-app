import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { StaffProfile } from "./staff-profile";

const profile = { firstName: "Philips", lastName: "Clay", role: "FACILITY_OPERATOR", facility: { name: "Quartz", type: "OTHER" }, photo: { status: null, url: null, updatedAt: null }, photoRequiredForDuty: true };

function setup(reply: (body: Record<string, string>) => Response) {
  const transport = vi.fn(async (_p: string, init?: RequestInit) => (init?.method === "POST" ? reply(JSON.parse(String(init.body))) : new Response(JSON.stringify(profile), { status: 200 })));
  render(<StaffProfile session="institutional" transport={transport} onSignedOut={() => {}} />);
  return transport;
}

it("keeps password fields collapsed until Change password is clicked", async () => {
  setup(() => new Response("{}", { status: 200 }));
  expect(await screen.findByText("Account security")).toBeTruthy();
  expect(screen.queryByLabelText("Current password")).toBeNull();
  expect(screen.getByText("Add photo")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Change password" }));
  expect(screen.getByLabelText("Current password")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Validate & change password" })).toBeTruthy();
});

it("validates in the browser before sending, and shows the server's refusal", async () => {
  const transport = setup(() => new Response(JSON.stringify({ error: "Your current password is not correct." }), { status: 400 }));
  fireEvent.click(await screen.findByRole("button", { name: "Change password" }));
  fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "old-pass-1" } });
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: "New-pass-22" } });
  fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "different-1" } });
  fireEvent.click(screen.getByRole("button", { name: "Validate & change password" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/do not match/);
  expect(transport.mock.calls.filter((c) => c[1]?.method === "POST")).toHaveLength(0);
  fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "New-pass-22" } });
  fireEvent.click(screen.getByRole("button", { name: "Validate & change password" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/current password is not correct/));
});
