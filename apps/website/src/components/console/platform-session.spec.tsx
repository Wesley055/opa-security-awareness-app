import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
import { PlatformSession } from "./platform-session";
const initial = { id: "admin-a", name: "Current Admin", role: "ADMIN" };
beforeEach(() =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(initial)),
  ),
);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it("preserves platform identity and children during a background read", async () => {
  render(
    <PlatformSession initial={initial}>
      <p>Protected governance</p>
    </PlatformSession>,
  );
  let finish!: (r: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  fireEvent(window, new Event("focus"));
  fireEvent(window, new Event("pageshow"));
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Current Admin")).toBeInTheDocument();
  expect(screen.getByText("Protected governance")).toBeInTheDocument();
  await act(async () => finish(Response.json(initial)));
  expect(screen.getByText("Current Admin")).toBeInTheDocument();
});
it("clears identity and protected children immediately on authority loss", () => {
  render(
    <PlatformSession initial={initial}>
      <p>Protected governance</p>
    </PlatformSession>,
  );
  fireEvent(window, new Event("opa-super-admin-authority-lost"));
  expect(screen.queryByText("Current Admin")).not.toBeInTheDocument();
  expect(screen.queryByText("Protected governance")).not.toBeInTheDocument();
});
it("does not expose prior actor children after an account switch", async () => {
  render(
    <PlatformSession initial={initial}>
      <p>Old actor data</p>
    </PlatformSession>,
  );
  vi.mocked(fetch).mockResolvedValue(
    Response.json({ ...initial, id: "admin-b", name: "New Admin" }),
  );
  fireEvent(window, new Event("focus"));
  await screen.findByText(/Account changed/);
  expect(screen.queryByText("Old actor data")).not.toBeInTheDocument();
  expect(screen.queryByText("Current Admin")).not.toBeInTheDocument();
  expect(router.refresh).toHaveBeenCalledTimes(1);
});

it("server-confirmed actor replacement discards the prior actor child draft", () => {
  function Draft() {
    const [value, setValue] = useState("");
    return (
      <input
        aria-label="Private draft"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
    );
  }
  const view = render(
    <PlatformSession initial={initial}>
      <Draft />
    </PlatformSession>,
  );
  fireEvent.change(screen.getByLabelText("Private draft"), {
    target: { value: "previous actor draft" },
  });
  view.rerender(
    <PlatformSession initial={{ ...initial, id: "admin-b", name: "New Admin" }}>
      <Draft />
    </PlatformSession>,
  );
  expect(screen.getByLabelText("Private draft")).toHaveValue("");
  expect(screen.queryByText("Current Admin")).not.toBeInTheDocument();
  expect(screen.getByText("New Admin")).toBeInTheDocument();
});
