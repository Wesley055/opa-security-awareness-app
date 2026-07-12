import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, CanActivate, ExecutionContext } from '@nestjs/common';
import request from 'supertest';

import { IncidentOrchestratorController } from '../src/modules/incident-orchestrator/incident-orchestrator.controller';
import { IncidentOrchestratorService } from '../src/modules/incident-orchestrator/incident-orchestrator.service';
import { JwtAuthGuard } from '../src/modules/auth/jwt-auth.guard';

class MockJwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();

    req.user = {
      sub: 'user-123',
      email: 'test@example.com',
      role: 'USER',
    };

    return true;
  }
}

describe('IncidentOrchestratorController (integration)', () => {
  let app: INestApplication;

  const orchestratorService = {
    createCoordinatedIncident: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef: TestingModule =
      await Test.createTestingModule({
        controllers: [IncidentOrchestratorController],
        providers: [
          {
            provide: IncidentOrchestratorService,
            useValue: orchestratorService,
          },
        ],
      })
        .overrideGuard(JwtAuthGuard)
        .useClass(MockJwtAuthGuard)
        .compile();

    app = moduleRef.createNestApplication();

    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('POST /incident-orchestrator/activate', async () => {
    orchestratorService.createCoordinatedIncident.mockResolvedValue({
      status: 'INCIDENT_ACTIVATED',
      contactsNotified: 1,
    });

    await request(app.getHttpServer())
      .post('/incident-orchestrator/activate')
      .send({
        triggerType: 'VOICE',
        mode: 'SILENT',
      })
      .expect(201);

    expect(
      orchestratorService.createCoordinatedIncident,
    ).toHaveBeenCalled();
  });
});