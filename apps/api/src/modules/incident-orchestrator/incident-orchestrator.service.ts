import { Injectable, NotFoundException } from '@nestjs/common';
import { IncidentStatus, IncidentTrigger, NotificationStatus } from '@prisma/client';
import { EmergencyContactsService } from '../emergency-contacts/emergency-contacts.service';
import {
  EmergencyTriggerType,
} from '../emergency-detection/dto/trigger-request.dto';
import { EmergencyDetectionService } from '../emergency-detection/emergency-detection.service';
import { EmergencyIntelligenceService } from '../emergency-intelligence/emergency-intelligence.service';
import { IncidentTimelineService } from '../incident-timeline/incident-timeline.service';
import { IncidentsService } from '../incidents/incidents.service';
import {
  NotificationChannel,
} from '../notifications/dto/send-notification.dto';
import { NotificationService } from '../notifications/notification.service';
import {
  buildNotificationPayload,
  buildTrackingUrl,
} from '../notifications/notification-payload';
import { UsersService } from '../users/users.service';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { IncidentAccessTokenService } from '../incident-access/incident-access-token.service';
import { JourneySessionService } from '../journey/journey-session.service';
import type { CreateIncidentRequestDto } from './dto/create-incident-request.dto';

export interface NotificationTaskResult {
  contactId: string;
  contactName: string;
  channel: NotificationChannel;
  result: { success: boolean; provider?: string; messageId?: string; error?: string };
}

@Injectable()
export class IncidentOrchestratorService {
  constructor(
    private readonly emergencyDetectionService: EmergencyDetectionService,
    private readonly emergencyIntelligenceService: EmergencyIntelligenceService,
    private readonly incidentsService: IncidentsService,
    private readonly emergencyContactsService: EmergencyContactsService,
    private readonly notificationService: NotificationService,
    private readonly usersService: UsersService,
    private readonly timelineService: IncidentTimelineService,
    private readonly prisma: PrismaService,
    private readonly accessTokenService: IncidentAccessTokenService,
    private readonly journeySessionService: JourneySessionService,
  ) {}

  async createCoordinatedIncident(
    userId: string,
    dto: CreateIncidentRequestDto,
  ) {
    const detection = this.emergencyDetectionService.evaluate({
      triggerType: dto.triggerType,
      mode: dto.mode,
      detectedPhrase: dto.detectedPhrase,
      language: dto.language,
      profileName: dto.profileName,
      voiceConfidence: dto.voiceConfidence,
      repetitionCount: dto.repetitionCount,
      userConfirmed: dto.userConfirmed,
      cancellationReceived: dto.cancellationReceived,
      deviceInMotion: dto.deviceInMotion,
      isOffline: dto.isOffline,
      confirmationSeconds: dto.confirmationSeconds,
    });

    if (!detection.outcome.shouldActivate) {
      return {
        status: detection.outcome.requiresConfirmation
          ? 'CONFIRMATION_REQUIRED'
          : 'NOT_ACTIVATED',
        detection,
        incident: null,
        intelligence: null,
        notifications: { queued: 0, dispatched: false },
      };
    }

    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found for this incident.');
    }
    const personName = `${user.firstName} ${user.lastName}`.trim();

    const intelligence =
      await this.emergencyIntelligenceService.buildLocationIntelligence({
        latitude: dto.latitude,
        longitude: dto.longitude,
        accuracy: dto.accuracy,
        speed: dto.speed,
        heading: dto.heading,
        altitude: dto.altitude,
        batteryLevel: dto.batteryLevel,
        isCharging: dto.isCharging,
        networkType: dto.networkType,
        language: dto.language,
        timestamp: dto.timestamp,
      });

    // Load and filter contacts BEFORE the transaction so we can build the
    // durable notification rows in memory (no network/IO inside the tx).
    const contacts =
      await this.emergencyContactsService.listForUser(userId);
    const activeContacts = contacts.filter(
      (contact) => contact.isActive,
    );

