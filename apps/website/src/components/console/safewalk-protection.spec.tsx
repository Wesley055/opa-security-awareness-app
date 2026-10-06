import {
  act,
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { SafeWalkProtection } from "./safewalk-protection";
import { emergencyFixture, incident } from "@/test/safewalk-emergency";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const transport = () =>
  vi.fn().mockImplementation(async () => Response.json(emergencyFixture()));
describe("SafeWalk Protection exception surface", () => {
  it("shows only supported emergency facts and links existing Incident/Evidence controls", async () => {
    render(<SafeWalkProtection transport={transport()} />);
    await screen.findByText(incident);
    expect(screen.getByText("Escalated to emergency")).toBeTruthy();
    expect(
      screen.getByText("No emergency-period location received"),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /Open Incident/ }).getAttribute("href"),
    ).toBe("/operator/incidents/" + incident);
  });
  it("does not add Operator response controls for institutional observers", async () => {
    render(
      <SafeWalkProtection transport={transport()} incidentLinks={false} />,
    );
    await screen.findByText(incident);
    expect(screen.queryByRole("link", { name: /Open Incident/ })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /acknowledge|dispatch|resolve/i }),
    ).toBeNull();
  });
  it("shows empty emergencies without claiming ordinary journeys do not exist", async () => {
    const read = vi
      .fn()
      .mockResolvedValue(
        Response.json({ ...emergencyFixture(), incidents: [] }),
      );
    render(<SafeWalkProtection transport={read} />);
    await screen.findByText(/No SafeWalk-origin emergencies/);
    expect(screen.getByText(/Private journeys remain private/)).toBeTruthy();
  });
  it("preserves records during transient failure and does not log out", async () => {
    const read = transport(),
      lost = vi.fn();
    window.addEventListener("opa:access-changed", lost);
    render(<SafeWalkProtection transport={read} />);
    await screen.findByText(incident);
    read.mockImplementationOnce(
      async () => new Response(null, { status: 503 }),
    );
    fireEvent(window, new Event("focus"));
    await screen.findByText(/temporarily unavailable/);
    expect(screen.getByText(incident)).toBeTruthy();
    expect(lost).not.toHaveBeenCalled();
    window.removeEventListener("opa:access-changed", lost);
  });
  it.each([401, 403, 404, 409])(
    "clears records and stops new reads on %s",
    async (status) => {
      const read = transport();
      render(<SafeWalkProtection transport={read} />);
      await screen.findByText(incident);
      read.mockImplementationOnce(async () => new Response(null, { status }));
      fireEvent(window, new Event("focus"));
      await screen.findByText(/visibility ended/);
      expect(screen.queryByText(incident)).toBeNull();
      const calls = read.mock.calls.length;
      fireEvent(window, new Event("focus"));
      expect(read).toHaveBeenCalledTimes(calls);
    },
  );
  it("stops polling after confirmed logout", async () => {
    vi.useFakeTimers();
    const read = transport();
    render(<SafeWalkProtection transport={read} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    fireEvent(window, new Event("opa:access-changed"));
    const calls = read.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(read).toHaveBeenCalledTimes(calls);
    expect(screen.queryByText(incident)).toBeNull();
  });
  it("actor remount discards prior data and ignores its late response", async () => {
    let resolve!: (r: Response) => void;
    const first = vi.fn().mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const next = vi
      .fn()
      .mockResolvedValue(
        Response.json({ ...emergencyFixture(), incidents: [] }),
      );
    const ui = render(<SafeWalkProtection key="first" transport={first} />);
    ui.rerender(<SafeWalkProtection key="second" transport={next} />);
    await screen.findByText(/No SafeWalk-origin/);
    await act(async () => resolve(Response.json(emergencyFixture())));
    expect(screen.queryByText(incident)).toBeNull();
  });
  it("clears previous facility data synchronously on endpoint change", async () => {
    const read = transport();
    const ui = render(<SafeWalkProtection endpoint="first" transport={read} />);
    await screen.findByText(incident);
    read.mockReturnValueOnce(new Promise(() => {}));
    ui.rerender(<SafeWalkProtection endpoint="second" transport={read} />);
    expect(screen.queryByText(incident)).toBeNull();
  });
  it("focus and restoration revalidate without clearing a valid scope or inventing delivery", async () => {
    const read = transport();
    render(<SafeWalkProtection transport={read} />);
    await screen.findByText(incident);
    fireEvent(window, new Event("focus"));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    fireEvent(window, new Event("pageshow"));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(3));
    expect(screen.getByText(incident)).toBeTruthy();
    expect(
      screen.getByText(/do not prove current device connectivity/),
    ).toBeTruthy();
  });
});
