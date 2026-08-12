import {
  ConflictException,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import {
  AccountStatus,
  UserRole,
} from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { toE164 } from '../../shared/phone/normalize-phone-number';
import type { CreateFacilityDto } from './dto/create-facility.dto';
import type { CreateOperatorDto } from './dto/create-operator.dto';

const ACTIVATION_TOKEN_BYTES = 32;
const ACTIVATION_VALIDITY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class AdminProvisioningService {
  constructor(private readonly prisma: PrismaService) {}

  private hashActivationToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async createFacility(dto: CreateFacilityDto) {
    const phoneNumber = dto.phoneNumber
      ? toE164(dto.phoneNumber)
      : undefined;

    return this.prisma.facility.create({
      data: {
        name: dto.name.trim(),
        type: dto.type,
        address: dto.address?.trim(),
        phoneNumber,
        latitude: dto.latitude,
        longitude: dto.longitude,
      },
    });
  }

  async createOperatorSeat(adminUserId: string, dto: CreateOperatorDto) {
    const email = dto.email.trim().toLowerCase();
    const phoneNumber = toE164(dto.phoneNumber);

    return this.prisma.$transaction(async (tx) => {
      const facility = await tx.facility.findUnique({
        where: { id: dto.facilityId },
        select: { id: true, isActive: true },
      });

      if (!facility || !facility.isActive) {
        throw new NotFoundException('Active facility not found.');
      }

      // SEQUENTIAL, NOT Promise.all. An interactive transaction client is a
      // SINGLE connection, and Prisma does not reliably support concurrent
      // queries on one - they can deadlock or error rather than run in
      // parallel. Two indexed lookups cost nothing to await in turn.
      //
      // It also makes the order real: email is checked first, so the
      // conflict a caller sees is deterministic rather than a race.
      const existingEmail = await tx.user.findUnique({
        where: { email },
        select: { id: true },
      });

      const existingPhone = await tx.user.findUnique({
        where: { phoneNumber },
        select: { id: true },
      });

      if (existingEmail) {
        throw new ConflictException(
          'An account already exists for this email.',
        );
      }

      if (existingPhone) {
        throw new ConflictException(
          'An account already exists for this phone number.',
        );
      }

      const rawToken = randomBytes(ACTIVATION_TOKEN_BYTES).toString(
        'base64url',
      );
      const activationTokenHash = this.hashActivationToken(rawToken);
      const activationExpiresAt = new Date(
        Date.now() + ACTIVATION_VALIDITY_MS,
      );

      const user = await tx.user.create({
        data: {
          email,
          phoneNumber,
          passwordHash: null,
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
          role: UserRole.FACILITY_OPERATOR,
          facilityId: dto.facilityId,
          isActive: true,
          accountStatus: AccountStatus.PENDING_ACTIVATION,
          activationTokenHash,
          activationExpiresAt,
          activatedAt: null,
          invitedByUserId: adminUserId,
        },
        select: {
          id: true,
          email: true,
          phoneNumber: true,
          firstName: true,
          lastName: true,
          role: true,
          facilityId: true,
          accountStatus: true,
          activationExpiresAt: true,
          invitedByUserId: true,
        },
      });

      return {
        user,
        activationToken: rawToken,
        activationPath: '/operator/activate/' + rawToken,
        activationExpiresAt,
      };
    });
  }

  async assignResidentToFacility(userId: string, facilityId: string) {
    return this.prisma.$transaction(async (tx) => {
      // Same user serialization domain used by incident routing. A facility
      // reassignment therefore cannot race the facility snapshot taken when
      // an SOS incident is created.
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${userId}))
      `;

      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, facilityId: true },
      });

      if (!user) {
        throw new NotFoundException('Resident not found.');
      }

      if (user.role !== UserRole.USER) {
        throw new BadRequestException(
          'Only USER accounts may be assigned as residents.',
        );
      }

      const facility = await tx.facility.findUnique({
        where: { id: facilityId },
        select: { id: true, isActive: true },
      });

      if (!facility || !facility.isActive) {
        throw new NotFoundException('Active facility not found.');
      }

      return tx.user.update({
        where: { id: userId },
        data: { facilityId },
        select: {
          id: true,
          email: true,
          role: true,
          facilityId: true,
        },
      });
    });
  }

  async removeResidentFromFacility(userId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${userId}))
      `;

      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, facilityId: true },
      });

      if (!user) {
        throw new NotFoundException('Resident not found.');
      }

      if (user.role !== UserRole.USER) {
        throw new BadRequestException(
          'Only USER accounts may be assigned as residents.',
        );
      }

      return tx.user.update({
        where: { id: userId },
        data: { facilityId: null },
        select: {
          id: true,
          email: true,
          role: true,
          facilityId: true,
        },
      });
    });
  }
}