    // Pre-generate a UUID per notification row so, after commit, each
    // synchronous send can update its EXACT row (race-safe, no matching).
    type QueuedNotification = {
      id: string;
      contactId: string;
      contactName: string;
      contactType: string;
      recipient: string;
      channel: NotificationChannel;
    };
    const notificationRows: QueuedNotification[] = activeContacts.flatMap(
      (contact) => {
        const contactName = `${contact.firstName} ${contact.lastName}`.trim();
        const rows: QueuedNotification[] = [
          {
            id: randomUUID(),
            contactId: contact.id,
            contactName,
            contactType: contact.relationship,
            recipient: contact.phoneNumber,
            channel: NotificationChannel.SMS,
          },
          {
            id: randomUUID(),
            contactId: contact.id,
            contactName,
            contactType: contact.relationship,
            recipient: contact.phoneNumber,
            channel: NotificationChannel.WHATSAPP,
          },
        ];
        if (contact.email) {
          rows.push({
            id: randomUUID(),
            contactId: contact.id,
            contactName,
            contactType: contact.relationship,
            recipient: contact.email,
            channel: NotificationChannel.EMAIL,
          });
        }
        return rows;
      },
    );

    // intelligence.location.crossStreet/address currently come from a
    // confirmed-mock GeocodingProvider (returns the same fabricated
    // address for every coordinate - see
    // docs/architecture/emergency-intelligence-engine.md). Using the
    // real GPS coordinates as a tappable map link instead, until that
    // provider is replaced with a real integration.
    const locationSummary = `https://maps.google.com/?q=${dto.latitude},${dto.longitude}`;

    // Durable-intent write: incident + QUEUED notification rows commit
    // atomically. If this commits, notifications will not be lost even if
    // the process crashes. Each row carries a self-contained payload so the
    // dispatch worker can deliver it without re-querying incident or user
    // data.
    //
    // INCIDENT IDENTITY IS LIFECYCLE-BASED, NOT TIME-BASED.
    //
    // A user may have at most one OPEN emergency. While that incident remains
    // OPEN, every later SOS activation belongs to it and is a retrigger,
    // regardless of elapsed time. Only a terminal transition allows the next
    // SOS to create a new incident.
    //
    // This reverses the earlier 60-second identity rule. That window was
    // useful for absorbing repeated activation calls, but production evidence
    // showed that using elapsed time to define incident identity left older
    // OPEN incidents orphaned when later emergencies were created.
    //
    // The per-user advisory lock below remains the concurrency authority: two
    // simultaneous SOS requests cannot both observe "no OPEN incident".

