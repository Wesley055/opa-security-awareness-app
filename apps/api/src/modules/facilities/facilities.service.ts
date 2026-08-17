import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { IncidentStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { ListFacilityIncidentsDto } from './dto/list-facility-incidents.dto';

const DEFAULT_TAKE = 25;
const MAX_TAKE = 100;

/**
 * The live queue: what an operator sees on opening the console.
 *
 * ACKNOWLEDGED IS NAMED HERE AND HAS NO WRITER. A sweep of apps/api/src on
 * 12 August 2026 found nothing that sets IncidentStatus.ACKNOWLEDGED -
 * every status write is OPEN, plus the terminal states through
 * IncidentsService's close(). The value is in the enum and belongs in the
 * live set, so this does not encode today's gap into the contract; but a
 * reader who sees a two-state default return only OPEN rows should find the
 * explanation here rather than go hunting for a bug.
 *
 * Incident-level acknowledgement is deliberately absent from the whole
 * system, not merely unpopulated: incidents.service.ts records
 * acknowledgement as a timeline event, because a Command Centre operator
 * asserting something about an emergency is a claim by an interested party.
 * The projection below therefore has no acknowledgedAt and must not gain
 * one until something honestly produces it.
 */
const LIVE_STATUSES: IncidentStatus[] = [
  IncidentStatus.OPEN,
  IncidentStatus.ACKNOWLEDGED,
];

/**
 * Fields an operator queue needs, and nothing else.
 *
 * The previous version returned the full hash chain, every delivery attempt
 * and every evidence record on every row, for every incident ever routed to
 * the facility. Those belong behind the per-incident routes that
 * IncidentAccessGuard already protects, not in a list.
 *
 * Nothing here is a value OPA cannot populate honestly. public-incident-
 * snapshot.dto.ts established the rule for this codebase: such a field is
 * OMITTED, not returned as null, because a null implies the capability
 * exists and is merely empty. The marketing copy in apps/website promises
 * ETA and patient context; the backend has neither, and this does not
 * pretend otherwise.
 *
 * createdAt and id are both required by the cursor, not merely displayed.
 */
const QUEUE_SELECT = {
  id: true,
  status: true,
  trigger: true,
  latitude: true,
  longitude: true,
  address: true,
  createdAt: true,
  lastTriggeredAt: true,
  retriggerCount: true,
  resolvedAt: true,
  user: {
    select: { firstName: true, lastName: true },
  },
} satisfies Prisma.IncidentSelect;

type QueueCursor = { createdAt: Date; id: string };

/**
 * OPAQUE ON PURPOSE. The client passes nextCursor back verbatim and never
 * constructs one, so the encoding can change without a client change.
 */
function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(
    JSON.stringify({ c: row.createdAt.toISOString(), i: row.id }),
  ).toString('base64url');
}

function decodeCursor(raw: string): QueueCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    ) as { c?: unknown; i?: unknown };

    if (typeof parsed.c !== 'string' || typeof parsed.i !== 'string') {
      throw new Error('shape');
    }

    const createdAt = new Date(parsed.c);
    if (Number.isNaN(createdAt.getTime())) {
      throw new Error('date');
    }

    return { createdAt, id: parsed.i };
  } catch {
    // Loudly, not silently. Returning page one for a malformed cursor would
    // show an operator the same emergencies again and hide everything below
    // the point they had reached.
    throw new BadRequestException('Invalid pagination cursor.');
  }
}

