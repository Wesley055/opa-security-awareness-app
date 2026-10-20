import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ActivityLog } from "./activity-log";

const rows = [
  { id: "6a967f6e-0000-4000-8000-000000000001", actorUserId: "6a967f6e-0000-4000-8000-000000000001", resourceId: "6a967f6e-0000-4000-8000-000000000001", action: "STAFF_PHOTO_UPLOADED", createdAt: "2026-10-20T21:15:19Z" },
  { id: "6a967f6e-0000-4000-8000-000000000002", actorUserId: "x", actorRole: "FACILITY_ADMIN", resourceId: "y", action: "EVIDENCE_AIR_LIST_READ", createdAt: "2026-10-20T21:10:00Z" },
  { id: "6a967f6e-0000-4000-8000-000000000003", actorUserId: "x", actorRole: "SYSTEM", resourceId: "z", action: "DUTY_REPORT_SYSTEM_GENERATED", createdAt: "2026-10-20T20:00:00Z" },
];

it("shows plain activity, hides routine access records and never shows identifiers or event codes", () => {
  const { container } = render(<ActivityLog rows={rows} />);
  expect(screen.getByText("Uploaded a profile photo")).toBeTruthy();
  expect(screen.getByText("The account holder")).toBeTruthy();
  expect(screen.getByText("OPA (automatic)")).toBeTruthy();
  expect(screen.getByText(/1 item may need your attention/)).toBeTruthy();
  expect(screen.queryByText("Viewed the incident reports list")).toBeNull();
  expect(container.textContent).not.toMatch(/6a967f6e|EVIDENCE_|STAFF_PHOTO/);
  fireEvent.click(screen.getByRole("checkbox"));
  expect(screen.getByText("Viewed the incident reports list")).toBeTruthy();
  expect(screen.getByText("Facility Administrator")).toBeTruthy();
});
