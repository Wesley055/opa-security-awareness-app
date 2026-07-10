import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateEmergencyContactDto } from './dto/create-emergency-contact.dto';
import type { UpdateEmergencyContactDto } from './dto/update-emergency-contact.dto';

@Injectable()
export class EmergencyContactsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateEmergencyContactDto) {
    return this.prisma.$transaction(async (tx) => {
      if (dto.isPrimary === true) {
        await tx.emergencyContact.updateMany({
          where: {
            userId,
            isPrimary: true,
          },
          data: {
            isPrimary: false,
          },
        });
      }

      return tx.emergencyContact.create({
        data: {
          userId,
          firstName: dto.firstName,
          lastName: dto.lastName,
          relationship: dto.relationship,
          phoneNumber: dto.phoneNumber,
          email: dto.email,
          isPrimary: dto.isPrimary ?? false,
          isActive: dto.isActive ?? true,
        },
      });
    });
  }

  listForUser(userId: string) {
    return this.prisma.emergencyContact.findMany({
      where: {
        userId,
      },
      orderBy: [
        {
          isPrimary: 'desc',
        },
        {
          createdAt: 'asc',
        },
      ],
    });
  }

  async findOne(userId: string, contactId: string) {
    const contact = await this.prisma.emergencyContact.findFirst({
      where: {
        id: contactId,
        userId,
      },
    });

    if (!contact) {
      throw new NotFoundException('Emergency contact not found.');
    }

    return contact;
  }

  async update(
    userId: string,
    contactId: string,
    dto: UpdateEmergencyContactDto,
  ) {
    await this.findOne(userId, contactId);

    return this.prisma.$transaction(async (tx) => {
      if (dto.isPrimary === true) {
        await tx.emergencyContact.updateMany({
          where: {
            userId,
            isPrimary: true,
            NOT: {
              id: contactId,
            },
          },
          data: {
            isPrimary: false,
          },
        });
      }

      return tx.emergencyContact.update({
        where: {
          id: contactId,
        },
        data: {
          firstName: dto.firstName,
          lastName: dto.lastName,
          relationship: dto.relationship,
          phoneNumber: dto.phoneNumber,
          email: dto.email,
          isPrimary: dto.isPrimary,
          isActive: dto.isActive,
        },
      });
    });
  }

  async remove(userId: string, contactId: string) {
    await this.findOne(userId, contactId);

    await this.prisma.emergencyContact.delete({
      where: {
        id: contactId,
      },
    });

    return {
      message: 'Emergency contact deleted successfully.',
    };
  }

  async setPrimary(userId: string, contactId: string) {
    await this.findOne(userId, contactId);

    return this.prisma.$transaction(async (tx) => {
      await tx.emergencyContact.updateMany({
        where: {
          userId,
          isPrimary: true,
        },
        data: {
          isPrimary: false,
        },
      });

      return tx.emergencyContact.update({
        where: {
          id: contactId,
        },
        data: {
          isPrimary: true,
          isActive: true,
        },
      });
    });
  }
}