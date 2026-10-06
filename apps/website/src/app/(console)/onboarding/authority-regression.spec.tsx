import {
  render,
  screen,
  waitFor,
  fireEvent,
  cleanup,
  act,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Workspace from "./workspace";
const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/onboarding-fetch", () => ({ onboardingFetch: api }));
const a = "00000000-0000-4000-8000-000000000001",
  b = "00000000-0000-4000-8000-000000000002";
let status = 200,
  actor = { id: "admin", role: "ADMIN" },
  facilities = [
    { id: a, name: "Facility A" },
    { id: b, name: "Facility B" },
  ];
beforeEach(() => {
  status = 200;
  actor = { id: "admin", role: "ADMIN" };
  facilities = [
    { id: a, name: "Facility A" },
    { id: b, name: "Facility B" },
  ];
  api.mockReset();
  api.mockImplementation(async (path: string) => ({
    ok: status === 200,
    status,
    json: async () =>
      status === 200
        ? path === "facilities"
          ? { actor, facilities, nextCursor: null }
          : { invitations: [], nextCursor: null }
        : { error: "Current authority required." },
  }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe("rendered onboarding authority", () => {
  it.each([401, 403])("removes rendered authority after %s", async (denied) => {
    render(<Workspace />);
    await screen.findByRole("option", { name: "Facility B" });
    await userEvent.selectOptions(
      screen.getByLabelText("Authorized facility"),
      b,
    );
    await screen.findByRole("heading", { name: "Invite staff" });
    status = denied;
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("option", { name: "Facility B" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("heading", { name: "Invite staff" }),
    ).not.toBeInTheDocument();
  });
  it("clears ADMIN-era selection on focus and changes to Support scope", async () => {
    render(<Workspace />);
    await screen.findByRole("option", { name: "Facility B" });
    await userEvent.selectOptions(
      screen.getByLabelText("Authorized facility"),
      b,
    );
    actor = { id: "support", role: "USER" };
    facilities = [{ id: a, name: "Facility A" }];
    fireEvent(window, new Event("focus"));
    await waitFor(() =>
      expect(
        screen.queryByRole("option", { name: "Facility B" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Authorized facility")).toHaveValue("");
    expect(screen.getByText(/support.*USER/)).toBeInTheDocument();
  });
});

it("removes revoked facilities during background revalidation without refreshing the page", async () => {
  actor = { id: "support", role: "USER" };
  facilities = [{ id: a, name: "Facility A" }];
  render(<Workspace />);
  await screen.findByRole("option", { name: "Facility A" });
  await userEvent.selectOptions(
    screen.getByLabelText("Authorized facility"),
    a,
  );
  facilities = [];
  await waitFor(
    () =>
      expect(
        screen.queryByRole("option", { name: "Facility A" }),
      ).not.toBeInTheDocument(),
    { timeout: 7000 },
  );
  expect(
    screen.queryByRole("heading", { name: "Invite staff" }),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText("Authorized facility")).toHaveValue("");
}, 10000);
it("clears authorization before a restored-session response and ignores a previous in-flight response", async () => {
  render(<Workspace />);
  await screen.findByRole("option", { name: "Facility B" });
  let complete!: (value: unknown) => void;
  api.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  fireEvent(window, new Event("focus"));
  expect(
    screen.queryByLabelText("Authorized facility"),
  ).not.toBeInTheDocument();
  actor = { id: "support", role: "USER" };
  facilities = [{ id: a, name: "Facility A" }];
  fireEvent(window, new Event("opa-onboarding-session"));
  await screen.findByRole("option", { name: "Facility A" });
  await act(async () =>
    complete({
      ok: true,
      status: 200,
      json: async () => ({
        actor: { id: "admin", role: "ADMIN" },
        facilities: [{ id: b, name: "Facility B" }],
        nextCursor: null,
      }),
    }),
  );
  expect(
    screen.queryByRole("option", { name: "Facility B" }),
  ).not.toBeInTheDocument();
});

it("fails closed when a periodic authority request hangs", async () => {
  vi.useFakeTimers();
  await act(async () => {
    render(<Workspace />);
  });
  expect(
    screen.getByRole("option", { name: "Facility B" }),
  ).toBeInTheDocument();
  api.mockImplementation(
    (_path: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal!.addEventListener(
          "abort",
          () => reject(new DOMException("Timed out", "AbortError")),
          { once: true },
        );
      }),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15000);
  });
  expect(
    screen.queryByLabelText("Authorized facility"),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText(/Current authority could not be confirmed/),
  ).toBeInTheDocument();
});
