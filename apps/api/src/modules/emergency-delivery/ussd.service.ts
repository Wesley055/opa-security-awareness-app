import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { toE164 } from "../../shared/phone/normalize-phone-number";
import { IncidentOrchestratorService } from "../incident-orchestrator/incident-orchestrator.service";
import { IncidentTimelineService } from "../incident-timeline/incident-timeline.service";
import { ActivationMode, ActivationSource, EmergencyTriggerType, TriggerMode } from "../emergency-detection/dto/trigger-request.dto";
import { msisdnHash, ussdEnabled } from "./delivery-identity";
import { enabledLanguages, USSD_TEXT, type UssdLanguage, type UssdText } from "./ussd-text";

export interface UssdRequest {
  sessionId?: string;
  serviceCode?: string;
  phoneNumber?: string;
  text?: string;
  networkCode?: string;
}

const MAX_SOS_SESSIONS_PER_HOUR = 3;
const LAST_FIX_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const con = (s: string) => `CON ${s}`;
const end = (s: string) => `END ${s}`;

/** A stable UUID v4 per USSD session, so a retried "Yes, send" reconciles instead of duplicating. */
export function sessionActivationId(sessionId: string): string {
  const h = createHash("sha256").update(`opa-ussd:${sessionId}`).digest("hex").split("");
  h[12] = "4";
  h[16] = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  const x = h.join("");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

/**
 * USSD SOS. Send first, ask after: the alert exists as soon as the person
 * answers "1 Yes, send"; the questions that follow only add to it, so a
 * dropped session never loses the SOS. No PIN (owner decision 23 Oct); the
 * number is the one the mobile network reports, recorded as USSD_NUMBER,
 * which is not proof of identity. Ending an emergency is never offered here.
 */
@Injectable()
export class UssdService {
  private readonly log = new Logger("Ussd");

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly orchestrator: IncidentOrchestratorService,
    private readonly timeline: IncidentTimelineService,
  ) {}

  async handle(request: UssdRequest, now = new Date()): Promise<string> {
    const languages = enabledLanguages();
    if (!ussdEnabled()) return end(USSD_TEXT.en.unavailable);
    const sessionId = (request.sessionId ?? "").slice(0, 120);
    const text = typeof request.text === "string" ? request.text : "";
    if (!sessionId || !request.phoneNumber || text.length > 200) return end(USSD_TEXT.en.invalid);
    let e164: string;
    try {
      e164 = toE164(request.phoneNumber);
    } catch {
      return end(USSD_TEXT.en.notRegistered);
    }
    const hash = msisdnHash(this.config.getOrThrow<string>("PII_LOOKUP_KEY"), e164);
    const user = await this.prisma.user.findUnique({
      where: { phoneNumber: e164 },
      select: { id: true, role: true, isActive: true, accountStatus: true, preferredLanguage: true },
    });
    const lang: UssdLanguage = languages.includes(user?.preferredLanguage as UssdLanguage) ? (user!.preferredLanguage as UssdLanguage) : "en";
    const t = USSD_TEXT[lang];

    const session = await this.prisma.ussdSession.upsert({
      where: { sessionId },
      create: { sessionId, msisdnHash: hash, userId: user?.id ?? null, step: "START", language: lang },
      update: {},
    });
    // A session belongs to the number that opened it.
    if (session.msisdnHash !== hash) return end(t.invalid);
    const step = async (name: string, outcome?: string, incidentId?: string) => {
      await this.prisma.ussdSession.update({ where: { id: session.id }, data: { step: name, ...(outcome ? { outcome } : {}), ...(incidentId ? { incidentId } : {}) } });
    };

    // Residents only: an SOS must reach a security team.
    if (!user || !user.isActive || user.accountStatus !== "ACTIVE" || user.role !== "USER") {
      await step("END", "NOT_REGISTERED");
      return end(t.notRegistered);
    }

    const parts = text === "" ? [] : text.split("*");
    const [first, second, third, fourth, fifth] = parts;

    if (parts.length === 0) {
      await step("MAIN");
      return con(languages.length > 1 ? t.main : t.main.split("\n").slice(0, 2).join("\n"));
    }

    if (first === "2" && languages.length > 1) {
      if (parts.length === 1) return con(t.language);
      const chosen: UssdLanguage | null = second === "1" ? "en" : second === "2" ? "ha" : null;
      if (!chosen || !languages.includes(chosen)) return end(t.invalid);
      await this.prisma.user.update({ where: { id: user.id }, data: { preferredLanguage: chosen } });
      await step("END", "LANGUAGE_SET");
      return end(USSD_TEXT[chosen].languageSaved);
    }

    if (first !== "1") return end(t.invalid);
    if (parts.length === 1) {
      await step("CONFIRM");
      return con(t.confirm);
    }
    if (second === "2") {
      await step("END", "CANCELLED");
      return end(t.cancelled);
    }
    if (second !== "1") return end(t.invalid);

    // "1*1": send the SOS (once per session; a retry reconciles).
    let incidentId = session.incidentId;
    if (!incidentId) {
      const created = await this.prisma.ussdSession.count({
        where: { msisdnHash: hash, outcome: "SOS_SENT", createdAt: { gt: new Date(now.getTime() - 60 * 60 * 1000) } },
      });
      if (created >= MAX_SOS_SESSIONS_PER_HOUR) {
        await step("END", "RATE_LIMITED");
        return end(t.alreadyActive);
      }
      try {
        const result = await this.orchestrator.createCoordinatedIncident(
          user.id,
          {
            triggerType: EmergencyTriggerType.SOS_BUTTON,
            mode: TriggerMode.IMMEDIATE,
            activationMode: ActivationMode.STANDARD,
            activationSource: "USSD" as ActivationSource,
            userConfirmed: true,
            isOffline: true,
            activationId: sessionActivationId(sessionId),
            pressedAt: now.toISOString(),
          },
          { channel: "USSD", verification: "USSD_NUMBER" },
        );
        incidentId = (result as { incident?: { id?: string } | null }).incident?.id ?? null;
        if (!incidentId) throw new Error("no incident");
        await step("WHERE", "SOS_SENT", incidentId);
        await this.recordLastKnownLocation(user.id, incidentId, now);
      } catch (error) {
        this.log.error(`USSD SOS failed for session ${session.id}: ${error instanceof Error ? error.name : "unknown"}`);
        await step("END", "FAILED");
        return end(t.unavailable);
      }
    }

    const places = await this.prisma.savedPlace.findMany({ where: { userId: user.id }, orderBy: { position: "asc" }, take: 4 });
    if (parts.length === 2) return con(t.where(places.map((p) => p.label)));

    // "1*1*<place>"
    if (parts.length === 3) {
      if (third === "9") return con(t.landmark);
      if (third !== "0") {
        const place = places[Number(third) - 1];
        if (!place) return con(t.where(places.map((p) => p.label)));
        await this.event(incidentId, user.id, "USSD_LOCATION", {
          source: "SAVED_PLACE",
          label: place.label,
          description: place.description,
          latitude: place.latitude?.toString() ?? null,
          longitude: place.longitude?.toString() ?? null,
          verified: false,
        });
      }
      return con(t.canCall);
    }

    // "1*1*9*<landmark>" -> ask about calling; "1*1*<n>*<answer>" -> done
    if (third === "9" && parts.length === 4) {
      const landmark = (fourth ?? "").trim().slice(0, 80);
      if (landmark && landmark !== "0")
        await this.event(incidentId, user.id, "USSD_LOCATION", { source: "TYPED_LANDMARK", landmark, verified: false });
      return con(t.canCall);
    }
    const answer = third === "9" ? fifth : fourth;
    if (answer === "1" || answer === "2") {
      await this.event(incidentId, user.id, "USSD_CALLBACK_PREFERENCE", { canCall: answer === "1" });
      await step("END", "COMPLETED");
      return end(answer === "1" ? t.done : t.doneNoCall);
    }
    return end(t.done);
  }

  private async event(incidentId: string, userId: string, type: string, payload: Record<string, unknown>) {
    await this.timeline.recordEvent({ incidentId, type, source: "USSD", actorUserId: userId, payload });
  }

  /** The last position the person's OPA app reported, with its age. Never shown as live. */
  private async recordLastKnownLocation(userId: string, incidentId: string, now: Date) {
    const fix = await this.prisma.journeyLocationFix.findFirst({
      where: { journeySession: { userId }, latitude: { not: null }, receivedAt: { gt: new Date(now.getTime() - LAST_FIX_MAX_AGE_MS) } },
      orderBy: { receivedAt: "desc" },
      select: { latitude: true, longitude: true, accuracy: true, recordedAt: true },
    });
    if (!fix) return;
    await this.event(incidentId, userId, "USSD_LOCATION", {
      source: "LAST_APP_FIX",
      latitude: fix.latitude?.toString() ?? null,
      longitude: fix.longitude?.toString() ?? null,
      accuracy: fix.accuracy,
      recordedAt: fix.recordedAt.toISOString(),
      ageMinutes: Math.round((now.getTime() - fix.recordedAt.getTime()) / 60000),
      verified: false,
    });
  }
}
