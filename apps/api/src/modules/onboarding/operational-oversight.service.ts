import { ForbiddenException, Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { PrismaService } from "../../prisma/prisma.service";
import { IncidentTimelineService } from "../incident-timeline/incident-timeline.service";
import { institutionalAuthority } from "./support-authority";
export type ResponsePolicy = {
  acknowledgementSeconds: number;
  dispatchSeconds: number;
  progressSeconds: number;
  unattendedSeconds: number;
  closureSeconds: number;
  version: number;
};
export function operationalExceptions(
  createdAt: Date,
  events: Array<{ type: string; occurredAt: Date }>,
  policy: ResponsePolicy,
  now: Date,
) {
  const last = (type: string) =>
    events
      .filter((e) => e.type === type)
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())[0]
      ?.occurredAt;
  const ack = last("OPERATOR_ACKNOWLEDGED"),
    dispatch = last("OPERATOR_DISPATCHED"),
    progress = last("OPERATOR_RESPONSE_PROGRESS");
  const elapsed = (from: Date, seconds: number) =>
    now.getTime() - from.getTime() >= seconds * 1000;
  const kinds: string[] = [];
  if (!ack && elapsed(createdAt, policy.acknowledgementSeconds))
    kinds.push("ACKNOWLEDGEMENT_OVERDUE");
  if (ack && !dispatch && elapsed(ack, policy.dispatchSeconds))
    kinds.push("DISPATCH_OVERDUE");
  if (dispatch && elapsed(progress ?? dispatch, policy.progressSeconds))
    kinds.push("RESPONSE_PROGRESS_OVERDUE");
  if (!ack && elapsed(createdAt, policy.unattendedSeconds))
    kinds.push("UNATTENDED_INCIDENT");
  if (elapsed(createdAt, policy.closureSeconds)) kinds.push("CLOSURE_OVERDUE");
  return kinds;
}
@Injectable()
export class OperationalOversightService {
  private running = false;
  private cursor: string | undefined;
  private readonly logger = new Logger(OperationalOversightService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly timeline: IncidentTimelineService,
  ) {}
  @Interval(10000)
  async scan() {
    if (this.running) return;
    this.running = true;
    try {
      const policies = await this.prisma.facilityResponsePolicy.findMany({
        where: { facility: { isActive: true } },
        orderBy: { facilityId: "asc" },
        take: 50,
        ...(this.cursor
          ? { cursor: { facilityId: this.cursor }, skip: 1 }
          : {}),
      });
      for (const policy of policies) {
        const incidents = await this.prisma.incident.findMany({
          where: { facilityId: policy.facilityId, status: "OPEN" },
          select: { id: true },
          orderBy: { id: "asc" },
        });
        for (const incident of incidents) await this.evaluate(incident.id);
      }
      this.cursor =
        policies.length === 50
          ? policies[policies.length - 1]?.facilityId
          : undefined;
    } catch {
      this.logger.error(
        "Operational exception evaluation unavailable; readiness requires investigation.",
      );
    } finally {
      this.running = false;
    }
  }
  async evaluate(incidentId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(3,hashtext(${incidentId}))`;
      const incident = await tx.incident.findUnique({
        where: { id: incidentId },
        include: {
          timelineEvents: true,
          facility: { include: { responsePolicy: true } },
        },
      });
      if (
        !incident ||
        incident.status !== "OPEN" ||
        !incident.facility?.isActive ||
        !incident.facility.responsePolicy
      )
        return [];
      const policy = incident.facility.responsePolicy,
        now = new Date();
      const kinds = operationalExceptions(
        incident.createdAt,
        incident.timelineEvents,
        policy,
        now,
      );
      const previous = new Set(
        incident.timelineEvents
          .filter((e) => e.type === "OPERATIONAL_EXCEPTION")
          .map((e) => (e.payload as { kind?: string } | null)?.kind),
      );
      const recipients = await tx.user.findMany({
        where: {
          facilityId: incident.facilityId,
          role: { in: ["FACILITY_ADMIN", "FACILITY_OPERATOR"] },
          isActive: true,
          accountStatus: "ACTIVE",
          membershipState: "ACTIVE",
        },
        select: { id: true, role: true },
      });
      for (const kind of kinds) {
        if (previous.has(kind)) continue;
        await this.timeline.recordEvent(
          {
            incidentId,
            type: "OPERATIONAL_EXCEPTION",
            source: "FACILITY_RESPONSE_POLICY",
            occurredAt: now,
            payload: {
              kind,
              facilityId: incident.facilityId,
              policyVersion: policy.version,
              observedAt: now.toISOString(),
              statement:
                "Response milestone was not recorded within facility policy. Motive is not inferred.",
            },
          },
          tx,
        );
        await this.timeline.recordEvent(
          {
            incidentId,
            type: "OPERATIONAL_ESCALATION",
            source: "FACILITY_RESPONSE_POLICY",
            occurredAt: now,
            payload: {
              kind,
              facilityId: incident.facilityId,
              policyVersion: policy.version,
              recipientUserIds: recipients.map((r) => r.id),
              channel: "INSTITUTIONAL_WORKSPACE",
              externalDelivery: "NOT_ATTEMPTED",
            },
          },
          tx,
        );
      }
      return kinds;
    });
  }
  async oversight(actorId: string, facilityId: string) {
    return this.prisma.$transaction(async (tx) => {
      const actor = await tx.user.findUnique({
        where: { id: actorId },
        select: {
          role: true,
          facilityId: true,
          isActive: true,
          accountStatus: true,
          membershipState: true,
        },
      });
      if (actor?.role === "FACILITY_OPERATOR") {
        if (
          actor.facilityId !== facilityId ||
          !actor.isActive ||
          actor.accountStatus !== "ACTIVE" ||
          actor.membershipState !== "ACTIVE" ||
          !(await tx.facility.findUnique({ where: { id: facilityId } }))
            ?.isActive
        )
          throw new ForbiddenException("Current facility authority required.");
      } else
        await institutionalAuthority(
          tx,
          actorId,
          facilityId,
          "INCIDENT_SUPPORT_READ",
        );
      const policy = await tx.facilityResponsePolicy.findUnique({
        where: { facilityId },
      });
      const incidents = await tx.incident.findMany({
        where: { facilityId, status: "OPEN" },
        orderBy: { createdAt: "asc" },
        take: 100,
        select: {
          id: true,
          status: true,
          createdAt: true,
          timelineEvents: {
            where: {
              type: {
                in: [
                  "OPERATOR_SEEN",
                  "OPERATOR_ACKNOWLEDGED",
                  "OPERATOR_DISPATCHED",
                  "OPERATOR_RESPONSE_PROGRESS",
                  "OPERATOR_ESCALATION",
                  "OPERATIONAL_EXCEPTION",
                  "OPERATIONAL_ESCALATION",
                ],
              },
            },
            orderBy: { sequence: "asc" },
            select: {
              id: true,
              type: true,
              occurredAt: true,
              actorUserId: true,
              payload: true,
            },
          },
        },
      });
      return {
        policyState: policy ? "CONFIGURED" : "NOT_CONFIGURED",
        policy: policy
          ? {
              acknowledgementSeconds: policy.acknowledgementSeconds,
              dispatchSeconds: policy.dispatchSeconds,
              progressSeconds: policy.progressSeconds,
              unattendedSeconds: policy.unattendedSeconds,
              closureSeconds: policy.closureSeconds,
              version: policy.version,
            }
          : null,
        incidents: incidents.map((row) => ({
          id: row.id,
          status: row.status,
          createdAt: row.createdAt,
          currentExceptions: policy
            ? operationalExceptions(
                row.createdAt,
                row.timelineEvents,
                policy,
                new Date(),
              )
            : [],
          events: row.timelineEvents.map((e) => ({
            id: e.id,
            type: e.type,
            occurredAt: e.occurredAt,
            actorUserId: e.actorUserId,
            kind: (e.payload as { kind?: string } | null)?.kind ?? null,
          })),
        })),
        interpretation:
          "Recorded facts and overdue milestones; no inference about personnel motive.",
        escalationChannel: "INSTITUTIONAL_WORKSPACE",
      };
    });
  }
}
