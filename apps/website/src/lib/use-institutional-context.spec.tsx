import { StrictMode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useInstitutionalContext } from "./use-institutional-context";
const context = (name = "Current Person", id = "actor-a") => ({
  actor: { id, name, role: "TECHNICAL_SUPPORT" },
  facilities: [{ id: "a", name: "Facility A", capabilities: ["STAFF_READ"] }],
});
function Probe() {
  const a = useInstitutionalContext();
  return (
    <>
      <p>{a.context?.actor.name ?? "No identity"}</p>
      <output>{a.state}</output>
      <button disabled={!a.canMutate}>Authorized action</button>
    </>
  );
}
beforeEach(() =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(context())),
  ),
);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it.each(["focus", "pageshow", "visibilitychange"])(
  "preserves READY identity and controls during %s validation",
  async (event) => {
    render(<Probe />);
    await screen.findByText("Current Person");
    let finish!: (r: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    fireEvent(
      event === "visibilitychange" ? document : window,
      new Event(event),
    );
    expect(screen.getByText("Current Person")).toBeInTheDocument();
    expect(screen.getByText("READY")).toBeInTheDocument();
    expect(screen.getByRole("button")).toBeEnabled();
    await act(async () => finish(Response.json(context())));
    expect(screen.getByText("READY")).toBeInTheDocument();
  },
);
it("coalesces concurrent context triggers", async () => {
  render(<Probe />);
  await screen.findByText("Current Person");
  let finish!: (r: Response) => void;
  vi.mocked(fetch)
    .mockClear()
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          finish = r;
        }),
    );
  fireEvent(window, new Event("focus"));
  fireEvent(window, new Event("pageshow"));
  expect(fetch).toHaveBeenCalledTimes(1);
  await act(async () => finish(Response.json(context())));
});
it("discarded response cannot resurrect identity after authority loss", async () => {
  render(<Probe />);
  await screen.findByText("Current Person");
  let finish!: (r: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  fireEvent(window, new Event("focus"));
  fireEvent(window, new Event("opa-institutional-authority-lost"));
  await act(async () => finish(Response.json(context("Old person"))));
  expect(screen.queryByText("Old person")).not.toBeInTheDocument();
  expect(screen.getByText("AUTHORITY_EXPIRED")).toBeInTheDocument();
});
it("replaces actor identity from current authority", async () => {
  render(<Probe />);
  await screen.findByText("Current Person");
  vi.mocked(fetch).mockResolvedValue(
    Response.json(context("New Person", "actor-b")),
  );
  fireEvent(window, new Event("focus"));
  await screen.findByText("New Person");
  expect(screen.queryByText("Current Person")).not.toBeInTheDocument();
});
it("StrictMode starts one read and cleans event listeners", async () => {
  const view = render(
    <StrictMode>
      <Probe />
    </StrictMode>,
  );
  await screen.findByText("Current Person");
  expect(fetch).toHaveBeenCalledTimes(1);
  view.unmount();
  fireEvent(window, new Event("focus"));
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("temporary service failure pauses actions without publishing logout", async () => {
  render(<Probe />);
  await screen.findByText("Current Person");
  vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }));
  fireEvent(window, new Event("focus"));
  await waitFor(() => expect(screen.getByRole("button")).toBeDisabled());
  expect(screen.getByText("Current Person")).toBeInTheDocument();
  expect(screen.queryByText("AUTHORITY_EXPIRED")).not.toBeInTheDocument();
});

it("does not remount sign-in through automatic reads after genuine session loss", async () => {
  vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 401 }));
  render(<Probe />);
  await screen.findByText("AUTHORITY_EXPIRED");
  const count = vi.mocked(fetch).mock.calls.length;
  vi.useFakeTimers();
  fireEvent(window, new Event("focus"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000);
  });
  expect(fetch).toHaveBeenCalledTimes(count);
  expect(screen.getByText("AUTHORITY_EXPIRED")).toBeInTheDocument();
});
