import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * One incident, for whoever IncidentAccessGuard has already admitted.
 *
 * AUTHORIZATION IS THE CALLER'S JOB, as with FacilitiesService. The guard
 * has established that the requester owns this incident, operates the
 * facility it was routed to, or is an admin. This method must not be
 * reachable from anywhere that guard is absent.
 *
 * WHAT IS ABSENT FROM THE PROJECTION IS THE POINT.
 *
 *   metadata        internal dispatch plumbing - redisDispatchPrepared and
 *                   notificationFanoutPrepared. An untyped blob of
 *                   implementation state has no business in a console.
 *   trustedContact  untyped JSON of unknown shape. Same reasoning, and it
 *                   may carry a third party's details.
 *   facilityId      the guard uses it to decide; the reader gains nothing.
 *                   NOTE the consequence: an ADMIN, who has no facility of
 *                   their own, therefore sees an incident with no indication
 *                   of which estate it belongs to. Deliberate for now.
 *   timelineEvents  behind /incidents/:id/timeline, its own guard, 14A-9.
 *   evidence        behind /incidents/:id/evidence, 14A-10.
 *   notifications   delivery records are not operator-facing.
 *   accessTokens    capability material. Never.
 *
 * journeySessionId IS included and nothing renders it yet. 14A-8 needs to
 * know whether a live location stream exists; returning the id now means
 * that slice does not have to widen this projection to find out.
 *
 * voicePhrase IS included, and note what it actually is: create() writes
 * dto.voicePhrase for EVERY trigger, and only validates its content when
 * the trigger is VOICE_HELP_HELP. So a button-triggered incident can carry
 * arbitrary device-supplied text. Render it as untrusted plain text.
 */

const DETAIL_SELECT = {
  id: true,
  status: true,
  trigger: true,

  latitude: true,
  longitude: true,
  address: true,

  voicePhrase: true,
  lastTriggeredAt: true,
  retriggerCount: true,

  createdAt: true,
  updatedAt: true,
  /**
   * RESOLVED ONLY, never CANCELLED. incidents.service.ts writes null here
   * for a cancellation on purpose - "a cancelled incident is not resolved,
   * and overloading one column with two meanings would be read wrongly
   * later". A reader must take status as the authority and treat a null
   * resolvedAt on a CANCELLED incident as correct, not missing.
   */
  resolvedAt: true,

  journeySessionId: true,

  user: {
    select: { firstName: true, lastName: true },
  },
} satisfies Prisma.IncidentSelect;

@Injectable()
export class IncidentDetailService {
  constructor(private readonly prisma: PrismaService) {}

  async getDetail(incidentId: string) {
    const incident = await this.prisma.incident.findUnique({
      where: { id: incidentId },
      select: DETAIL_SELECT,
    });

    // IncidentAccessGuard already 404s an unknown incident, so this branch
    // is unreachable through the controller today. It stays because a
    // service must not assume its only caller - and because a guard that
    // stopped checking would otherwise turn a missing row into a null body.
    if (!incident) {
      throw new NotFoundException('Incident not found.');
    }

    return incident;
  }
}