import { ConfigService } from "@nestjs/config";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { EnrollmentService } from "./enrollment.service";
import { enrollmentAuthority } from "../onboarding/support-authority";

const identity = {
  firstName: "Head",
  lastName: "Office",
  email: "head.office@example.test",
  phoneNumber: "+2348012345678",
};
const context = {
  reason: "Appoint Head Office security lead",
  correlationId: randomUUID(),
};
const actor = (role: string) => ({
  id: "actor",
  role,
  isActive: true,
  accountStatus: "ACTIVE",
  facilityId: null,
});

function service(tx: Record<string, unknown>) {
  const config = new ConfigService({ ENROLLMENT_ENCRYPTION_KEY: "ab".repeat(32) });
  return new EnrollmentService(
    { $transaction: async (fn: (t: unknown) => unknown) => fn(tx) } as never,
    config,
  );
}

describe("Head Office administrator enrollment", () => {
  it("is appointed only by the OPA platform owner", async () => {
    for (const role of ["TECHNICAL_SUPPORT", "FACILITY_ADMIN", "FACILITY_OPERATOR", "USER"]) {
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        user: { findUnique: jest.fn().mockResolvedValue(actor(role)) },
        supportEmployment: { findUnique: jest.fn().mockResolvedValue({ state: "ACTIVE" }) },
      };
      await expect(
        enrollmentAuthority(tx as never, "actor", null, "ORGANIZATION_ADMIN"),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      user: { findUnique: jest.fn().mockResolvedValue(actor("ADMIN")) },
    };
    await expect(
      enrollmentAuthority(tx as never, "actor", null, "ORGANIZATION_ADMIN"),
    ).resolves.toMatchObject({ actorRole: "ADMIN", authority: "PLATFORM_ADMIN" });
  });

  it("can never belong to a facility", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      user: { findUnique: jest.fn().mockResolvedValue(actor("ADMIN")) },
    };
    await expect(
      enrollmentAuthority(tx as never, "actor", "facility", "ORGANIZATION_ADMIN"),
    ).rejects.toThrow("cannot be facility members");
  });

  it.each([
    ["no organization", undefined, undefined],
    ["a facility as well", "facility", "organization"],
  ])("rejects an invitation with %s before any database work", async (_l, facilityId, organizationId) => {
    const tx = { $executeRaw: jest.fn() };
    await expect(
      service(tx).request(
        identity,
        "key",
        facilityId,
        "actor",
        "ORGANIZATION_ADMIN",
        context,
        false,
        organizationId,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it("rejects an organization on any other role", async () => {
    await expect(
      service({}).request(identity, "key", "facility", "actor", "FACILITY_ADMIN", context, false, "organization"),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("records the organization on the invitation and in the audit trail", async () => {
    const id = randomUUID();
    const tx = {
      $executeRaw: jest.fn(),
      $queryRaw: jest.fn().mockResolvedValue([]),
      user: { findUnique: jest.fn().mockResolvedValue(actor("ADMIN")) },
      organization: { findUnique: jest.fn().mockResolvedValue({ id: "organization" }) },
      administrativeAuditEvent: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
      enrollmentRequest: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id }),
      },
      accountInvitationDelivery: { createMany: jest.fn() },
    };
    const result = await service(tx).request(
      identity,
      "key",
      undefined,
      "actor",
      "ORGANIZATION_ADMIN",
      context,
      false,
      "organization",
    );
    expect(result).toEqual({ requestId: id, status: "VERIFICATION_PENDING" });
    expect(tx.enrollmentRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        requestedRole: "ORGANIZATION_ADMIN",
        facilityId: undefined,
        organizationId: "organization",
        invitedByUserId: "actor",
      }),
    });
    expect(tx.administrativeAuditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "ENROLLMENT_REQUESTED",
        afterState: expect.objectContaining({
          requestedRole: "ORGANIZATION_ADMIN",
          organizationId: "organization",
        }),
      }),
    });
  });

  it("refuses an organization that does not exist", async () => {
    const tx = {
      $executeRaw: jest.fn(),
      $queryRaw: jest.fn().mockResolvedValue([]),
      user: { findUnique: jest.fn().mockResolvedValue(actor("ADMIN")) },
      organization: { findUnique: jest.fn().mockResolvedValue(null) },
      administrativeAuditEvent: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
      enrollmentRequest: { findUnique: jest.fn(), create: jest.fn() },
    };
    await expect(
      service(tx).request(identity, "key", undefined, "actor", "ORGANIZATION_ADMIN", context, false, "missing"),
    ).rejects.toThrow("Organization not found.");
    expect(tx.enrollmentRequest.create).not.toHaveBeenCalled();
  });
});
