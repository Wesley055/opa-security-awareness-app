import { Injectable } from '@nestjs/common';
import { IncidentTrigger } from '@prisma/client';
import { EmergencyContactsService } from '../emergency-contacts/emergency-contacts.service';
import {
  EmergencyTriggerType,
  TriggerMode,
} from '../emergency-detection/dto/trigger-request.dto';
import { EmergencyDetectionService } from '../emergency-detection/emergency-detection.service';
import { EmergencyIntelligenceService } from '../emergency-intelligence/emergency-intelligence.service';
import { IncidentsService } from '../incidents/incidents.service';
import {
  NotificationChannel,
} from '../notifications/dto/send-notification.dto';
import { NotificationService } from '../notifications/notification.service';
import type { CreateIncidentRequestDto } from './dto/create-incident-request.dto';

@Injectable()
export class IncidentOrchestratorService {
  constructor(
    private readonly emergencyDetectionService: EmergencyDetectionService,
    private readonly emergencyIntelligenceService: EmergencyIntelligenceService,
    private readonly incidentsService: IncidentsService,
    private readonly emergencyContactsService: EmergencyContactsService,
    private readonly notificationService: NotificationService,
  ) {}

  async createCoordinatedIncident(
    userId: string,
    dto: CreateIncidentRequestDto,
  ) {
    /*
     * Step 1:
     * Evaluate the trigger.
     */
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

    /*
     * If the trigger does not activate an emergency,
     * return the evaluation without creating an incident.
     */
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

    /*
     * Step 2:
     * Build emergency intelligence from location and device data.
     */
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

    /*
     * Step 3:
     * Create the incident.
     */
    const incident = await this.incidentsService.create(userId, {
      trigger: this.mapIncidentTrigger(dto.triggerType),
      latitude: dto.latitude,
      longitude: dto.longitude,
      address: intelligence.location.address,
      voicePhrase: dto.detectedPhrase,
    });

    /*
     * Step 4:
     * Load active emergency contacts.
     */
    const contacts =
      await this.emergencyContactsService.listForUser(userId);

    const activeContacts = contacts.filter(
      (contact) => contact.isActive,
    );

    /*
     * Step 5:
     * Send short, readable alerts.
     *
     * The complete emergency details remain available
     * through the secure incident link.
     */
    const trackingUrl =
      `https://opasafety.com/incidents/${incident.id}`;

    const locationSummary =
      intelligence.location.crossStreet ??
      intelligence.location.address ??
      `${dto.latitude}, ${dto.longitude}`;

    const notifications = [];

    for (const contact of activeContacts) {
      const smsResult =
        await this.notificationService.sendEmergencyAlert({
          incidentId: incident.id,
          contactId: contact.id,
          contactName: `${contact.firstName} ${contact.lastName}`.trim(),
          contactType: contact.relationship,
          recipient: contact.phoneNumber,
          channel: NotificationChannel.SMS,
          personName: 'OPA user',
          location: locationSummary,
          trackingUrl,
        });

      notifications.push({
        contactId: contact.id,
        contactName:
          `${contact.firstName} ${contact.lastName}`.trim(),
        channel: NotificationChannel.SMS,
        result: smsResult,
      });

      if (contact.email) {
        const emailResult =
          await this.notificationService.sendEmergencyAlert({
            incidentId: incident.id,
            contactId: contact.id,
            contactName: `${contact.firstName} ${contact.lastName}`.trim(),
            contactType: contact.relationship,
            recipient: contact.email,
            channel: NotificationChannel.EMAIL,
            personName: 'OPA user',
            location: locationSummary,
            trackingUrl,
          });

        notifications.push({
          contactId: contact.id,
          contactName:
            `${contact.firstName} ${contact.lastName}`.trim(),
          channel: NotificationChannel.EMAIL,
          result: emailResult,
        });
      }
    }

    /*
     * Step 6:
     * Return the complete coordinated result.
     */
    return {
      status: 'INCIDENT_ACTIVATED',
      incident,
      detection,
      intelligence,
      contactsNotified: activeContacts.length,
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