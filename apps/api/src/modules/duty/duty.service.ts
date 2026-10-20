import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { DutyReportOrigin, DutyShiftEnd, IncidentStatus, Prisma, StaffPhotoStatus, UserRole } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { EmailProvider } from "../notifications/providers/email.provider";
import { buildDocument, documentDigest, type DutyDocument, type DutySection, type HandoverItem } from "./duty-document";

export const MAX_SHIFT_HOURS = 12;
const LIVE: IncidentStatus[] = [IncidentStatus.OPEN, IncidentStatus.ACKNOWLEDGED];

export type SubmitInput = { notes?: string; handoverItems?: HandoverItem[] };

/**
 * OPA Duty Reports. A duty shift is a REPORTING record only: nothing in the
 * incident queue, acknowledgement or any SOS path reads it, so starting (or
 * not starting) duty can never interrupt emergency response.
 */
@Injectable()
export class DutyService {
  private readonly logger = new Logger(DutyService.name);
  constructor(private readonly prisma: PrismaService, private readonly email: EmailProvider) {}

  private async operator(userId: string) {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, facilityId: true, isActive: true, membershipState: true, photoStatus: true, firstName: true, lastName: true },
    });
    if (!u || !u.isActive || u.membershipState !== "ACTIVE" || !u.facilityId || u.role !== UserRole.FACILITY_OPERATOR) {
      throw new ForbiddenException("Duty reports are for active facility operators.");
    }
    return u as typeof u & { facilityId: string };
  }

  async current(userId: string) {
    const op = await this.operator(userId);
    const shift = await this.prisma.dutyShift.findFirst({ where: { operatorId: op.id, endedAt: null }, select: { id: true, startedAt: true } });
    const missing = await this.prisma.dutyShift.findMany({
      where: { operatorId: op.id, endedBy: DutyShiftEnd.SYSTEM, reports: { none: { origin: DutyReportOrigin.OPERATOR_SUBMITTED } } },
      select: { id: true, startedAt: true, endedAt: true },
      orderBy: { startedAt: "desc" },
      take: 5,
    });
    return {
      shift: shift ? { id: shift.id, startedAt: shift.startedAt.toISOString() } : null,
      photoApproved: op.photoStatus === StaffPhotoStatus.APPROVED,
      reportsMissing: missing.map((m) => ({ shiftId: m.id, startedAt: m.startedAt.toISOString(), endedAt: m.endedAt!.toISOString() })),
      maxShiftHours: MAX_SHIFT_HOURS,
    };
  }

  async start(userId: string) {
    const op = await this.operator(userId);
    if (op.photoStatus !== StaffPhotoStatus.APPROVED) {
      // Only the reporting record is refused. The incident queue stays open.
      throw new ConflictException({ code: "PHOTO_REQUIRED", message: "Add a profile photo (approved by your Facility Admin) to start a duty shift. You can still respond to every emergency." });
    }
    try {
      const shift = await this.prisma.$transaction(async (tx) => {
        const s = await tx.dutyShift.create({ data: { facilityId: op.facilityId, operatorId: op.id }, select: { id: true, startedAt: true } });
        await tx.administrativeAuditEvent.create({ data: { actorUserId: op.id, actorRole: op.role, action: "DUTY_SHIFT_STARTED", resourceId: s.id, facilityId: op.facilityId } });
        return s;
      });
      return { id: shift.id, startedAt: shift.startedAt.toISOString() };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ConflictException({ code: "SHIFT_OPEN", message: "You already have a duty shift in progress." });
      throw e;
    }
  }

  /** Builds the summary from authoritative records for [from, to]. */
  async prepare(facilityId: string, from: Date, to: Date): Promise<DutyDocument> {
    const facility = await this.prisma.facility.findUnique({ where: { id: facilityId }, select: { type: true } });
    if (!facility) throw new NotFoundException("Facility not found.");
    const incidents = await this.prisma.incident.findMany({
      where: {
        facilityId,
        createdAt: { lte: to },
        OR: [
          { createdAt: { gte: from } },
          // Carried over: raised earlier, still open when the shift started.
          { createdAt: { lt: from }, OR: [{ status: { in: LIVE } }, { resolvedAt: { gte: from } }] },
        ],
      },
      select: { id: true, trigger: true, status: true, createdAt: true, resolvedAt: true },
      take: 500,
    });
    const acknowledgements = incidents.length
      ? await this.prisma.incidentTimelineEvent.findMany({
          where: { incidentId: { in: incidents.map((i) => i.id) }, type: "OPERATOR_ACKNOWLEDGED", source: "COMMAND_CENTER", actorUserId: { not: null }, occurredAt: { lte: to } },
          select: { incidentId: true, occurredAt: true },
        })
      : [];
    const sections: DutySection[] = [];
    const gate = await this.prisma.gateEvent.groupBy({ by: ["type"], where: { facilityId, occurredAt: { gte: from, lte: to } }, _count: { _all: true } });
    const passes = await this.prisma.visitorPass.count({ where: { facilityId } });
    if (passes > 0 || gate.length > 0) {
      const c = (t: string) => gate.find((g) => g.type === t)?._count._all ?? 0;
      sections.push({ key: "visitors", entries: c("ENTRY"), exits: c("EXIT"), denied: c("DENIED"), overstays: c("OVERSTAY"), manualEntries: c("MANUAL_ENTRY") });
    }
    const started = await this.prisma.journeySession.count({ where: { user: { facilityId }, startedAt: { gte: from, lte: to } } });
    const emergencies = await this.prisma.journeySession.count({ where: { user: { facilityId }, safeWalkEmergencyAt: { gte: from, lte: to } } });
    if (started || emergencies) sections.push({ key: "safewalk", started, emergencies });
    return buildDocument({ facilityType: facility.type, from, to, incidents: incidents.map((i) => ({ ...i, trigger: String(i.trigger), status: String(i.status) })), acknowledgements, sections });
  }

  async preview(userId: string) {
    const op = await this.operator(userId);
    const shift = await this.prisma.dutyShift.findFirst({ where: { operatorId: op.id, endedAt: null } });
    if (!shift) throw new BadRequestException("No duty shift in progress.");
    return this.prepare(op.facilityId, shift.startedAt, new Date());
  }

  /** Operator ends the shift and submits. Also accepts a late report for a shift OPA closed. */
  async submit(userId: string, input: SubmitInput, shiftId?: string) {
    const op = await this.operator(userId);
    const notes = input.notes?.trim() || null;
    if (notes && notes.length > 4000) throw new BadRequestException("Notes are limited to 4000 characters.");
    const handover = (input.handoverItems ?? []).map((h) => ({ text: String(h.text ?? "").trim().slice(0, 500), category: h.category })).filter((h) => h.text);
    if (handover.length > 50) throw new BadRequestException("At most 50 handover items.");
    if (handover.some((h) => !["HANDOVER", "UNRESOLVED", "OBSERVATION"].includes(h.category))) throw new BadRequestException("Unknown handover category.");

    const now = new Date();
    const report = await this.prisma.$transaction(async (tx) => {
      const shift = shiftId
        ? await tx.dutyShift.findFirst({ where: { id: shiftId, operatorId: op.id } })
        : await tx.dutyShift.findFirst({ where: { operatorId: op.id, endedAt: null } });
      if (!shift) throw new BadRequestException("No duty shift to report on.");
      const already = await tx.dutyReport.findFirst({ where: { shiftId: shift.id, origin: DutyReportOrigin.OPERATOR_SUBMITTED } });
      if (already) throw new ConflictException({ code: "ALREADY_SUBMITTED", message: "This shift's report was already submitted." });
      let endedAt = shift.endedAt;
      const late = shift.endedBy === DutyShiftEnd.SYSTEM;
      if (!endedAt) {
        const closed = await tx.dutyShift.updateMany({ where: { id: shift.id, endedAt: null }, data: { endedAt: now, endedBy: DutyShiftEnd.OPERATOR } });
        if (closed.count !== 1) throw new ConflictException("The shift was just closed. Try again.");
        endedAt = now;
      }
      const doc = await this.prepare(op.facilityId, shift.startedAt, endedAt);
      const r = await tx.dutyReport.create({
        data: {
          shiftId: shift.id, facilityId: op.facilityId, version: 1, origin: DutyReportOrigin.OPERATOR_SUBMITTED,
          submittedById: op.id, late, sourceCutoff: endedAt, sourceDigest: documentDigest(doc),
          document: doc as unknown as Prisma.InputJsonValue, notes,
          handoverItems: handover.length ? (handover as unknown as Prisma.InputJsonValue) : undefined,
        },
        select: { id: true, submittedAt: true, late: true },
      });
      await tx.administrativeAuditEvent.create({ data: { actorUserId: op.id, actorRole: op.role, action: "DUTY_REPORT_SUBMITTED", resourceId: r.id, facilityId: op.facilityId, afterState: { shiftId: shift.id, late } } });
      return { ...r, doc, startedAt: shift.startedAt, endedAt };
    });
    const emailed = await this.notifyAdmins(op.facilityId, `${op.firstName} ${op.lastName}`.trim(), report.doc, notes, handover, report.late);
    return { id: report.id, submittedAt: report.submittedAt.toISOString(), late: report.late, adminsNotified: emailed };
  }

  /** Emails active Facility Admins. Addresses are looked up here and never returned to the operator. */
  private async notifyAdmins(facilityId: string, operatorName: string, doc: DutyDocument, notes: string | null, handover: HandoverItem[], late: boolean): Promise<number> {
    const [facility, admins] = await Promise.all([
      this.prisma.facility.findUnique({ where: { id: facilityId }, select: { name: true } }),
      this.prisma.user.findMany({ where: { facilityId, role: UserRole.FACILITY_ADMIN, isActive: true, membershipState: "ACTIVE" }, select: { email: true } }),
    ]);
    const t = doc.totals;
    const lines = [
      `OPA Duty Report: ${facility?.name ?? "your facility"}`,
      `Operator: ${operatorName}${late ? " (submitted late; OPA closed this shift)" : ""}`,
      `Shift: ${doc.window.from} to ${doc.window.to} (UTC)`,
      "",
      `Incidents raised this shift: ${t.raised}`,
      `Carried over from earlier: ${t.carriedOver}`,
      `Acknowledged in the Command Center: ${t.acknowledged}`,
      `Not acknowledged or unknown: ${t.notAcknowledgedOrUnknown}`,
      `Still open at end of shift: ${t.stillOpenAtCutoff}`,
      ...doc.sections.map((s) => (s.key === "visitors" ? `Visitors: ${s.entries} entries, ${s.exits} exits, ${s.denied} denied, ${s.overstays} departures not confirmed` : `SafeWalk: ${s.started} started, ${s.emergencies} emergencies`)),
      "",
      notes ? `Operator notes:\n${notes}` : "Operator notes: none",
      ...(handover.length ? ["", "Handover:", ...handover.map((h) => `- [${h.category}] ${h.text}`)] : []),
      "",
      "Open the Command Center → Reports / Analytics → Duty Reports to review and acknowledge.",
      "No resident contact details are included in this email.",
    ];
    let sent = 0;
    for (const a of admins) {
      try {
        const r = await this.email.send({ recipient: a.email, subject: `OPA Duty Report: ${facility?.name ?? "facility"}`, message: lines.join("\n") });
        if (r.success) sent++;
      } catch (error) {
        this.logger.warn(`duty report email failed: ${error instanceof Error ? error.name : "unknown"}`);
      }
    }
    return sent;
  }

  /** Backup: closes shifts past MAX_SHIFT_HOURS and records a SYSTEM_GENERATED summary. */
  async sweep(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - MAX_SHIFT_HOURS * 3600_000);
    const stale = await this.prisma.dutyShift.findMany({ where: { endedAt: null, startedAt: { lte: cutoff } }, select: { id: true, facilityId: true, startedAt: true, operatorId: true }, take: 50 });
    let n = 0;
    for (const s of stale) {
      const endedAt = new Date(s.startedAt.getTime() + MAX_SHIFT_HOURS * 3600_000);
      await this.prisma.$transaction(async (tx) => {
        const closed = await tx.dutyShift.updateMany({ where: { id: s.id, endedAt: null }, data: { endedAt, endedBy: DutyShiftEnd.SYSTEM } });
        if (closed.count !== 1) return;
        const doc = await this.prepare(s.facilityId, s.startedAt, endedAt);
        const r = await tx.dutyReport.create({
          data: { shiftId: s.id, facilityId: s.facilityId, version: 1, origin: DutyReportOrigin.SYSTEM_GENERATED, sourceCutoff: endedAt, sourceDigest: documentDigest(doc), document: doc as unknown as Prisma.InputJsonValue },
          select: { id: true },
        });
        await tx.administrativeAuditEvent.create({ data: { actorUserId: s.operatorId, actorRole: "SYSTEM", action: "DUTY_REPORT_SYSTEM_GENERATED", resourceId: r.id, facilityId: s.facilityId, reason: "Shift reached its maximum length without an operator report. The operator report is still required." } });
        n++;
      });
    }
    return n;
  }

  /** Reports for a facility: admins see all; an operator sees their own. */
  async list(viewerId: string, facilityId: string, ownOnly: boolean) {
    const shifts = await this.prisma.dutyShift.findMany({
      where: { facilityId, ...(ownOnly ? { operatorId: viewerId } : {}) },
      orderBy: { startedAt: "desc" },
      take: 50,
      select: {
        id: true, startedAt: true, endedAt: true, endedBy: true,
        operator: { select: { firstName: true, lastName: true } },
        reports: { orderBy: [{ origin: "asc" }, { version: "desc" }], select: { id: true, origin: true, submittedAt: true, late: true, acknowledgedAt: true, document: true } },
      },
    });
    return shifts.map((s) => {
      const operatorReport = s.reports.find((r) => r.origin === DutyReportOrigin.OPERATOR_SUBMITTED) ?? null;
      const systemReport = s.reports.find((r) => r.origin === DutyReportOrigin.SYSTEM_GENERATED) ?? null;
      const status = !s.endedAt ? "IN_PROGRESS" : operatorReport ? (operatorReport.late ? "SUBMITTED_LATE" : "SUBMITTED") : "OPERATOR_REPORT_MISSING";
      const t = (operatorReport ?? systemReport)?.document as unknown as DutyDocument | undefined;
      return {
        shiftId: s.id,
        operatorName: `${s.operator.firstName} ${s.operator.lastName}`.trim(),
        startedAt: s.startedAt.toISOString(),
        endedAt: s.endedAt?.toISOString() ?? null,
        endedBy: s.endedBy,
        status,
        operatorReport: operatorReport && { id: operatorReport.id, submittedAt: operatorReport.submittedAt.toISOString(), late: operatorReport.late, acknowledged: !!operatorReport.acknowledgedAt },
        systemReport: systemReport && { id: systemReport.id, generatedAt: systemReport.submittedAt.toISOString(), label: "Generated by OPA. Not submitted by an operator." },
        totals: t?.totals ?? null,
      };
    });
  }

  async read(viewerId: string, facilityId: string, reportId: string, ownOnly: boolean) {
    const r = await this.prisma.dutyReport.findFirst({
      where: { id: reportId, facilityId, ...(ownOnly ? { shift: { operatorId: viewerId } } : {}) },
      select: { id: true, origin: true, submittedAt: true, late: true, sourceCutoff: true, sourceDigest: true, document: true, notes: true, handoverItems: true, acknowledgedAt: true, shift: { select: { startedAt: true, endedAt: true, endedBy: true, operator: { select: { firstName: true, lastName: true } } } } },
    });
    if (!r) throw new NotFoundException("Duty report not found.");
    // Records referenced by the report may have changed since; say so, never merge silently.
    const doc = r.document as unknown as DutyDocument;
    const ids = [...doc.incidents.raised, ...doc.incidents.carriedOver].map((i) => i.id);
    const now = ids.length ? await this.prisma.incident.findMany({ where: { id: { in: ids } }, select: { id: true, status: true } }) : [];
    const changedSinceReport = [...doc.incidents.raised, ...doc.incidents.carriedOver].filter((i) => now.find((n) => n.id === i.id)?.status !== i.status).map((i) => i.reference);
    return {
      id: r.id,
      origin: r.origin,
      label: r.origin === DutyReportOrigin.SYSTEM_GENERATED ? "Generated by OPA. Not submitted by an operator." : r.late ? "Submitted by the operator (late)" : "Submitted by the operator",
      operatorName: `${r.shift.operator.firstName} ${r.shift.operator.lastName}`.trim(),
      submittedAt: r.submittedAt.toISOString(),
      sourceCutoff: r.sourceCutoff.toISOString(),
      sourceDigest: r.sourceDigest,
      document: doc,
      notes: r.notes,
      handoverItems: r.handoverItems ?? [],
      acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
      changedSinceReport,
    };
  }

  /** Facility Admin acknowledges an operator report. The report itself never changes. */
  async acknowledge(adminId: string, facilityId: string, reportId: string) {
    const r = await this.prisma.dutyReport.findFirst({ where: { id: reportId, facilityId }, select: { id: true, origin: true, acknowledgedAt: true } });
    if (!r) throw new NotFoundException("Duty report not found.");
    if (r.origin !== DutyReportOrigin.OPERATOR_SUBMITTED) throw new BadRequestException("Only operator-submitted reports are acknowledged. The operator report for this shift is still missing.");
    if (r.acknowledgedAt) return { acknowledgedAt: r.acknowledgedAt.toISOString() };
    const at = new Date();
    await this.prisma.$transaction([
      this.prisma.dutyReport.update({ where: { id: r.id }, data: { acknowledgedById: adminId, acknowledgedAt: at } }),
      this.prisma.administrativeAuditEvent.create({ data: { actorUserId: adminId, actorRole: UserRole.FACILITY_ADMIN, action: "DUTY_REPORT_ACKNOWLEDGED", resourceId: r.id, facilityId } }),
    ]);
    return { acknowledgedAt: at.toISOString() };
  }
}
