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

    // Canonical BEFORE the uniqueness check, and the same value is stored
    // below. Mirrors the email treatment three lines up: normalise once,
    // compare and persist the normalised form. Without this the same
    // person registers twice as 08024662124 and +2348024662124, because
    // User.phoneNumber is @unique on the exact string.
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
    // Authentication requires BOTH lifecycle activation and administrative
    // enablement, and they are separate questions: a suspended operator and
    // one who never claimed their seat are different facts, and support
    // will be asked to tell them apart.
    //
    // The passwordHash check is not belt-and-braces. A pending seat has NO
    // hash, and bcrypt.compare against null throws rather than returning
    // false - so this narrows the type and keeps the failure a clean 401
    // instead of a 500 that leaks the account's existence.
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
    const accessPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tokenType: 'access',
    };
    const refreshPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
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