import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccountStatus } from '@prisma/client';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  credentialVersion?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
        accountStatus: true,
        credentialVersion: true,
      },
    });

    if (
      !user ||
      !user.isActive ||
      user.accountStatus !== AccountStatus.ACTIVE ||
      user.credentialVersion !== (payload.credentialVersion ?? 0)
    ) {
      throw new UnauthorizedException('Invalid or expired access token.');
    }

    return {
      sub: user.id,
      email: user.email,
      role: user.role,
      credentialVersion: user.credentialVersion,
    };
  }
}