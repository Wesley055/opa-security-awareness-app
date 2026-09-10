import { ConfigService } from "@nestjs/config";
import { ForbiddenException } from "@nestjs/common";
import { EnrollmentService } from "../auth/enrollment.service";
import { PlatformAdminService } from "./platform-admin.service";

describe("platform authority and durable staff intake", () => {
  const config = new ConfigService({
    ENROLLMENT_ENCRYPTION_KEY: "ab".repeat(32),
  });
  const input = {
    firstName: "Staff",
    lastName: "Test",
    email: "staff@example.test",
    phoneNumber: "+2348012345678",
    facilityId: "facility",
  };
  function setup(role = "ADMIN") {
    const tx = {
      $queryRaw: jest.fn(),
      $executeRaw: jest.fn(),
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({
            id: "actor",
            role,
            isActive: true,
            accountStatus: "ACTIVE",
            facilityId: "facility",
          }),
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      facility: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: "facility", isActive: true }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      enrollmentRequest: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "request" }),
      },
      accountInvitationDelivery: { createMany: jest.fn() },
      administrativeAuditEvent: { create: jest.fn() },
    };
    const prisma = {
      $transaction: async (fn: (client: typeof tx) => unknown) => fn(tx),
    };
    const enrollment = new EnrollmentService(prisma as never, config);
    return {
      tx,
      service: new PlatformAdminService(prisma as never, enrollment),
    };
  }
  it.each(["FACILITY_OPERATOR", "FACILITY_ADMIN", "USER"])(
    "denies %s platform directory access",
    async (role) => {
      const { tx, service } = setup(role);
      await expect(service.directory("actor")).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(tx.facility.findMany).not.toHaveBeenCalled();
    },
  );
  it.each(["FACILITY_OPERATOR", "FACILITY_ADMIN"] as const)(
    "queues %s proofs atomically without creating accounts or returning secrets",
    async (role) => {
      const { tx, service } = setup();
      expect(await service.invite("actor", input, "retry-key", role)).toEqual({
        requestId: "request",
        status: "VERIFICATION_PENDING",
      });
      expect(tx.user.findFirst).not.toHaveBeenCalled();
      expect(tx.user.create).not.toHaveBeenCalled();
      expect(tx.enrollmentRequest.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          requestedRole: role,
          facilityId: "facility",
          invitedByUserId: "actor",
        }),
      });
      expect(tx.accountInvitationDelivery.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({
            enrollmentId: "request",
            channel: "SMS",
            purpose: "ENROLLMENT",
            recipient: "",
          }),
          expect.objectContaining({
            enrollmentId: "request",
            channel: "EMAIL",
            purpose: "ENROLLMENT",
            recipient: "",
          }),
        ]),
      });
      expect(tx.administrativeAuditEvent.create).toHaveBeenCalled();
    },
  );
  it("denies a tenant administrator attempting a staff-role invitation", async () => {
    const { tx, service } = setup("FACILITY_ADMIN");
    await expect(
      service.invite("actor", input, "key", "FACILITY_OPERATOR"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.enrollmentRequest.create).not.toHaveBeenCalled();
  });
  it("reuses a durable receipt for the same request", async () => {
    const { tx, service } = setup();
    tx.enrollmentRequest.findUnique.mockResolvedValue({ id: "request" });
    expect(
      await service.invite("actor", input, "same-key", "FACILITY_OPERATOR"),
    ).toEqual({ requestId: "request", status: "VERIFICATION_PENDING" });
    expect(tx.accountInvitationDelivery.createMany).not.toHaveBeenCalled();
  });
});
