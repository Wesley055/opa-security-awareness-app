import { StrictMode } from "react";
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import Workspace from "./workspace";
const a = "00000000-0000-4000-8000-000000000001",
  b = "00000000-0000-4000-8000-000000000002";
let actor = { id: "support", role: "TECHNICAL_SUPPORT" },
  facilities = [
    {
      id: a,
      name: "Facility A",
      capabilities: ["STAFF_READ", "STAFF_PROVISION"],
    },
  ],
  status = 200;
beforeEach(() => {
  sessionStorage.clear();
  actor = { id: "support", role: "TECHNICAL_SUPPORT" };
  facilities = [
    {
      id: a,
      name: "Facility A",
      capabilities: ["STAFF_READ", "STAFF_PROVISION"],
    },
  ];
  status = 200;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json(
        { actor: { ...actor, name: actor.id }, facilities },
        { status },
      ),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("institutional rendered authorization", () => {
  it("shows only authorized Facility A and identifies actual actor", async () => {
    render(<Workspace />);
    await screen.findByRole("option", { name: "Facility A" });
    expect(
      screen.queryByRole("option", { name: "Facility B" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("support")).toBeInTheDocument();
  });
  it("preserves selected facility after successful authority revalidation", async () => {
    render(<Workspace />);
    await screen.findByRole("option", { name: "Facility A" });

    const selector = screen.getByLabelText(
      /Authorized facility|My assigned facilities/,
    );

    fireEvent.change(selector, {
      target: { value: a },
    });

    await waitFor(() => expect(selector).toHaveValue(a));

    fireEvent(window, new Event("focus"));

    await waitFor(() =>
      expect(
        screen.getByLabelText(/Authorized facility|My assigned facilities/),
      ).toHaveValue(a),
    );

    expect(
      screen.getByRole("heading", { name: "Facility A" }),
    ).toBeInTheDocument();
  });
  it.each([401, 403])(
    "clears rendered facilities after authority fails with %s",
    async (denied) => {
      render(<Workspace />);
      await screen.findByRole("option", { name: "Facility A" });
      fireEvent.change(
        screen.getByLabelText(/Authorized facility|My assigned facilities/),
        {
          target: { value: a },
        },
      );
      fireEvent.click(screen.getByRole("button", { name: "Commissioning" }));
      expect(
        screen.getByRole("heading", { name: "Provision first Facility Administrator" }),
      ).toBeInTheDocument();
      status = denied;
      fireEvent(window, new Event("focus"));
      await waitFor(() =>
        expect(
          screen.queryByRole("option", { name: "Facility A" }),
        ).not.toBeInTheDocument(),
      );
      expect(
        screen.queryByRole("heading", { name: "Provision first Facility Administrator" }),
      ).not.toBeInTheDocument();
    },
  );
  it("revocation removes selection and draft on restoration", async () => {
    render(<Workspace />);
    await screen.findByRole("option", { name: "Facility A" });
    fireEvent.change(
      screen.getByLabelText(/Authorized facility|My assigned facilities/),
      {
        target: { value: a },
      },
    );
    facilities = [];
    fireEvent(window, new Event("pageshow"));
    await waitFor(() =>
      expect(
        screen.queryByRole("option", { name: "Facility A" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("heading", { name: "Provision first Facility Administrator" }),
    ).not.toBeInTheDocument();
  });
  it("does not retain ADMIN-era Facility B when switching actor", async () => {
    actor = { id: "admin", role: "ADMIN" };
    facilities.push({
      id: b,
      name: "Facility B",
      capabilities: ["PLATFORM_ADMIN"],
    });
    render(<Workspace />);
    await screen.findByRole("option", { name: "Facility B" });
    fireEvent.change(
      screen.getByLabelText(/Authorized facility|My assigned facilities/),
      {
        target: { value: b },
      },
    );
    actor = { id: "support", role: "TECHNICAL_SUPPORT" };
    facilities = facilities.filter((f) => f.id === a);
    fireEvent(window, new Event("focus"));
    await screen.findByText("support");
    expect(
      screen.queryByRole("option", { name: "Facility B" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByLabelText(/Authorized facility|My assigned facilities/),
    ).toHaveValue("");
  });
  it("Operator can record operational events but has no institutional resolution or administration form", async () => {
    actor = { id: "operator", role: "FACILITY_OPERATOR" };
    facilities = [
      { id: a, name: "Facility A", capabilities: ["FACILITY_OPERATOR"] },
    ];
    render(<Workspace />);
    const commandCenter = await screen.findByRole("button", {
      name: "Open Command Center",
    });
    const handoffForm = commandCenter.closest("form");

    expect(handoffForm).not.toBeNull();
    expect(handoffForm).toHaveAttribute(
      "action",
      "/api/institutional/operator-handoff",
    );
    expect(handoffForm).toHaveAttribute("method", "post");
    expect(
      screen.queryByRole("link", { name: "Open Command Center" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Resolve incident" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Manage membership" }),
    ).not.toBeInTheDocument();
  });
  it("clears prior actor scope on a same-origin session change signal", async () => {
    render(<Workspace />);
    await screen.findByRole("option", { name: "Facility A" });
    fireEvent.change(
      screen.getByLabelText(/Authorized facility|My assigned facilities/),
      {
        target: { value: a },
      },
    );
    status = 401;
    fireEvent(
      window,
      new StorageEvent("storage", {
        key: "opa-institutional-session",
        newValue: "changed",
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("option", { name: "Facility A" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("heading", { name: "Provision first Facility Administrator" }),
    ).not.toBeInTheDocument();
  });
  it("ADMIN global recovery is routed to exclusive platform governance", async () => {
    actor = { id: "admin", role: "ADMIN" };
    render(<Workspace />);
    expect(
      await screen.findByRole("link", {
        name: "Open platform governance and recovery",
      }),
    ).toHaveAttribute("href", "/super-admin/organization");
    expect(
      screen.queryByRole("heading", { name: "Recover global account access" }),
    ).not.toBeInTheDocument();
    expect(
      vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(0);
  });
});

it("StrictMode starts one current context read and removes restoration listeners on unmount", async () => {
  const view = render(
    <StrictMode>
      <Workspace />
    </StrictMode>,
  );
  await screen.findByRole("option", { name: "Facility A" });
  expect(
    vi
      .mocked(fetch)
      .mock.calls.filter(([path]) => String(path).endsWith("/context")),
  ).toHaveLength(1);
  view.unmount();
  const before = vi.mocked(fetch).mock.calls.length;
  await act(async () => {
    fireEvent(window, new Event("focus"));
    fireEvent(window, new Event("pageshow"));
    await Promise.resolve();
  });
  expect(fetch).toHaveBeenCalledTimes(before);
});
