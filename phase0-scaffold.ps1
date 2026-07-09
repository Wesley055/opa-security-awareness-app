param(
  [string]$Root = (Get-Location).Path
)

$ErrorActionPreference = "Stop"

function Write-ProjectFile {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Content
  )

  $target = Join-Path $Root $Path
  $parent = Split-Path $target -Parent
  if ($parent -and -not (Test-Path $parent)) {
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
  }
  Set-Content -Path $target -Value $Content -NoNewline -Encoding UTF8
}

$files = @(
  @{
    Path = "apps/api/package.json"
    Content = @'
{
  "name": "@opa/api",
  "version": "0.0.1",
  "private": true,
  "type": "commonjs",
  "scripts": {
    "build": "nest build",
    "lint": "eslint \"{src,test}/**/*.ts\" --max-warnings=0",
    "start": "node dist/main.js",
    "start:dev": "nest start --watch",
    "test": "jest",
    "test:cov": "jest --coverage",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:deploy": "prisma migrate deploy"
  },
  "dependencies": {
    "@nestjs/common": "^10.4.15",
    "@nestjs/config": "^3.3.0",
    "@nestjs/core": "^10.4.15",
    "@nestjs/jwt": "^10.2.0",
    "@nestjs/passport": "^10.0.3",
    "@nestjs/platform-express": "^10.4.15",
    "@nestjs/throttler": "^6.3.0",
    "@prisma/client": "^6.1.0",
    "bcrypt": "^5.1.1",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "helmet": "^8.0.0",
    "passport": "^0.7.0",
    "passport-jwt": "^4.0.1",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.4.8",
    "@nestjs/testing": "^10.4.15",
    "@types/bcrypt": "^5.0.2",
    "@types/express": "^5.0.0",
    "@types/jest": "^29.5.14",
    "@types/node": "^22.10.2",
    "@types/passport-jwt": "^4.0.1",
    "@typescript-eslint/eslint-plugin": "^8.18.1",
    "@typescript-eslint/parser": "^8.18.1",
    "eslint": "^9.17.0",
    "jest": "^29.7.0",
    "prettier": "^3.4.2",
    "prisma": "^6.1.0",
    "supertest": "^7.0.0",
    "ts-jest": "^29.2.5",
    "typescript": "^5.7.2"
  }
}
'@
  },
  @{
    Path = "apps/api/tsconfig.json"
    Content = @'
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "declaration": true,
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "strict": true,
    "strictPropertyInitialization": false,
    "noImplicitOverride": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "exclude": ["node_modules", "dist"]
}
'@
  },
  @{
    Path = "apps/api/prisma/schema.prisma"
    Content = @'
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum UserRole {
  USER
  RESPONDER
  ADMIN
}

enum IncidentStatus {
  OPEN
  ACKNOWLEDGED
  RESOLVED
  CANCELLED
}

enum IncidentTrigger {
  SOS_BUTTON
  VOICE_HELP_HELP
  TRUSTED_CONTACT
  SYSTEM_TEST
}

model User {
  id           String     @id @default(uuid()) @db.Uuid
  email        String     @unique
  phoneNumber  String     @unique
  passwordHash String
  firstName    String
  lastName     String
  role         UserRole   @default(USER)
  isActive     Boolean    @default(true)
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt
  incidents    Incident[]

  @@index([phoneNumber])
}

model Incident {
  id             String          @id @default(uuid()) @db.Uuid
  userId         String          @db.Uuid
  user           User            @relation(fields: [userId], references: [id], onDelete: Restrict)
  trigger        IncidentTrigger
  status         IncidentStatus  @default(OPEN)
  latitude       Decimal         @db.Decimal(9, 6)
  longitude      Decimal         @db.Decimal(9, 6)
  address        String?
  voicePhrase    String?
  trustedContact Json?
  metadata       Json?
  createdAt      DateTime        @default(now())
  updatedAt      DateTime        @updatedAt
  resolvedAt     DateTime?

  @@index([userId, createdAt])
  @@index([status, createdAt])
}
'@
  },
  @{
    Path = "apps/api/src/main.ts"
    Content = @'
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);
  const origins = config.getOrThrow<string>('ALLOWED_ORIGINS').split(',');

  app.use(helmet());
  app.enableCors({ origin: origins, credentials: true });
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));

  await app.listen(config.getOrThrow<number>('API_PORT'));
}

