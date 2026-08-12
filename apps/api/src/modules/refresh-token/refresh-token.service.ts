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
  tokenType: 'refresh';
}

@Injectable()
export class RefreshTokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    // Reads Prisma directly rather than through UsersService.findById,
    // which predates accountStatus and does not select it. Widening that
    // shared method for one caller would change what every existing
    // consumer receives.
    private readonly prisma: PrismaService,
  ) {}

  createRefreshToken(user: {
    id: string;
    email: string;
    role?: string;
  }): string {
    return this.jwtService.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
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
  }): string {
    return this.jwtService.sign(
      {
        sub: payload.sub,
        email: payload.email,
        role: payload.role,
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

  /**
   * Exchange a refresh token for a new pair.
   *
   * THE DATABASE READ IS THE WHOLE POINT. Before it, this method verified
   * a signature and copied the payload forward, which meant suspension
   * did not suspend: setting isActive=false stopped login() but not
   * rotation, and since every rotation minted a NEW 30-day refresh token,
   * the window rolled forward indefinitely. There was no revocation path.
   *
   * The three guards all re-read from PostgreSQL for exactly this reason.
   * This is the same principle applied where the credentials are minted.
   *
   * THE INCOMING role CLAIM IS IGNORED, NOT VALIDATED AGAINST. A stale
   * role is stale, not forged - a legitimate promotion or demotion must
   * not force a logout - so issuance simply takes the current value.
   */
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
      },
    });

    // ONE MESSAGE FOR EVERY REJECTION, matching verifyRefreshToken's.
    // The caller is unauthenticated and must not learn whether the token
    // was bad, the account suspended, or the seat never activated.
    if (
      !user ||
      !user.isActive ||
      user.accountStatus !== AccountStatus.ACTIVE
    ) {
      throw new UnauthorizedException(
        'Refresh token is invalid or expired.',
      );
    }

    // Every field comes from the row that was just read. Nothing from the
    // payload survives into the new tokens except by having matched.
    return {
      accessToken: this.createAccessToken({
        sub: user.id,
        email: user.email,
        role: user.role,
      }),
      refreshToken: this.createRefreshToken({
        id: user.id,
        email: user.email,
        role: user.role,
      }),
    };
  }
}