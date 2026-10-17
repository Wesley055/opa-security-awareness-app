import { ConfigService } from "@nestjs/config";
import { prepareIdentityDelivery } from "./identity-delivery";
import { enrollmentCodeMatches } from "../../shared/security/activation-code";
import * as resolution from "../../shared/security/enrollment-resolution";

const KEY = "ab".repeat(32);
const config = new ConfigService({
  ENROLLMENT_ENCRYPTION_KEY: KEY,
  OPA_WEB_URL: "https://opasafety.com",
  OPA_ENVIRONMENT: "production",
});
const request = {
  id: "8f6b0d5e-3c1a-4b8e-9f2d-1a2b3c4d5e6f",
  revokedAt: null,
  verifiedAt: null,
  acceptedAt: null,
  proofAttempts: 0,
  expiresAt: new Date("2099-10-18T13:30:00Z"),
  facilityId: null,
  organizationId: null,
  requestedRole: "USER",
  invitedByUserId: null,
  identityCiphertext: "x",
};

function tx() {
  return {
    enrollmentRequest: {
      findUnique: jest.fn().mockResolvedValue(request),
      update: jest.fn().mockResolvedValue({}),
    },
  };
}

describe("enrollment invitation message", () => {
  beforeEach(() =>
    jest.spyOn(resolution, "resolveEnrollmentIdentity").mockResolvedValue({
      email: "ada@example.com",
      phoneNumber: "+2348012345678",
      firstName: "Ada",
      lastName: "O",
    } as never),
  );
  afterEach(() => jest.restoreAllMocks());

  it.each(["SMS", "EMAIL"])("sends a short %s with a 4-digit code that verifies", async (channel) => {
    const t = tx();
    const msg = await prepareIdentityDelivery(
      t as never,
      { purpose: "ENROLLMENT", enrollmentId: request.id, channel: channel === "SMS" ? "SMS" : "EMAIL" } as never,
      config,
    );
    const code = /\b(\d{4})\b/.exec(msg!.message)![1]!;
    expect(msg!.message).toContain("https://opasafety.com/enroll?requestId=" + request.id);
    expect(msg!.message).toContain("18 Oct, 14:30 WAT");
    expect(msg!.message).not.toContain("Request:");
    if (channel === "SMS") expect(msg!.message.length).toBeLessThanOrEqual(240);
    const data = t.enrollmentRequest.update.mock.calls[0][0].data;
    const digest = channel === "SMS" ? data.phoneTokenHash : data.emailTokenHash;
    expect(digest).not.toContain(code);
    expect(enrollmentCodeMatches(code, digest, KEY)).toBe(true);
  });
});
