# OPA

OPA is a Nigerian emergency safety platform. Phase 0 targets a production-ready monorepo:

- Flutter 3 mobile application.
- NestJS TypeScript backend in strict mode.
- PostgreSQL database with Prisma.
- Redis prepared for dispatch and notification queues.
- Authentication, users, emergency incidents, SOS, and `HELP HELP` voice trigger foundations.

## Current Workspace Note

This OneDrive-backed workspace is currently refusing directory creation from the agent process, so the full Phase 0 tree is captured in `phase0-scaffold.ps1`.

Run this from the repository root once directory creation is available:

```powershell
.\phase0-scaffold.ps1
```

Then run:

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
