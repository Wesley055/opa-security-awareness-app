import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { PasswordInput } from "./password-input";
import { ForgotPasswordForm, ResetPasswordForm } from "./recovery-forms";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("starts masked, toggles by keyboard, preserves value/autocomplete and never submits or persists", async () => {
  const submit = vi.fn((e) => e.preventDefault());
  const store = vi.spyOn(Storage.prototype, "setItem");
  const value = crypto.randomUUID();
  render(
    <form onSubmit={submit}>
      <PasswordInput
        aria-label="Password"
        name="password"
        defaultValue={value}
        autoComplete="current-password"
      />
      <PasswordInput
        aria-label="Confirm password"
        name="confirmPassword"
        autoComplete="new-password"
      />
    </form>,
  );
  const input = screen.getByLabelText("Password");
  const toggle = screen.getAllByRole("button", { name: "Show password" })[0];
  expect(input).toHaveAttribute("type", "password");
  expect(toggle).toHaveAttribute("aria-pressed", "false");
  toggle.focus();
  await userEvent.keyboard("{Enter}");
  expect(input).toHaveAttribute("type", "text");
  expect(input).toHaveValue(value);
  expect(toggle).toHaveAttribute("aria-pressed", "true");
  await userEvent.keyboard(" ");
  expect(input).toHaveAttribute("type", "password");
  expect(input).toHaveValue(value);
  expect(input).toHaveAttribute("autocomplete", "current-password");
  expect(screen.getByLabelText("Confirm password")).toHaveAttribute(
    "type",
    "password",
  );
  expect(submit).not.toHaveBeenCalled();
  expect(store).not.toHaveBeenCalled();
});
it("generic recovery allows explicit resend and distinguishes all local workspaces and SSO", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ ok: true })),
  );
  render(<ForgotPasswordForm />);
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: crypto.randomUUID() + "@example.test" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send recovery email" }));
  expect(await screen.findByRole("status")).toHaveTextContent("If an eligible");
  expect(screen.getByText(/SSO-only/)).toBeInTheDocument();
  for (const name of [
    "Super Admin sign in",
    "Technical Support / Facility Admin sign in",
    "Operator sign in",
  ])
    expect(screen.getByRole("link", { name })).toBeInTheDocument();
  expect(screen.getByText(/Residents and Users/)).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Resend recovery email" }),
  );
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("reset confirms chosen password, has independent visibility and reports success only after response", async () => {
  const chosen = crypto.randomUUID();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ ok: true })),
  );
  render(<ResetPasswordForm initialToken={crypto.randomUUID()} />);
  fireEvent.change(screen.getByLabelText("New password"), {
    target: { value: chosen },
  });
  fireEvent.change(screen.getByLabelText("Confirm password"), {
    target: { value: "different-credential" },
  });
  fireEvent.submit(
    screen.getByRole("button", { name: "Reset password" }).closest("form")!,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("must match");
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Confirm password"), {
    target: { value: chosen },
  });
  fireEvent.click(screen.getAllByRole("button", { name: "Show password" })[1]);
  expect(screen.getByLabelText("Confirm password")).toHaveAttribute(
    "type",
    "text",
  );
  expect(screen.getByLabelText("New password")).toHaveAttribute(
    "type",
    "password",
  );
  fireEvent.submit(
    screen.getByRole("button", { name: "Reset password" }).closest("form")!,
  );
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Previous credentials and sessions are invalid",
  );
  expect(
    JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)),
  ).toMatchObject({ password: chosen });
});
it("an uncertain reset preserves drafts and releases controls", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
  );
  const chosen = crypto.randomUUID();
  render(<ResetPasswordForm initialToken={crypto.randomUUID()} />);
  fireEvent.change(screen.getByLabelText("New password"), {
    target: { value: chosen },
  });
  fireEvent.change(screen.getByLabelText("Confirm password"), {
    target: { value: chosen },
  });
  fireEvent.submit(
    screen.getByRole("button", { name: "Reset password" }).closest("form")!,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("Result unknown");
  expect(screen.getByLabelText("New password")).toHaveValue(chosen);
  expect(screen.getByRole("button", { name: "Reset password" })).toBeEnabled();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});
