import { reconcilePlanItem } from './reconcile-legacy-open-incidents.logic';

type VerificationResult = {
  valid: boolean;
  brokenAtSequence?: number;
};

describe('legacy reconciliation runner apply item', () => {
  const item = {
    incidentId: 'incident-stale',
    userId: 'user-1',
    evidenceIncidentId: 'incident-resolved',
    lastTriggeredAt: new Date(
      '2026-08-06T13:15:46.174Z',
    ),
  };

  function build() {
    const calls: string[] = [];

    const incidentsService = {
      reconcileLegacyDuplicate: jest.fn(
        async (
          incidentId: string,
          userId: string,
          evidenceIncidentId: string,
          expectedLastTriggeredAt: Date,
        ) => {
          calls.push('reconcile');

          return {
            id: incidentId,
            status: 'CANCELLED',
            resolvedAt: null,
            evidenceIncidentId,
            evidenceResolvedAt: new Date(
              '2026-08-09T05:19:52.516Z',
            ),
            revokedTokens: 1,
            endedJourneySessionId: null,
            userId,
            expectedLastTriggeredAt,
          };
        },
      ),
    };

    const timeline = {
      verifyStructuralChain: jest.fn(
        async (): Promise<VerificationResult> => {
          calls.push('structural');
          return { valid: true };
        },
      ),

      verifyTailEvent: jest.fn(
        async (): Promise<VerificationResult> => {
          calls.push('tail');
          return { valid: true };
        },
      ),
    };

    return {
      calls,
      incidentsService,
      timeline,
    };
  }

  it('runs structural verification before reconciliation and tail verification after', async () => {
    const {
      calls,
      incidentsService,
      timeline,
    } = build();

    await reconcilePlanItem(item, {
      incidentsService: incidentsService as never,
      timeline: timeline as never,
    });

    expect(calls).toEqual([
      'structural',
      'reconcile',
      'tail',
    ]);
  });

  it('refuses structural damage before any mutation', async () => {
    const {
      incidentsService,
      timeline,
    } = build();

    timeline.verifyStructuralChain.mockResolvedValueOnce({
      valid: false,
      brokenAtSequence: 2,
    });

    await expect(
      reconcilePlanItem(item, {
        incidentsService: incidentsService as never,
        timeline: timeline as never,
      }),
    ).rejects.toThrow(
      'PREVERIFY_STRUCTURAL_FAILED incident=incident-stale sequence=2',
    );

    expect(
      timeline.verifyStructuralChain,
    ).toHaveBeenCalledTimes(1);

    expect(
      timeline.verifyStructuralChain,
    ).toHaveBeenCalledWith(
      item.incidentId,
    );

    expect(
      incidentsService.reconcileLegacyDuplicate,
    ).not.toHaveBeenCalled();

    expect(
      timeline.verifyTailEvent,
    ).not.toHaveBeenCalled();
  });

  it('passes the planned lastTriggeredAt race pin unchanged', async () => {
    const {
      incidentsService,
      timeline,
    } = build();

    await reconcilePlanItem(item, {
      incidentsService: incidentsService as never,
      timeline: timeline as never,
    });

    expect(
      incidentsService.reconcileLegacyDuplicate,
    ).toHaveBeenCalledWith(
      item.incidentId,
      item.userId,
      item.evidenceIncidentId,
      item.lastTriggeredAt,
    );
  });

  it('verifies the new tail exactly once after mutation', async () => {
    const {
      incidentsService,
      timeline,
    } = build();

    await reconcilePlanItem(item, {
      incidentsService: incidentsService as never,
      timeline: timeline as never,
    });

    expect(
      incidentsService.reconcileLegacyDuplicate,
    ).toHaveBeenCalledTimes(1);

    expect(
      timeline.verifyTailEvent,
    ).toHaveBeenCalledTimes(1);

    expect(
      timeline.verifyTailEvent,
    ).toHaveBeenCalledWith(
      item.incidentId,
    );
  });

  it('fails loudly when the newly appended tail is invalid', async () => {
    const {
      incidentsService,
      timeline,
    } = build();

    timeline.verifyTailEvent.mockResolvedValueOnce({
      valid: false,
      brokenAtSequence: 4,
    });

    await expect(
      reconcilePlanItem(item, {
        incidentsService: incidentsService as never,
        timeline: timeline as never,
      }),
    ).rejects.toThrow(
      'POSTVERIFY_TAIL_FAILED incident=incident-stale sequence=4',
    );

    expect(
      incidentsService.reconcileLegacyDuplicate,
    ).toHaveBeenCalledTimes(1);
  });

  it('propagates a retrigger race refusal and never verifies a nonexistent new tail', async () => {
    const {
      incidentsService,
      timeline,
    } = build();

    incidentsService.reconcileLegacyDuplicate
      .mockRejectedValueOnce(
        new Error(
          'Incident was retriggered after the reconciliation plan was computed.',
        ),
      );

    await expect(
      reconcilePlanItem(item, {
        incidentsService: incidentsService as never,
        timeline: timeline as never,
      }),
    ).rejects.toThrow(
      'Incident was retriggered after the reconciliation plan was computed.',
    );

    expect(
      timeline.verifyStructuralChain,
    ).toHaveBeenCalledTimes(1);

    expect(
      timeline.verifyTailEvent,
    ).not.toHaveBeenCalled();
  });
});