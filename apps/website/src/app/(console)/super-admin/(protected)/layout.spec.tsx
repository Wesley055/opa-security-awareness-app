import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("@/lib/super-admin-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/super-admin-api")>();
  return { ...actual, requireAdmin: auth };
});
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error("REDIRECT:" + path);
  },
}));
import Layout from "./layout";
import { AdminFailure } from "@/lib/super-admin-api";
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("renders the shell for ADMIN without requiring facility membership", async () => {
  auth.mockResolvedValue({ name: "Platform Admin" });
  render(await Layout({ children: <p>Protected child</p> }));
  expect(screen.getByText("Platform ADMIN")).toBeInTheDocument();
  expect(screen.getByText("Protected child")).toBeInTheDocument();
});
it("redirects an unauthenticated request to dedicated sign-in", async () => {
  auth.mockRejectedValue(new AdminFailure(401));
  await expect(Layout({ children: <p>Protected child</p> })).rejects.toThrow(
    "REDIRECT:/super-admin/login",
  );
});
it.each([403, 503])("withholds protected children on %s", async (status) => {
  auth.mockRejectedValue(new AdminFailure(status));
  render(await Layout({ children: <p>Protected child</p> }));
  expect(screen.queryByText("Protected child")).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toBeInTheDocument();
});
