import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, type VisitorPass } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import {
  generateVisitorCode,
  normalizeVisitorCode,
  protectVisitor,
  revealVisitor,
  visitorCodeDigest,
} from "./estate-crypto";
import type { CreateVisitorPassDto, EstateSettingsDto } from "./estate.dto";

const MINUTE = 60_000;
const ENTRY_WINDOW_MS = 24 * 60 * MINUTE;
const EARLY_ARRIVAL_MS = 60 * MINUTE;
const MAX_LIVE_PASSES = 20;
/** Six digits are guessable, so wrong codes are limited per guard and per estate. */
const FAILURE_WINDOW_MS = 10 * MINUTE;
const MAX_GUARD_FAILURES = 10;
const MAX_ESTATE_FAILURES = 50;
const WAT_OFFSET_MS = 60 * MINUTE;

/** Start of today in Nigeria (WAT, UTC+1, no daylight saving), as a UTC instant. */
export function startOfWatDay(now = new Date()): Date {
  const day = 24 * 60 * MINUTE;
  return new Date(Math.floor((now.getTime() + WAT_OFFSET_MS) / day) * day - WAT_OFFSET_MS);
}

export function maskPhone(phone?: string): string | null {
  return phone ? "•••• " + phone.slice(-4) : null;
}

@Injectable()
export class EstateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get secret() {
    return this.config.getOrThrow<string>("ENROLLMENT_ENCRYPTION_KEY");
  }

  private visitor(pass: Pick<VisitorPass, "visitorCiphertext">) {
    try {
      return revealVisitor(this.secret, pass.visitorCiphertext);
    } catch {
      return { name: "Unreadable visitor record" };
    }
  }

  private expectedExitAt(pass: Pick<VisitorPass, "checkedInAt" | "expectedMinutes">) {
    return pass.checkedInAt ? new Date(pass.checkedInAt.getTime() + pass.expectedMinutes * MINUTE) : null;
  }

  /** Residents: active USER accounts that belong to an estate. Re-read on every call. */
  async resident(actorId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { id: true, role: true, isActive: true, accountStatus: true, membershipState: true, facilityId: true },
    });
    if (
      !user ||
      user.role !== "USER" ||
      !user.isActive ||
      user.accountStatus !== "ACTIVE" ||
      user.membershipState !== "ACTIVE" ||
      !user.facilityId
    )
      throw new ForbiddenException("Visitor passes are available to estate residents.");
    return { userId: user.id, facilityId: user.facilityId };
  }

  private residentView(pass: VisitorPass, now = new Date()) {
    const exit = this.expectedExitAt(pass);
    return {
      id: pass.id,
      visitorName: this.visitor(pass).name,
      destination: pass.destination,
      status: pass.status,
      validFrom: pass.validFrom,
      validUntil: pass.validUntil,
      expectedMinutes: pass.expectedMinutes,
      checkedInAt: pass.checkedInAt,
      checkedOutAt: pass.checkedOutAt,
      expectedExitAt: exit,
      departureUnconfirmed: pass.status === "CHECKED_IN" && !!pass.overstayAlertedAt,
      overdue: pass.status === "CHECKED_IN" && !!exit && exit < now,
    };
  }

  /** Issue a fresh code for a pass: new digest, retried on the rare live-code collision. */
  private async withFreshCode<T>(facilityId: string, write: (digest: string) => Promise<T>): Promise<{ code: string; result: T }> {
    for (let attempt = 0; attempt < 6; attempt++) {
      const code = generateVisitorCode();
      try {
        return { code, result: await write(visitorCodeDigest(this.secret, facilityId, code)) };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue;
        throw error;
      }
    }
    throw new ConflictException("Could not issue a visitor code. Try again.");
  }

  async createPass(actorId: string, dto: CreateVisitorPassDto) {
    const { userId, facilityId } = await this.resident(actorId);
    const facility = await this.prisma.facility.findUniqueOrThrow({
      where: { id: facilityId },
      select: { visitorDefaultMinutes: true, isActive: true },
    });
    if (!facility.isActive) throw new ForbiddenException("This estate is not active.");
    const now = new Date();
    const validFrom = dto.validFrom ? new Date(dto.validFrom) : now;
    if (validFrom.getTime() < now.getTime() - 60 * MINUTE || validFrom.getTime() > now.getTime() + 30 * 24 * 60 * MINUTE)
      throw new BadRequestException("Choose a visit start between now and 30 days ahead.");
    const expectedMinutes = dto.expectedMinutes ?? facility.visitorDefaultMinutes;
    const live = await this.prisma.visitorPass.count({
      where: { hostUserId: userId, status: { in: ["ISSUED", "CHECKED_IN"] } },
    });
    if (live >= MAX_LIVE_PASSES)
      throw new ConflictException(`You already have ${MAX_LIVE_PASSES} active visitor passes. Cancel one first.`);
    const visitorCiphertext = protectVisitor(this.secret, {
      name: dto.visitorName.trim(),
      ...(dto.visitorPhone ? { phone: dto.visitorPhone } : {}),
    });
    const { code, result } = await this.withFreshCode(facilityId, (codeDigest) =>
      this.prisma.visitorPass.create({
        data: {
          facilityId,
          hostUserId: userId,
          visitorCiphertext,
          destination: dto.destination.trim(),
          codeDigest,
          validFrom,
          validUntil: new Date(validFrom.getTime() + Math.max(ENTRY_WINDOW_MS, expectedMinutes * MINUTE)),
          expectedMinutes,
        },
      }),
    );
    return { code, pass: this.residentView(result) };
  }

  async myPasses(actorId: string) {
    const { userId } = await this.resident(actorId);
    const passes = await this.prisma.visitorPass.findMany({
      where: { hostUserId: userId },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    const now = new Date();
    return { passes: passes.map((p) => this.residentView(p, now)) };
  }

  private async ownLivePass(actorId: string, passId: string) {
    const { userId, facilityId } = await this.resident(actorId);
    const pass = await this.prisma.visitorPass.findUnique({ where: { id: passId } });
    if (!pass || pass.hostUserId !== userId) throw new NotFoundException("Visitor pass not found.");
    return { pass, facilityId };
  }

  /** A lost code is replaced, never shown again: only its digest is stored. */
  async newCode(actorId: string, passId: string) {
    const { pass, facilityId } = await this.ownLivePass(actorId, passId);
    if (pass.status !== "ISSUED" || pass.validUntil <= new Date())
      throw new ConflictException("A new code can only be issued for a pass that has not been used.");
    const { code, result } = await this.withFreshCode(facilityId, (codeDigest) =>
      this.prisma.visitorPass.update({ where: { id: pass.id, status: "ISSUED" }, data: { codeDigest } }),
    );
    return { code, pass: this.residentView(result) };
  }

  async revoke(actorId: string, passId: string) {
    const { pass } = await this.ownLivePass(actorId, passId);
    if (pass.status !== "ISSUED")
      throw new ConflictException(
        pass.status === "CHECKED_IN" ? "Your visitor is inside. Security records their exit at the gate." : "This pass is already closed.",
      );
    const updated = await this.prisma.visitorPass.update({
      where: { id: pass.id, status: "ISSUED" },
      data: { status: "REVOKED", closedAt: new Date() },
    });
    return { pass: this.residentView(updated) };
  }

  // ---------------------------------------------------------------- gate

  private gateView(pass: VisitorPass, now = new Date()) {
    const visitor = this.visitor(pass);
    const exit = this.expectedExitAt(pass);
    const early = pass.status === "ISSUED" && now.getTime() < pass.validFrom.getTime() - EARLY_ARRIVAL_MS;
    return {
      passId: pass.id,
      status: pass.status,
      visitorName: visitor.name,
      visitorPhone: maskPhone(visitor.phone),
      destination: pass.destination,
      validFrom: pass.validFrom,
      validUntil: pass.validUntil,
      expectedMinutes: pass.expectedMinutes,
      checkedInAt: pass.checkedInAt,
      expectedExitAt: exit,
      overdue: pass.status === "CHECKED_IN" && !!exit && exit < now,
      /** What the guard can do next. */
      action: pass.status === "CHECKED_IN" ? "EXIT" : early ? "TOO_EARLY" : "ADMIT",
    };
  }

  private async recordFailure(facilityId: string, actorId: string, note: string) {
    await this.prisma.gateEvent.create({ data: { facilityId, actorUserId: actorId, type: "VERIFY_FAILED", note } });
  }

  async verify(actorId: string, facilityId: string, rawCode: string) {
    const since = new Date(Date.now() - FAILURE_WINDOW_MS);
    const [mine, estate] = await Promise.all([
      this.prisma.gateEvent.count({ where: { actorUserId: actorId, type: "VERIFY_FAILED", occurredAt: { gte: since } } }),
      this.prisma.gateEvent.count({ where: { facilityId, type: "VERIFY_FAILED", occurredAt: { gte: since } } }),
    ]);
    if (mine >= MAX_GUARD_FAILURES || estate >= MAX_ESTATE_FAILURES)
      throw new HttpException(
        "Too many incorrect codes. Wait 10 minutes, or call the resident to confirm the visitor.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    const code = normalizeVisitorCode(rawCode);
    if (!code) {
      await this.recordFailure(facilityId, actorId, "Not six digits");
      throw new BadRequestException("Enter the six-digit visitor code.");
    }
    const now = new Date();
    const pass = await this.prisma.visitorPass.findFirst({
      where: {
        facilityId,
        codeDigest: visitorCodeDigest(this.secret, facilityId, code),
        status: { in: ["ISSUED", "CHECKED_IN"] },
      },
    });
    if (!pass) {
      await this.recordFailure(facilityId, actorId, "No live pass");
      throw new NotFoundException("No valid visitor pass for this code at this estate.");
    }
    if (pass.status === "ISSUED" && pass.validUntil <= now) {
      await this.prisma.visitorPass.updateMany({ where: { id: pass.id, status: "ISSUED" }, data: { status: "EXPIRED", closedAt: now } });
      await this.recordFailure(facilityId, actorId, "Expired pass");
      throw new NotFoundException("This visitor pass has expired. Ask the resident to issue a new one.");
    }
    await this.prisma.gateEvent.create({ data: { facilityId, passId: pass.id, actorUserId: actorId, type: "VERIFIED" } });
    return { pass: this.gateView(pass, now) };
  }

  /** Every gate decision re-reads the pass under a row lock: the code alone is never permission. */
  private async decide(
    actorId: string,
    facilityId: string,
    passId: string,
    from: "ISSUED" | "CHECKED_IN",
    apply: (pass: VisitorPass, now: Date) => Prisma.VisitorPassUpdateInput,
    type: "ENTRY" | "DENIED" | "EXIT",
    note?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "VisitorPass" WHERE id = ${passId}::uuid FOR UPDATE`;
      const pass = await tx.visitorPass.findUnique({ where: { id: passId } });
      if (!pass || pass.facilityId !== facilityId) throw new NotFoundException("Visitor pass not found at this estate.");
      const now = new Date();
      if (pass.status !== from)
        throw new ConflictException(
          from === "ISSUED" ? "This pass has already been used or closed. Verify the code again." : "This visitor is not recorded as inside.",
        );
      if (type === "ENTRY") {
        if (pass.validUntil <= now) throw new ConflictException("This pass has expired.");
        if (now.getTime() < pass.validFrom.getTime() - EARLY_ARRIVAL_MS)
          throw new ConflictException("This visit has not started yet. Check the date with the resident.");
      }
      const updated = await tx.visitorPass.update({ where: { id: pass.id }, data: apply(pass, now) });
      await tx.gateEvent.create({ data: { facilityId, passId: pass.id, actorUserId: actorId, type, note: note?.trim() || null } });
      return { pass: this.gateView(updated, now) };
    });
  }

  admit(actorId: string, facilityId: string, passId: string) {
    return this.decide(actorId, facilityId, passId, "ISSUED", (_p, now) => ({
      status: "CHECKED_IN",
      checkedInAt: now,
      checkedInByUserId: actorId,
    }), "ENTRY");
  }

  deny(actorId: string, facilityId: string, passId: string, reason?: string) {
    return this.decide(actorId, facilityId, passId, "ISSUED", (_p, now) => ({ status: "DENIED", closedAt: now }), "DENIED", reason);
  }

  exit(actorId: string, facilityId: string, passId: string) {
    return this.decide(actorId, facilityId, passId, "CHECKED_IN", (_p, now) => ({
      status: "CHECKED_OUT",
      checkedOutAt: now,
      checkedOutByUserId: actorId,
      closedAt: now,
    }), "EXIT");
  }

  async manualEntry(actorId: string, facilityId: string, note: string) {
    const event = await this.prisma.gateEvent.create({
      data: { facilityId, actorUserId: actorId, type: "MANUAL_ENTRY", note: note.trim() },
    });
    return { id: event.id, occurredAt: event.occurredAt };
  }

  async gateBoard(facilityId: string) {
    const now = new Date();
    const [inside, events] = await Promise.all([
      this.prisma.visitorPass.findMany({
        where: { facilityId, status: "CHECKED_IN" },
        orderBy: { checkedInAt: "asc" },
        take: 200,
      }),
      this.prisma.gateEvent.findMany({
        where: { facilityId, occurredAt: { gte: startOfWatDay(now) }, type: { not: "VERIFIED" } },
        orderBy: { occurredAt: "desc" },
        take: 50,
        include: { pass: { select: { destination: true, visitorCiphertext: true } } },
      }),
    ]);
    return {
      observedAt: now,
      inside: inside.map((p) => this.gateView(p, now)),
      events: events.map((e) => ({
        id: e.id,
        type: e.type,
        occurredAt: e.occurredAt,
        destination: e.pass?.destination ?? null,
        visitorName: e.pass ? this.visitor(e.pass).name : null,
        note: e.note,
      })),
    };
  }

  /** Responders see visitors recorded inside for the household that raised the SOS. */
  async incidentVisitors(facilityId: string, incidentId: string) {
    const incident = await this.prisma.incident.findUnique({
      where: { id: incidentId },
      select: { facilityId: true, userId: true, createdAt: true },
    });
    if (!incident || incident.facilityId !== facilityId) throw new NotFoundException("Incident not found at this estate.");
    const since = new Date(incident.createdAt.getTime() - 12 * 60 * MINUTE);
    const passes = await this.prisma.visitorPass.findMany({
      where: {
        facilityId,
        hostUserId: incident.userId,
        OR: [{ status: "CHECKED_IN" }, { status: "CHECKED_OUT", checkedOutAt: { gte: since } }],
      },
      orderBy: { checkedInAt: "desc" },
      take: 20,
    });
    return {
      note: "Gate records only: entry and exit as recorded by security, not confirmed physical presence.",
      visitors: passes.map((p) => ({
        visitorName: this.visitor(p).name,
        destination: p.destination,
        status: p.status,
        checkedInAt: p.checkedInAt,
        checkedOutAt: p.checkedOutAt,
      })),
    };
  }

  // ---------------------------------------------------------------- estate admin

  async overview(facilityId: string) {
    const now = new Date();
    const today = startOfWatDay(now);
    const [facility, inside, entriesToday, issuedToday, overdue, openIncidents, events] = await Promise.all([
      this.prisma.facility.findUniqueOrThrow({
        where: { id: facilityId },
        select: { name: true, visitorDefaultMinutes: true, overstayGraceMinutes: true },
      }),
      this.prisma.visitorPass.count({ where: { facilityId, status: "CHECKED_IN" } }),
      this.prisma.gateEvent.count({ where: { facilityId, type: "ENTRY", occurredAt: { gte: today } } }),
      this.prisma.visitorPass.count({ where: { facilityId, createdAt: { gte: today } } }),
      this.prisma.visitorPass.count({ where: { facilityId, status: "CHECKED_IN", overstayAlertedAt: { not: null } } }),
      this.prisma.incident.count({ where: { facilityId, status: { in: ["OPEN", "ACKNOWLEDGED"] } } }),
      this.prisma.gateEvent.findMany({
        where: { facilityId, type: { in: ["ENTRY", "EXIT", "DENIED", "OVERSTAY", "MANUAL_ENTRY"] } },
        orderBy: { occurredAt: "desc" },
        take: 15,
        include: { pass: { select: { destination: true } } },
      }),
    ]);
    return {
      observedAt: now,
      estate: facility.name,
      settings: { visitorDefaultMinutes: facility.visitorDefaultMinutes, overstayGraceMinutes: facility.overstayGraceMinutes },
      totals: { inside, entriesToday, issuedToday, departureUnconfirmed: overdue, openIncidents },
      recent: events.map((e) => ({ type: e.type, occurredAt: e.occurredAt, destination: e.pass?.destination ?? null, note: e.note })),
    };
  }

  async updateSettings(facilityId: string, dto: EstateSettingsDto) {
    const updated = await this.prisma.facility.update({
      where: { id: facilityId },
      data: { visitorDefaultMinutes: dto.visitorDefaultMinutes, overstayGraceMinutes: dto.overstayGraceMinutes },
      select: { visitorDefaultMinutes: true, overstayGraceMinutes: true },
    });
    return { settings: updated };
  }

  // ---------------------------------------------------------------- background

  /**
   * Marks departures not confirmed after expected exit + the estate's grace,
   * and expires unused passes. Idempotent, so two running instances are safe.
   */
  async sweep(now = new Date()) {
    const flagged = await this.prisma.$queryRaw<{ id: string; facilityId: string }[]>`
      UPDATE "VisitorPass" p SET "overstayAlertedAt" = ${now}, "updatedAt" = ${now}
      FROM "Facility" f
      WHERE f.id = p."facilityId" AND p.status = 'CHECKED_IN' AND p."overstayAlertedAt" IS NULL
        AND p."checkedInAt" + make_interval(mins => p."expectedMinutes" + f."overstayGraceMinutes") < ${now}
      RETURNING p.id, p."facilityId"`;
    if (flagged.length)
      await this.prisma.gateEvent.createMany({
        data: flagged.map((f) => ({ facilityId: f.facilityId, passId: f.id, type: "OVERSTAY" as const, note: "Departure not confirmed" })),
      });
    const expired = await this.prisma.visitorPass.updateMany({
      where: { status: "ISSUED", validUntil: { lte: now } },
      data: { status: "EXPIRED", closedAt: now },
    });
    return { overstays: flagged.length, expired: expired.count };
  }
}
