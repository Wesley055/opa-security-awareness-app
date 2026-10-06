import { randomUUID, webcrypto } from "node:crypto";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, it, expect, vi } from "vitest";
const mock = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/super-admin-fetch", () => ({ superAdminFetch: mock.request }));
import Governance from "@/app/(console)/super-admin/(protected)/organization/workspace";
import { CreateFacility } from "@/app/(console)/super-admin/workspace";
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  mock.request.mockReset();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("wires Organizations attachment and Facility parent/type through the existing governance transport", async () => {
  const actor = randomUUID(),
    org = randomUUID(),
    f = randomUUID();
  const overview = {
    actor: { id: actor, role: "ADMIN" },
    organizations: [{ id: org, name: "Parent organization" }],
    facilities: [
      {
        id: f,
        name: "Facility under review",
        type: "OTHER",
        organizationId: null as string | null,
        organization: null as { id: string; name: string } | null,
        operationalState: "CREATED",
      },
    ],
    assignments: [],
    elevations: [],
    employmentCount: 0,
    openIncidents: 0,
  };
  mock.request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      overview.facilities[0].organizationId = org;
      overview.facilities[0].organization = {
        id: org,
        name: "Parent organization",
      };
      return Response.json({ id: f });
    }
    return Response.json(
      path === "organization/overview"
        ? overview
        : path === "support/employees"
          ? { employees: [], invitations: [] }
          : path === "support/readiness"
            ? {}
            : [],
    );
  });
  render(<Governance initial="Organizations" />);
  await screen.findByRole("option", { name: "Parent organization" });
  fireEvent.change(screen.getByLabelText("Open organization"), {
    target: { value: org },
  });
  fireEvent.change(screen.getByLabelText("Eligible unassociated facility"), {
    target: { value: f },
  });
  const form = screen
    .getByRole("button", { name: "Attach facility" })
    .closest("form")!;
  const inputs = form.querySelectorAll("input");
  fireEvent.change(inputs[0], { target: { value: "Reviewed parent" } });
  fireEvent.click(form.querySelector('input[type="checkbox"]')!);
  fireEvent.submit(form);
  await screen.findByText("Parent organization: Parent organization");
  const write = mock.request.mock.calls.find((c) => c[1]?.method === "POST")!;
  expect(write[0]).toBe("organization/facilities/" + f + "/organization");
  expect(new Headers(write[1].headers).get("x-platform-actor")).toBe(actor);
  expect(JSON.parse(write[1].body)).toMatchObject({
    organizationId: org,
    reason: "Reviewed parent",
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Facilities" }),
  );
  fireEvent.change(screen.getByLabelText("Facility", { exact: true }), {
    target: { value: f },
  });
  expect(screen.getAllByText("Facility type: OTHER").length).toBeGreaterThan(0);
  expect(screen.queryByRole("button", { name: "Attach facility" })).toBeNull();
});
it("facility creation submits explicitly selected OTHER rather than the initial HOSPITAL default", async () => {
  mock.request.mockResolvedValue(
    Response.json({ id: randomUUID(), name: "Synthetic", type: "OTHER" }),
  );
  render(<CreateFacility />);
  fireEvent.change(screen.getByLabelText("Facility name"), {
    target: { value: "Synthetic" },
  });
  fireEvent.change(screen.getByLabelText("Facility type"), {
    target: { value: "OTHER" },
  });
  fireEvent.submit(
    screen.getByRole("button", { name: "Create facility" }).closest("form")!,
  );
  await waitFor(() => expect(mock.request).toHaveBeenCalledTimes(1));
  expect(JSON.parse(mock.request.mock.calls[0][1].body)).toMatchObject({
    type: "OTHER",
  });
});
