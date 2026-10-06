import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, it, expect, vi } from "vitest";
const mock = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/super-admin-fetch", () => ({ superAdminFetch: mock.request }));
import Workspace from "./workspace";
const id = "6d08a466-e685-4123-a06e-c281e389a221";
const facility = {
  id,
  name: "Fixture facility",
  type: "OTHER",
  isActive: true,
  isVerified: false,
};
beforeEach(() => {
  mock.request.mockReset();
  mock.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === "POST") return Response.json({ status: "RECORDED" });
    if (path === "facilities")
      return Response.json({ facilities: [facility], nextCursor: null });
    if (path.endsWith("/members"))
      return Response.json({
        members: [
          {
            id,
            role: "FACILITY_OPERATOR",
            isActive: true,
            accountStatus: "ACTIVE",
            membershipState: "ACTIVE",
          },
        ],
        nextCursor: null,
      });
    if (path.endsWith("/invitations"))
      return Response.json({ invitations: [], nextCursor: null });
    if (path.endsWith("/audit"))
      return Response.json({ events: [], nextCursor: null });
    return Response.json({ facility });
  });
});
afterEach(cleanup);
async function show() {
  await act(async () => {
    render(<Workspace />);
  });
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: /Fixture facility/ })),
  );
  fireEvent.change(screen.getByLabelText(/Required for access changes/), {
    target: { value: "Reviewed" },
  });
}
it("membership mutation owns its duplicate guard without disabling unrelated invitation fields", async () => {
  await show();
  let finish!: (r: Response) => void;
  const normal = mock.request.getMockImplementation()!;
  mock.request.mockImplementation((p: string, i?: RequestInit) =>
    i?.method === "POST"
      ? new Promise((r) => {
          finish = r;
        })
      : normal(p, i),
  );
  fireEvent.click(screen.getByRole("button", { name: "Suspend access" }));
  fireEvent.click(screen.getByRole("button", { name: "Suspend access" }));
  expect(
    mock.request.mock.calls.filter((c) => c[1]?.method === "POST"),
  ).toHaveLength(1);
  expect(screen.getByLabelText("First name")).toBeEnabled();
  await act(async () => finish(Response.json({ status: "RECORDED" })));
});
it("post-mutation detail refresh preserves dirty invitation fields", async () => {
  await show();
  fireEvent.change(screen.getByLabelText("First name"), {
    target: { value: "Unsubmitted draft" },
  });
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Suspend access" })),
  );
  expect(screen.getByLabelText("First name")).toHaveValue("Unsubmitted draft");
});
it("terminal authority loss clears all facility and protected-display state", async () => {
  await show();
  act(() => window.dispatchEvent(new Event("opa-super-admin-authority-lost")));
  expect(screen.queryByLabelText("First name")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Reveal one identifier" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("Authority expired");
});

it("late protected reveal cannot restore plaintext after authority loss", async () => {
  await show();
  let finish!: (r: Response) => void;
  const normal = mock.request.getMockImplementation()!;
  mock.request.mockImplementation((p: string, i?: RequestInit) =>
    p.endsWith("/reveal")
      ? new Promise((r) => {
          finish = r;
        })
      : normal(p, i),
  );
  fireEvent.submit(
    screen
      .getByRole("button", { name: "Reveal one identifier" })
      .closest("form")!,
  );
  act(() => window.dispatchEvent(new Event("opa-super-admin-authority-lost")));
  await act(async () =>
    finish(Response.json({ value: "private fixture value" })),
  );
  expect(screen.queryByText("private fixture value")).not.toBeInTheDocument();
});