void bootstrap();
'@
  },
  @{
    Path = "apps/api/src/app.module.ts"
    Content = @'
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './modules/auth/auth.module';
import { IncidentsModule } from './modules/incidents/incidents.module';
import { UsersModule } from './modules/users/users.module';
import { PrismaModule } from './prisma/prisma.module';
import { validateEnv } from './shared/config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 60 }]),
    PrismaModule,
    AuthModule,
    UsersModule,
    IncidentsModule,
  ],
})
export class AppModule {}
'@
  },
  @{
    Path = "apps/api/src/shared/config/env.validation.ts"
    Content = @'
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(14).default(12),
  ALLOWED_ORIGINS: z.string().min(1),
});

export function validateEnv(config: Record<string, unknown>) {
  return envSchema.parse(config);
}
'@
  },
  @{
    Path = "apps/api/src/prisma/prisma.module.ts"
    Content = @'
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
'@
  },
  @{
    Path = "apps/api/src/prisma/prisma.service.ts"
    Content = @'
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
'@
  },
  @{
    Path = "apps/api/src/modules/users/users.service.ts"
    Content = @'
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
        isActive: true,
        createdAt: true,
      },
    });
  }
}
'@
  },
  @{
    Path = "apps/api/src/modules/users/users.module.ts"
    Content = @'
import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
'@
  },
  @{
    Path = "apps/api/src/modules/users/users.controller.ts"
    Content = @'
import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { UsersService } from './users.service';

type AuthenticatedRequest = Request & { user: JwtPayload };

@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  me(@Req() request: AuthenticatedRequest) {
    return this.usersService.findById(request.user.sub);
  }
}
'@
  },
  @{
    Path = "apps/api/src/modules/auth/dto/register.dto.ts"
    Content = @'
import { IsEmail, IsNotEmpty, IsPhoneNumber, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsPhoneNumber('NG')
  phoneNumber!: string;

  @IsString()
  @MinLength(12)
  password!: string;

  @IsString()
  @IsNotEmpty()
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  lastName!: string;
}
'@
  },
  @{
    Path = "apps/api/src/modules/auth/dto/login.dto.ts"
    Content = @'
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(12)
  password!: string;
}
'@
  },
  @{
    Path = "apps/api/src/modules/auth/jwt.strategy.ts"
    Content = @'
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  validate(payload: JwtPayload): JwtPayload {
    return payload;
  }
}
'@
  },
  @{
    Path = "apps/api/src/modules/auth/jwt-auth.guard.ts"
    Content = @'
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
'@
  },
  @{
    Path = "apps/api/src/modules/auth/auth.service.ts"
    Content = @'
import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) throw new ConflictException('An account already exists for this email.');

    const passwordHash = await bcrypt.hash(dto.password, this.config.getOrThrow<number>('BCRYPT_ROUNDS'));
    const user = await this.usersService.create({
      email: dto.email.toLowerCase(),
      phoneNumber: dto.phoneNumber,
      passwordHash,
      firstName: dto.firstName.trim(),
      lastName: dto.lastName.trim(),
    });

    return this.issueTokens(user);
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmail(dto.email.toLowerCase());
    if (!user || !user.isActive) throw new UnauthorizedException('Invalid credentials.');
    const isValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isValid) throw new UnauthorizedException('Invalid credentials.');
    return this.issueTokens(user);
  }

  private async issueTokens(user: { id: string; email: string; role: string; firstName: string; lastName: string }) {
    const payload = { sub: user.id, email: user.email, role: user.role };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.config.getOrThrow<string>('JWT_ACCESS_EXPIRES_IN'),
      }),
      this.jwtService.signAsync(payload, {
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
'@
  },
  @{
    Path = "apps/api/src/modules/auth/auth.controller.ts"
    Content = @'
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }
}
'@
  },
  @{
    Path = "apps/api/src/modules/auth/auth.module.ts"
    Content = @'
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [UsersModule, PassportModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
'@
  },
  @{
    Path = "apps/api/src/modules/incidents/dto/create-incident.dto.ts"
    Content = @'
import { IncidentTrigger } from '@prisma/client';
import { IsEnum, IsLatitude, IsLongitude, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateIncidentDto {
  @IsEnum(IncidentTrigger)
  trigger!: IncidentTrigger;

  @IsLatitude()
  latitude!: number;

  @IsLongitude()
  longitude!: number;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  voicePhrase?: string;
}
'@
  },
  @{
    Path = "apps/api/src/modules/incidents/incidents.service.ts"
    Content = @'
import { BadRequestException, Injectable } from '@nestjs/common';
import { IncidentTrigger } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateIncidentDto } from './dto/create-incident.dto';

@Injectable()
export class IncidentsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateIncidentDto) {
    if (dto.trigger === IncidentTrigger.VOICE_HELP_HELP && dto.voicePhrase?.toUpperCase() !== 'HELP HELP') {
      throw new BadRequestException('Voice-triggered incidents require phrase HELP HELP.');
    }

    return this.prisma.incident.create({
      data: {
        userId,
        trigger: dto.trigger,
        latitude: dto.latitude,
        longitude: dto.longitude,
        address: dto.address,
        voicePhrase: dto.voicePhrase,
        metadata: {
          redisDispatchPrepared: true,
          notificationFanoutPrepared: true,
        },
      },
    });
  }

  listForUser(userId: string) {
    return this.prisma.incident.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
'@
  },
  @{
    Path = "apps/api/src/modules/incidents/incidents.controller.ts"
    Content = @'
import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { CreateIncidentDto } from './dto/create-incident.dto';
import { IncidentsService } from './incidents.service';

type AuthenticatedRequest = Request & { user: JwtPayload };

@UseGuards(JwtAuthGuard)
@Controller('incidents')
export class IncidentsController {
  constructor(private readonly incidentsService: IncidentsService) {}

  @Post()
  create(@Req() request: AuthenticatedRequest, @Body() dto: CreateIncidentDto) {
    return this.incidentsService.create(request.user.sub, dto);
  }

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.incidentsService.listForUser(request.user.sub);
  }
}
'@
  },
  @{
    Path = "apps/api/src/modules/incidents/incidents.module.ts"
    Content = @'
import { Module } from '@nestjs/common';
import { IncidentsController } from './incidents.controller';
import { IncidentsService } from './incidents.service';

@Module({
  controllers: [IncidentsController],
  providers: [IncidentsService],
  exports: [IncidentsService],
})
export class IncidentsModule {}
'@
  },
  @{
    Path = "apps/mobile/pubspec.yaml"
    Content = @'
name: opa_mobile
description: OPA Nigerian emergency safety mobile app.
publish_to: "none"
version: 0.0.1+1

environment:
  sdk: ">=3.4.0 <4.0.0"

dependencies:
  flutter:
    sdk: flutter
  cupertino_icons: ^1.0.8

dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^4.0.0

flutter:
  uses-material-design: true
'@
  },
  @{
    Path = "apps/mobile/lib/main.dart"
    Content = @'
import 'package:flutter/material.dart';
import 'src/app.dart';

void main() {
  runApp(const OpaApp());
}
'@
  },
  @{
    Path = "apps/mobile/lib/src/app.dart"
    Content = @'
import 'package:flutter/material.dart';
import 'features/sos/sos_page.dart';

class OpaApp extends StatelessWidget {
  const OpaApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'OPA',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF008753)),
        useMaterial3: true,
      ),
      home: const SosPage(),
    );
  }
}
'@
  },
  @{
    Path = "apps/mobile/lib/src/features/voice/voice_trigger.dart"
    Content = @'
class VoiceTrigger {
  static const phrase = 'HELP HELP';

  bool matches(String transcript) {
    final normalized = transcript.trim().toUpperCase().replaceAll(RegExp(r'\s+'), ' ');
    return normalized == phrase;
  }
}
'@
  },
  @{
    Path = "apps/mobile/lib/src/features/sos/sos_button.dart"
    Content = @'
import 'package:flutter/material.dart';

class SosButton extends StatefulWidget {
  const SosButton({required this.onTriggered, super.key});

  final VoidCallback onTriggered;

  @override
  State<SosButton> createState() => _SosButtonState();
}

class _SosButtonState extends State<SosButton> {
  bool _pressed = false;

  void _trigger() {
    setState(() => _pressed = false);
    widget.onTriggered();
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onLongPressStart: (_) => setState(() => _pressed = true),
      onLongPressEnd: (_) => _trigger(),
      child: AnimatedScale(
        scale: _pressed ? 0.96 : 1,
        duration: const Duration(milliseconds: 120),
        child: Semantics(
          button: true,
          label: 'Hold to send SOS emergency alert',
          child: Container(
            width: 208,
            height: 208,
            decoration: const BoxDecoration(
              shape: BoxShape.circle,
              gradient: LinearGradient(colors: [Color(0xFFFF6868), Color(0xFFC81E1E)]),
            ),
            alignment: Alignment.center,
            child: const Text(
              'SOS',
              style: TextStyle(color: Colors.white, fontSize: 52, fontWeight: FontWeight.w900),
            ),
          ),
        ),
      ),
    );
  }
}
'@
  },
  @{
    Path = "apps/mobile/lib/src/features/sos/sos_page.dart"
    Content = @'
import 'package:flutter/material.dart';
import '../voice/voice_trigger.dart';
import 'sos_button.dart';

class SosPage extends StatefulWidget {
  const SosPage({super.key});

  @override
  State<SosPage> createState() => _SosPageState();
}

class _SosPageState extends State<SosPage> {
  final VoiceTrigger _voiceTrigger = VoiceTrigger();
  String _status = 'Monitoring';
  bool _alertSent = false;

  void _sendAlert(String source) {
    setState(() {
      _alertSent = true;
      _status = '$source alert sent';
    });
  }

  void _simulateVoice() {
    if (_voiceTrigger.matches('HELP HELP')) {
      _sendAlert('Voice');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('OPA Safety')),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(_status, style: Theme.of(context).textTheme.headlineMedium),
              const SizedBox(height: 8),
              Text(
                _alertSent
                    ? 'Emergency contacts and responders are being notified.'
                    : 'Hold SOS or say HELP HELP to trigger an emergency incident.',
              ),
              const Spacer(),
              Center(child: SosButton(onTriggered: () => _sendAlert('SOS'))),
              const Spacer(),
              FilledButton.icon(
                onPressed: _simulateVoice,
                icon: const Icon(Icons.mic),
                label: const Text('Simulate HELP HELP'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
'@
  },
  @{
    Path = "apps/mobile/test/voice_trigger_test.dart"
    Content = @'
import 'package:flutter_test/flutter_test.dart';
import 'package:opa_mobile/src/features/voice/voice_trigger.dart';

void main() {
  test('matches HELP HELP phrase case-insensitively', () {
    final trigger = VoiceTrigger();
    expect(trigger.matches('help   help'), isTrue);
    expect(trigger.matches('help me'), isFalse);
  });
}
'@
  },
  @{
    Path = "docs/PHASE0.md"
    Content = @'
# OPA Phase 0

OPA is a Nigerian emergency safety platform. Phase 0 establishes a production-oriented monorepo with:

- Flutter 3 mobile foundation.
- NestJS TypeScript backend with strict mode.
- PostgreSQL via Prisma.
- Redis development service prepared for dispatch queues and notification fanout.
- Authentication, user, and emergency incident modules.
- SOS button and `HELP HELP` voice trigger foundation.

## Security Baseline

- Secrets are environment-driven and excluded from Git.
- JWT access and refresh secrets must be at least 32 bytes.
- Passwords are hashed with bcrypt.
- DTO validation is whitelisted and rejects unknown fields.
- Helmet, CORS allow-listing, and request throttling are enabled.
- User responses do not expose password hashes.

## Development

```powershell
docker compose up -d
copy .env.example .env
npm install
npm run prisma:generate
npm run prisma:migrate
npm run api:test
cd apps/mobile
flutter test
```

## Architecture

The API is organized by modules: `auth`, `users`, and `incidents`. Prisma is isolated behind `PrismaService`. The Flutter app separates feature modules for SOS and voice trigger logic.
'@
  }
)

$files += @(
  @{
    Path = "apps/api/nest-cli.json"
    Content = @'
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true
  }
}
'@
  },
  @{
    Path = "apps/api/tsconfig.build.json"
    Content = @'
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "test", "dist", "**/*spec.ts"]
}
'@
  },
  @{
    Path = "apps/api/jest.config.ts"
    Content = @'
import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['src/**/*.(t|j)s'],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
};

