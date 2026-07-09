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