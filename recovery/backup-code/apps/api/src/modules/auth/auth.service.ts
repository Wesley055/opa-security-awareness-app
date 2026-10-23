import {
  Injectable,
  type OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AccountStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { UsersService } from '../users/users.service';
import type { LoginDto } from './dto/login.dto';


interface TokenUser {
  id: string;
  email: string;
  role: string;
  firstName: string;
  lastName: string;
  credentialVersion?: number;
}

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly dummyHash: Promise<string>;

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {
    this.dummyHash = bcrypt.hash(randomBytes(32).toString('hex'), this.config.getOrThrow<number>('BCRYPT_ROUNDS'));
  }

  async onModuleInit() { await this.dummyHash; }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmail(
      dto.email.toLowerCase(),
    );

    const dummyHash = await this.dummyHash;
    // Always perform credential verification, including missing and ineligible accounts.
    const isValid = await bcrypt.compare(dto.password, user?.passwordHash ?? dummyHash);
    if (!user || !user.isActive || user.accountStatus !== AccountStatus.ACTIVE || !user.passwordHash || !isValid) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    return this.issueTokens(user);
  }

  async issueTokens(user: TokenUser) {
    const credentialVersion = user.credentialVersion ?? 0;

    const accessPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      credentialVersion,
      tokenType: 'access',
    };

    const refreshPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      credentialVersion,
      tokenType: 'refresh',
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(accessPayload, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.config.getOrThrow<string>('JWT_ACCESS_EXPIRES_IN'),
      }),
      this.jwtService.signAsync(refreshPayload, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.config.getOrThrow<string>('JWT_REFRESH_EXPIRES_IN'),
      }),
    ]);

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
    };
  }
}