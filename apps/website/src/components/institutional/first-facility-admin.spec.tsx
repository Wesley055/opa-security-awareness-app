import { randomUUID, webcrypto } from "node:crypto";
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { FirstFacilityAdmin } from "./first-facility-admin";
import { OperationStore } from "@/lib/canonical-operations";
import {
  institutionalPath,
  institutionalProjection,
} from "@/lib/institutional-path";
let transport: ReturnType<
    typeof vi.fn<(path: string, init?: RequestInit) => Promise<Response>>
  >,
  store: OperationStore,
  facility: string;
const diagnostics = vi.fn();
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  sessionStorage.clear();
  facility = randomUUID();
  transport = vi.fn(async (_path: string, init?: RequestInit) =>
    init?.method === "POST"
      ? Response.json({
          requestId: randomUUID(),
          status: "VERIFICATION_PENDING",
        })
      : Response.json({ eligible: true, explanation: "Current authority" }),
  );
  store = new OperationStore(randomUUID(), transport);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const show = (prerequisite = "") =>
  render(
    <FirstFacilityAdmin
      facilityId={facility}
      store={store}
      transport={transport}
      prerequisite={prerequisite}
      onDiagnostics={diagnostics}
      onSuccess={() => {}}
    />,
  );
const fill = () => {
  fireEvent.change(screen.getByLabelText("First name"), {
    target: { value: "Synthetic" },
  });
  fireEvent.change(screen.getByLabelText("Last name"), {
    target: { value: "Administrator" },
  });
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: randomUUID() + "@example.test" },
  });
  fireEvent.change(screen.getByLabelText("Phone in international format"), {
    target: { value: "+2348012345678" },
  });
  fireEvent.change(screen.getByLabelText("Reason for this action"), {
    target: { value: "Reviewed commissioning" },
  });
  fireEvent.click(screen.getByRole("checkbox"));
};
it("offers fixed first Administrator commissioning without a role selector or case", async () => {
  show();
  await waitFor(() => expect(transport).toHaveBeenCalled());
  fill();
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Provision first Facility Administrator" })
        .hasAttribute("disabled"),
    ).toBe(false),
  );
  fireEvent.submit(
    screen
      .getByRole("button", { name: "Provision first Facility Administrator" })
      .closest("form")!,
  );
  await screen.findByText(/Enrollment reference:/);
  const write = transport.mock.calls.find((c) => c[1]?.method === "POST")!;
  expect(write[0]).toBe("facilities/" + facility + "/first-facility-admin");
  const payload = JSON.parse(String(write[1]!.body));
  expect(payload).not.toHaveProperty("role");
  expect(payload).toMatchObject({ reason: "Reviewed commissioning" });
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(screen.getByText(/Provider acceptance is not delivery/)).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "Open Enrollment & Delivery" }),
  );
  expect(diagnostics).toHaveBeenCalled();
});
it("shows local prerequisite and sends nothing", async () => {
  show("Facility must be commissioning.");
  fill();
  expect(screen.getByText("Facility must be commissioning.")).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: "Provision first Facility Administrator" })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(transport).not.toHaveBeenCalled();
});
it("denied eligibility never leaves an unexplained spinner or enabled action", async () => {
  transport.mockResolvedValue(
    Response.json({
      eligible: false,
      explanation: "An active Facility Administrator already exists.",
    }),
  );
  show();
  fill();
  await screen.findByText("An active Facility Administrator already exists.");
  expect(
    screen
      .getByRole("button", { name: "Provision first Facility Administrator" })
      .hasAttribute("disabled"),
  ).toBe(true);
});
it("focus rechecks eligibility and removes stale permission", async () => {
  show();
  fill();
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Provision first Facility Administrator" })
        .hasAttribute("disabled"),
    ).toBe(false),
  );
  transport.mockImplementation(async () =>
    Response.json({
      eligible: false,
      explanation: "Current assignment required.",
    }),
  );
  fireEvent(window, new Event("focus"));
  await screen.findByText("Current assignment required.");
  expect(
    screen
      .getByRole("button", { name: "Provision first Facility Administrator" })
      .hasAttribute("disabled"),
  ).toBe(true);
});
it("failed authority check fails closed with actionable text", async () => {
  transport.mockRejectedValue(Error("unavailable"));
  show();
  fill();
  await screen.findByText(/Commissioning authority could not be confirmed/);
  expect(
    screen
      .getByRole("button", { name: "Provision first Facility Administrator" })
      .hasAttribute("disabled"),
  ).toBe(true);
});
it("only renders delivery rows for the submitted enrollment without conflating provider acceptance", async () => {
  const id = randomUUID();
  transport.mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === "POST")
      return Response.json({ requestId: id, status: "VERIFICATION_PENDING" });
    if (path.endsWith("/delivery"))
      return Response.json([
        {
          enrollmentId: id,
          channel: "EMAIL",
          status: "SENT",
          deliveryStatus: "PROVIDER_ACCEPTED",
        },
        {
          enrollmentId: id,
          channel: "SMS",
          status: "FAILED",
          deliveryStatus: "UNKNOWN",
        },
        {
          enrollmentId: randomUUID(),
          channel: "FOREIGN",
          status: "SENT",
          deliveryStatus: "DELIVERED",
        },
      ]);
    return Response.json({ eligible: true });
  });
  show();
  fill();
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Provision first Facility Administrator" })
        .hasAttribute("disabled"),
    ).toBe(false),
  );
  fireEvent.submit(
    screen
      .getByRole("button", { name: "Provision first Facility Administrator" })
      .closest("form")!,
  );
  await screen.findByText("EMAIL: SENT · confirmation: PROVIDER_ACCEPTED");
  expect(screen.getByText("SMS: FAILED · confirmation: UNKNOWN")).toBeTruthy();
  expect(screen.queryByText(/FOREIGN/)).toBeNull();
});
it("allows only exact first-admin proxy paths and safe fields", () => {
  const path = "facilities/" + facility + "/first-facility-admin";
  for (const method of ["GET", "POST"])
    expect(institutionalPath(path, method)).toBe("/institutional/" + path);
  for (const method of ["PATCH", "DELETE", "PUT"])
    expect(institutionalPath(path, method)).toBeNull();
  expect(institutionalPath(path + "/extra", "POST")).toBeNull();
  expect(
    institutionalProjection({
      eligible: true,
      explanation: "Reviewed",
      enrollmentId: facility,
      emailCode: "redacted",
      phoneCode: "redacted",
      identityCiphertext: "redacted",
    }),
  ).toEqual({
    eligible: true,
    explanation: "Reviewed",
    enrollmentId: facility,
  });
});

