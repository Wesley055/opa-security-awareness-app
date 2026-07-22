import { Injectable, NotFoundException } from '@nestjs/common';
import { IncidentTrigger } from '@prisma/client';
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
import { UsersService } from '../users/users.service';
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
        notifications: [],
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

    const incident = await this.incidentsService.create(userId, {
      trigger: this.mapIncidentTrigger(dto.triggerType),
      latitude: dto.latitude,
      longitude: dto.longitude,
      address: intelligence.location.address,
      voicePhrase: dto.detectedPhrase,
    });

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

    const contacts =
      await this.emergencyContactsService.listForUser(userId);

    const activeContacts = contacts.filter(
      (contact) => contact.isActive,
    );

    const trackingUrl = `https://opasafety.com/incidents/${incident.id}`;

    // intelligence.location.crossStreet/address currently come from a
    // confirmed-mock GeocodingProvider (returns the same fabricated
    // address for every coordinate — see
    // docs/architecture/emergency-intelligence-engine.md). Using the
    // real GPS coordinates as a tappable map link instead, until that
    // provider is replaced with a real integration.
    const locationSummary = `https://maps.google.com/?q=${dto.latitude},${dto.longitude}`;

    const sendOne = async (
      contact: (typeof activeContacts)[number],
      channel: NotificationChannel,
      recipient: string,
    ): Promise<NotificationTaskResult> => {
      const contactName = `${contact.firstName} ${contact.lastName}`.trim();
      try {
        const result = await this.notificationService.sendEmergencyAlert({
          incidentId: incident.id,
          contactId: contact.id,
          contactName,
          contactType: contact.relationship,
          recipient,
          channel,
          personName,
          location: locationSummary,
          trackingUrl,
        });
        return { contactId: contact.id, contactName, channel, result };
      } catch (error) {
        return {
          contactId: contact.id,
          contactName,
          channel,
          result: {
            success: false,
            error:
              error instanceof Error ? error.message : 'Unknown notification error',
          },
        };
      }
    };

    const notificationTasks: Promise<NotificationTaskResult>[] = activeContacts.flatMap(
      (contact) => {
        const tasks = [
          sendOne(contact, NotificationChannel.SMS, contact.phoneNumber),
          sendOne(contact, NotificationChannel.WHATSAPP, contact.phoneNumber),
        ];
        if (contact.email) {
          tasks.push(sendOne(contact, NotificationChannel.EMAIL, contact.email));
        }
        return tasks;
      },
    );

    const notifications = await Promise.all(notificationTasks);

    for (const notification of notifications) {
      await this.timelineService.recordEvent({
        incidentId: incident.id,
        type: 'CONTACT_NOTIFIED',
        source: 'INCIDENT_ORCHESTRATOR',
        payload: {
          contactId: notification.contactId,
          contactName: notification.contactName,
          channel: notification.channel,
          success: notification.result.success,
        },
      });
    }

    return {
      status: 'INCIDENT_ACTIVATED',
      incident,
      detection,
      intelligence,
      contactsNotified: new Set(
        notifications
          .filter((n) => n.result.success)
          .map((n) => n.contactId),
      ).size,
      notifications,
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