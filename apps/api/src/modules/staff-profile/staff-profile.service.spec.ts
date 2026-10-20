import { photoKind, StaffProfileService } from "./staff-profile.service";
import * as bcrypt from "bcrypt";

jest.mock("@azure/storage-blob", () => ({
  BlobSASPermissions: { parse: () => ({}) },
  BlobServiceClient: { fromConnectionString: () => ({ getContainerClient: () => ({ getBlockBlobClient: () => ({ uploadData: jest.fn(), generateSasUrl: jest.fn().mockResolvedValue("https://sas") }) }) }) },
}));

const config: any = { getOrThrow: (k: string) => (k === "BCRYPT_ROUNDS" ? 4 : "x") };
function svc(user: object) {
  const prisma: any = {
    user: { findUnique: jest.fn().mockResolvedValue(user), update: jest.fn(), findFirst: jest.fn() },
    passwordResetToken: { updateMany: jest.fn() },
    administrativeAuditEvent: { create: jest.fn() },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  };
  return { s: new StaffProfileService(prisma, config), prisma };
}

describe("staff profiles", () => {
  it("accepts JPEG/PNG by magic bytes only", () => {
    expect(photoKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpg");
    expect(photoKind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("png");
    expect(photoKind(Buffer.from("<svg>"))).toBeNull();
  });

  it("operator photo waits for admin approval; admin photo applies directly", async () => {
    const jpg = { buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1]), size: 5 };
    expect((await svc({ id: "o", role: "FACILITY_OPERATOR", isActive: true, facilityId: "f" }).s.uploadPhoto("o", jpg)).status).toBe("PENDING");
    expect((await svc({ id: "a", role: "FACILITY_ADMIN", isActive: true, facilityId: "f" }).s.uploadPhoto("a", jpg)).status).toBe("APPROVED");
  });

  it("refuses residents", async () => {
    await expect(svc({ id: "u", role: "USER", isActive: true }).s.me("u")).rejects.toThrow(/institutional staff/);
  });

  it("password change needs the current password and signs out every session", async () => {
    const passwordHash = await bcrypt.hash("old-password-1", 4);
    const { s, prisma } = svc({ id: "o", role: "FACILITY_OPERATOR", isActive: true, facilityId: "f", passwordHash });
    await expect(s.changePassword("o", "wrong", "New-password-22")).rejects.toThrow(/current password/);
    await s.changePassword("o", "old-password-1", "New-password-22");
    expect(prisma.user.update.mock.calls[0][0].data.credentialVersion).toEqual({ increment: 1 });
    expect(prisma.administrativeAuditEvent.create.mock.calls[0][0].data.action).toBe("STAFF_PASSWORD_CHANGED");
  });
});