@Injectable()
export class FacilitiesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Incidents routed to one facility, newest first.
   *
   * AUTHORIZATION IS THE CALLER'S JOB. FacilityOperatorGuard has already
   * established that the requester belongs to this facility or is an admin.
   * This method must not be reachable from anywhere that guard is absent.
   *
   * FACILITY EXISTENCE IS CHECKED; isActive IS DELIBERATELY NOT.
   *
   * Deactivating a facility is not a revocation workflow today. Incident
   * creation snapshots facilityId without consulting isActive, residents
   * remain assigned, and neither guard checks it. Filtering here would
   * therefore produce the worst combination available: new emergencies
   * still routed to the facility, and operators who can no longer see them.
   * A live emergency nobody can see is strictly worse than one visible to a
   * deactivated facility.
   *
   * isActive gates PROVISIONING - AdminProvisioningService refuses to
   * create an operator seat or assign a resident into an inactive facility.
   * Making it gate emergency visibility too needs an atomic administrative
   * workflow that also reassigns residents and revokes operator access, and
   * it cannot be bolted on as a filter in a list query.
   */
  async listIncidentsForFacility(
    facilityId: string,
    query: ListFacilityIncidentsDto = {},
  ) {
    const facility = await this.prisma.facility.findUnique({
      where: { id: facilityId },
      select: { id: true },
    });

    if (!facility) {
      throw new NotFoundException('Facility not found.');
    }

    const take = Math.min(query.take ?? DEFAULT_TAKE, MAX_TAKE);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;

    // THE SEEK PREDICATE, and it mirrors the ORDER BY exactly.
    //
    //   ORDER BY createdAt DESC, id DESC
    //   WHERE createdAt < c OR (createdAt = c AND id < i)
    //
    // Written out rather than delegated to Prisma's cursor option, which
    // resolves a row by unique id and therefore accepts an id from outside
    // this facility's filtered queue. Here the boundary is expressed in the
    // same terms as the ordering, so a cursor cannot address a row the
    // filter would exclude.
    const seek: Prisma.IncidentWhereInput | undefined = cursor
      ? {
          OR: [
            { createdAt: { lt: cursor.createdAt } },
            {
              AND: [
                { createdAt: cursor.createdAt },
                { id: { lt: cursor.id } },
              ],
            },
          ],
        }
      : undefined;

    const rows = await this.prisma.incident.findMany({
      where: {
        facilityId,
        status: query.status ? { equals: query.status } : { in: LIVE_STATUSES },
        ...(seek ?? {}),
      },
      select: QUEUE_SELECT,
      // Matches @@index([facilityId, status, createdAt Desc, id Desc]).
      // id is the tiebreaker, not decoration: two incidents created in the
      // same millisecond would otherwise page non-deterministically, and a
      // row could be served twice or skipped. In this queue a skipped row
      // is somebody's emergency.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      // take + 1 so the response can report whether another page exists
      // without a second count query.
      take: take + 1,
    });

    const hasMore = rows.length > take;
    const incidents = hasMore ? rows.slice(0, take) : rows;
    const last = incidents[incidents.length - 1];

    return {
      incidents,
      // Null means the end of the queue, not an error.
      nextCursor: hasMore && last ? encodeCursor(last) : null,
      hasMore,
    };
  }

  /**
   * Reader-safe membership for the signed-in facility operator.
   *
   * DO NOT CONSOLIDATE THIS WITH
   * AdminProvisioningService.listFacilityMembers(). That projection selects
   * email and phoneNumber, which an administrator provisioning a seat
   * legitimately needs. An operator answering "who is at this estate" does
   * not, and the resident whose number it would expose never agreed to be
   * reachable by a gatehouse. THE DIFFERENCE IN PROJECTION IS THE SECURITY
   * BOUNDARY - a later refactor that notices two similar reads and merges
   * them removes it silently.
   *
   * THE FACILITY ID IS NEVER A PARAMETER THE BROWSER CONTROLS. It arrives
   * from OperatorFacilityGuard, which read it from the caller's row. Same
   * argument as the operator queue: the browser does not need to know, send,
   * or be trusted with a facility id.
   *
   * isActive AND accountStatus ARE CARRIED BUT NEED NOT BE RENDERED. Both are
   * provisioning facts, and today every member of OPA Demo Estate is
   * ACTIVE/ACTIVE, so a status column would show one value twice. Carried
   * because 14A-12 may want them and widening later is worse - the same call
   * 2.6 made for journeySessionId.
   */
  async listMembersForOperator(facilityId: string) {
    const facility = await this.prisma.facility.findUnique({
      where: { id: facilityId },
      select: {
        id: true,
        name: true,
        isActive: true,
        isVerified: true,
      },
    });

    if (!facility) {
      throw new NotFoundException('Facility not found.');
    }

    const members = await this.prisma.user.findMany({
      where: { facilityId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        accountStatus: true,
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    // User.facilityId is ONE COLUMN carrying operators and residents alike -
    // 9.5's "Facility.staff is a misleading name". Partition by role rather
    // than trusting any relation to have done it.
    return {
      facility,
      operators: members.filter(
        (member) => member.role === UserRole.FACILITY_OPERATOR,
      ),
      residents: members.filter((member) => member.role === UserRole.USER),
    };
  }
}