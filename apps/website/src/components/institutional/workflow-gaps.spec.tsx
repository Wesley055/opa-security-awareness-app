import { InvitationRoleSelect } from "@/app/(console)/institutional/workspace";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  renderHook,
  act,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountRecovery } from "./account-recovery";
import { MemberOversight } from "./member-oversight";
import { useInvitationRoles } from "./use-invitation-roles";
import { operationStore } from "@/lib/canonical-operations";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const account = {
  id: "00000000-0000-4000-8000-000000000003",
  displayIdentity: "K••• H••• · Account ABC123",
  role: "FACILITY_ADMIN",
  accountStatus: "ACTIVE",
  isActive: true,
  membershipState: "ACTIVE",
  facility: { name: "Facility A" },
  supportEmployment: null,
};
describe("human-safe workflow completion", () => {
  it("requires a new explicit role choice when eligible roles change", () => {
    const view = render(<InvitationRoleSelect roles={["FACILITY_ADMIN", "FACILITY_OPERATOR"]} />);
    const select = screen.getByRole("combobox");
    expect(select).toHaveValue("");
    fireEvent.change(select, { target: { value: "FACILITY_OPERATOR" } });
    expect(select).toHaveValue("FACILITY_OPERATOR");
    view.rerender(<InvitationRoleSelect roles={["FACILITY_ADMIN"]} />);
    expect(screen.getByRole("combobox")).toHaveValue("");
    expect(screen.queryByRole("option", { name: "Operator" })).not.toBeInTheDocument();
  });
  it("Super Admin selects a masked person by facility/context, with recovery confirmation retained", async () => {
    const transport = vi.fn(async () =>
      Response.json({ accounts: [account], nextCursor: null }),
    );
    const store = operationStore("recovery-test", transport);
    render(
      <AccountRecovery
        transport={transport}
        store={store}
        blocked=""
        onSuccess={() => {}}
      />,
    );
    await screen.findByRole("option", { name: /K••• H•••.*Facility A/ });
    expect(
      screen.queryByLabelText(/Account reference/),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Account to recover"), {
      target: { value: account.id },
    });
    expect(
      screen.getByRole("heading", { name: account.displayIdentity }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Confirm this sensitive action|Reason required/),
    ).toBeInTheDocument();
    expect(transport.mock.calls.length).toBe(1);
  });
  it("failed directory read is an explicit retry state, not an indefinite spinner", async () => {
    const transport = vi.fn(async () => Response.json({}, { status: 503 }));
    render(
      <AccountRecovery
        transport={transport}
        store={operationStore("recovery-failed", transport)}
        blocked=""
        onSuccess={() => {}}
      />,
    );
    await screen.findByText(/Account directory unavailable/);
    expect(
      screen.queryByText("Retrieving account directory…"),
    ).not.toBeInTheDocument();
  });
  it("authority loss removes recovery choices", async () => {
    const transport = vi.fn(async () =>
      Response.json({ accounts: [account], nextCursor: null }),
    );
    const store = operationStore("recovery-expired", transport);
    const view = render(
      <AccountRecovery
        transport={transport}
        store={store}
        blocked=""
        onSuccess={() => {}}
      />,
    );
    await screen.findByRole("option", { name: /K•••/ });
    view.rerender(
      <AccountRecovery
        transport={transport}
        store={store}
        blocked="Current authority required"
        onSuccess={() => {}}
      />,
    );
    expect(
      screen.queryByRole("option", { name: /K•••/ }),
    ).not.toBeInTheDocument();
  });
  it("Support role choices come from the server and clear on case change or authority loss", async () => {
    const transport = vi.fn(async () =>
      Response.json({
        roles: ["FACILITY_OPERATOR"],
        explanation: "Approved support assistance",
      }),
    );
    const { result, rerender } = renderHook(
      ({ caseId, enabled }) =>
        useInvitationRoles(transport, "facility", caseId, enabled),
      { initialProps: { caseId: "case-one", enabled: true } },
    );
    await waitFor(() =>
      expect(result.current.roles).toEqual(["FACILITY_OPERATOR"]),
    );
    expect(transport).toHaveBeenCalledWith(
      "facilities/facility/invitation-roles?caseReference=case-one",
    );
    rerender({ caseId: "case-two", enabled: false });
    expect(result.current.roles).toEqual([]);
  });
  it("revoked Support eligibility disappears on the bounded refresh", async () => {
    vi.useFakeTimers();
    let roles = ["FACILITY_OPERATOR"];
    const transport = vi.fn(async () =>
      Response.json({ roles, explanation: "Current authority" }),
    );
    const { result } = renderHook(() =>
      useInvitationRoles(transport, "facility", "case", true),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(result.current.roles).toEqual(["FACILITY_OPERATOR"]);
    roles = [];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(result.current.roles).toEqual([]);
  });
  it("Facility Admin oversight connects masked Operators with recorded facts and unassigned incident exceptions", () => {
    render(
      <MemberOversight
        members={[{ ...account, role: "FACILITY_OPERATOR" }]}
        oversight={{
          policyState: "CONFIGURED",
          incidents: [
            {
              id: "incident",
              createdAt: "2026-09-30",
              currentExceptions: ["DISPATCH_OVERDUE"],
              events: [
                {
                  id: "event",
                  type: "OPERATOR_ACKNOWLEDGED",
                  actorUserId: account.id,
                  occurredAt: "2026-09-30",
                },
              ],
            },
          ],
        }}
      />,
    );
    expect(
      screen.getByRole("heading", { name: account.displayIdentity }),
    ).toBeInTheDocument();
    expect(screen.getByText(/operator acknowledged/)).toBeInTheDocument();
    expect(screen.getByText("dispatch overdue")).toBeInTheDocument();
    expect(
      screen.getByText(/not automatically attributed/),
    ).toBeInTheDocument();
  });
});
