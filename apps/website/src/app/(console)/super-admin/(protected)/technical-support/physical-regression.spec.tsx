import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import {
  fixture,
  install,
  show,
  fillInvite,
  form,
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
it("confirmed directory enables identity inputs while reason remains mandatory", async () => {
  await show(state);
  expect(screen.getByLabelText("First name")).toBeEnabled();
  expect(
    within(form("Invite Technical Support")).getByRole("button", {
      name: "Invite Technical Support",
    }),
  ).toBeDisabled();
  expect(
    within(form("Invite Technical Support")).getByText("Reason required."),
  ).toBeInTheDocument();
});
it.each(["focus", "pageshow"])(
  "%s coalesces overlapping reads and preserves draft",
  async (event) => {
    await show(state);
    fillInvite();
    const before = vi.mocked(fetch).mock.calls.length;
    fireEvent(window, new Event(event));
    fireEvent(window, new Event(event));
    await waitFor(() =>
      expect(screen.getAllByRole("status")[0]).toHaveTextContent(
        "Platform context confirmed",
      ),
    );
    expect(screen.getByLabelText("Email")).toHaveValue("fixture@example.test");
    const overview = vi
      .mocked(fetch)
      .mock.calls.slice(before)
      .filter((c) => String(c[0]).endsWith("/overview"));
    expect(overview).toHaveLength(1);
  },
);
it("successful periodic revalidation preserves controls", async () => {
  await show(state);
  fillInvite();
  vi.useFakeTimers();
  await act(async () => vi.advanceTimersByTimeAsync(20001));
  expect(screen.getByLabelText("Email")).toHaveValue("fixture@example.test");
  expect(
    within(form("Invite Technical Support")).getByRole("button", {
      name: "Invite Technical Support",
    }),
  ).toBeEnabled();
});
it("focus preserves confirmed controls while unchanged authority is revalidated", async () => {
  await show(state);
  fillInvite();
  const original = vi.mocked(fetch).getMockImplementation()!;
  let finish!: (value: Response) => void;
  vi.mocked(fetch).mockImplementation((input, init) =>
    String(input).endsWith("/overview")
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : original(input, init),
  );
  fireEvent(window, new Event("focus"));
  expect(
    within(form("Invite Technical Support")).getByRole("button", {
      name: "Invite Technical Support",
    }),
  ).toBeEnabled();
  await act(async () => finish(Response.json(state.overview)));
  expect(
    within(form("Invite Technical Support")).getByRole("button", {
      name: "Invite Technical Support",
    }),
  ).toBeEnabled();
});
it("double submit preserves a single normalized invitation and stable operation identity", async () => {
  await show(state);
  fillInvite();
  submit("Invite Technical Support");
  submit("Invite Technical Support");
  await success("Invite Technical Support");
  expect(writes()).toHaveLength(1);
  const sent = writes()[0],
    body = JSON.parse(String(sent[1]?.body));
  expect(body.phoneNumber).toBe("+12025550123");
  expect(new Headers(sent[1]?.headers).get("idempotency-key")).toBe(
    body.correlationId,
  );
});
it("unknown result retains identity until identical replay after reconciliation", async () => {
  await show(state);
  fillInvite();
  const original = vi.mocked(fetch).getMockImplementation()!;
  let first = true;
  vi.mocked(fetch).mockImplementation((input, init) => {
    if (
      String(input).endsWith("/invitations") &&
      init?.method === "POST" &&
      first
    ) {
      first = false;
      return Promise.reject(new Error("Disconnected"));
    }
    return original(input, init);
  });
  submit("Invite Technical Support");
  await waitFor(() =>
    expect(
      within(form("Invite Technical Support")).getByText("RESULT UNKNOWN"),
    ).toBeInTheDocument(),
  );
  const before = JSON.parse(String(writes()[0][1]?.body)).correlationId;
  fireEvent.click(
    within(form("Invite Technical Support")).getByRole("button", {
      name: "Check recorded result",
    }),
  );
  await waitFor(() =>
    expect(
      within(form("Invite Technical Support")).getByRole("button", {
        name: "Replay identical action",
      }),
    ).toBeEnabled(),
  );
  submit("Invite Technical Support");
  await success("Invite Technical Support");
  expect(writes()).toHaveLength(2);
  expect(JSON.parse(String(writes()[1][1]?.body)).correlationId).toBe(before);
});
it.each([400, 409])(
  "definite failure %s leaves a bounded retryable form",
  async (status) => {
    await show(state);
    fillInvite();
    state.postStatus = status;
    submit("Invite Technical Support");
    await waitFor(() =>
      expect(
        within(form("Invite Technical Support")).getByText("SERVER FAILURE"),
      ).toBeInTheDocument(),
    );
    expect(
      within(form("Invite Technical Support")).getByRole("button", {
        name: "Invite Technical Support",
      }),
    ).toBeEnabled();
  },
);
it.each([401, 403])(
  "authority denial %s removes data and explicit recovery restores a clean form",
  async (status) => {
    await show(state);
    fillInvite();
    state.status = status;
    fireEvent(window, new Event("focus"));
    await waitFor(() =>
      expect(screen.queryByLabelText("Email")).not.toBeInTheDocument(),
    );
    state.status = 200;
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh current state" }),
    );
    expect(await screen.findByLabelText("Email")).toHaveValue("");
  },
);
it("renders human employee name and valid UTF-8 separators", async () => {
  await show(state);
  expect(
    screen.getByRole("option", { name: "Fixture Support · ACTIVE" }),
  ).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/Ã|Â|â€|�/);
});
