import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { JourneySessionService } from './journey-session.service';
import { JourneyIngestionService } from './journey-ingestion.service';

const USER = 'user-1';
const SESSION = 'session-1';

describe('JourneyIngestionService', () => {
  let service: JourneyIngestionService;

  const journeySessionService = {
    recordTrackedFixes: jest.fn(),
    resolveForActivation: jest.fn(),
  };

  const prisma = {
    $transaction: jest.fn(),
    // startSession takes the lifecycle lock before its existence check.
    $executeRaw: jest.fn(),
    journeySession: { findUnique: jest.fn(), findFirst: jest.fn() },
  };

  const openSession = {
    id: SESSION,
    userId: USER,
    status: 'ACTIVE',
    startedAt: new Date(),
  };

  function dto(overrides: Record<string, unknown> = {}) {
    return {
      sessionId: SESSION,
      fixes: [
        {
          idempotencyKey: 'key-1',
          source: 'foreground' as const,
          latitude: 6.5244,
          longitude: 3.3792,
          recordedAt: new Date().toISOString(),
          ...overrides,
        },
      ],
    };
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof prisma) => unknown) => callback(prisma),
    );
    prisma.journeySession.findUnique.mockResolvedValue(openSession);
    prisma.journeySession.findFirst.mockResolvedValue(null);
    prisma.$executeRaw.mockResolvedValue(1);
    journeySessionService.recordTrackedFixes.mockResolvedValue({
      inserted: 1,
      skippedDuplicateInBatch: 0,
      skippedAlreadyStored: 0,
      receivedAt: new Date(),
      tailSequence: 0,
      tailHash: 'a'.repeat(64),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JourneyIngestionService,
        { provide: PrismaService, useValue: prisma },
        { provide: JourneySessionService, useValue: journeySessionService },
      ],
    }).compile();

    service = module.get<JourneyIngestionService>(JourneyIngestionService);
  });

  it('passes the batch through to recordTrackedFixes', async () => {
    const result = await service.ingest(USER, dto() as never);
    expect(result.inserted).toBe(1);
    expect(journeySessionService.recordTrackedFixes).toHaveBeenCalledTimes(1);
  });

  // The widened envelope must arrive untransformed - see D12.
  it('passes optional telemetry through untransformed', async () => {
    await service.ingest(
      USER,
      dto({ accuracy: 5, speed: 1.5, heading: null, batteryLevel: 80, isCharging: true }) as never,
    );
    const args = journeySessionService.recordTrackedFixes.mock.calls[0][1];
    expect(args.fixes[0].accuracy).toBe(5);
    expect(args.fixes[0].heading).toBeNull();
    expect(args.fixes[0].isCharging).toBe(true);
  });

  it('converts recordedAt to a Date before the service sees it', async () => {
    await service.ingest(USER, dto() as never);
    const args = journeySessionService.recordTrackedFixes.mock.calls[0][1];
    expect(args.fixes[0].recordedAt).toBeInstanceOf(Date);
  });

  it('404s an unknown session', async () => {
    prisma.journeySession.findUnique.mockResolvedValue(null);
    await expect(service.ingest(USER, dto() as never)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  // Not a 403: the response must not confirm the id exists.
  it('404s a session owned by another user', async () => {
    prisma.journeySession.findUnique.mockResolvedValue({
      ...openSession,
      userId: 'someone-else',
    });
    await expect(service.ingest(USER, dto() as never)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(journeySessionService.recordTrackedFixes).not.toHaveBeenCalled();
  });

  it('409s an ended session', async () => {
    prisma.journeySession.findUnique.mockResolvedValue({
      ...openSession,
      status: 'ENDED',
    });
    await expect(service.ingest(USER, dto() as never)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rejects a fix from too far in the future', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await expect(
      service.ingest(USER, dto({ recordedAt: future }) as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a fix from before the session started', async () => {
    const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await expect(
      service.ingest(USER, dto({ recordedAt: old }) as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // Control: nothing above passes merely because every call throws.
  it('accepts a fix at the current time', async () => {
    await expect(service.ingest(USER, dto() as never)).resolves.toBeDefined();
  });

  describe('startSession', () => {
    const stored = {
      id: SESSION,
      status: 'STARTED',
      purpose: 'MANUAL',
      startedAt: new Date(),
      lastFixReceivedAt: null,
    };

    it('returns the resolved session in wire shape', async () => {
      journeySessionService.resolveForActivation.mockResolvedValue(stored);

      const result = await service.startSession(USER, {} as never);

      expect(result.sessionId).toBe(SESSION);
      expect(result.status).toBe('STARTED');
      expect(result.lastFixReceivedAt).toBeNull();
      expect(typeof result.startedAt).toBe('string');
    });

    it('defaults to MANUAL rather than INCIDENT', async () => {
      journeySessionService.resolveForActivation.mockResolvedValue(stored);

      await service.startSession(USER, {} as never);

      const args = journeySessionService.resolveForActivation.mock.calls[0];
      expect(args[2]).toBe('MANUAL');
    });

    it('passes a requested purpose through', async () => {
      journeySessionService.resolveForActivation.mockResolvedValue(stored);

      await service.startSession(USER, { purpose: 'SAFEWALK' } as never);

      const args = journeySessionService.resolveForActivation.mock.calls[0];
      expect(args[2]).toBe('SAFEWALK');
    });

    // The honest signal that a reuse happened: what comes back is what is
    // STORED, not what was asked for.
    it('returns the stored purpose, not the requested one', async () => {
      journeySessionService.resolveForActivation.mockResolvedValue({
        ...stored,
        purpose: 'INCIDENT',
      });

      const result = await service.startSession(USER, { purpose: 'SAFEWALK' } as never);

      expect(result.purpose).toBe('INCIDENT');
    });

    it('reports reused=false when no session existed', async () => {
      journeySessionService.resolveForActivation.mockResolvedValue(stored);
      prisma.journeySession.findFirst.mockResolvedValue(null);

      const result = await service.startSession(USER, {} as never);

      expect(result.reused).toBe(false);
    });

    it('reports reused=true when an open session already existed', async () => {
      journeySessionService.resolveForActivation.mockResolvedValue(stored);
      prisma.journeySession.findFirst.mockResolvedValue({ id: SESSION });

      const result = await service.startSession(USER, {} as never);

      expect(result.reused).toBe(true);
    });

    // The existence check must be serialised or it races.
    it('takes the lifecycle lock before looking', async () => {
      journeySessionService.resolveForActivation.mockResolvedValue(stored);
      prisma.journeySession.findFirst.mockResolvedValue(null);

      await service.startSession(USER, {} as never);

      expect(prisma.$executeRaw).toHaveBeenCalled();
    });

    it('runs inside a transaction', async () => {
      journeySessionService.resolveForActivation.mockResolvedValue(stored);
      prisma.journeySession.findFirst.mockResolvedValue(null);

      await service.startSession(USER, {} as never);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });
});
