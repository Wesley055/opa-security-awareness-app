import { randomUUID, webcrypto } from "node:crypto";
import {
  render,
  screen,
  fireEvent,
  within,
  waitFor,
} from "@testing-library/react";
import { vi } from "vitest";
import Workspace from "@/app/(console)/super-admin/(protected)/technical-support/workspace";
export function fixture() {
  const actor = String(randomUUID()),
    employee = randomUUID(),
    facility = randomUUID(),
    grant = randomUUID();
  return {
    actor,
    employee,
    facility,
    grant,
    status: 200,
    postStatus: 200,
    receipt: "NOT_RECORDED",
    overview: {
      actor: { id: actor, role: "ADMIN" },
      organizations: [],
      facilities: [
        {
          id: facility,
          name: "Fixture facility",
          organizationId: null,
          operationalState: "COMMISSIONING",
        },
      ],
      assignments: [],
      elevations: [],
      employmentCount: 1,
      openIncidents: 0,
    },
    directory: {
      employees: [
        {
          id: employee,
          firstName: "Fixture",
          lastName: "Support",
          isActive: true,
          accountStatus: "ACTIVE",
          supportEmployment: { state: "ACTIVE" },
          supportGrants: [
            {
              id: grant,
              capability: "STAFF_READ",
              revokedAt: null as string | null,
              expiresAt: null,
            },
          ],
        },
      ],
      invitations: [],
    },
  };
}
export type Fixture = ReturnType<typeof fixture>;
export function install(state: Fixture) {
  vi.stubGlobal("crypto", webcrypto);
  sessionStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input, init) => {
      const path = String(input);
      if (path.endsWith("/refresh"))
        return Response.json(
          {},
          { status: state.status >= 400 ? state.status : 401 },
        );
      if (path.includes("/operations/"))
        return Response.json({
          status: state.receipt,
          receipt:
            state.receipt === "COMMITTED" ? { resourceId: state.grant } : null,
        });
      if (init?.method === "POST") {
        if (state.postStatus >= 400)
          return Response.json(
            { error: "Reviewed action rejected" },
            { status: state.postStatus },
          );
        const body = JSON.parse(String(init.body));
        if (path.endsWith("/employment"))
          state.directory.employees[0].supportEmployment.state = body.state;
        if (path.endsWith("/revoke") || path.endsWith("/revoke-all"))
          state.directory.employees[0].supportGrants[0].revokedAt =
            new Date().toISOString();
        return Response.json(
          path.endsWith("/invitations")
            ? { requestId: state.grant }
            : { id: state.grant },
        );
      }
      if (state.status >= 400)
        return Response.json(
          { error: "Unavailable" },
          { status: state.status },
        );
      return Response.json(
        path.endsWith("/overview")
          ? state.overview
          : path.endsWith("/employees")
            ? state.directory
            : path.endsWith("/readiness")
              ? { sms: { state: "CONFIGURED" }, email: { state: "CONFIGURED" } }
              : [],
      );
    }),
  );
}
export const writes = () =>
  vi
    .mocked(fetch)
    .mock.calls.filter(
      (c) => c[1]?.method === "POST" && !String(c[0]).endsWith("/refresh"),
    );
export const form = (title: string) =>
  screen.getByRole("heading", { name: title }).closest("form")!;
export const set = (
  label: string,
  value: string,
  scope: HTMLElement = document.body,
) =>
  fireEvent.change(within(scope).getByLabelText(label), { target: { value } });
export function prepare(title: string, confirm = false) {
  const element = form(title);
  set("Reason for this action", "Reviewed synthetic action", element);
  if (confirm) fireEvent.click(within(element).getByRole("checkbox"));
  return element;
}
export function fillInvite() {
  const element = prepare("Invite Technical Support");
  set("First name", "Fixture", element);
  set("Last name", "Support", element);
  set("Email", "fixture@example.test", element);
  set("Phone in international format", "+1 202 555 0123", element);
  return element;
}
export async function show(state: Fixture) {
  render(<Workspace />);
  await screen.findByLabelText("First name");
  set("Technical Support employee", state.employee);
  set("Facility", state.facility);
  await waitFor(() => screen.getByText(/Employment: ACTIVE/));
}
export const submit = (title: string) => fireEvent.submit(form(title));
export async function success(title: string) {
  await waitFor(() => within(form(title)).getByText("SUCCESS"));
}
