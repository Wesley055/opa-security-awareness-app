import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

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

  rotate(refreshToken: string) {
    const payload = this.verifyRefreshToken(refreshToken);

    return {
      accessToken: this.createAccessToken({
        sub: payload.sub,
        email: payload.email,
        role: payload.role,
      }),
      refreshToken: this.createRefreshToken({
        id: payload.sub,
        email: payload.email,
        role: payload.role,
      }),
    };
  }
}