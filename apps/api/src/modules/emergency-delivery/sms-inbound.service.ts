import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, type DeliveryVerification } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { toE164 } from "../../shared/phone/normalize-phone-number";
import { IncidentOrchestratorService } from "../incident-orchestrator/incident-orchestrator.service";
import {
  ActivationMode,
  ActivationSource,
  EmergencyTriggerType,
  TriggerMode,
} from "../emergency-detection/dto/trigger-request.dto";
import type { CreateIncidentRequestDto } from "../incident-orchestrator/dto/create-incident-request.dto";
import { decodeSms, deriveDeviceKey, macMatches } from "./sms-codec";
import { msisdnHash, smsFallbackEnabled } from "./delivery-identity";
import { signingSecret } from "./sms-keys.service";
import { sendFromShortcode, sendReceipt } from "./sms-reply";
import { applyConsentReply, consentReplyText, consentWord } from "../journey/safewalk-consent";

export interface InboundSms {
  id?: string;
  from?: string;
  to?: string;
  text?: string;
  linkId?: string;
}

const MAX_PER_TEN_MINUTES = 10;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Offline SOS by SMS. NEVER creates an alert for a number that is not an
 * active resident's registered number, and never notifies anyone twice: the
 * activation id inside a signed message is the same one the internet route
 * uses, so both copies reconcile onto one incident.
 */
@Injectable()
export class SmsInboundService {
  private readonly log = new Logger("SmsInbound");

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly orchestrator: IncidentOrchestratorService,
  ) {}

  async handle(sms: InboundSms, now = new Date()): Promise<string> {
    const sosEnabled = smsFallbackEnabled();
    // SafeWalk contacts answer their invitation (YES / STOP) on the same short code.
    const consentEnabled = process.env.SAFEWALK_ESCALATION_ENABLED === "true";
    if (!sosEnabled && !consentEnabled) return "DISABLED";
    const messageId = (sms.id ?? "").slice(0, 120);
    if (!messageId || !sms.from || typeof sms.text !== "string" || sms.text.length > 480) return "BAD_REQUEST";
    let e164: string;
    try {
      e164 = toE164(sms.from);
    } catch {
      return "BAD_SENDER";
    }
    const hash = msisdnHash(this.config.getOrThrow<string>("PII_LOOKUP_KEY"), e164);

    // Idempotency: Africa's Talking may deliver the same callback more than once.
    let row: { id: string };
    try {
      row = await this.prisma.inboundMessage.create({
        data: { provider: "africastalking", providerMessageId: messageId, msisdnHash: hash, outcome: "RECEIVED" },
        select: { id: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return "DUPLICATE";
      throw error;
    }
    const finish = async (outcome: string, extra: { userId?: string; incidentId?: string } = {}) => {
      await this.prisma.inboundMessage.update({ where: { id: row.id }, data: { outcome, ...extra } });
      return outcome;
    };

    const recent = await this.prisma.inboundMessage.count({
      where: { msisdnHash: hash, receivedAt: { gt: new Date(now.getTime() - 10 * 60 * 1000) } },
    });
    if (recent > MAX_PER_TEN_MINUTES) return finish("RATE_LIMITED");

    // A shared short code routes by keyword ("OPA ..."); the keyword is not part of the message.
    const keyword = (process.env.AFRICASTALKING_SMS_KEYWORD ?? "").trim();
    const body = keyword && sms.text.trim().toLowerCase().startsWith(keyword.toLowerCase() + " ")
      ? sms.text.trim().slice(keyword.length + 1)
      : sms.text;

    // YES / STOP is never an emergency. It only answers a SafeWalk invitation
    // sent to this number; with no invitation it falls through unchanged.
    const word = consentEnabled ? consentWord(body) : null;
    if (word) {
      const applied = await applyConsentReply(this.prisma, hash, word, now);
      if (applied) {
        await sendFromShortcode(e164, consentReplyText(word), sms.linkId);
        return finish("SAFEWALK_" + applied);
      }
    }
    if (!sosEnabled) return finish("DISABLED");

    const user = await this.prisma.user.findUnique({
      where: { phoneNumber: e164 },
      select: { id: true, role: true, isActive: true, accountStatus: true, credentialVersion: true },
    });
    // Unknown, inactive or staff numbers: logged by hash only, no alert, no reply.
    if (!user || !user.isActive || user.accountStatus !== "ACTIVE" || user.role !== "USER")
      return finish("UNKNOWN_SENDER");

    const decoded = decodeSms(body);
    if (decoded.kind === "UNRECOGNISED") return finish("UNRECOGNISED", { userId: user.id });

    let verification: DeliveryVerification = "SMS_NUMBER_ONLY";
    const dto: CreateIncidentRequestDto = {
      triggerType: EmergencyTriggerType.SOS_BUTTON,
      mode: TriggerMode.IMMEDIATE,
      activationMode: ActivationMode.STANDARD,
      activationSource: "SMS_FALLBACK" as ActivationSource,
      userConfirmed: true,
      isOffline: true,
    };
    if (decoded.kind === "SIGNED_FORMAT") {
      const secret = signingSecret();
      const key = await this.prisma.deviceSmsKey.findUnique({ where: { keyId: decoded.sos.keyId } });
      const signed =
        !!secret &&
        !!key &&
        key.userId === user.id &&
        !key.revokedAt &&
        macMatches(deriveDeviceKey(secret, key.keyId, user.id, user.credentialVersion), decoded.fields, decoded.mac);
      if (signed) {
        // Replay protection: a signed press older than a day is refused.
        if (now.getTime() - decoded.sos.pressedAt.getTime() > MAX_AGE_MS) return finish("STALE", { userId: user.id });
        verification = "SMS_SIGNED";
        dto.activationId = decoded.sos.activationId;
        dto.pressedAt = decoded.sos.pressedAt.toISOString();
        dto.activationMode = decoded.sos.silent ? ActivationMode.SILENT : ActivationMode.STANDARD;
        dto.mode = decoded.sos.silent ? TriggerMode.SILENT : TriggerMode.IMMEDIATE;
      }
      // Location is useful even when the signature does not verify; the
      // verification level tells the duty officer how far to trust it.
      if (decoded.sos.latitude !== null && decoded.sos.longitude !== null) {
        dto.latitude = decoded.sos.latitude;
        dto.longitude = decoded.sos.longitude;
        if (decoded.sos.accuracy !== null) dto.accuracy = decoded.sos.accuracy;
      }
    }

    try {
      const result = await this.orchestrator.createCoordinatedIncident(user.id, dto, { channel: "SMS", verification });
      const incidentId = (result as { incident?: { id?: string } | null }).incident?.id ?? undefined;
      const outcome = (result as { reconciled?: boolean }).reconciled ? "RECONCILED" : verification;
      await finish(outcome, { userId: user.id, incidentId });
      // Tells a person with no internet that the alert arrived.
      const receipt = await sendReceipt(e164, now, sms.linkId);
      if (receipt === "FAILED") this.log.warn(`receipt not sent for inbound ${row.id}`);
      return outcome;
    } catch (error) {
      this.log.error(`SMS SOS failed for inbound ${row.id}: ${error instanceof Error ? error.name : "unknown"}`);
      return finish("FAILED", { userId: user.id });
    }
  }
}
