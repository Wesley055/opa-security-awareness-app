import {
  toReaderTimelineEvent,
  type ReaderTimelineEvent,
} from './timeline-event.dto';

/**
 * The projection is what stands between internal payloads and whoever calls
 * GET /incidents/:incidentId/timeline. These tests assert what it EMITS,
 * because unlike a Prisma select there is no database to constrain it.
 *
 * NOT ALL EXCLUSIONS. Four tests prove fields survive - including falsy
 * ones - and three prove fields are dropped. A projection that returned {}
 * for everything would pass an exclusion-only suite completely.
 */
describe('toReaderTimelineEvent', () => {
  const OCCURRED = new Date('2026-08-14T07:46:39.912Z');

  function event(type: string, payload: unknown) {
    return {
      sequence: 1,
      type,
      occurredAt: OCCURRED,
      source: 'INCIDENT_ORCHESTRATOR',
      payload,
    };
  }

  it('returns the reader fields and nothing else', () => {
    const result = toReaderTimelineEvent(
      event('INCIDENT_CREATED', { trigger: 'SOS_BUTTON', silentMode: false }),
    );

    expect(Object.keys(result).sort()).toEqual([
      'display',
      'occurredAt',
      'sequence',
      'source',
      'type',
    ]);
  });

  it('drops every internal field a raw event carries', () => {
    // The real row also has id, incidentId, actorUserId, correlationId,
    // recordedAt, previousHash and hash. None may survive, and neither may
    // the raw payload itself.
    const raw = {
      ...event('INCIDENT_RESOLVED', {
        reason: 'USER_SAFE',
        previousStatus: 'OPEN',
        newStatus: 'RESOLVED',
        revokedTokens: 1,
        endedJourneySessionId: 'bad7a799-bb26-497e-9a30-3712c11681ee',
      }),
    };

    const result = toReaderTimelineEvent(raw) as ReaderTimelineEvent &
      Record<string, unknown>;

    expect(result.payload).toBeUndefined();
    expect(result.hash).toBeUndefined();
    expect(result.previousHash).toBeUndefined();
    expect(result.actorUserId).toBeUndefined();
    expect(result.correlationId).toBeUndefined();
    expect(result.incidentId).toBeUndefined();
    expect(result.recordedAt).toBeUndefined();

    // And the two internal payload fields must not reach display.
    expect(result.display.revokedTokens).toBeUndefined();
    expect(result.display.endedJourneySessionId).toBeUndefined();
  });

  it('copies only allowlisted keys from a known payload', () => {
    // The real INCIDENT_CREATED payload also carries confidenceLevel and
    // confidenceScore, which are detection-model internals.
    const result = toReaderTimelineEvent(
      event('INCIDENT_CREATED', {
        trigger: 'SOS_BUTTON',
        silentMode: false,
        confidenceLevel: 'LOW',
        confidenceScore: 20,
      }),
    );

    expect(result.display).toEqual({
      trigger: 'SOS_BUTTON',
      silentMode: false,
    });
  });

  it('omits an allowlisted key the payload does not have', () => {
    // close() spreads reason in only when supplied, so a cancellation with
    // no reason has no such key. The allowlist must not manufacture one.
    const result = toReaderTimelineEvent(
      event('INCIDENT_CANCELLED', {
        previousStatus: 'OPEN',
        newStatus: 'CANCELLED',
        revokedTokens: 0,
      }),
    );

    expect(result.display).toEqual({
      previousStatus: 'OPEN',
      newStatus: 'CANCELLED',
    });
    expect('reason' in result.display).toBe(false);
  });

  it('preserves false and zero', () => {
    // Presence, not truthiness. queued: 0 means nobody was notified, which
    // an operator needs to know; silentMode: false is a real answer.
    const queued = toReaderTimelineEvent(
      event('NOTIFICATIONS_QUEUED', { queued: 0 }),
    );
    expect(queued.display).toEqual({ queued: 0 });

    const created = toReaderTimelineEvent(
      event('INCIDENT_CREATED', { trigger: 'SOS_BUTTON', silentMode: false }),
    );
    expect(created.display.silentMode).toBe(false);
  });

  it('keeps an unknown event type with an empty display', () => {
    // type is a free-form string. An audit trail that silently drops an
    // event it cannot label is worse than one showing a bare label.
    const result = toReaderTimelineEvent(
      event('SOMETHING_NOBODY_HAS_WRITTEN_YET', { secret: 'value' }),
    );

    expect(result.type).toBe('SOMETHING_NOBODY_HAS_WRITTEN_YET');
    expect(result.sequence).toBe(1);
    expect(result.source).toBe('INCIDENT_ORCHESTRATOR');
    expect(result.display).toEqual({});
  });

  it('returns an empty display for a payload that is not an object', () => {
    // payload is Json? - it can be null, and jsonb can hold an array or a
    // scalar. None of those have allowlisted keys.
    expect(toReaderTimelineEvent(event('INCIDENT_CREATED', null)).display).toEqual({});
    expect(toReaderTimelineEvent(event('INCIDENT_CREATED', [1, 2])).display).toEqual({});
    expect(toReaderTimelineEvent(event('INCIDENT_CREATED', 'text')).display).toEqual({});
  });

  it('allowlists exactly the agreed keys for every known type', () => {
    // One assertion per type, each passing a payload with every allowlisted
    // key plus an intruder. This fails if a key is dropped from the list
    // AND if one is added - the half that keeps internals out.
    const cases: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
      [
        'LOCATION_ATTACHED',
        { latitude: 1, longitude: 2, intruder: 'x' },
        { latitude: 1, longitude: 2 },
      ],
      [
        'INCIDENT_RESOLVED',
        {
          reason: 'USER_SAFE',
          previousStatus: 'OPEN',
          newStatus: 'RESOLVED',
          intruder: 'x',
        },
        { reason: 'USER_SAFE', previousStatus: 'OPEN', newStatus: 'RESOLVED' },
      ],
      [
        'SOS_RETRIGGERED',
        {
          triggerMethod: 'SOS_BUTTON',
          latitude: 1,
          longitude: 2,
          retriggerCount: 3,
          secondsSinceInitialTrigger: 45,
          dedupeWindowSeconds: 60,
          retriggeredAt: '2026-08-14T07:46:39.912Z',
        },
        {
          triggerMethod: 'SOS_BUTTON',
          latitude: 1,
          longitude: 2,
          retriggerCount: 3,
          secondsSinceInitialTrigger: 45,
        },
      ],
      [
        'EVIDENCE_ADDED',
        {
          evidenceType: 'PHOTO',
          sizeBytes: 1024,
          evidenceId: 'uuid-here',
          sha256: 'abc123',
        },
        { evidenceType: 'PHOTO', sizeBytes: 1024 },
      ],
    ];

    for (const [type, payload, expected] of cases) {
      expect(toReaderTimelineEvent(event(type, payload)).display).toEqual(
        expected,
      );
    }
  });
});