    const activation = await this.prisma.$transaction(async (tx) => {
      // Serialise activations for THIS user only. Different users never
      // block each other.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;

      // D11: the device clock is advisory. A missing or unparseable
      // dto.timestamp must not fail the emergency, so it falls back to the
      // server clock HERE, at the orchestrator boundary, so the journey
      // service only ever receives a Date. This does NOT weaken D3:
      // receivedAt remains the database clock, captured inside insertFixes.
      const parsedRecordedAt = dto.timestamp ? new Date(dto.timestamp) : null;
      const recordedAt =
        parsedRecordedAt && !Number.isNaN(parsedRecordedAt.getTime())
          ? parsedRecordedAt
          : new Date();

      const recent = await tx.incident.findFirst({
        where: {
          userId,
          status: IncidentStatus.OPEN,
        },
        // Deterministic while legacy data is being reconciled. Once the
        // database invariant is installed, at most one row can match.
        orderBy: [
          { lastTriggeredAt: 'desc' },
          { createdAt: 'desc' },
          { id: 'desc' },
        ],
      });

      if (recent) {
        // Re-trigger of an emergency that is still OPEN. OPEN now defines
        // continuity; elapsed time does not. Do NOT create a second incident
        // and do NOT queue duplicate notifications, but record the retrigger
        // because repeated SOS actions may signal rising distress.
        //
        // The incident's own latitude/longitude are deliberately NOT
        // overwritten: they are the immutable origin of the emergency (where
        // an abduction began). The new coordinates are recorded as a journey
        // location fix on the hash chain and on the timeline (Sprint 10B).
        const retriggeredAt = new Date();
        const updated = await tx.incident.update({
          where: { id: recent.id },
          data: {
            lastTriggeredAt: retriggeredAt,
            retriggerCount: { increment: 1 },
          },
        });

        // Inside the transaction, deliberately: the timeline events are
        // written after commit, so a crash in that window should cost the
        // audit event, not the position. recordRetriggerFix is
        // self-healing - it resolves and links a session of its own when
        // incident.journeySessionId is null.
        const retriggerFix =
          await this.journeySessionService.recordRetriggerFix(tx, {
            incident: updated,
            latitude: dto.latitude,
            longitude: dto.longitude,
            accuracy: dto.accuracy,
            speed: dto.speed,
            heading: dto.heading,
            batteryLevel: dto.batteryLevel,
            isCharging: dto.isCharging,
            recordedAt,
          });

        return {
          incident: {
            ...updated,
            journeySessionId: retriggerFix.sessionId,
          },
          deduplicated: true as const,
          retriggeredAt,
          trackingUrl: null,
        };
      }

      const created = await this.incidentsService.create(
        userId,
        {
          trigger: this.mapIncidentTrigger(dto.triggerType),
          latitude: dto.latitude,
          longitude: dto.longitude,
          // The geocoding implementation is currently a development mock and
          // returns the same fabricated address for EVERY coordinate. Persisting
          // it would attach a plausible but wrong street address to every
          // incident, which the incident portal or a responder could later
          // trust. Persist only the authoritative GPS coordinates below until a
          // production geocoder is enabled.
          // See docs/architecture/emergency-intelligence-engine.md
          voicePhrase: dto.detectedPhrase,
        },
        tx,
      );

      // The activation fix needs created.id, so the session is resolved
      // here rather than before the create. The lifecycle lock is already
      // held above and pg_advisory_xact_lock is reentrant within a
      // transaction, so resolveForActivation re-taking it is free (D6).
      const journeySession =
        await this.journeySessionService.resolveForActivation(tx, userId);
      await this.journeySessionService.recordActivationFix(tx, {
        sessionId: journeySession.id,
        incidentId: created.id,
        latitude: dto.latitude,
        longitude: dto.longitude,
        accuracy: dto.accuracy,
        speed: dto.speed,
        heading: dto.heading,
        batteryLevel: dto.batteryLevel,
        isCharging: dto.isCharging,
        recordedAt,
      });
      await tx.incident.update({
        where: { id: created.id },
        data: { journeySessionId: journeySession.id },
      });

      // The tracking URL needs the new incident id, so it is built here.
      // Pure string work - no IO inside the transaction.
      // Issue the capability token the tracking link will carry, inside the
      // same transaction: if the incident commits, so does its tracking link.
      // The RAW token is returned once here and never stored - only its hash
      // is persisted, so it cannot be recovered later.
      const { token: trackingToken } = await this.accessTokenService.issue(
        created.id,
        undefined,
        tx,
      );
      const incidentTrackingUrl = buildTrackingUrl(trackingToken);

      await tx.incidentNotification.createMany({
        data: notificationRows.map((row) => ({
          id: row.id,
          incidentId: created.id,
          contactId: row.contactId,
          contactName: row.contactName,
          contactType: row.contactType,
          recipient: row.recipient,
          channel: row.channel,
          status: NotificationStatus.QUEUED,
          attemptCount: 0,
          payload: buildNotificationPayload({
            channel: row.channel,
            recipient: row.recipient,
            personName,
            location: locationSummary,
            trackingUrl: incidentTrackingUrl,
          }),
        })),
      });

      return {
        incident: created,
        deduplicated: false as const,
        retriggeredAt: null,
        trackingUrl: incidentTrackingUrl,
      };
    });

    const incident = activation.incident;

