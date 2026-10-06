import { describe, it, expect } from "vitest";
import {
  deliveryLabel,
  supportProjection,
  type SupportDelivery,
} from "./support-administration";
const row: SupportDelivery = {
  channel: "SMS",
  status: "SENT",
  deliveryStatus: "UNKNOWN",
  attemptCount: 1,
  failureCategory: null,
  providerAcceptedAt: null,
  confirmedDeliveredAt: null,
};
describe("support delivery truth", () => {
  it.each([
    ["QUEUED", "Queued"],
    ["ATTEMPTING", "Attempting"],
    ["PROVIDER_ACCEPTED", "Provider accepted; delivery not confirmed"],
    ["FAILED", "Failed"],
    ["UNKNOWN", "Unknown; delivery not confirmed"],
  ])("labels %s independently of transport SENT", (state, label) =>
    expect(deliveryLabel({ ...row, deliveryStatus: state })).toBe(label),
  );
  it("requires confirmation evidence before claiming delivery", () => {
    expect(deliveryLabel({ ...row, deliveryStatus: "DELIVERED" })).toContain(
      "Unknown",
    );
    expect(
      deliveryLabel({
        ...row,
        deliveryStatus: "DELIVERED",
        confirmedDeliveredAt: new Date().toISOString(),
      }),
    ).toBe("Delivery confirmed");
  });
  it("projects only safe delivery diagnostics", () => {
    expect(
      supportProjection({
        deliveries: [
          {
            ...row,
            recipient: "private",
            providerMessageId: "private",
            requestCiphertext: "private",
          },
        ],
      }),
    ).toEqual({ deliveries: [row] });
  });
});
