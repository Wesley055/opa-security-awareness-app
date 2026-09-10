import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Workspace from "./workspace";
vi.mock("@/lib/super-admin-fetch", () => ({ superAdminFetch: vi.fn() }));
import { superAdminFetch } from "@/lib/super-admin-fetch";
describe("Super Admin directory", () => {
  beforeEach(() => vi.clearAllMocks());
  it("shows a real empty state", async () => {
    vi.mocked(superAdminFetch).mockResolvedValue(
      new Response(JSON.stringify({ facilities: [], nextCursor: null })),
    );
    render(<Workspace />);
    await screen.findByText("No facilities to display.");
    expect(screen.queryByText(/activation token/i)).toBeNull();
  });
  it("shows a recoverable service error", async () => {
    vi.mocked(superAdminFetch).mockResolvedValue(
      new Response(JSON.stringify({ error: "Service unavailable" }), {
        status: 503,
      }),
    );
    render(<Workspace />);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Service unavailable",
      ),
    );
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });
});
