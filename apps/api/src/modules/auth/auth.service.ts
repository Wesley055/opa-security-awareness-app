import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AccountStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { toE164 } from '../../shared/phone/normalize-phone-number';
import { UsersService } from '../users/users.service';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';

interface TokenUser {
  id: string;
  email: string;
  role: string;
  firstName: string;
  lastName: string;
  credentialVersion?: number;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const normalizedEmail = dto.email.toLowerCase();

    const existingEmail = await this.usersService.findByEmail(normalizedEmail);
    if (existingEmail) {
      throw new ConflictException(
        'An account already exists for this email.',
      );
    }

    const phoneNumber = toE164(dto.phoneNumber);

    const existingPhone = await this.usersService.findByPhone(phoneNumber);
    if (existingPhone) {
      throw new ConflictException(
        'An account already exists for this phone number.',
      );
    }

    const passwordHash = await bcrypt.hash(
      dto.password,
      this.config.getOrThrow<number>('BCRYPT_ROUNDS'),
    );

    const user = await this.usersService.create({
      email: normalizedEmail,
      phoneNumber,
      passwordHash,
      firstName: dto.firstName.trim(),
      lastName: dto.lastName.trim(),
    });

    return this.issueTokens(user);
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmail(
      dto.email.toLowerCase(),
    );

    if (
      !user ||
      !user.isActive ||
      user.accountStatus !== AccountStatus.ACTIVE ||
      !user.passwordHash
    ) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    const isValid = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );

    if (!isValid) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    return this.issueTokens(user);
  }

  private async issueTokens(user: TokenUser) {
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