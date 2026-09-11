import { incidentScope } from "../../shared/security/incident-scope";
import { maskDeliveryRecipient } from "./delivery-recipient";
import {
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Req,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import type { JwtPayload } from "../auth/jwt.strategy";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { IncidentAccessGuard } from "../../shared/guards/incident-access.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";

const SELECT = {
  id: true,
  recipient: true,
  protectedSnapshotId: true,
  channel: true,
  deliveryStatus: true,
  queuedAt: true,
  firstAttemptAt: true,
  lastAttemptAt: true,
  providerAcceptedAt: true,
  confirmedDeliveredAt: true,
  attemptCount: true,
  failureCategory: true,
  updatedAt: true,
  status: true,
  nextAttemptAt: true,
  _count: {
    select: { deliveryEvents: { where: { reason: "DURABLY_QUEUED" } } },
  },
  deliveryAttempts: {
    orderBy: { number: "asc" as const },
    take: 5,
    select: {
      number: true,
      status: true,
      startedAt: true,
      completedAt: true,
      providerAcceptedAt: true,
      deliveredAt: true,
      failureCategory: true,
      _count: {
        select: { events: { where: { newStatus: "FAILED" as const } } },
      },
    },
  },
} satisfies Prisma.IncidentNotificationSelect;

type Row = Prisma.IncidentNotificationGetPayload<{ select: typeof SELECT }>;
const latency = (from: Date | null, to: Date | null) =>
  from && to && to >= from ? to.getTime() - from.getTime() : null;

export function deliveryProjection(row: Row) {
  const attempts = row.deliveryAttempts;
  const historyComplete =
    row._count.deliveryEvents > 0 && row.attemptCount === attempts.length;
  return {
    id: row.id,
    // Only the masked snapshot leaves the service. Never spread the row.
    recipient: {
      maskedIdentity: row.protectedSnapshotId
        ? "••••"
        : maskDeliveryRecipient(row.channel, row.recipient),
      reference: row.id,
    },
    channel: row.channel,
    receiptAuthentication:
      row.channel === "EMAIL" ? "PROVIDER_SIGNATURE" : "UNAVAILABLE",
    status: row.deliveryStatus,
    queuedAt: row.queuedAt,
    firstAttemptAt: row.firstAttemptAt,
    lastAttemptAt: row.lastAttemptAt,
    providerAcceptedAt: row.providerAcceptedAt,
    deliveredAt: row.confirmedDeliveredAt,
    attemptCount: row.attemptCount,
    retryCount: Math.max(0, row.attemptCount - 1),
    failureCategory: row.failureCategory,
    lastUpdatedAt: row.updatedAt,
    retryScheduledAt:
      row.status === "QUEUED" && row.attemptCount > 0
        ? row.nextAttemptAt
        : null,
    hasUnconfirmedOutcome:
      row.deliveryStatus === "UNKNOWN" ||
      row.deliveryStatus === "PROVIDER_ACCEPTED" ||
      row.deliveryStatus === "ATTEMPTING" ||
      row.deliveryStatus === "QUEUED",
    historyComplete,
    failedAttemptCount: historyComplete
      ? attempts.filter((a) => a._count.events > 0).length
      : null,
    attempts: attempts.map((a) => ({
      number: a.number,
      status: a.status,
      attemptedAt: a.startedAt,
      responseRecordedAt: a.completedAt,
      providerAcceptedAt: a.providerAcceptedAt,
      deliveredAt: a.deliveredAt,
      failureCategory: a.failureCategory,
      hadFailure: a._count.events > 0,
    })),
    latencyMs: {
      queueToFirstAttempt: latency(row.queuedAt, row.firstAttemptAt),
      queueToProviderAcceptance: latency(row.queuedAt, row.providerAcceptedAt),
      queueToConfirmedDelivery: latency(row.queuedAt, row.confirmedDeliveredAt),
    },
  };
}

@Injectable()
export class DeliveryReadService {
  constructor(private readonly prisma: PrismaService) {}
  // Matches A's incidentScope. Actor identity comes from verified JWT only.
  async forActorIncident(actorId: string, incidentId: string, after?: string) {
    const actor = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: {
        role: true,
        facilityId: true,
        isActive: true,
        accountStatus: true,
      },
    });
    const scope = incidentScope(actorId, actor);
    const incident = await this.prisma.incident.findFirst({
      where: { AND: [{ id: incidentId }, scope] },
      select: { id: true },
    });
    if (!incident) throw new NotFoundException("Incident not found.");
    const rows = await this.prisma.incidentNotification.findMany({
      where: {
        incidentId,
        incident: scope,
        ...(after ? { id: { gt: after } } : {}),
      },
      select: SELECT,
      orderBy: { id: "asc" },
      take: 51,
    });
    return {
      version: 1,
      items: rows.slice(0, 50).map(deliveryProjection),
      nextCursor: rows.length > 50 ? rows[49]!.id : null,
    };
  }
}

@UseGuards(JwtAuthGuard, IncidentAccessGuard)
@Controller("incidents")
export class DeliveryReadController {
  constructor(private readonly service: DeliveryReadService) {}
  @Get(":incidentId/deliveries")
  get(
    @Req() request: Request & { user: JwtPayload },
    @Param("incidentId", new ParseUUIDPipe()) incidentId: string,
    @Query("after", new ParseUUIDPipe({ optional: true })) after?: string,
  ) {
    return this.service.forActorIncident(request.user.sub, incidentId, after);
  }
}