it("discards an old eligibility response after focus restoration", async () => {
  let finish!: (value: Response) => void;
  transport
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    )
    .mockImplementation(async () =>
      Response.json({ eligible: false, explanation: "Assignment revoked." }),
    );
  show();
  fill();
  fireEvent(window, new Event("focus"));
  await screen.findByText("Assignment revoked.");
  await act(async () => {
    finish(Response.json({ eligible: true }));
  });
  expect(
    screen
      .getByRole("button", { name: "Provision first Facility Administrator" })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(transport.mock.calls[0][1]?.signal?.aborted).toBe(true);
});
it("clears prior eligibility while preserving the draft across prerequisite loss", async () => {
  const view = show();
  fill();
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Provision first Facility Administrator" })
        .hasAttribute("disabled"),
    ).toBe(false),
  );
  const props = {
    facilityId: facility,
    store,
    transport,
    onDiagnostics: diagnostics,
    onSuccess: () => {},
  };
  view.rerender(
    <FirstFacilityAdmin
      {...props}
      prerequisite="Revalidating current authority."
    />,
  );
  transport.mockImplementation(async () =>
    Response.json({ eligible: false, explanation: "Permission revoked." }),
  );
  view.rerender(<FirstFacilityAdmin {...props} prerequisite="" />);
  expect(
    screen
      .getByRole("button", { name: "Provision first Facility Administrator" })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(screen.getByLabelText("First name")).toHaveValue("Synthetic");
  await screen.findByText("Permission revoked.");
});
