import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Workspace from "./workspace";
const { fetchOnboarding } = vi.hoisted(() => ({ fetchOnboarding: vi.fn() }));
vi.mock("@/lib/onboarding-fetch", () => ({ onboardingFetch: fetchOnboarding }));
const facility = "00000000-0000-4000-8000-000000000001";
describe("delegated support workspace", () => {
  beforeEach(() => {
    fetchOnboarding.mockReset();
    fetchOnboarding.mockImplementation(async (path: string) => ({
      ok: true,
      json: async () =>
        path === "facilities"
          ? {
              facilities: [{ id: facility, name: "Assigned facility" }],
              nextCursor: null,
            }
          : { invitations: [], nextCursor: null },
    }));
  });
  it("offers only authorized facilities and staff roles", async () => {
    render(<Workspace />);
    await screen.findByRole("option", { name: "Assigned facility" });
    await userEvent.selectOptions(
      screen.getByLabelText("Authorized facility"),
      facility,
    );
    await screen.findByRole("heading", { name: "Invite staff" });
    expect(screen.getByLabelText("Role").textContent).toBe(
      "Facility OperatorFacility Admin",
    );
    expect(
      screen.queryByText(/Residents|Evidence|SafeWalk|Reports|Create facility/),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(fetchOnboarding).toHaveBeenCalledWith(
        `facilities/${facility}/invitations`,
        undefined,
      ),
    );
  });
  it("shows the empty state after all authority is revoked", async () => {
    fetchOnboarding.mockResolvedValue({
      ok: true,
      json: async () => ({ facilities: [], nextCursor: null }),
    });
    render(<Workspace />);
    await waitFor(() => expect(fetchOnboarding).toHaveBeenCalled());
    expect(
      screen.getByText("No authorized facilities are available."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Invite staff" }),
    ).not.toBeInTheDocument();
  });
});
