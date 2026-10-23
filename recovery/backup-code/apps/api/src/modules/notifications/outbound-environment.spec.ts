import { outboundDenial, recipientAllowed } from "./outbound-environment";
import { EmailProvider } from "./providers/email.provider";
import { PushProvider } from "./providers/push.provider";
import { receiptStatus } from "./delivery-policy";
import type { preflight } from "../../../../../packages/environment-policy/index.cjs";
describe("staging outbound safety", () => {
  const original = process.env;
  beforeEach(() => {
    process.env = { ...original, OPA_ENVIRONMENT: "staging" };
  });
  afterEach(() => {
    process.env = original;
    jest.restoreAllMocks();
  });
  const checked: typeof preflight = () => ({
    environment: "staging",
    databaseEnvironment: "staging",
    redisEnvironment: "staging",
    notificationMode: "allowlist",
    ssoEnabled: false,
    migrationReadiness: "ready",
  });
  it("defaults disabled and does not invoke provider network or quota", async () => {
    const network = jest.spyOn(globalThis, "fetch");
    const reserve = jest.fn();
    expect(
      await outboundDenial("EMAIL", "test@example.test", reserve, checked),
    ).toMatchObject({
      success: false,
      retryable: false,
      failureCategory: "REJECTED",
    });
    expect(reserve).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  });
  it("requires exact recipients and blocks injection", () => {
    process.env.OPA_NOTIFICATION_MODE = "allowlist";
    process.env.OPA_NOTIFICATION_ALLOWLIST_JSON = JSON.stringify({
      EMAIL: ["test@example.test"],
      SMS: ["+2348012345678"],
      PUSH: ["ExponentPushToken[fixture]"],
    });
    expect(recipientAllowed("EMAIL", "test@example.test")).toBe(true);
    expect(recipientAllowed("SMS", "+2348012345678")).toBe(true);
    expect(recipientAllowed("PUSH", "ExponentPushToken[fixture]")).toBe(true);
    for (const recipient of [
      "real@example.test",
      "test@example.test,real@example.test",
      "test@example.test\r\nBcc: real@example.test",
    ])
      expect(recipientAllowed("EMAIL", recipient)).toBe(false);
  });
  it("reserves before sending and fails closed on exhausted/unavailable budgets", async () => {
    process.env.OPA_NOTIFICATION_MODE = "allowlist";
    process.env.OPA_NOTIFICATION_ALLOWLIST_JSON = JSON.stringify({
      EMAIL: ["test@example.test"],
    });
    const reserve = jest
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error("unavailable"));
    expect(
      await outboundDenial("EMAIL", "test@example.test", reserve, checked),
    ).toBeNull();
    expect(
      await outboundDenial("EMAIL", "test@example.test", reserve, checked),
    ).toMatchObject({ success: false });
    expect(
      await outboundDenial("EMAIL", "test@example.test", reserve, checked),
    ).toMatchObject({ success: false });
    expect(reserve).toHaveBeenCalledTimes(3);
  });
  it("direct provider paths deny without a trusted policy and cannot create delivery truth", async () => {
    const network = jest.spyOn(globalThis, "fetch");
    for (const provider of [new EmailProvider(), new PushProvider()]) {
      const result = await provider.send({
        recipient: "real@example.test",
        message: "fixture",
      });
      expect(result.success).toBe(false);
      expect(result.messageId).toBeUndefined();
      expect(
        receiptStatus(
          "ATTEMPTING",
          result.success ? "PROVIDER_ACCEPTED" : "FAILED",
        ),
      ).toBe("FAILED");
    }
    expect(network).not.toHaveBeenCalled();
  });
  it("production transport behavior remains enabled", async () => {
    process.env.OPA_ENVIRONMENT = "production";
    delete process.env.OPA_NOTIFICATION_MODE;
    expect(await outboundDenial("EMAIL", "test@example.test")).toBeNull();
  });
});
