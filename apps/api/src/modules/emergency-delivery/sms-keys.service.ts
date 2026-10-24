import { Injectable, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { deriveDeviceKey } from "./sms-codec";
import { smsFallbackEnabled } from "./delivery-identity";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const MAX_ACTIVE_KEYS = 4;

export function signingSecret(): Buffer | null {
  const raw = process.env.SMS_SIGNING_SECRET ?? "";
  const key = Buffer.from(raw, "base64");
  return key.length === 32 && key.toString("base64") === raw ? key : null;
}

function newKeyId(): string {
  return Array.from(randomBytes(8), (b) => BASE32[b % 32]).join("");
}

@Injectable()
export class SmsKeysService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Issues the signing key a phone uses for its offline SOS SMS. Residents
   * only: an SMS SOS must reach a security team. The key is derived, not
   * stored, and dies with the next password change or sign-out-everywhere.
   */
  async issue(userId: string) {
    if (!smsFallbackEnabled()) return { enabled: false as const };
    const secret = signingSecret();
    const shortCode = process.env.AFRICASTALKING_SHORTCODE ?? "";
    if (!secret || !/^\d{3,8}$/.test(shortCode)) throw new ServiceUnavailableException("SMS fallback is not configured.");
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, isActive: true, accountStatus: true, credentialVersion: true },
      });
      if (!user?.isActive || user.accountStatus !== "ACTIVE") throw new UnauthorizedException("Account unavailable.");
      if (user.role !== "USER") return { enabled: false as const };
      const active = await tx.deviceSmsKey.findMany({
        where: { userId, revokedAt: null },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      const surplus = active.slice(MAX_ACTIVE_KEYS - 1).map((k) => k.id);
      if (surplus.length) await tx.deviceSmsKey.updateMany({ where: { id: { in: surplus } }, data: { revokedAt: new Date() } });
      const keyId = newKeyId();
      await tx.deviceSmsKey.create({ data: { keyId, userId } });
      return {
        enabled: true as const,
        keyId,
        key: deriveDeviceKey(secret, keyId, userId, user.credentialVersion).toString("base64"),
        shortCode,
        keyword: process.env.AFRICASTALKING_SMS_KEYWORD || null,
      };
    });
  }
}
