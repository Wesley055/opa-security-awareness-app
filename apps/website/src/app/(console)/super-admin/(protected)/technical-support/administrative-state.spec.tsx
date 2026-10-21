import { StrictMode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import Workspace from "./workspace";
import {
  fixture,
  install,
  show,
  fillInvite,
  form,
  set,
  prepare,
  submit,
  success,
  writes,
  type Fixture,
} from "@/test/governance-browser";
let state: Fixture;
beforeEach(() => {
  state = fixture();
  install(state);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it.each([500, 401, 403])(
  "initial load %s terminates without usable authority",
  async (status) => {
    state.status = status;
    render(<Workspace />);
    await waitFor(() =>
      expect(screen.getAllByRole("status")[0]).not.toHaveTextContent(
        "INITIAL LOADING",
      ),
    );
    expect(screen.queryByLabelText("First name")).not.toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  },
);
it("hung initial load ends at the body-inclusive deadline", async () => {
  vi.useFakeTimers();
  vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
  render(<Workspace />);
  await act(async () => vi.advanceTimersByTimeAsync(15001));
  expect(screen.getAllByRole("status")[0]).toHaveTextContent(/timed out/);
  expect(screen.getAllByRole("status")[0]).not.toHaveTextContent(
    "INITIAL LOADING",
  );
});
it.each([
  ["First name", ""],
  ["Last name", ""],
  ["Email", "invalid"],
  ["Phone in international format", "123"],
])("invalid %s has visible validation and zero POST", async (label, value) => {
  await show(state);
  const element = fillInvite();
  set(label, value, element);
  submit("Invite Technical Support");
  expect(writes()).toHaveLength(0);
  expect(within(element).getByRole("alert")).toBeInTheDocument();
});
it("missing reason explains its disabled action", async () => {
  await show(state);
  const element = fillInvite();
  set("Reason for this action", "", element);
  expect(within(element).getByText("Reason required.")).toBeInTheDocument();
  submit("Invite Technical Support");
  expect(writes()).toHaveLength(0);
});
it.each(["focus", "pageshow"])(
  "%s preserves safe drafts and validation",
  async (event) => {
    await show(state);
    const element = fillInvite();
    set("Email", "invalid", element);
    submit("Invite Technical Support");
    fireEvent(window, new Event(event));
    await waitFor(() =>
      expect(screen.getAllByRole("status")[0]).toHaveTextContent(
        "Platform context confirmed",
      ),
    );
    expect(screen.getByLabelText("Email")).toHaveValue("invalid");
    expect(
      within(form("Invite Technical Support")).getByRole("alert"),
    ).toBeInTheDocument();
  },
);
it.each(["focus", "pageshow", "poll"])(
  "%s cannot unlock a pending invitation or block independent employment after revalidation",
  async (event) => {
    await show(state);
    fillInvite();
    const original = vi.mocked(fetch).getMockImplementation()!;
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockImplementation((input, init) =>
      String(input).endsWith("/invitations") && init?.method === "POST"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : original(input, init),
    );
    submit("Invite Technical Support");
    await waitFor(() => expect(writes()).toHaveLength(1));
    if (event === "poll")
      fireEvent.click(
        screen.getByRole("button", { name: "Refresh current state" }),
      );
    else fireEvent(window, new Event(event));
    await waitFor(() =>
      expect(screen.getAllByRole("status")[0]).toHaveTextContent(
        "Platform context confirmed",
      ),
    );
    submit("Invite Technical Support");
    expect(writes()).toHaveLength(1);
    prepare("Suspend employment", true);
    expect(
      within(form("Suspend employment")).getByRole("button", {
        name: "Suspend employment",
      }),
    ).toBeEnabled();
    await act(async () => finish(Response.json({ requestId: state.grant })));
    await success("Invite Technical Support");
  },
);
it("refresh preserves a successful result and the entered draft", async () => {
  await show(state);
  fillInvite();
  submit("Invite Technical Support");
  await success("Invite Technical Support");
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh current state" }),
  );
  await success("Invite Technical Support");
  expect(screen.getByLabelText("Email")).toHaveValue("fixture@example.test");
  expect(writes()).toHaveLength(1);
});
it("refresh failure preserves drafts but pauses writes until confirmed recovery", async () => {
  await show(state);
  fillInvite();
  state.status = 503;
  fireEvent(window, new Event("focus"));
  await waitFor(() =>
    expect(screen.getAllByRole("status")[0]).toHaveTextContent(
      "Current platform authority or service unavailable.",
    ),
  );
  expect(screen.getByLabelText("Email")).toHaveValue("fixture@example.test");
  submit("Invite Technical Support");
  expect(writes()).toHaveLength(0);
  state.status = 200;
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh current state" }),
  );
  await waitFor(() =>
    expect(screen.getAllByRole("status")[0]).toHaveTextContent(
      "Platform context confirmed",
    ),
  );
  expect(
    within(form("Invite Technical Support")).getByRole("button", {
      name: "Invite Technical Support",
    }),
  ).toBeEnabled();
});
it.each([401, 403])(
  "current authority denial after POST %s invalidates privileged state",
  async (status) => {
    await show(state);
    fillInvite();
    state.postStatus = status;
    state.status = status;
    submit("Invite Technical Support");
    if (status === 403) {
      await waitFor(() => expect(writes()).toHaveLength(1));
      fireEvent(window, new Event("focus"));
    }
    await waitFor(() =>
      expect(screen.queryByLabelText("First name")).not.toBeInTheDocument(),
    );
    expect(writes()).toHaveLength(1);
  },
);
it.each([
  ["Suspend employment", "SUSPENDED"],
  ["End employment", "ENDED"],
  ["Activate / reactivate employment", "ACTIVE"],
])("%s records an independent outcome", async (title, target) => {
  await show(state);
  if (target === "ACTIVE") {
    state.directory.employees[0].supportEmployment.state = "SUSPENDED";
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh current state" }),
    );
    await screen.findByText(/Employment: SUSPENDED/);
  }
  prepare(title, true);
  submit(title);
  await success(title);
  expect(JSON.parse(String(writes()[0][1]?.body)).state).toBe(target);
});
it("explicit permission has a separate reviewed outcome", async () => {
  await show(state);
  fireEvent.click(screen.getByText("Advanced permissions"));
  prepare("Grant explicit permission", true);
  submit("Grant explicit permission");
  await success("Grant explicit permission");
  expect(JSON.parse(String(writes()[0][1]?.body))).toMatchObject({
    capability: "STAFF_READ",
    facilityId: state.facility,
  });
});
it("individual permission revocation removes its current record", async () => {
  await show(state);
  prepare("Revoke staff read", true);
  submit("Revoke staff read");
  await waitFor(() =>
    expect(
      state.directory.employees[0].supportGrants[0].revokedAt,
    ).not.toBeNull(),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("heading", { name: "Revoke staff read" }),
    ).not.toBeInTheDocument(),
  );
});
it("revoke all permissions retains employment and reports its own outcome", async () => {
  await show(state);
  prepare("Revoke all support permissions", true);
  submit("Revoke all support permissions");
  await success("Revoke all support permissions");
  expect(state.directory.employees[0].supportEmployment.state).toBe("ACTIVE");
});
it.each([
  "Suspend employment",
  "Grant explicit permission",
  "Revoke staff read",
])("%s definite rejection releases only that operation", async (title) => {
  await show(state);
  if (title === "Grant explicit permission")
    fireEvent.click(screen.getByText("Advanced permissions"));
  prepare(title, true);
  state.postStatus = 409;
  submit(title);
  await waitFor(() =>
    expect(within(form(title)).getByText("SERVER FAILURE")).toBeInTheDocument(),
  );
  expect(
    within(form(title)).getByRole("button", { name: title }),
  ).toBeEnabled();
  expect(screen.getByLabelText("First name")).toBeEnabled();
});
it.each(["", "2000-01-01T00:00"])(
  "invalid sensitive expiry %s sends nothing",
  async (expiry) => {
    await show(state);
    fireEvent.click(screen.getByText("Advanced permissions"));
    set("Permission", "PII_RESOLVE");
    const element = prepare("Grant explicit permission", true);
    set("Required expiry", expiry, element);
    submit("Grant explicit permission");
    expect(writes()).toHaveLength(0);
    expect(within(element).getByRole("alert")).toBeInTheDocument();
  },
);
it("inactive employment cannot grant permissions", async () => {
  await show(state);
  state.directory.employees[0].supportEmployment.state = "SUSPENDED";
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh current state" }),
  );
  await screen.findByText(/Employment: SUSPENDED/);
  prepare("Grant Standard Facility Support permissions");
  submit("Grant Standard Facility Support permissions");
  expect(writes()).toHaveLength(0);
  expect(
    within(form("Grant Standard Facility Support permissions")).getByText(
      /ACTIVE employment/,
    ),
  ).toBeInTheDocument();
});
it("hung mutation ends unknown and reconciles a committed receipt without another POST", async () => {
  await show(state);
  fillInvite();
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation((input, init) =>
    String(input).endsWith("/invitations") && init?.method === "POST"
      ? new Promise(() => {})
      : original(input, init),
  );
  vi.useFakeTimers();
  submit("Invite Technical Support");
  await vi.waitFor(() => expect(writes()).toHaveLength(1));
  await act(async () => vi.advanceTimersByTimeAsync(15001));
  expect(
    within(form("Invite Technical Support")).getByText("RESULT UNKNOWN"),
  ).toBeInTheDocument();
  submit("Invite Technical Support");
  expect(writes()).toHaveLength(1);
  state.receipt = "COMMITTED";
  fireEvent.click(
    within(form("Invite Technical Support")).getByRole("button", {
      name: "Check recorded result",
    }),
  );
  await vi.waitFor(() =>
    expect(
      within(form("Invite Technical Support")).getByText("SUCCESS"),
    ).toBeInTheDocument(),
  );
  expect(writes()).toHaveLength(1);
});
it("late pre-mutation directory cannot restore a revoked permission", async () => {
  await show(state);
  const original = vi.mocked(fetch).getMockImplementation()!,
    stale = structuredClone(state.directory);
  let finish!: (value: Response) => void,
    delay = true;
  vi.mocked(fetch).mockImplementation((input, init) => {
    if (String(input).endsWith("/employees") && delay) {
      delay = false;
      return new Promise((resolve) => {
        finish = resolve;
      });
    }
    return original(input, init);
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh current state" }),
  );
  await waitFor(() => expect(finish).toBeDefined());
  prepare("Revoke staff read", true);
  submit("Revoke staff read");
  await waitFor(() =>
    expect(
      screen.queryByRole("heading", { name: "Revoke staff read" }),
    ).not.toBeInTheDocument(),
  );
  await act(async () => finish(Response.json(stale)));
  expect(
    screen.queryByRole("heading", { name: "Revoke staff read" }),
  ).not.toBeInTheDocument();
});
it("StrictMode unmount cleans polling and event handlers", async () => {
  vi.useFakeTimers();
  const result = render(
    <StrictMode>
      <Workspace />
    </StrictMode>,
  );
  await act(async () => vi.advanceTimersByTimeAsync(1));
  result.unmount();
  const count = vi.mocked(fetch).mock.calls.length;
  await act(async () => vi.advanceTimersByTimeAsync(60000));
  fireEvent(window, new Event("focus"));
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(count);
});
it("employment can be suspended again only as an explicit new action", async () => {
  await show(state);
  prepare("Suspend employment", true);
  submit("Suspend employment");
  await success("Suspend employment");
  prepare("Activate / reactivate employment", true);
  submit("Activate / reactivate employment");
  await success("Activate / reactivate employment");
  fireEvent.click(
    within(form("Suspend employment")).getByRole("button", {
      name: "Start a new action",
    }),
  );
  submit("Suspend employment");
  await success("Suspend employment");
  expect(writes()).toHaveLength(3);
});
it("changing platform actor clears old forms and selections", async () => {
  await show(state);
  fillInvite();
  state.overview.actor.id = crypto.randomUUID();
  fireEvent(window, new Event("focus"));
  await waitFor(() => expect(screen.getByLabelText("Email")).toHaveValue(""));
  expect(screen.getByLabelText("Technical Support employee")).toHaveValue("");
  expect(writes()).toHaveLength(0);
});
