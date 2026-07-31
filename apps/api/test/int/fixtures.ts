import { randomUUID } from 'crypto';
import type { PrismaClient, User, JourneySession, Incident } from '@prisma/client';
import { prismaTest } from './prisma-test-client';

let seq = 0;

/**
 * User has two unique columns (email, phoneNumber). Truncation runs between
 * tests, but a single test may create several users, so values must be
 * distinct within a test as well as across runs.
 *
 * phoneNumber is a deterministic counter, not UUID-derived: a UUID is
 * mostly hex letters, so stripping non-digits yields a variable number of
 * digits and adjacent seq values can produce colliding strings.
 */
export async function createUser(
  client: PrismaClient = prismaTest,
): Promise<User> {
  seq += 1;
  const tag = seq + '-' + randomUUID().slice(0, 8);

  return client.user.create({
    data: {
      email: 'int-' + tag + '@example.test',
      phoneNumber: '+234' + String(700000000 + seq),
      passwordHash: 'not-a-real-hash',
      firstName: 'Int',
      lastName: 'Test',
    },
  });
}

export type SessionStatus = 'STARTED' | 'ACTIVE' | 'ENDED';

export interface SessionOverrides {
  status?: SessionStatus;
  purpose?: 'INCIDENT' | 'SAFEWALK' | 'GUARDIAN' | 'MANUAL' | 'SYSTEM_TEST';
  endedAt?: Date;
  endedReason?: 'USER_ENDED' | 'INCIDENT_RESOLVED' | 'TIMED_OUT' | 'SUPERSEDED' | 'ADMIN_ENDED';
}

/** purpose is required with no default: every creation path must choose. */
export async function createSession(
  userId: string,
  overrides: SessionOverrides = {},
  client: PrismaClient = prismaTest,
): Promise<JourneySession> {
  return client.journeySession.create({
    data: {
      userId,
      purpose: overrides.purpose ?? 'INCIDENT',
      status: overrides.status ?? 'STARTED',
      endedAt: overrides.endedAt,
      endedReason: overrides.endedReason,
    },
  });
}

export interface IncidentOverrides {
  trigger?: 'SOS_BUTTON' | 'VOICE_HELP_HELP' | 'TRUSTED_CONTACT' | 'SYSTEM_TEST';
  status?: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'CANCELLED';
  latitude?: string;
  longitude?: string;
  journeySessionId?: string;
}

/**
 * Incident has exactly four required columns with no default: userId,
 * trigger, latitude and longitude. Everything else defaults or is nullable.
 *
 * Coordinates are passed as STRINGS. The columns are Decimal(9, 6) and
 * decimal.js is not installed, so Prisma.Decimal or a string are the options;
 * a string keeps the Prisma namespace out of this file for one value. A JS
 * float would introduce a binary representation the database then rounds,
 * which is the same class of problem D3 documents for timestamps.
 */
export async function createIncident(
  userId: string,
  overrides: IncidentOverrides = {},
  client: PrismaClient = prismaTest,
): Promise<Incident> {
  return client.incident.create({
    data: {
      userId,
      trigger: overrides.trigger ?? 'SOS_BUTTON',
      status: overrides.status ?? 'OPEN',
      latitude: overrides.latitude ?? '6.524379',
      longitude: overrides.longitude ?? '3.379206',
      journeySessionId: overrides.journeySessionId,
    },
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls until predicate holds, so tests do not race on fixed sleeps. */
export async function waitFor(
  predicate: () => boolean,
  timeoutMs = 5000,
): Promise<void> {
  const start = Date.now();

  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor timed out after ' + timeoutMs + 'ms');
    }
    await sleep(10);
  }
}

/** Prisma unique-violation code. */
export async function captureError(
  run: () => Promise<unknown>,
): Promise<{ code?: string; message: string } | null> {
  try {
    await run();
    return null;
  } catch (err) {
    const e = err as { code?: string; message?: string };
    return { code: e.code, message: e.message ?? String(err) };
  }
}
