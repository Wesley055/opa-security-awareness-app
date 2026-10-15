import { Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { InsightService } from "./insight.service";

/** The existing committed lifecycle timeline is the durable source of work.
 * AIR uniqueness and transactional digest checks are the completion receipt.
 * No report generation, provider calls or queue waits run in emergency requests.
 */
@Injectable()
export class InsightReportWorker {
  private running = false;
  private cursor: string | undefined;
  private readonly logger = new Logger(InsightReportWorker.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly insight: InsightService,
  ) {}

  @Interval(1000)
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      // Fresh lane gives recent resolutions priority. Recovery lane revisits every
      // resolved incident, including evidence added without updating Incident.updatedAt.
      const where = {
        status: "RESOLVED" as const,
        facilityId: { not: null },
        timelineEvents: { some: { type: "INCIDENT_RESOLVED" } },
      };
      const recentEvents = await this.prisma.incidentTimelineEvent.findMany({
        where: {
          type: "INCIDENT_RESOLVED",
          incident: { status: "RESOLVED", facilityId: { not: null } },
        },
        select: { incidentId: true },
        orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
        take: 5,
      });
      const fresh = recentEvents.map((e) => ({ id: e.incidentId }));
      const recovery = await this.prisma.incident.findMany({
        where: {
          ...where,
          ...(this.cursor ? { id: { gt: this.cursor } } : {}),
        },
        select: { id: true },
        orderBy: { id: "asc" },
        take: 5,
      });
      this.cursor =
        recovery.length === 5 ? recovery[recovery.length - 1]!.id : undefined;
      for (const { id } of [
        ...new Map([...fresh, ...recovery].map((r) => [r.id, r])).values(),
      ]) {
        const prior = await this.prisma.afterIncidentReport.findFirst({
          where: { incidentId: id },
          orderBy: { version: "desc" },
          select: { generatedAt: true },
        });
        const failures = await this.prisma.administrativeAuditEvent.findMany({
          where: {
            resourceId: id,
            action: "EVIDENCE_AIR_AUTOMATIC_FAILED",
            ...(prior ? { createdAt: { gt: prior.generatedAt } } : {}),
          },
          orderBy: { createdAt: "desc" },
          take: 3,
          select: { createdAt: true },
        });
        if (
          failures.length >= 3 ||
          (failures[0] && Date.now() - +failures[0].createdAt < 5000)
        )
          continue;
        try {
          await this.insight.automatic(id);
        } catch (error) {
          // Another replica/manual generator may win a serializable race.
          // Its durable receipt is reconciled on the next scan, not dead-lettered.
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            ["P2034", "P2002"].includes(error.code)
          )
            continue;
          // Persist retry accounting; fail closed if it cannot be recorded.
          const incident = await this.prisma.incident.findUnique({
            where: { id },
            select: {
              facilityId: true,
              timelineEvents: {
                where: {
                  type: "INCIDENT_RESOLVED",
                  actorUserId: { not: null },
                },
                orderBy: { sequence: "desc" },
                take: 1,
                select: { actorUserId: true, id: true },
              },
            },
          });
          const event = incident?.timelineEvents[0];
          if (incident?.facilityId && event?.actorUserId)
            await this.prisma.administrativeAuditEvent.create({
              data: {
                actorUserId: event.actorUserId,
                actorRole: "SYSTEM",
                facilityId: incident.facilityId,
                action: "EVIDENCE_AIR_AUTOMATIC_FAILED",
                resourceId: id,
                afterState: {
                  eventReference: event.id,
                  attempt: failures.length + 1,
                  retryExhausted: failures.length >= 2,
                  reason: "GENERATION_UNAVAILABLE",
                  retryAfterSeconds: 5,
                },
              },
            });
          this.logger.warn(
            "Automatic AIR generation unavailable; durable event retained for recovery and authorized review.",
          );
        }
      }
    } catch {
      this.logger.error(
        "Automatic AIR scan unavailable; durable state retained.",
      );
    } finally {
      this.running = false;
    }
  }
}
