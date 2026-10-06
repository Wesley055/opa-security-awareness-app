import { randomBytes, randomUUID } from "node:crypto";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, it, expect, vi } from "vitest";
import EnrollPage from "./page";
const navigation = vi.hoisted(() => ({ query: "" }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(navigation.query),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("explains an identifier conflict without identifying the colliding identifier or assuming this email has an account", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "VERIFY" }),
      })
      .mockResolvedValue({
        ok: true,
        json: async () => ({ status: "AUTHENTICATION_REQUIRED" }),
      }),
  );
  render(<EnrollPage />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Invitation reference"), randomUUID());
  await user.type(
    screen.getByLabelText("Email verification code"),
    randomBytes(8).toString("hex"),
  );
  await user.type(
    screen.getByLabelText("Phone verification code"),
    randomBytes(8).toString("hex"),
  );
  const password = randomBytes(24).toString("hex");
  await user.type(screen.getByLabelText("Choose a password"), password);
  await user.type(screen.getByLabelText("Confirm password"), password);
  await user.click(screen.getByRole("checkbox"));
  await user.click(
    screen.getByRole("button", { name: "Verify and activate account" }),
  );
  expect(
    await screen.findByText(/a separate account cannot be created/),
  ).toHaveTextContent("contact your administrator");
  expect(
    screen.queryByText(
      /phone already|email already|Sign in to your existing account/,
    ),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Continue with an existing account" }),
  ).toBeInTheDocument();
});

it("prefills only the request reference from the delivered link; both proofs remain required", () => {
  const id = randomUUID();
  navigation.query = "requestId=" + id;
  render(<EnrollPage />);
  expect(screen.getByLabelText("Invitation reference")).toHaveValue(id);
  expect(screen.getByLabelText("Email verification code")).toBeRequired();
  expect(screen.getByLabelText("Phone verification code")).toBeRequired();
  navigation.query = "";
});

it("does not activate or submit mismatched password confirmation", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "VERIFY" }),
    }),
  );
  render(<EnrollPage />);
  const form = screen
    .getByRole("button", { name: "Verify and activate account" })
    .closest("form")!;
  const password = crypto.randomUUID();
  fireEvent.change(screen.getByLabelText("Choose a password"), {
    target: { value: password },
  });
  fireEvent.change(screen.getByLabelText("Confirm password"), {
    target: { value: crypto.randomUUID() },
  });
  fireEvent.submit(form);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Passwords must match",
  );
  expect(
    vi.mocked(fetch).mock.calls.filter((call) => call[1]?.method === "POST"),
  ).toHaveLength(0);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Verify and activate account" }),
  ).toBeEnabled();
});

async function acceptAs(role: string, ok = true) {
  const secret = randomBytes(20).toString("hex");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_path, init) => ({
      ok: init?.method === "POST" ? ok : true,
      json: async () =>
        init?.method === "POST"
          ? ok
            ? { status: "ACCEPTED", role }
            : { status: "REJECTED", error: "Proofs rejected" }
          : { status: "VERIFY" },
    })),
  );
  const ui = render(<EnrollPage />);
  fireEvent.change(screen.getByLabelText("Invitation reference"), {
    target: { value: randomUUID() },
  });
  fireEvent.change(screen.getByLabelText("Email verification code"), {
    target: { value: secret },
  });
  fireEvent.change(screen.getByLabelText("Phone verification code"), {
    target: { value: secret },
  });
  fireEvent.change(screen.getByLabelText("Choose a password"), {
    target: { value: secret },
  });
  fireEvent.change(screen.getByLabelText("Confirm password"), {
    target: { value: secret },
  });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.submit(
    screen
      .getByRole("button", { name: "Verify and activate account" })
      .closest("form")!,
  );
  await screen.findByRole(ok ? "status" : "alert");
  return { ui, secret };
}
it.each([
  ["USER", "Open OPA app to sign in", "opa://login"],
  ["ADMIN", "Sign in to Super Admin", "/super-admin/login"],
  [
    "FACILITY_OPERATOR",
    "Sign in to Operator Command Center",
    "/operator/login",
  ],
  ["FACILITY_ADMIN", "Sign in to Facility Admin workspace", "/institutional"],
  ["TECHNICAL_SUPPORT", "Sign in to OPA Support Console", "/institutional"],
])(
  "accepted %s uses the existing truthful sign-in destination",
  async (role, label, href) => {
    const { secret } = await acceptAs(role);
    expect(screen.getByRole("link", { name: label })).toHaveAttribute(
      "href",
      href,
    );
    expect(screen.queryByLabelText("Choose a password")).toBeNull();
    expect(document.body.textContent).not.toContain(secret);
    expect(window.location.href).not.toContain(secret);
    for (const link of screen.getAllByRole("link"))
      expect(link.getAttribute("href")).not.toMatch(/[?#]/);
    if (role === "USER")
      expect(
        screen.getByText(/There is no resident web portal/),
      ).toBeInTheDocument();
    fireEvent(window, new Event("pageshow"));
    expect(screen.queryByLabelText("Email verification code")).toBeNull();
  },
);
it("failed activation never renders a success sign-in CTA", async () => {
  await acceptAs("USER", false);
  expect(
    screen.queryByRole("region", { name: "Enrollment complete" }),
  ).toBeNull();
  expect(screen.queryByRole("link", { name: /sign in/i })).toBeNull();
});
it("refresh only checks resume state and never repeats activation", async () => {
  const { ui } = await acceptAs("FACILITY_ADMIN");
  const writes = () =>
    vi.mocked(fetch).mock.calls.filter((c) => c[1]?.method === "POST").length;
  expect(writes()).toBe(1);
  ui.unmount();
  render(<EnrollPage />);
  await screen.findByRole("button", { name: "Verify and activate account" });
  expect(writes()).toBe(1);
  expect(screen.getByLabelText("Choose a password")).toHaveValue("");
});
