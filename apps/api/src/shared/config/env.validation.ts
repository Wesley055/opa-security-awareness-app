import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  // OPTIONAL, deliberately. Nothing in the application uses Redis
  // today - getClient() has no callers - and readiness-policy.ts
  // declares only 'database' required (ADR-016 D5).
  //
  // This line was z.string().url() until 8 August 2026, making the
  // schema STRICTER than the policy it enforces. Removing REDIS_URL
  // from App Service then failed config validation and took
  // production down. A supplied-but-malformed value is still
  // rejected: absent and malformed are different failures.
  REDIS_URL: z.string().url().optional(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(14).default(12),
  ALLOWED_ORIGINS: z.string().min(1),
  // Optional so password-recovery links never become a production boot dependency.
  // When absent, reset emails retain the secure raw-token fallback.
  OPA_WEB_URL: z.string().url().optional(),
  AZURE_STORAGE_CONNECTION_STRING: z.string().min(1),
  AZURE_STORAGE_CONTAINER: z.string().min(1),
});

export function validateEnv(config: Record<string, unknown>) {
  return envSchema.parse(config);
}