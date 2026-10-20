import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BlobSASPermissions, BlobServiceClient } from "@azure/storage-blob";
import { StaffPhotoStatus, UserRole } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service";

export const STAFF_ROLES: UserRole[] = [UserRole.FACILITY_ADMIN, UserRole.FACILITY_OPERATOR, UserRole.TECHNICAL_SUPPORT, UserRole.ADMIN, UserRole.ORGANIZATION_ADMIN];
export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

/** JPEG or PNG by magic bytes; the declared content type is not trusted. */
export function photoKind(buf: Buffer): "jpg" | "png" | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  return null;
}

/**
 * Staff profiles: one shared workspace for Facility Admins, Operators and
 * OPA staff. Name, role and facility are read-only here. A new operator photo
 * needs Facility Admin approval; other staff photos apply directly.
 * Photos never gate emergency response (only the start of a duty shift).
 */
@Injectable()
export class StaffProfileService {
  private readonly blob: BlobServiceClient;
  private readonly container: string;
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {
    this.blob = BlobServiceClient.fromConnectionString(config.getOrThrow<string>("AZURE_STORAGE_CONNECTION_STRING"));
    this.container = config.getOrThrow<string>("AZURE_STORAGE_CONTAINER");
  }

  private async staff(userId: string) {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, firstName: true, lastName: true, role: true, isActive: true, facilityId: true, photoKey: true, photoStatus: true, photoUpdatedAt: true, passwordHash: true, facility: { select: { name: true, type: true } } },
    });
    if (!u || !u.isActive || !STAFF_ROLES.includes(u.role)) throw new ForbiddenException("Profiles are for institutional staff.");
    return u;
  }

  private signed(key: string | null): Promise<string | null> {
    if (!key) return Promise.resolve(null);
    return this.blob.getContainerClient(this.container).getBlockBlobClient(key).generateSasUrl({ permissions: BlobSASPermissions.parse("r"), expiresOn: new Date(Date.now() + 5 * 60_000) });
  }

  async me(userId: string) {
    const u = await this.staff(userId);
    return {
      firstName: u.firstName,
      lastName: u.lastName,
      role: u.role,
      facility: u.facility ? { name: u.facility.name, type: u.facility.type } : null,
      photo: { status: u.photoStatus, url: await this.signed(u.photoKey), updatedAt: u.photoUpdatedAt?.toISOString() ?? null },
      photoRequiredForDuty: u.role === UserRole.FACILITY_OPERATOR,
    };
  }

  async uploadPhoto(userId: string, file: { buffer: Buffer; size: number } | undefined) {
    const u = await this.staff(userId);
    if (!file?.buffer?.length) throw new BadRequestException("Choose a photo.");
    if (file.size > MAX_PHOTO_BYTES) throw new BadRequestException("Photo must be 3 MB or smaller.");
    const kind = photoKind(file.buffer);
    if (!kind) throw new BadRequestException("Use a JPEG or PNG photo.");
    const key = `staff-photos/${u.id}/${randomUUID()}.${kind}`;
    await this.blob.getContainerClient(this.container).getBlockBlobClient(key).uploadData(file.buffer, { blobHTTPHeaders: { blobContentType: kind === "jpg" ? "image/jpeg" : "image/png", blobCacheControl: "private, no-store" } });
    // Operators: a new photo waits for Facility Admin approval (it only affects starting a duty shift, never SOS).
    const status = u.role === UserRole.FACILITY_OPERATOR ? StaffPhotoStatus.PENDING : StaffPhotoStatus.APPROVED;
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: u.id }, data: { photoKey: key, photoStatus: status, photoUpdatedAt: new Date(), photoReviewedBy: null, photoReviewedAt: null } }),
      this.prisma.administrativeAuditEvent.create({ data: { actorUserId: u.id, actorRole: u.role, action: "STAFF_PHOTO_UPLOADED", resourceId: u.id, facilityId: u.facilityId, afterState: { status } } }),
    ]);
    return { status };
  }

  async changePassword(userId: string, current: string, next: string) {
    const u = await this.staff(userId);
    if (!u.passwordHash || !(await bcrypt.compare(current, u.passwordHash))) throw new UnauthorizedException("Your current password is not correct.");
    if (current === next) throw new BadRequestException("Choose a password you have not just used.");
    const passwordHash = await bcrypt.hash(next, this.config.getOrThrow<number>("BCRYPT_ROUNDS"));
    await this.prisma.$transaction([
      // credentialVersion invalidates every session, including this one: sign in again.
      this.prisma.user.update({ where: { id: u.id }, data: { passwordHash, credentialVersion: { increment: 1 } } }),
      this.prisma.passwordResetToken.updateMany({ where: { userId: u.id, consumedAt: null }, data: { consumedAt: new Date() } }),
      this.prisma.administrativeAuditEvent.create({ data: { actorUserId: u.id, actorRole: u.role, action: "STAFF_PASSWORD_CHANGED", resourceId: u.id, facilityId: u.facilityId } }),
    ]);
    return { signedOutEverywhere: true };
  }

  async signOutEverywhere(userId: string) {
    const u = await this.staff(userId);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: u.id }, data: { credentialVersion: { increment: 1 } } }),
      this.prisma.administrativeAuditEvent.create({ data: { actorUserId: u.id, actorRole: u.role, action: "STAFF_SIGNED_OUT_EVERYWHERE", resourceId: u.id, facilityId: u.facilityId } }),
    ]);
    return { signedOutEverywhere: true };
  }

  /** Facility Admin: operators of their facility with photos awaiting review. */
  async pendingPhotos(facilityId: string) {
    const rows = await this.prisma.user.findMany({ where: { facilityId, role: UserRole.FACILITY_OPERATOR, isActive: true, photoStatus: StaffPhotoStatus.PENDING }, select: { id: true, firstName: true, lastName: true, photoKey: true, photoUpdatedAt: true }, take: 100 });
    return Promise.all(rows.map(async (r) => ({ userId: r.id, name: `${r.firstName} ${r.lastName}`.trim(), url: await this.signed(r.photoKey), uploadedAt: r.photoUpdatedAt?.toISOString() ?? null })));
  }

  async reviewPhoto(adminId: string, facilityId: string, operatorId: string, approve: boolean) {
    const op = await this.prisma.user.findFirst({ where: { id: operatorId, facilityId, role: UserRole.FACILITY_OPERATOR }, select: { id: true, photoStatus: true } });
    if (!op) throw new NotFoundException("Operator not found in your facility.");
    if (op.photoStatus !== StaffPhotoStatus.PENDING) throw new BadRequestException("No photo is waiting for review.");
    const status = approve ? StaffPhotoStatus.APPROVED : StaffPhotoStatus.REJECTED;
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: op.id }, data: { photoStatus: status, photoReviewedBy: adminId, photoReviewedAt: new Date() } }),
      this.prisma.administrativeAuditEvent.create({ data: { actorUserId: adminId, actorRole: UserRole.FACILITY_ADMIN, action: approve ? "STAFF_PHOTO_APPROVED" : "STAFF_PHOTO_REJECTED", resourceId: op.id, facilityId } }),
    ]);
    return { status };
  }
}
