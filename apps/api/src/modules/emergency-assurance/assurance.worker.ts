import { Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { SmsProvider } from "../notifications/providers/sms.provider";
import { sendFromShortcode } from "../emergency-delivery/sms-reply";
import { contactPhoneHash } from "../journey/safewalk-consent";
import { toE164 } from "../../shared/phone/normalize-phone-number";
import { outboundDenial } from "../notifications/outbound-environment";
import {
  ACTIVE_STATUSES,
  ASSURANCE_WINDOW_MS,
  askText,
  contactAssuranceEnabled,
  reminderText,
  securityEscalationEnabled,
  securityEscalationText,
  timings,
  voiceConfigured,
} from "./assurance-policy";

const MAX_CALLS_PER_INCIDENT = 5;
const SECURITY_WINDOW_MS = 60 * 60_000;

/**
 * Runs after an SOS has already gone out. Every step is claimed with a
 * conditional update first (at most once, even across several API instances
 * or a restart), and every step re-checks that the incident is still open.
 */
@Injectable()
export class EmergencyAssuranceWorker {
  private readonly log = new Logger("EmergencyAssurance");
  private running = false;
  constructor(private readonly prisma: PrismaService, private readonly sms: SmsProvider) {}

  @Interval(5000)
  async tick() {
    if (this.running || (!contactAssuranceEnabled() && !securityEscalationEnabled())) return;
    this.running = true;
    try {
      await this.run(new Date());
    } catch {
      this.log.error("assurance pass failed; it will run again");
    } finally {
      this.running = false;
    }
  }

  async run(now: Date) {
    if (securityEscalationEnabled()) await this.escalateUnacknowledged(now);
    if (!contactAssuranceEnabled()) return;
    await this.closeEnded(now);
    await this.seed(now);
    await this.ask(now);
    await this.remindAndCall(now);
  }

  /** One row per contact who was sent the SOS text. */
  async seed(now: Date) {
    const incidents = await this.prisma.incident.findMany({
      where: { status: { in: [...ACTIVE_STATUSES] }, createdAt: { gt: new Date(now.getTime() - ASSURANCE_WINDOW_MS) }, contactAssurances: { none: {} } },
      take: 20,
      select: { id: true, notifications: { where: { channel: "SMS", contactId: { not: null } }, select: { contactId: true } } },
    });
    for (const incident of incidents) {
      const ids = [...new Set(incident.notifications.map((n) => n.contactId!))];
      if (!ids.length) continue;
      const contacts = await this.prisma.emergencyContact.findMany({ where: { id: { in: ids } }, select: { id: true, phoneNumber: true, relationship: true } });
      const rows = contacts
        .map((c) => ({ incidentId: incident.id, emergencyContactId: c.id, phoneHash: contactPhoneHash(c.phoneNumber), relationship: (c.relationship || "Contact").slice(0, 40) }))
        .filter((r): r is typeof r & { phoneHash: string } => !!r.phoneHash);
      if (rows.length) await this.prisma.incidentContactAssurance.createMany({ data: rows, skipDuplicates: true });
    }
  }

  async closeEnded(now: Date) {
    await this.prisma.incidentContactAssurance.updateMany({
      where: { closedAt: null, incident: { status: { notIn: [...ACTIVE_STATUSES] } } },
      data: { closedAt: now },
    });
  }

  private async contactFor(row: { emergencyContactId: string | null; phoneHash: string }) {
    if (!row.emergencyContactId) return null;
    const contact = await this.prisma.emergencyContact.findUnique({ where: { id: row.emergencyContactId }, select: { phoneNumber: true } });
    // A number changed since the alert is not the person who was alerted.
    if (!contact || contactPhoneHash(contact.phoneNumber) !== row.phoneHash) return null;
    return toE164(contact.phoneNumber);
  }

  async ask(now: Date) {
    const rows = await this.prisma.incidentContactAssurance.findMany({
      where: { askSentAt: null, closedAt: null, confirmedAt: null, createdAt: { gt: new Date(now.getTime() - ASSURANCE_WINDOW_MS) } },
      take: 50,
      include: { incident: { select: { user: { select: { firstName: true } } } } },
    });
    for (const row of rows) {
      const claimed = await this.prisma.incidentContactAssurance.updateMany({ where: { id: row.id, askSentAt: null }, data: { askSentAt: now } });
      if (claimed.count !== 1) continue;
      const to = await this.contactFor(row);
      if (to) await sendFromShortcode(to, askText(row.incident.user.firstName || "your contact"));
    }
  }

  /** Only when NOBODY alerted for this incident has confirmed. */
  async remindAndCall(now: Date) {
    const { reminderMs, voiceMs } = timings();
    const incidents = await this.prisma.incident.findMany({
      where: {
        status: { in: [...ACTIVE_STATUSES] },
        createdAt: { lte: new Date(now.getTime() - reminderMs), gt: new Date(now.getTime() - ASSURANCE_WINDOW_MS) },
        contactAssurances: { some: {}, none: { confirmedAt: { not: null } } },
      },
      take: 20,
      select: { id: true, createdAt: true, user: { select: { firstName: true } }, contactAssurances: { where: { closedAt: null } }, notifications: { where: { channel: "SMS" }, select: { contactId: true, payload: true } } },
    });
    for (const incident of incidents) {
      const name = incident.user.firstName || "your contact";
      const voiceDue = now.getTime() - incident.createdAt.getTime() >= voiceMs;
      let calls = incident.contactAssurances.filter((r) => r.voiceCallAt).length;
      for (const row of incident.contactAssurances) {
        if (!row.reminderSentAt) {
          const claimed = await this.prisma.incidentContactAssurance.updateMany({ where: { id: row.id, reminderSentAt: null, confirmedAt: null }, data: { reminderSentAt: now } });
          const to = claimed.count === 1 ? await this.contactFor(row) : null;
          if (to) {
            const payload = incident.notifications.find((n) => n.contactId === row.emergencyContactId)?.payload as { trackingUrl?: string } | null | undefined;
            const url = typeof payload?.trackingUrl === "string" && payload.trackingUrl.startsWith("https://") ? payload.trackingUrl : null;
            const viaShortcode = await sendFromShortcode(to, reminderText(name, url));
            if (viaShortcode === "SKIPPED") await this.sms.send({ recipient: to, message: reminderText(name, url).replace(/ Reply .*$/, "") });
          }
        } else if (voiceDue && !row.voiceCallAt && voiceConfigured() && calls < MAX_CALLS_PER_INCIDENT) {
          const claimed = await this.prisma.incidentContactAssurance.updateMany({ where: { id: row.id, voiceCallAt: null, confirmedAt: null }, data: { voiceCallAt: now } });
          if (claimed.count !== 1) continue;
          calls++;
          const to = await this.contactFor(row);
          const outcome = to ? await placeCall(to) : "NUMBER_UNAVAILABLE";
          await this.prisma.incidentContactAssurance.update({ where: { id: row.id }, data: { voiceOutcome: outcome } });
        }
      }
    }
  }

  /** Security path: an SOS nobody on duty has acknowledged. Independent of contacts. */
  async escalateUnacknowledged(now: Date) {
    const { securityAckMs } = timings();
    const incidents = await this.prisma.incident.findMany({
      where: {
        status: "OPEN",
        facilityId: { not: null },
        createdAt: { lte: new Date(now.getTime() - securityAckMs), gt: new Date(now.getTime() - SECURITY_WINDOW_MS) },
        securityEscalation: null,
      },
      take: 20,
      select: { id: true, createdAt: true, facilityId: true, facility: { select: { name: true } } },
    });
    for (const incident of incidents) {
      const admins = await this.prisma.user.findMany({
        where: { facilityId: incident.facilityId!, role: "FACILITY_ADMIN", isActive: true, accountStatus: "ACTIVE", membershipState: "ACTIVE" },
        select: { phoneNumber: true },
      });
      try {
        await this.prisma.incidentSecurityEscalation.create({ data: { incidentId: incident.id, facilityId: incident.facilityId!, notifiedAt: now, recipients: admins.length } });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue;
        throw error;
      }
      const waited = Math.max(1, Math.round((now.getTime() - incident.createdAt.getTime()) / 60_000));
      let sent = 0;
      for (const admin of admins) {
        if (!admin.phoneNumber) continue;
        const result = await this.sms.send({ recipient: admin.phoneNumber, message: securityEscalationText(incident.facility?.name ?? "your site", waited) }).catch(() => null);
        if (result?.success) sent++;
      }
      await this.prisma.incidentSecurityEscalation.update({ where: { incidentId: incident.id }, data: { sent } });
    }
  }
}

/** Africa's Talking outbound call. The spoken script is served by the voice callback. */
export async function placeCall(to: string): Promise<string> {
  try {
    if (await outboundDenial("VOICE", to)) return "POLICY_DENIED";
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const AfricasTalking = require("africastalking");
    const voice = AfricasTalking({ apiKey: process.env.AFRICASTALKING_API_KEY, username: process.env.AFRICASTALKING_USERNAME }).VOICE;
    const result = await voice.call({ callFrom: process.env.AFRICASTALKING_VOICE_NUMBER, callTo: [to] });
    const entry = result?.entries?.[0] as { status?: string } | undefined;
    return entry?.status === "Queued" ? "QUEUED" : `FAILED_${String(entry?.status ?? result?.errorMessage ?? "UNKNOWN").slice(0, 30)}`;
  } catch {
    return "FAILED_REQUEST";
  }
}
