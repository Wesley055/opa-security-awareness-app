import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import Delegation from "./workspace";
const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/onboarding-fetch", () => ({ onboardingFetch: api }));
const employee = "00000000-0000-4000-8000-000000000001",
  facility = "00000000-0000-4000-8000-000000000002";
beforeEach(() => {
  api.mockReset();
  api.mockImplementation(async (path: string) => ({
    ok: true,
    json: async () =>
      path === "employees"
        ? {
            users: [
              {
                id: employee,
                role: "USER",
                isActive: true,
                accountStatus: "ACTIVE",
              },
              {
                id: "admin",
                role: "ADMIN",
                isActive: true,
                accountStatus: "ACTIVE",
              },
            ],
            nextCursor: null,
          }
        : path === "facilities"
          ? {
              facilities: [
                { id: facility, name: "Facility A", isActive: true },
              ],
              nextCursor: null,
            }
          : { grants: [], nextCursor: null },
  }));
});
afterEach(cleanup);
it.each(["dropdown", "manual"])(
  "requires only the %s employee selection and an explicit reviewed approval",
  async (method) => {
    const user = userEvent.setup();
    render(<Delegation />);
    await screen.findByRole("option", { name: /USER/ });
    expect(screen.getByRole("option", { name: /ADMIN/ })).toBeDisabled();
    if (method === "dropdown")
      await user.selectOptions(
        screen.getByLabelText("Existing user"),
        employee,
      );
    else {
      await user.click(screen.getByText("Use a manual reference instead"));
      await user.type(
        screen.getByLabelText("Or enter existing user reference"),
        employee,
      );
      await user.click(
        screen.getByRole("button", { name: "Select reference" }),
      );
    }
    await waitFor(() =>
      expect(screen.getByLabelText("Existing facility")).toBeEnabled(),
    );
    await user.selectOptions(
      screen.getByLabelText("Existing facility"),
      facility,
    );
    await user.selectOptions(screen.getByLabelText("Duration"), "8h");
    await user.click(screen.getByRole("button", { name: "Review grant" }));
    expect(api.mock.calls.some((c) => c[1]?.method === "POST")).toBe(false);
    expect(
      screen.getByRole("region", { name: "Review grant" }),
    ).toHaveTextContent("Temporary technical support coverage");
    await user.click(screen.getByRole("button", { name: "Grant authority" }));
    const mutation = api.mock.calls.find((c) => c[1]?.method === "POST");
    expect(mutation?.[0]).toBe("employees/" + employee + "/grants");
    const body = JSON.parse(mutation![1].body);
    expect(body.facilityId).toBe(facility);
    expect(Date.parse(body.expiresAt) - Date.now()).toBeGreaterThan(
      7.9 * 3600000,
    );
  },
);
