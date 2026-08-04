import type { JourneySessionEndReason } from '@prisma/client';

/**
 * What the client gets back from ending a session.
 *
 * Deliberately NOT an extension of JourneySessionDto. startSession returns
 * that type today and widening it would change a shipped contract for no
 * benefit. Purely additive, on the pattern ADR-014 used for
 * IngestFixesResult.
 *
 * There is no request DTO: the route carries only a path parameter and no
 * body, so the value-import rule that binds @Body() classes does not apply.
 */
export type EndJourneySessionDto = {
  sessionId: string;
  /**
   * The 'ENDED' LITERAL, not JourneySessionStatus. This endpoint returns
   * only after the session is ended; STARTED and ACTIVE are not possible
   * outcomes and must not be expressible in the type.
   */
  status: 'ENDED';
  endedAt: string;
  /**
   * The ENUM, not the 'USER_ENDED' literal - the deliberate asymmetry with
   * status above. On the alreadyEnded path the stored reason is whatever
   * ended the session, and once a second owner exists (reaper, incident
   * close, admin) that will not always be USER_ENDED. status is invariant
   * across those owners; endedReason is not.
   */
  endedReason: JourneySessionEndReason;
  /** True when the session was already ENDED and this call wrote nothing. */
  alreadyEnded: boolean;
};
