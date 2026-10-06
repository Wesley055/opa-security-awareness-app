import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Workspace from "./workspace";
const facility = "00000000-0000-4000-8000-000000000001",
  supportCase = "00000000-0000-4000-8000-000000000002";
let role: string, caseOpen: boolean;
beforeEach(() => {
  sessionStorage.clear();
  role = "TECHNICAL_SUPPORT";
  caseOpen = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input) => {
      const path = String(input);
      return Response.json(
        path.endsWith("/context")
          ? {
              actor: { id: "current-actor", name: "Current Person", role },
              facilities: [
                {
                  id: facility,
                  name: "Facility A",
                  capabilities: ["STAFF_READ", "STAFF_PROVISION"],
                },
              ],
            }
          : path.endsWith("/cases")
            ? caseOpen
              ? [{ id: supportCase, reference: "Case A", status: "OPEN" }]
              : []
            : path.includes("invitation-roles")
              ? { roles: ["USER", "FACILITY_OPERATOR"] }
              : path.endsWith("/readiness")
                ? {
                    sms: { state: "CONFIGURED" },
                    email: { state: "CONFIGURED" },
                  }
                : [],
      );
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("preserves facility and case through focus and reload; clears a closed case", async () => {
  let view = render(<Workspace />);
  await screen.findByRole("option", { name: "Facility A" });
  fireEvent.change(screen.getByLabelText("My assigned facilities"), {
    target: { value: facility },
  });
  await screen.findByRole("option", { name: /Case A/ });
  fireEvent.change(screen.getByLabelText("Support Case context"), {
    target: { value: supportCase },
  });
  fireEvent(window, new Event("focus"));
  await act(async () => {});
  expect(screen.getByLabelText("Support Case context")).toHaveValue(
    supportCase,
  );
  view.unmount();
  view = render(<Workspace />);
  await waitFor(() =>
    expect(screen.getByLabelText("Support Case context")).toHaveValue(
      supportCase,
    ),
  );
  caseOpen = false;
  fireEvent(window, new Event("focus"));
  await waitFor(() =>
    expect(screen.getByLabelText("Support Case context")).toHaveValue(""),
  );
  expect(screen.getByLabelText("My assigned facilities")).toHaveValue(facility);
});
it("Facility Admin sees primary staffing actions and current identity without Operator handoff", async () => {
  role = "FACILITY_ADMIN";
  render(<Workspace />);
  await screen.findByText("Current Person");
  expect(screen.getByText("Facility Administrator")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "People" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Invite Operator" }));
  await waitFor(() =>
    expect(screen.getByLabelText("Membership")).toHaveValue(
      "FACILITY_OPERATOR",
    ),
  );
  expect(
    screen.queryByRole("button", { name: "Open Command Center" }),
  ).not.toBeInTheDocument();
});

it.each([
  "null",
  "not-json",
  JSON.stringify({ facility: "foreign", supportCase: "foreign-case" }),
])(
  "untrusted selection cache cannot supply facility authority: %s",
  async (value) => {
    sessionStorage.setItem(
      "opa-console-selection:current-actor:TECHNICAL_SUPPORT",
      value,
    );
    render(<Workspace />);
    await screen.findByText("Current Person");
    expect(screen.getByLabelText("My assigned facilities")).toHaveValue("");
    expect(
      screen.queryByRole("option", { name: "foreign" }),
    ).not.toBeInTheDocument();
  },
);
