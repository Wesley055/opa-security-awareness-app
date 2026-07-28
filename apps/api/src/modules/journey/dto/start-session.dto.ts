import { IsIn, IsOptional } from 'class-validator';
import { JourneyPurpose } from '@prisma/client';
import type { JourneySessionStatus } from '@prisma/client';

/**
 * Purposes a CLIENT may request.
 *
 * INCIDENT is excluded deliberately: it belongs to the orchestrator, which
 * sets it when an emergency creates the session. GUARDIAN is excluded
 * because no product exists behind it - see ADR-009.
 *
 * purpose is a TAG. Nothing in 10B may branch on it.
 */
export const CLIENT_PURPOSES = [
  JourneyPurpose.MANUAL,
  JourneyPurpose.SAFEWALK,
  JourneyPurpose.SYSTEM_TEST,
] as const;

export class StartSessionDto {
  @IsOptional()
  @IsIn(CLIENT_PURPOSES)
  purpose?: (typeof CLIENT_PURPOSES)[number];
}

/**
 * What the client gets back.
 *
 * purpose is returned AS STORED, not as requested. One active session per
 * user is enforced by a partial unique index, so asking to start a session
 * while one is open REUSES it - and the stored purpose wins. A client that
 * asked for SAFEWALK and got INCIDENT back is being told, accurately, that
 * it joined a session an emergency already opened.
 */
export type JourneySessionDto = {
  sessionId: string;
  status: JourneySessionStatus;
  purpose: JourneyPurpose;
  startedAt: string;
  lastFixReceivedAt: string | null;
  /**
   * True when an open session already existed and this call joined it.
   * Explicit rather than inferred from purpose: a client should not have to
   * understand one-active-session-per-user to read its own telemetry.
   */
  reused: boolean;
};