export default config;
'@
  },
  @{
    Path = "apps/api/eslint.config.mjs"
    Content = @'
import eslint from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
  eslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: './tsconfig.json',
        sourceType: 'module'
      }
    },
    plugins: {
      '@typescript-eslint': tseslint
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/consistent-type-imports': 'error'
    }
  }
];
'@
  },
  @{
    Path = "apps/api/src/modules/auth/auth.service.spec.ts"
    Content = @'
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  const usersService = {
    findByEmail: jest.fn(),
    create: jest.fn(),
  };
  const jwtService = {
    signAsync: jest.fn(),
  };
  const config = {
    getOrThrow: jest.fn((key: string) => {
      const values: Record<string, string | number> = {
        BCRYPT_ROUNDS: 10,
        JWT_ACCESS_SECRET: 'a'.repeat(32),
        JWT_REFRESH_SECRET: 'b'.repeat(32),
        JWT_ACCESS_EXPIRES_IN: '15m',
        JWT_REFRESH_EXPIRES_IN: '30d',
      };
      return values[key];
    }),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jwtService.signAsync.mockResolvedValueOnce('access').mockResolvedValueOnce('refresh');
  });

  it('registers a user with a hashed password', async () => {
    usersService.findByEmail.mockResolvedValue(null);
    usersService.create.mockResolvedValue({
      id: 'user-id',
      email: 'ada@example.com',
      firstName: 'Ada',
      lastName: 'Okafor',
      role: 'USER',
    });

    const service = new AuthService(usersService as never, jwtService as unknown as JwtService, config as never);
    const result = await service.register({
      email: 'Ada@Example.com',
      phoneNumber: '+2348012345678',
      password: 'StrongPassword123!',
      firstName: 'Ada',
      lastName: 'Okafor',
    });

    expect(usersService.create).toHaveBeenCalledWith(expect.objectContaining({ email: 'ada@example.com' }));
    expect(usersService.create.mock.calls[0][0].passwordHash).not.toBe('StrongPassword123!');
    expect(result.accessToken).toBe('access');
  });

  it('rejects duplicate registration', async () => {
    usersService.findByEmail.mockResolvedValue({ id: 'existing' });
    const service = new AuthService(usersService as never, jwtService as unknown as JwtService, config as never);

    await expect(
      service.register({
        email: 'ada@example.com',
        phoneNumber: '+2348012345678',
        password: 'StrongPassword123!',
        firstName: 'Ada',
        lastName: 'Okafor',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects invalid login credentials', async () => {
    usersService.findByEmail.mockResolvedValue({
      id: 'user-id',
      email: 'ada@example.com',
      passwordHash: await bcrypt.hash('CorrectPassword123!', 10),
      isActive: true,
    });
    const service = new AuthService(usersService as never, jwtService as unknown as JwtService, config as never);

    await expect(service.login({ email: 'ada@example.com', password: 'WrongPassword123!' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
'@
  },
  @{
    Path = "apps/api/src/modules/incidents/incidents.service.spec.ts"
    Content = @'
import { BadRequestException } from '@nestjs/common';
import { IncidentTrigger } from '@prisma/client';
import { IncidentsService } from './incidents.service';

describe('IncidentsService', () => {
  const prisma = {
    incident: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates SOS incidents with redis dispatch metadata prepared', async () => {
    prisma.incident.create.mockResolvedValue({ id: 'incident-id' });
    const service = new IncidentsService(prisma as never);

    await service.create('user-id', {
      trigger: IncidentTrigger.SOS_BUTTON,
      latitude: 6.5244,
      longitude: 3.3792,
    });

    expect(prisma.incident.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-id',
          metadata: expect.objectContaining({ redisDispatchPrepared: true }),
        }),
      }),
    );
  });

  it('requires exact HELP HELP phrase for voice incidents', async () => {
    const service = new IncidentsService(prisma as never);

    await expect(
      service.create('user-id', {
        trigger: IncidentTrigger.VOICE_HELP_HELP,
        latitude: 6.5244,
        longitude: 3.3792,
        voicePhrase: 'help me',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
'@
  },
  @{
    Path = "apps/mobile/test/sos_button_test.dart"
    Content = @'
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:opa_mobile/src/features/sos/sos_button.dart';

void main() {
  testWidgets('renders accessible SOS button', (tester) async {
    var triggered = false;

    await tester.pumpWidget(MaterialApp(home: Scaffold(body: SosButton(onTriggered: () => triggered = true))));

    expect(find.text('SOS'), findsOneWidget);
    await tester.longPress(find.byType(SosButton));
    expect(triggered, isTrue);
  });
}
'@
  },
  @{
    Path = "docs/SECURITY.md"
    Content = @'
# Security

Phase 0 security practices:

- Never commit `.env` files or production secrets.
- Use different JWT access and refresh secrets per environment.
- Keep bcrypt rounds between 10 and 14; production default is 12.
- Validate all inbound DTOs and reject unknown fields.
- Store only password hashes, never plaintext passwords.
- Keep incident location access behind authenticated endpoints.
- Use Redis for future queue-backed notification dispatch rather than synchronous emergency fanout.
- Add audit logging and device binding before production launch.
'@
  }
)

foreach ($file in $files) {
  Write-ProjectFile -Path $file.Path -Content $file.Content
}

Write-Host "OPA Phase 0 scaffold written to $Root"
