import {
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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("invites through canonical provisioning with normalized phone and no caller role/facility", async () => {
  await show(state);
  fillInvite();
  submit("Invite Technical Support");
  await success("Invite Technical Support");
  const sent = writes()[0];
  expect(String(sent[0])).toBe("/api/super-admin/support/invitations");
  expect(JSON.parse(String(sent[1]?.body))).toMatchObject({
    phoneNumber: "+12025550123",
    reason: "Reviewed synthetic action",
  });
  expect(JSON.parse(String(sent[1]?.body))).not.toHaveProperty("role");
  expect(JSON.parse(String(sent[1]?.body))).not.toHaveProperty("facilityId");
});
it("requires explicit reviewed confirmation to end employment", async () => {
  await show(state);
  prepare("End employment");
  submit("End employment");
  expect(writes()).toHaveLength(0);
  fireEvent.click(within(form("End employment")).getByRole("checkbox"));
  submit("End employment");
  await success("End employment");
  expect(JSON.parse(String(writes()[0][1]?.body)).state).toBe("ENDED");
});
it("employment does not expire and no destructive delete is offered", async () => {
  await show(state);
  expect(screen.getByText(/Employment does not expire/)).toBeInTheDocument();
  expect(
    within(form("Suspend employment")).queryByLabelText(/expiry/i),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /delete/i }),
  ).not.toBeInTheDocument();
});
it("suspended employment can be explicitly reactivated", async () => {
  state.directory.employees[0].supportEmployment.state = "SUSPENDED";
  await showWithoutActive();
  prepare("Activate / reactivate employment", true);
  submit("Activate / reactivate employment");
  await success("Activate / reactivate employment");
  expect(state.directory.employees[0].supportEmployment.state).toBe("ACTIVE");
});
it("ended employment cannot be restored by ordinary actions", async () => {
  state.directory.employees[0].supportEmployment.state = "ENDED";
  await showWithoutActive();
  for (const title of [
    "Activate / reactivate employment",
    "Suspend employment",
    "End employment",
  ]) {
    prepare(title, true);
    submit(title);
    expect(
      within(form(title)).getByRole("button", { name: title }),
    ).toBeDisabled();
  }
  expect(writes()).toHaveLength(0);
});
it("sensitive permissions require explicit scope, reason, confirmation and future expiry", async () => {
  await show(state);
  fireEvent.click(screen.getByText("Advanced permissions"));
  set("Permission", "PII_RESOLVE");
  const element = prepare("Grant explicit permission", true);
  set("Required expiry", "2000-01-01T00:00", element);
  submit("Grant explicit permission");
  expect(writes()).toHaveLength(0);
  expect(within(element).getByRole("alert")).toHaveTextContent("future");
  set("Required expiry", "2099-01-01T00:00", element);
  submit("Grant explicit permission");
  await success("Grant explicit permission");
  expect(JSON.parse(String(writes()[0][1]?.body))).toMatchObject({
    capability: "PII_RESOLVE",
    facilityId: state.facility,
  });
});
it("current authority loss removes privileged forms and identity drafts", async () => {
  await show(state);
  fillInvite();
  state.status = 403;
  fireEvent(window, new Event("focus"));
  await waitFor(() =>
    expect(screen.queryByLabelText("First name")).not.toBeInTheDocument(),
  );
  expect(writes()).toHaveLength(0);
});
async function showWithoutActive() {
  const current = state.directory.employees[0].supportEmployment.state;
  state.directory.employees[0].supportEmployment.state = "ACTIVE";
  await show(state);
  state.directory.employees[0].supportEmployment.state = current;
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh current state" }),
  );
  await screen.findByText(new RegExp("Employment: " + current));
}
