import { Injectable, NotFoundException } from '@nestjs/common';
import { IncidentStatus, IncidentTrigger, NotificationStatus } from '@prisma/client';
import { EmergencyContactsService } from '../emergency-contacts/emergency-contacts.service';
import {
  EmergencyTriggerType,
  TriggerMode,
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
    // DEDUPLICATION: a panicking user may tap SOS several times. Without a
    // guard that creates several incidents and several full sets of alerts
    // for ONE emergency. A per-user advisory lock serialises concurrent
    // activations so two simultaneous taps cannot both pass the "is there a
    // recent incident" check.
    const dedupeWindowSeconds = Number(
      process.env.SOS_DEDUPE_WINDOW_SECONDS ?? 60,
    );

    const activation = await this.prisma.$transaction(async (tx) => {
      // Serialise activations for THIS user only. Different users never
      // block each other.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;

      const cutoff = new Date(Date.now() - dedupeWindowSeconds * 1000);
      const recent = await tx.incident.findFirst({
        where: {
          userId,
          status: IncidentStatus.OPEN,
          lastTriggeredAt: { gte: cutoff },
        },
        orderBy: { lastTriggeredAt: 'desc' },
      });

      if (recent) {
        // Re-trigger of an emergency already in flight. Do NOT create a
        // second incident and do NOT queue duplicate notifications, but do
        // record that it happened - repeated taps may signal rising distress.
        //
        // The incident's own latitude/longitude are deliberately NOT
        // overwritten: they are the immutable origin of the emergency (where
        // an abduction began). The new coordinates are recorded on the
        // timeline instead, and continuous movement becomes a proper location
        // stream in Sprint 10B.
        const retriggeredAt = new Date();
        const updated = await tx.incident.update({
          where: { id: recent.id },
          data: {
            lastTriggeredAt: retriggeredAt,
            retriggerCount: { increment: 1 },
          },
        });
        return {
          incident: updated,
          deduplicated: true as const,
          retriggeredAt,
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

      // The tracking URL needs the new incident id, so it is built here.
      // Pure string work - no IO inside the transaction.
      const incidentTrackingUrl = buildTrackingUrl(created.id);

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
          dedupeWindowSeconds,
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
          trackingUrl: buildTrackingUrl(incident.id),
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

    const trackingUrl = buildTrackingUrl(incident.id);

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
