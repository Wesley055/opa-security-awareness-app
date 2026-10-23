import { randomBytes, randomUUID } from "node:crypto";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { JwtStrategy } from "./jwt.strategy";
import type { PrismaService } from "../../prisma/prisma.service";
describe("session restart contract", () => {
  const secret = randomBytes(32).toString("hex"),
    id = randomUUID();
  const payload = {
    sub: id,
    email: "fixture@example.test",
    role: "ADMIN",
    credentialVersion: 0,
  };
  const record = {
    id,
    email: payload.email,
    role: "ADMIN",
    credentialVersion: 0,
    isActive: true,
    accountStatus: "ACTIVE",
  };
  const prisma = { user: { findUnique: jest.fn() } };
  const strategy = () =>
    new JwtStrategy(
      new ConfigService({ JWT_ACCESS_SECRET: secret }),
      prisma as unknown as PrismaService,
    );
  beforeEach(() => prisma.user.findUnique.mockResolvedValue({ ...record }));
  it("new signer/verifier and strategy instances retain a valid token with stable signing key and DB state", async () => {
    const token = new JwtService({ secret }).sign(payload, { expiresIn: "5m" });
    const decoded = new JwtService({ secret }).verify<typeof payload>(token);
    await expect(strategy().validate(decoded)).resolves.toMatchObject(payload);
    await expect(strategy().validate(decoded)).resolves.toMatchObject(payload);
  });
  it("changing signing material invalidates the previous token, not a process restart itself", () => {
    const token = new JwtService({ secret }).sign(payload);
    expect(() =>
      new JwtService({ secret: randomBytes(32).toString("hex") }).verify(token),
    ).toThrow();
  });
  it("current credential revocation denies existing tokens after restart", async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...record,
      credentialVersion: 1,
    });
    await expect(strategy().validate(payload)).rejects.toThrow();
  });
  it("missing or inactive account denies session restoration", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(strategy().validate(payload)).rejects.toThrow();
    prisma.user.findUnique.mockResolvedValue({ ...record, isActive: false });
    await expect(strategy().validate(payload)).rejects.toThrow();
  });
});
