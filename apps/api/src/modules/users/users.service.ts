import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.UserCreateInput) {
    return this.prisma.user.create({ data });
  }

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  }

  /**
   * CONTRACT: phoneNumber MUST already be canonical E.164.
   *
   * Deliberately does NOT normalise, unlike findByEmail which lowercases
   * internally. Lowercasing is region-free and idempotent; normalising a
   * phone number is neither - it depends on a default region this method
   * has no way to know. Normalising here would always assume Nigeria, so
   * once the mobile country picker sends region=US with a bare
   * 4694791451, the write path and this lookup would disagree about the
   * same input and a duplicate would slip through.
   *
   * Callers normalise at the boundary with toE164 from
   * shared/phone/normalize-phone-number, and pass the result here.
   */
  findByPhone(phoneNumber: string) {
    return this.prisma.user.findUnique({ where: { phoneNumber } });
  }

  findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        phoneNumber: true,
        firstName: true,
        lastName: true,
        role: true,
        facilityId: true,
        isActive: true,
        createdAt: true,
      },
    });
  }
}