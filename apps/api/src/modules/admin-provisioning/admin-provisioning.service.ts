import {
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import {
  AccountStatus,
  UserRole,
} from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  hashActivationCredential,
} from '../../shared/security/activation-code';
import { toE164 } from '../../shared/phone/normalize-phone-number';
import type { FindResidentDto } from './dto/find-resident.dto';
import type { CreateFacilityDto } from './dto/create-facility.dto';
import type { CreateOperatorDto } from './dto/create-operator.dto';
import type { CreateResidentDto } from './dto/create-resident.dto';

const ACTIVATION_TOKEN_BYTES = 32;
const ACTIVATION_VALIDITY_MS = 24 * 60 * 60 * 1000;
type ProvisionedAccountDto = {
  email: string;
  phoneNumber: string;
  firstName: string;
  lastName: string;
  facilityId: string;
};

@Injectable()
export class AdminProvisioningService {
  constructor(private readonly prisma: PrismaService) {}

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
    return this.createProvisionedAccount(
      adminUserId,
      dto,
      UserRole.FACILITY_OPERATOR,
      '/operator/activate/',
    );
  }

  async createFacilityAdminSeat(adminUserId: string, dto: CreateOperatorDto) {
    return this.createProvisionedAccount(
      adminUserId,
      dto,
      UserRole.FACILITY_ADMIN,
      '/operator/activate/',
    );
  }

  async createBulkResidentInvites(
    adminUserId: string,
    residents: CreateResidentDto[],
  ) {
    const results: Array<
      | {
          index: number;
          status: 'QUEUED';
          user: Awaited<ReturnType<AdminProvisioningService['createResidentInvite']>>['user'];
          delivery: Awaited<ReturnType<AdminProvisioningService['createResidentInvite']>>['delivery'];
        }
      | {
          index: number;
          status: 'FAILED';
          error: {
            statusCode: number;
            message: string;
          };
        }
    > = [];

    for (const [index, dto] of residents.entries()) {
      try {
        const created = await this.createResidentInvite(adminUserId, dto);
        results.push({
          index,
          status: 'QUEUED',
          user: created.user,
          delivery: created.delivery,
        });
      } catch (error: unknown) {
        if (error instanceof HttpException) {
          const response = error.getResponse();
          const responseMessage =
            typeof response === 'string'
              ? response
              : Array.isArray((response as { message?: unknown })?.message)
                ? (response as { message: unknown[] }).message.join('; ')
                : typeof (response as { message?: unknown })?.message === 'string'
                  ? (response as { message: string }).message
                  : error.message;

          results.push({
            index,
            status: 'FAILED',
            error: {
              statusCode: error.getStatus(),
              message: responseMessage,
            },
          });
          continue;
        }

        // Do not leak unexpected internal/provider details through a bulk row.
        results.push({
          index,
          status: 'FAILED',
          error: {
            statusCode: 500,
            message: 'Resident provisioning failed.',
          },
        });
      }
    }

    const queued = results.filter((result) => result.status === 'QUEUED').length;
    const failed = results.length - queued;

    return {
      total: results.length,
      queued,
      failed,
      results,
    };
  }
  async createResidentInvite(adminUserId: string, dto: CreateResidentDto) {
    return this.createResidentWithQueuedInvitation(adminUserId, dto);
  }

  /**
   * Resident provisioning is durable and worker-delivered.
   *
   * No activation credential is minted here. The USER and its QUEUED SMS
   * delivery commit atomically; the delivery worker mints a fresh code only
   * after it owns the delivery attempt.
   */
  private async createResidentWithQueuedInvitation(
    adminUserId: string,
    dto: CreateResidentDto,
  ) {
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

      const user = await tx.user.create({
        data: {
          email,
          phoneNumber,
          passwordHash: null,
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
          role: UserRole.USER,
          facilityId: dto.facilityId,
          isActive: true,
          accountStatus: AccountStatus.PENDING_ACTIVATION,
          activationTokenHash: null,
          activationExpiresAt: null,
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

      const delivery = await tx.accountInvitationDelivery.create({
        data: {
          userId: user.id,
          facilityId: dto.facilityId,
          invitedByUserId: adminUserId,
          channel: 'SMS',
          status: 'QUEUED',
          recipient: phoneNumber,
        },
        select: {
          id: true,
          channel: true,
          status: true,
          recipient: true,
          queuedAt: true,
          nextAttemptAt: true,
        },
      });

      return { user, delivery };
    });
  }

  /**
   * Shared provisioning boundary for institution-created accounts.
   *
   * Both operators and residents enter the same token lifecycle:
   * - active facility must already exist;
   * - email and phone are canonicalised and globally unique;
   * - only a SHA-256 token digest is stored;
   * - the raw token is returned once;
   * - the account starts PENDING_ACTIVATION with no password.
   *
   * Keeping this in one path prevents resident and operator invitation
   * security semantics from drifting apart.
   */
  private async createProvisionedAccount(
    adminUserId: string,
    dto: ProvisionedAccountDto,
    role: UserRole,
    activationPathPrefix: string,
  ) {
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

      // Sequential by design: deterministic conflict reporting and no
      // concurrent queries on the interactive transaction connection.
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

      const rawToken = randomBytes(ACTIVATION_TOKEN_BYTES).toString('base64url');
      const activationTokenHash = hashActivationCredential(rawToken);
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
          role,
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
        activationPath: activationPathPrefix + rawToken,
        activationExpiresAt,
      };
    });
  }

  /**
   * Look one RESIDENT up by an exact unique identifier.
   *
   * EXACTLY ONE IDENTIFIER, ENFORCED HERE. class-validator has no XOR, so
   * a DTO-level version would mean a custom ValidatorConstraint class -
   * a new abstraction for one invariant, in a codebase with none. It also
   * sits badly with RegisterDto's rule that the service is the single
   * validation authority when it already owns the semantics, which here
   * it does: normalisation and lookup both live below.
   *
   * BOTH NORMALISATIONS HAPPEN AT THIS BOUNDARY, exactly as auth.service
   * does them. An admin typing 08024662124 must find the row registration
   * stored as +2348024662124, and Ada@Example.com must find
   * ada@example.com. UsersService.findByPhone deliberately refuses to
   * normalise its own argument - see its contract - because a lookup that
   * assumes a region disagrees with a write path that was told one.
   *
   * A NON-RESIDENT MATCH RETURNS NULL. The endpoint asks whether a
   * RESIDENT exists for this identifier; an operator or admin is still
   * no. Reporting the mismatch instead would disclose that some account
   * exists - which the caller did not ask about and cannot act on here.
   *
   * findUnique is kept rather than findFirst with role in the where
   * clause: the columns are unique, and findFirst would read as though
   * the lookup might be ambiguous when it cannot be.
   */
  async findResident(query: FindResidentDto) {
    const hasEmail = !!query.email;
    const hasPhone = !!query.phoneNumber;

    if (hasEmail === hasPhone) {
      throw new BadRequestException(
        'Provide exactly one of email or phoneNumber.',
      );
    }

    const where = hasEmail
      ? { email: (query.email as string).trim().toLowerCase() }
      : { phoneNumber: toE164(query.phoneNumber as string) };

    const user = await this.prisma.user.findUnique({
      where,
      select: {
        id: true,
        email: true,
        phoneNumber: true,
        firstName: true,
        lastName: true,
        role: true,
        facilityId: true,
        isActive: true,
        accountStatus: true,
        createdAt: true,
      },
    });

    if (!user || user.role !== UserRole.USER) {
      return null;
    }

    return user;
  }

  /**
   * Everyone attached to a facility, split by role.
   *
   * FACILITY.STAFF IS A MISLEADING NAME. The Prisma relation is called
   * 'FacilityStaff', but User.facilityId is a single column carrying
   * operators and residents alike, so it returns both. This reads the
   * column once and partitions here rather than trusting the relation's
   * name or issuing two queries for one index scan.
   *
   * Deliberately UNPAGINATED, unlike the incident queue. A facility's
   * membership is bounded by how many people an estate has; its incident
   * history is not. If an estate ever has enough residents for this to
   * matter, it needs pagination AND a different admin screen.
   */
  async listFacilityMembers(facilityId: string) {
    const facility = await this.prisma.facility.findUnique({
      where: { id: facilityId },
      select: { id: true, name: true, isActive: true },
    });

    if (!facility) {
      throw new NotFoundException('Facility not found.');
    }

    const members = await this.prisma.user.findMany({
      where: { facilityId },
      select: {
        id: true,
        email: true,
        phoneNumber: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        accountStatus: true,
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    return {
      facility,
      operators: members.filter(
        (m) => m.role === UserRole.FACILITY_OPERATOR,
      ),
      residents: members.filter((m) => m.role === UserRole.USER),
    };
  }

  async getResidentInvitation(userId: string, expectedFacilityId?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        facilityId: true,
        isActive: true,
        accountStatus: true,
        activatedAt: true,
      },
    });

    if (!user || user.role !== UserRole.USER) {
      throw new NotFoundException('Resident not found.');
    }

    if (expectedFacilityId && user.facilityId !== expectedFacilityId) {
      throw new NotFoundException('Resident not found.');
    }

    const deliveries = await this.prisma.accountInvitationDelivery.findMany({
      where: { userId },
      select: {
        id: true,
        channel: true,
        status: true,
        attemptCount: true,
        lastError: true,
        queuedAt: true,
        nextAttemptAt: true,
        lastAttemptAt: true,
        sentAt: true,
        failedAt: true,
        createdAt: true,
      },
      orderBy: [{ queuedAt: 'desc' }, { createdAt: 'desc' }],
      take: 20,
    });

    const history = deliveries.map((delivery) => ({
      id: delivery.id,
      channel: delivery.channel,
      status: delivery.status,
      attemptCount: delivery.attemptCount,
      lastError: delivery.lastError?.slice(0, 300) ?? null,
      queuedAt: delivery.queuedAt,
      nextAttemptAt: delivery.nextAttemptAt,
      lastAttemptAt: delivery.lastAttemptAt,
      sentAt: delivery.sentAt,
      failedAt: delivery.failedAt,
      createdAt: delivery.createdAt,
    }));
    const latest = history[0] ?? null;

    const inFlight = await this.prisma.accountInvitationDelivery.findFirst({
      where: {
        userId,
        status: { in: ['QUEUED', 'SENDING'] },
      },
      select: { id: true },
    });
    const hasInFlight = inFlight !== null;

    const cooldownFrom = latest?.lastAttemptAt ?? latest?.queuedAt ?? null;
    const cooldownUntil = cooldownFrom
      ? new Date(cooldownFrom.getTime() + 5 * 60 * 1000)
      : null;
    const cooldownActive =
      cooldownUntil !== null && cooldownUntil.getTime() > Date.now();

    const eligibleAccount =
      user.isActive &&
      user.accountStatus === AccountStatus.PENDING_ACTIVATION;

    const canResend =
      user.facilityId !== null &&
      eligibleAccount &&
      !hasInFlight &&
      !cooldownActive;

    return {
      resident: {
        id: user.id,
        facilityId: user.facilityId,
        isActive: user.isActive,
        accountStatus: user.accountStatus,
        activatedAt: user.activatedAt,
      },
      latest,
      history,
      canResend,
      resendAvailableAt: canResend ? null : cooldownActive ? cooldownUntil : null,
    };
  }

  async resendResidentInvitation(
    adminUserId: string,
    userId: string,
    expectedFacilityId?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${userId}))
      `;

      const user = await tx.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          role: true,
          facilityId: true,
          phoneNumber: true,
          isActive: true,
          accountStatus: true,
        },
      });

      if (!user || user.role !== UserRole.USER || !user.facilityId) {
        throw new NotFoundException('Resident not found.');
      }

      if (expectedFacilityId && user.facilityId !== expectedFacilityId) {
        throw new NotFoundException('Resident not found.');
      }

      if (
        !user.isActive ||
        user.accountStatus !== AccountStatus.PENDING_ACTIVATION
      ) {
        throw new ConflictException(
          'Resident is not eligible for activation.',
        );
      }

      if (!user.phoneNumber) {
        throw new ConflictException(
          'Resident has no SMS-capable phone number.',
        );
      }

      const inFlight = await tx.accountInvitationDelivery.findFirst({
        where: {
          userId,
          status: { in: ['QUEUED', 'SENDING'] },
        },
        select: { id: true, status: true },
      });

      if (inFlight) {
        throw new ConflictException(
          'An invitation delivery is already queued or sending.',
        );
      }

      const latest = await tx.accountInvitationDelivery.findFirst({
        where: { userId },
        select: {
          lastAttemptAt: true,
          queuedAt: true,
          createdAt: true,
        },
        orderBy: [{ queuedAt: 'desc' }, { createdAt: 'desc' }],
      });

      const cooldownFrom = latest?.lastAttemptAt ?? latest?.queuedAt;
      if (
        cooldownFrom &&
        Date.now() - cooldownFrom.getTime() < 5 * 60 * 1000
      ) {
        throw new ConflictException(
          'Please wait five minutes before resending this invitation.',
        );
      }

      const delivery = await tx.accountInvitationDelivery.create({
        data: {
          userId,
          facilityId: user.facilityId,
          invitedByUserId: adminUserId,
          channel: 'SMS',
          status: 'QUEUED',
          recipient: user.phoneNumber,
        },
        select: {
          id: true,
          channel: true,
          status: true,
          queuedAt: true,
          nextAttemptAt: true,
        },
      });

      return { delivery };
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

  /**
   * Remove a resident from a SPECIFIC facility.
   *
   * expectedFacilityId is the membership the caller believes exists. It is
   * compared under the advisory lock, so a concurrent reassignment cannot
   * slip between the read and the update.
   */
  async removeResidentFromFacility(
    userId: string,
    expectedFacilityId: string,
  ) {
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

      // LOAD-BEARING. Without it, a stale admin screen removes a resident
      // from facility B while believing it is removing them from A.
      //
      // It also catches an already-unassigned resident, which the previous
      // version wrote null over null for and reported as a successful
      // removal - so an admin could not tell a removal from a no-op.
      if (user.facilityId !== expectedFacilityId) {
        throw new ConflictException(
          'Resident facility membership has changed.',
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
