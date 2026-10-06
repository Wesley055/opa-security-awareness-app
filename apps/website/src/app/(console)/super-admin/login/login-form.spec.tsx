import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
import Login from "./login-form";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it.each([401, 503])(
  "distinguishes login status %s without account enumeration",
  async (status) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(
        { error: "The service is temporarily unavailable." },
        { status },
      ),
    );
    render(<Login />);
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "fixture@example.test" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: crypto.randomUUID() },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      status === 401
        ? "Invalid email or password."
        : "The service is temporarily unavailable.",
    );
    expect(vi.mocked(fetch).mock.calls[0][1]?.signal).toBeDefined();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  },
);
it("manual restore fails once, does not loop or claim invalid password", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json(
      { error: "Your session has ended. Sign in again." },
      { status: 401 },
    ),
  );
  render(<Login />);
  fireEvent.click(screen.getByRole("button", { name: "Restore session" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Your session has ended.",
  );
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(
    screen.queryByText("Invalid email or password."),
  ).not.toBeInTheDocument();
});

it("exposes recovery separately from restoring a session and shared password visibility", () => {
  render(<Login />);
  expect(screen.getByRole("link", { name: /Forgot password/ })).toHaveAttribute(
    "href",
    "/forgot-password",
  );
  expect(
    screen.getByRole("button", { name: "Restore session" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Show password" })).toHaveAttribute(
    "type",
    "button",
  );
});
