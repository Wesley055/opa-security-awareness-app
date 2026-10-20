import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DutyPanel } from "./duty-panel";

vi.mock("@/lib/viewer-session-fetch", () => ({
  viewerSessionFetch: vi.fn(async (path: string) =>
    new Response(JSON.stringify(path === "/api/operator/duty" ? { shift: null, photoApproved: false, reportsMissing: [], maxShiftHours: 12 } : []), { status: 200 }),
  ),
}));
afterEach(() => vi.clearAllMocks());

it("needs an approved photo to start duty but says emergencies never wait", async () => {
  render(<DutyPanel />);
  const start = await screen.findByRole("button", { name: "Start duty" });
  expect((start as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/respond to every SOS with or without a shift/)).toBeTruthy();
});
