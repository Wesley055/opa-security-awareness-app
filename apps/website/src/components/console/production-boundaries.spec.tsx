import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { DeliveryConfirmation } from "./delivery-confirmation";
import { ReportingShell } from "./reporting-shell";
import {
  deliveryPage,
  type DeliveryAttempt,
} from "@/lib/delivery-confirmation";
const row: DeliveryAttempt = {
  id: "1",
  channel: "SMS",
  recipient: { maskedIdentity: "••••1234", reference: "1" },
  status: "DELIVERED",
  receiptAuthentication: "UNAVAILABLE",
  failureCategory: null,
  attemptCount: 2,
  retryCount: 1,
  queuedAt: "2026-09-10T01:00:00Z",
  firstAttemptAt: null,
  lastAttemptAt: null,
  providerAcceptedAt: "2026-09-10T01:00:01Z",
  deliveredAt: "2026-09-10T01:00:02Z",
  retryScheduledAt: null,
  hasUnconfirmedOutcome: false,
  historyComplete: true,
};
const snapshot = (item: DeliveryAttempt) => ({
  state: "READY" as const,
  page: { version: 1 as const, items: [item], nextCursor: null },
});
it("withholds an unsupported SMS delivered claim", () => {
  render(<DeliveryConfirmation snapshot={snapshot(row)} />);
  expect(screen.getByText("Status: Delivery proof unavailable")).toBeVisible();
  expect(screen.queryByText(row.deliveredAt!)).toBeNull();
});
it("renders signed email mail-server delivery without exposing provider references", () => {
  render(
    <DeliveryConfirmation
      snapshot={snapshot({
        ...row,
        channel: "EMAIL",
        receiptAuthentication: "PROVIDER_SIGNATURE",
      })}
    />,
  );
  expect(screen.getByText("Status: DELIVERED")).toBeVisible();
  expect(screen.getByText(row.deliveredAt!)).toBeVisible();
  expect(screen.getByText(/reading is not established/)).toBeVisible();
  expect(screen.queryByText("Provider reference")).toBeNull();
});
it("presents unavailable records as unknown rather than an empty result", () => {
  render(<DeliveryConfirmation />);
  expect(screen.getByRole("status")).toHaveTextContent("unavailable");
  expect(
    screen.queryByText("No notification attempts are recorded."),
  ).toBeNull();
});
it.each(["UNKNOWN", "ATTEMPTING", "PROVIDER_ACCEPTED"] as const)(
  "preserves %s and incomplete evidence",
  (status) => {
    render(
      <DeliveryConfirmation
        snapshot={snapshot({
          ...row,
          status,
          hasUnconfirmedOutcome: true,
          historyComplete: false,
        })}
      />,
    );
    expect(
      screen.getByText("Status: " + status.replaceAll("_", " ")),
    ).toBeVisible();
    expect(screen.getByText(/outcome is unconfirmed/)).toBeVisible();
    expect(screen.getByText(/evidence is incomplete/)).toBeVisible();
  },
);
it("whitelists the bridge projection and refuses plaintext identities", () => {
  const parsed = deliveryPage({
    version: 1,
    items: [
      {
        ...row,
        providerMessageId: "secret",
        payload: { recipient: "private@example.test" },
      },
    ],
    nextCursor: null,
  });
  expect(parsed).not.toBeNull();
  expect(JSON.stringify(parsed)).not.toContain("secret");
  expect(JSON.stringify(parsed)).not.toContain("private@example.test");
  expect(
    deliveryPage({
      version: 1,
      items: [
        { ...row, recipient: { maskedIdentity: "private@example.test" } },
      ],
      nextCursor: null,
    }),
  ).toBeNull();
});
it("offers real reports without fabricating data or unfinished authoring", () => {
  render(<ReportingShell />);
  expect(
    screen.getByRole("heading", { name: "Reports & Analytics" }),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "Load report" })).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("Choose a date window");
  expect(screen.getByText(/JSON export are backend only/)).toBeVisible();
  expect(screen.queryByText("Notification outcomes")).toBeNull();
});
