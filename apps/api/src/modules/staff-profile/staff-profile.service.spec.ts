import { photoKind, StaffProfileService } from "./staff-profile.service";
import * as bcrypt from "bcrypt";

jest.mock("@azure/storage-blob", () => ({
  BlobSASPermissions: { parse: () => ({}) },
  BlobServiceClient: { fromConnectionString: () => ({ getContainerClient: () => ({ getBlockBlobClient: () => ({ uploadData: jest.fn(), generateSasUrl: jest.fn().mockResolvedValue("https://sas") }) }) }) },
}));

const config: any = { getOrThrow: (k: string) => (k === "BCRYPT_ROUNDS" ? 4 : "test-key") };
function svc(user: object) {
  const prisma: any = {
    user: { findUnique: jest.fn().mockResolvedValue(user), update: jest.fn(), findFirst: jest.fn() },
    passwordResetToken: { updateMany: jest.fn() },
    staffRecoveryCode: { count: jest.fn().mockResolvedValue(0), updateMany: jest.fn().mockResolvedValue({ count: 1 }), create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    administrativeAuditEvent: { create: jest.fn() },
  };
  prisma.$transaction = jest.fn((ops: any) => (typeof ops === "function" ? ops(prisma) : Promise.all(ops)));
  const sms = { send: jest.fn().mockResolvedValue({ success: true }) };
  const email = { send: jest.fn().mockResolvedValue({ success: true }) };
  return { s: new StaffProfileService(prisma, config, sms as any, email as any), prisma, sms, email };
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

  describe("in-session recovery by code", () => {
    const op = { id: "o", role: "FACILITY_OPERATOR", isActive: true, accountStatus: "ACTIVE", facilityId: "f", email: "o@x.t", phoneNumber: "+2348000000034" };
    const admin = { ...op, id: "a", role: "FACILITY_ADMIN" };

    it("operators get one SMS code; privileged staff get SMS and email codes; nothing full is revealed", async () => {
      const o = svc(op);
      const r = await o.s.startRecovery("o");
      expect(r).toMatchObject({ channels: ["SMS"], phoneHint: "34", smsSent: true, emailSent: null });
      expect(o.sms.send.mock.calls[0][0].message).toMatch(/code is \d{6}/);
      expect(o.email.send).not.toHaveBeenCalled();
      const created = o.prisma.staffRecoveryCode.create.mock.calls[0][0].data;
      expect(created.smsCodeMac).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(created)).not.toMatch(/"\d{6}"/);
      const a = svc(admin);
      expect((await a.s.startRecovery("a")).channels).toEqual(["SMS", "EMAIL"]);
      expect(a.email.send).toHaveBeenCalled();
    });

    it("rate-limits code requests", async () => {
      const o = svc(op);
      o.prisma.staffRecoveryCode.count.mockResolvedValue(3);
      await expect(o.s.startRecovery("o")).rejects.toThrow(/Too many code requests/);
    });

    it("accepts the right code, changes the password and signs out everywhere; wrong codes count and lock at 5", async () => {
      const o = svc(op);
      await o.s.startRecovery("o");
      const code = o.sms.send.mock.calls[0][0].message.match(/(\d{6})/)[1];
      const row = { ...o.prisma.staffRecoveryCode.create.mock.calls[0][0].data, attempts: 0, consumedAt: null };
      o.prisma.staffRecoveryCode.findFirst.mockResolvedValue(row);
      await expect(o.s.completeRecovery("o", code === "000000" ? "000001" : "000000", undefined, "New-pass-22")).rejects.toThrow(/not correct/);
      expect(o.prisma.staffRecoveryCode.update.mock.calls[0][0].data.attempts).toBe(1);
      o.prisma.staffRecoveryCode.findFirst.mockResolvedValue({ ...row, attempts: 4 });
      await expect(o.s.completeRecovery("o", "999999" === code ? "111111" : "999999", undefined, "New-pass-22")).rejects.toThrow(/Too many wrong codes/);
      o.prisma.staffRecoveryCode.findFirst.mockResolvedValue(row);
      await o.s.completeRecovery("o", code, undefined, "New-pass-22");
      expect(o.prisma.user.update.mock.calls.at(-1)[0].data.credentialVersion).toEqual({ increment: 1 });
      expect(o.prisma.administrativeAuditEvent.create.mock.calls.at(-1)[0].data.action).toBe("STAFF_PASSWORD_RECOVERED");
    });

    it("a privileged account needs the email code too", async () => {
      const a = svc(admin);
      await a.s.startRecovery("a");
      const code = a.sms.send.mock.calls[0][0].message.match(/(\d{6})/)[1];
      a.prisma.staffRecoveryCode.findFirst.mockResolvedValue({ ...a.prisma.staffRecoveryCode.create.mock.calls[0][0].data, attempts: 0, consumedAt: null });
      await expect(a.s.completeRecovery("a", code, undefined, "New-pass-22")).rejects.toThrow(/not correct/);
    });

    it("expired codes are refused", async () => {
      const o = svc(op);
      o.prisma.staffRecoveryCode.findFirst.mockResolvedValue({ id: "r", smsCodeMac: "a".repeat(64), attempts: 0, expiresAt: new Date(Date.now() - 1000), consumedAt: null });
      await expect(o.s.completeRecovery("o", "123456", undefined, "New-pass-22")).rejects.toThrow(/expired/);
    });
  });
});
