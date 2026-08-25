import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AccountStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface RefreshTokenPayload {
  sub: string;
  email: string;
  role?: string;
  credentialVersion?: number;
  tokenType: 'refresh';
}

@Injectable()
export class RefreshTokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  createRefreshToken(user: {
    id: string;
    email: string;
    role?: string;
    credentialVersion?: number;
  }): string {
    return this.jwtService.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        credentialVersion: user.credentialVersion ?? 0,
        tokenType: 'refresh',
      },
      {
        secret:
          this.configService.getOrThrow<string>(
            'JWT_REFRESH_SECRET',
          ),
        expiresIn:
          this.configService.getOrThrow<string>(
            'JWT_REFRESH_EXPIRES_IN',
          ),
      },
    );
  }

  verifyRefreshToken(token: string): RefreshTokenPayload {
    try {
      const payload =
        this.jwtService.verify<RefreshTokenPayload>(token, {
          secret:
            this.configService.getOrThrow<string>(
              'JWT_REFRESH_SECRET',
            ),
        });

      if (payload.tokenType !== 'refresh') {
        throw new UnauthorizedException(
          'Invalid refresh token type.',
        );
      }

      return payload;
    } catch {
      throw new UnauthorizedException(
        'Refresh token is invalid or expired.',
      );
    }
  }

  createAccessToken(payload: {
    sub: string;
    email: string;
    role?: string;
    credentialVersion?: number;
  }): string {
    return this.jwtService.sign(
      {
        sub: payload.sub,
        email: payload.email,
        role: payload.role,
        credentialVersion: payload.credentialVersion ?? 0,
        tokenType: 'access',
      },
      {
        secret:
          this.configService.getOrThrow<string>(
            'JWT_ACCESS_SECRET',
          ),
        expiresIn:
          this.configService.getOrThrow<string>(
            'JWT_ACCESS_EXPIRES_IN',
          ),
      },
    );
  }

  async rotate(refreshToken: string) {
    const payload = this.verifyRefreshToken(refreshToken);

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
      throw new UnauthorizedException(
        'Refresh token is invalid or expired.',
      );
    }

    return {
      accessToken: this.createAccessToken({
        sub: user.id,
        email: user.email,
        role: user.role,
        credentialVersion: user.credentialVersion,
      }),
      refreshToken: this.createRefreshToken({
        id: user.id,
        email: user.email,
        role: user.role,
        credentialVersion: user.credentialVersion,
      }),
    };
  }
}