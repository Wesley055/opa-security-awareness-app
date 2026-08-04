import {
  CanActivate,
  ExecutionContext,
  INestApplication,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { JwtAuthGuard } from '../src/modules/auth/jwt-auth.guard';
import { JourneyController } from '../src/modules/journey/journey.controller';
import { JourneyIngestionService } from '../src/modules/journey/journey-ingestion.service';

const USER = 'user-123';
const SESSION = '11111111-1111-4111-8111-111111111111';

class MockJwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    request.user = {
      sub: USER,
      email: 'test@example.com',
      role: 'USER',
    };
    return true;
  }
}

describe('JourneyController', () => {
  let app: INestApplication;

  const journeyIngestionService = {
    endSession: jest.fn(),
    ingest: jest.fn(),
    startSession: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [JourneyController],
      providers: [
        {
          provide: JourneyIngestionService,
          useValue: journeyIngestionService,
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

  it('POST /journey/sessions/:sessionId/end passes through the ended state', async () => {
    const response = {
      sessionId: SESSION,
      status: 'ENDED',
      endedAt: '2026-08-03T20:00:00.123Z',
      endedReason: 'USER_ENDED',
      alreadyEnded: false,
    };
    journeyIngestionService.endSession.mockResolvedValue(response);

    await request(app.getHttpServer())
      .post('/journey/sessions/' + SESSION + '/end')
      .expect(201)
      .expect(response);

    expect(journeyIngestionService.endSession).toHaveBeenCalledWith(
      USER,
      SESSION,
    );
  });

  it('returns 400 for a malformed session UUID', async () => {
    await request(app.getHttpServer())
      .post('/journey/sessions/not-a-uuid/end')
      .expect(400);

    expect(journeyIngestionService.endSession).not.toHaveBeenCalled();
  });
});