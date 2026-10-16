import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HeadOffice } from "./head-office";
import { parseHeadOffice } from "@/lib/organization-insight";
import { headOfficeFixture } from "@/lib/organization-insight.fixture";
afterEach(cleanup);
const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
describe("Head Office view", () => {
  it("shows organization totals and one row per branch", async () => {
    const transport = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>(async () => ok({ summary: parseHeadOffice(headOfficeFixture()) }));
    render(<HeadOffice transport={transport} />);
    fireEvent.click(screen.getByRole("button", { name: "Load view" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Demo Bank" })).toBeInTheDocument());
    expect(screen.getByRole("rowheader", { name: "Branch lagos" })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "Branch abuja" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Lagos" })).toBeInTheDocument();
    expect(transport.mock.calls[0]![0]).not.toContain("organizationId");
  });
  it("sends the chosen region and never an organization", async () => {
    const transport = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>(async () => ok({ summary: parseHeadOffice(headOfficeFixture()) }));
    render(<HeadOffice transport={transport} />);
    fireEvent.click(screen.getByRole("button", { name: "Load view" }));
    await screen.findByRole("option", { name: "Lagos" });
    fireEvent.change(screen.getByLabelText("Region"), { target: { value: "Lagos" } });
    fireEvent.click(screen.getByRole("button", { name: "Load view" }));
    await waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
    expect(transport.mock.calls[1]![0]).toContain("region=Lagos");
  });
  it("clears figures when access is refused", async () => {
    const transport = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>(async () => new Response("{}", { status: 403 }));
    render(<HeadOffice transport={transport} />);
    fireEvent.click(screen.getByRole("button", { name: "Load view" }));
    await screen.findByText(/no longer authorized/);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
