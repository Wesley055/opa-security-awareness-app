import { randomUUID, webcrypto } from "node:crypto";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, it, expect, vi } from "vitest";
import {
  OrganizationHierarchy,
  FacilityHierarchyDetail,
} from "./organization-hierarchy";
import { OperationStore } from "@/lib/canonical-operations";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});
function setup() {
  vi.stubGlobal("crypto", webcrypto);
  const a = randomUUID(),
    b = randomUUID(),
    f = randomUUID();
  const transport = vi.fn().mockResolvedValue(Response.json({ id: f }));
  const store = new OperationStore(randomUUID(), transport);
  const onSuccess = vi.fn();
  const facilities = [
    {
      id: f,
      name: "Eligible facility",
      type: "OTHER",
      organizationId: null,
      operationalState: "CREATED",
    },
    {
      id: randomUUID(),
      name: "Already attached",
      type: "HOSPITAL",
      organizationId: b,
      organization: { id: b, name: "Organization B" },
      operationalState: "CREATED",
    },
  ];
  const props = {
    organizations: [
      { id: a, name: "Organization A" },
      { id: b, name: "Organization B" },
    ],
    facilities,
    store,
    blocked: "",
    onSuccess,
  };
  const ui = render(<OrganizationHierarchy {...props} />);
  return { a, b, f, props, ui, transport, onSuccess };
}
it("shows unassociated facilities, exact parent and persisted type", () => {
  const { b } = setup();
  fireEvent.change(screen.getByLabelText("Open organization"), {
    target: { value: b },
  });
  expect(
    screen.getByText("Parent organization: Organization B"),
  ).toBeInTheDocument();
  expect(screen.getByText("Facility type: HOSPITAL")).toBeInTheDocument();
  expect(
    screen.getByText("Eligible facility — Unassociated"),
  ).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "Already attached" })).toBeNull();
});
it("requires reason and reviewed confirmation for exact organization/facility, then refreshes", async () => {
  const { a, f, transport, onSuccess } = setup();
  fireEvent.change(screen.getByLabelText("Open organization"), {
    target: { value: a },
  });
  fireEvent.change(screen.getByLabelText("Eligible unassociated facility"), {
    target: { value: f },
  });
  expect(screen.getByText("Facility type: OTHER")).toBeInTheDocument();
  const button = screen.getByRole("button", { name: "Attach facility" });
  expect(button).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Reason for this action"), {
    target: { value: "Reviewed parent" },
  });
  expect(button).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(button);
  await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  expect(transport).toHaveBeenCalledTimes(1);
  expect(transport.mock.calls[0][0]).toBe(
    "organization/facilities/" + f + "/organization",
  );
  expect(JSON.parse(transport.mock.calls[0][1].body)).toMatchObject({
    organizationId: a,
    reason: "Reviewed parent",
  });
});
it("changing organization clears candidate and confirmation; server reassignment removes eligibility", () => {
  const { a, b, f, props, ui } = setup();
  fireEvent.change(screen.getByLabelText("Open organization"), {
    target: { value: a },
  });
  fireEvent.change(screen.getByLabelText("Eligible unassociated facility"), {
    target: { value: f },
  });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.change(screen.getByLabelText("Open organization"), {
    target: { value: b },
  });
  expect(screen.queryByRole("button", { name: "Attach facility" })).toBeNull();
  fireEvent.change(screen.getByLabelText("Eligible unassociated facility"), {
    target: { value: f },
  });
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  ui.rerender(
    <OrganizationHierarchy
      {...props}
      facilities={props.facilities.map((x) => ({
        ...x,
        organizationId: b,
        organization: { id: b, name: "Organization B" },
      }))}
    />,
  );
  expect(screen.queryByRole("button", { name: "Attach facility" })).toBeNull();
});
it("blocks submission when current authority is unavailable", () => {
  const { a, f, props, ui, transport } = setup();
  fireEvent.change(screen.getByLabelText("Open organization"), {
    target: { value: a },
  });
  fireEvent.change(screen.getByLabelText("Eligible unassociated facility"), {
    target: { value: f },
  });
  ui.rerender(
    <OrganizationHierarchy
      {...props}
      blocked="Current authority unavailable."
    />,
  );
  fireEvent.change(screen.getByLabelText("Reason for this action"), {
    target: { value: "Reviewed" },
  });
  fireEvent.click(screen.getByRole("checkbox"));
  expect(
    screen.getByRole("button", { name: "Attach facility" }),
  ).toBeDisabled();
  expect(transport).not.toHaveBeenCalled();
});
it("never labels a recorded association unassociated when parent name is unavailable", () => {
  render(
    <FacilityHierarchyDetail
      facility={{
        id: randomUUID(),
        name: "Facility",
        organizationId: randomUUID(),
        operationalState: "CREATED",
      }}
    />,
  );
  expect(screen.getByText(/Association recorded/)).toBeInTheDocument();
  expect(screen.queryByText(/^Parent organization: Unassociated/)).toBeNull();
  expect(
    within(screen.getByText(/Facility type:/)).getByText(/Unavailable/),
  ).toBeTruthy();
});