    if (activation.deduplicated) {
      const retriggeredAt = activation.retriggeredAt ?? new Date();
      const secondsSinceInitialTrigger = Math.round(
        (retriggeredAt.getTime() - incident.createdAt.getTime()) / 1000,
      );

      await this.timelineService.recordEvent({
        incidentId: incident.id,
        type: 'SOS_RETRIGGERED',
        source: 'INCIDENT_ORCHESTRATOR',
        actorUserId: userId,
        payload: {
          triggerMethod: dto.triggerType,
          latitude: dto.latitude,
          longitude: dto.longitude,
          retriggerCount: incident.retriggerCount,
          secondsSinceInitialTrigger,
          retriggeredAt: retriggeredAt.toISOString(),
        },
      });

      return {
        status: 'INCIDENT_RETRIGGERED',
        incident,
        detection,
        intelligence,
        deduplicated: true,
        retriggerCount: incident.retriggerCount,
        notifications: {
          queued: 0,
          dispatched: false,
        },
        coordination: {
          // No tracking URL on a retrigger: only the token HASH is stored, so
          // the original link cannot be reconstructed. The family already has
          // a working link and no new notification is being sent.
          trackingUrl: null,
          silentMode: detection.outcome.isSilent,
          confidenceScore: detection.outcome.confidenceScore,
          confidenceLevel: detection.outcome.confidenceLevel,
          generatedAt: new Date().toISOString(),
        },
      };
    }

    await this.timelineService.recordEvent({
      incidentId: incident.id,
      type: 'INCIDENT_CREATED',
      source: 'INCIDENT_ORCHESTRATOR',
      actorUserId: userId,
      payload: {
        trigger: dto.triggerType,
        confidenceScore: detection.outcome.confidenceScore,
        confidenceLevel: detection.outcome.confidenceLevel,
        silentMode: detection.outcome.isSilent,
      },
    });
    await this.timelineService.recordEvent({
      incidentId: incident.id,
      type: 'LOCATION_ATTACHED',
      source: 'INCIDENT_ORCHESTRATOR',
      actorUserId: userId,
      payload: {
        latitude: dto.latitude,
        longitude: dto.longitude,
      },
    });

    // The tracking link built from the token issued inside the transaction.
    // The raw token exists only here and in the outbound message - it cannot
    // be recovered from the database later.
    const trackingUrl = activation.trackingUrl;

    // Notifications are dispatched exclusively by NotificationDispatchWorker,
    // which claims the QUEUED rows written in the transaction above. The
    // orchestrator no longer calls providers, so this request returns as soon
    // as the emergency intent is durably persisted.
    await this.timelineService.recordEvent({
      incidentId: incident.id,
      type: 'NOTIFICATIONS_QUEUED',
      source: 'INCIDENT_ORCHESTRATOR',
      actorUserId: userId,
      payload: {
        queued: notificationRows.length,
      },
    });

    return {
      status: 'INCIDENT_ACTIVATED',
      incident,
      detection,
      intelligence,
      notifications: {
        queued: notificationRows.length,
        dispatched: false,
      },
      coordination: {
        trackingUrl,
        silentMode: detection.outcome.isSilent,
        confidenceScore: detection.outcome.confidenceScore,
        confidenceLevel: detection.outcome.confidenceLevel,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  private mapIncidentTrigger(
    triggerType: EmergencyTriggerType,
  ): IncidentTrigger {
    switch (triggerType) {
      case EmergencyTriggerType.VOICE:
        return IncidentTrigger.VOICE_HELP_HELP;

      case EmergencyTriggerType.TRUSTED_CONTACT:
        return IncidentTrigger.TRUSTED_CONTACT;

      case EmergencyTriggerType.SYSTEM_TEST:
        return IncidentTrigger.SYSTEM_TEST;

      case EmergencyTriggerType.SOS_BUTTON:
      case EmergencyTriggerType.SILENT:
      case EmergencyTriggerType.SAFETY_CHECK:
      default:
        return IncidentTrigger.SOS_BUTTON;
    }
  }
}
