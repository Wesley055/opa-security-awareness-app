import { Test, TestingModule } from '@nestjs/testing';

import { EmergencyContactsService } from '../emergency-contacts/emergency-contacts.service';
import { EmergencyDetectionService } from '../emergency-detection/emergency-detection.service';
import { EmergencyIntelligenceService } from '../emergency-intelligence/emergency-intelligence.service';
import { IncidentsService } from '../incidents/incidents.service';
import { NotificationService } from '../notifications/notification.service';
import { UsersService } from '../users/users.service';
import { IncidentOrchestratorService } from './incident-orchestrator.service';

describe('IncidentOrchestratorService', () => {
  let service: IncidentOrchestratorService;

  const emergencyDetectionService = {
    evaluate: jest.fn(),
  };

  const emergencyIntelligenceService = {
    buildLocationIntelligence: jest.fn(),
  };

  const incidentsService = {
    create: jest.fn(),
  };

  const emergencyContactsService = {
    listForUser: jest.fn(),
  };

  const notificationService = {
    sendEmergencyAlert: jest.fn(),
  };

  const usersService = {
    findById: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IncidentOrchestratorService,
        {
          provide: EmergencyDetectionService,
          useValue: emergencyDetectionService,
        },
        {
          provide: EmergencyIntelligenceService,
          useValue: emergencyIntelligenceService,
        },
        {
          provide: IncidentsService,
          useValue: incidentsService,
        },
        {
          provide: EmergencyContactsService,
          useValue: emergencyContactsService,
        },
        {
          provide: NotificationService,
          useValue: notificationService,
        },
        {
          provide: UsersService,
          useValue: usersService,
        },
      ],
    }).compile();

    service = module.get<IncidentOrchestratorService>(
      IncidentOrchestratorService,
    );
  });

  it('should activate a coordinated incident and notify active contacts', async () => {
    emergencyDetectionService.evaluate.mockReturnValue({
      outcome: {
        shouldActivate: true,
        requiresConfirmation: false,
        isSilent: true,
        confidenceScore: 75,
        confidenceLevel: 'HIGH',
      },
    });

    usersService.findById.mockResolvedValue({
      id: 'user-123',
      firstName: 'Test',
      lastName: 'User',
    });

    emergencyIntelligenceService.buildLocationIntelligence.mockResolvedValue({
      location: {
        address: '12 Allen Avenue, Ikeja, Lagos',
        crossStreet: 'Allen Avenue & Opebi Road',
      },
    });

    incidentsService.create.mockResolvedValue({
      id: 'incident-123',
      userId: 'user-123',
      status: 'OPEN',
    });

    emergencyContactsService.listForUser.mockResolvedValue([
      {
        id: 'contact-1',
        firstName: 'Grace',
        lastName: 'Wesley',
        relationship: 'FAMILY',
        phoneNumber: '+2348012345678',
        email: 'grace@example.com',
        isActive: true,
      },
      {
        id: 'contact-2',
        firstName: 'Inactive',
        lastName: 'Contact',
        relationship: 'FRIEND',
        phoneNumber: '+2348099999999',
        email: null,
        isActive: false,
      },
    ]);

    notificationService.sendEmergencyAlert.mockResolvedValue({
      success: true,
      provider: 'MockProvider',
      messageId: 'message-123',
    });

    const result = await service.createCoordinatedIncident(
      'user-123',
      {
        triggerType: 'VOICE' as never,
        mode: 'SILENT' as never,
        detectedPhrase: 'HELP HELP',
        language: 'en-NG',
        voiceConfidence: 0.96,
        repetitionCount: 2,
        userConfirmed: false,
        cancellationReceived: false,
        deviceInMotion: true,
        isOffline: false,
        confirmationSeconds: 5,
        latitude: 6.6018,
        longitude: 3.3515,
        accuracy: 5,
        speed: 18,
        heading: 45,
        altitude: 42,
        batteryLevel: 72,
        isCharging: false,
        networkType: '4G',
        timestamp: '2026-07-12T09:00:00.000Z',
      },
    );

    expect(result.status).toBe('INCIDENT_ACTIVATED');
    expect(result.contactsNotified).toBe(1);
    expect(result.coordination?.silentMode).toBe(true);
    expect(result.incident?.id).toBe('incident-123');

    expect(incidentsService.create).toHaveBeenCalledTimes(1);
    expect(notificationService.sendEmergencyAlert).toHaveBeenCalledTimes(2);
  });

  it('should not create an incident when detection does not activate', async () => {
    emergencyDetectionService.evaluate.mockReturnValue({
      outcome: {
        shouldActivate: false,
        requiresConfirmation: false,
        isSilent: false,
        confidenceScore: 20,
        confidenceLevel: 'LOW',
      },
    });

    const result = await service.createCoordinatedIncident(
      'user-123',
      {
        triggerType: 'VOICE' as never,
        mode: 'IMMEDIATE' as never,
        detectedPhrase: 'GOOD MORNING',
        latitude: 6.6018,
        longitude: 3.3515,
      },
    );

    expect(result.status).toBe('NOT_ACTIVATED');
    expect(result.incident).toBeNull();
    expect(result.notifications).toEqual([]);

    expect(incidentsService.create).not.toHaveBeenCalled();
    expect(notificationService.sendEmergencyAlert).not.toHaveBeenCalled();
  });

  it('should return confirmation required when the trigger needs confirmation', async () => {
    emergencyDetectionService.evaluate.mockReturnValue({
      outcome: {
        shouldActivate: false,
        requiresConfirmation: true,
        isSilent: false,
        confidenceScore: 55,
        confidenceLevel: 'MEDIUM',
      },
    });

    const result = await service.createCoordinatedIncident(
      'user-123',
      {
        triggerType: 'VOICE' as never,
        mode: 'CONFIRMATION' as never,
        detectedPhrase: 'HELP HELP',
        latitude: 6.6018,
        longitude: 3.3515,
      },
    );

    expect(result.status).toBe('CONFIRMATION_REQUIRED');
    expect(result.incident).toBeNull();
  });
});