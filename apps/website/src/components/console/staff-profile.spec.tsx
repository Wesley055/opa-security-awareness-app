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

it("forgot current password: asks for the phone code (and email code for admins) instead", async () => {
  const transport = vi.fn(async (_p: string, init?: RequestInit) => {
    if (init?.method !== "POST") return new Response(JSON.stringify({ ...profile, role: "FACILITY_ADMIN" }), { status: 200 });
    const body = JSON.parse(String(init.body));
    return body.action === "recovery-start"
      ? new Response(JSON.stringify({ channels: ["SMS", "EMAIL"], phoneHint: "34", smsSent: true, emailSent: true }), { status: 200 })
      : new Response(JSON.stringify({ signedOutEverywhere: true }), { status: 200 });
  });
  render(<StaffProfile session="institutional" transport={transport} onSignedOut={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "Change password" }));
  fireEvent.click(screen.getByRole("button", { name: /Forgot your current password/ }));
  expect(await screen.findByText(/phone ending/)).toBeTruthy();
  expect(screen.queryByLabelText("Current password")).toBeNull();
  fireEvent.change(screen.getByLabelText("Code from your phone"), { target: { value: "123456" } });
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: "New-pass-22" } });
  fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "New-pass-22" } });
  fireEvent.click(screen.getByRole("button", { name: "Validate & change password" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/code sent to your email/);
  fireEvent.change(screen.getByLabelText("Code from your email"), { target: { value: "654321" } });
  fireEvent.click(screen.getByRole("button", { name: "Validate & change password" }));
  await waitFor(() => expect(screen.getByText(/signed out on every device/)).toBeTruthy());
  const last = JSON.parse(String(transport.mock.calls.at(-1)![1]!.body));
  expect(last).toMatchObject({ action: "recovery-complete", smsCode: "123456", emailCode: "654321" });
});
