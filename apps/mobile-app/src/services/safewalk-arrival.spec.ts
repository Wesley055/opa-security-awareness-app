jest.mock('./api', () => ({ backgroundApi: { post: jest.fn() } }));
import { ARRIVAL_DWELL_MS, distanceMeters, evaluateArrival, isSafeWalkResponse, SAFEWALK_KIND, SAFEWALK_SAFE_ACTION, type ArrivalTarget } from './safewalk-arrival';

const target: ArrivalTarget = { sessionId: 's', latitude: 6.44, longitude: 3.47, radiusMeters: 100, label: 'Shoprite', expectedArrivalAt: '2026-10-25T18:00:00Z' };
const at = (t: number, dLat = 0, accuracy: number | null = 10) => ({ latitude: 6.44 + dLat, longitude: 3.47, accuracy, timestamp: t });
const fresh = { sessionId: 's', insideSince: null, detectedAt: null };

it('measures distance in metres', () => {
  expect(Math.round(distanceMeters({ latitude: 6.44, longitude: 3.47 }, { latitude: 6.441, longitude: 3.47 }))).toBe(111);
});

it('detects arrival only after about a minute inside the area', () => {
  expect(evaluateArrival(fresh, target, [at(0), at(30_000)]).detected).toBe(false);
  const r = evaluateArrival(fresh, target, [at(0), at(30_000), at(ARRIVAL_DWELL_MS)]);
  expect(r.detected).toBe(true);
  expect(r.state.detectedAt).toBe(ARRIVAL_DWELL_MS);
});

it('walking past the destination does not count', () => {
  const r = evaluateArrival(fresh, target, [at(0), at(30_000), at(45_000, 0.01), at(70_000)]);
  expect(r.detected).toBe(false);
  expect(r.state.insideSince).toBe(70_000);
});

it('a vague fix neither starts nor breaks the wait', () => {
  expect(evaluateArrival(fresh, target, [at(0, 0, 400), at(70_000, 0, 400)]).detected).toBe(false);
  expect(evaluateArrival(fresh, target, [at(0), at(30_000, 0.01, 400), at(65_000)]).detected).toBe(true);
});

it('prompts once per journey and resets for a new one', () => {
  const done = { sessionId: 's', insideSince: 0, detectedAt: 60_000 };
  expect(evaluateArrival(done, target, [at(200_000)]).detected).toBe(false);
  expect(evaluateArrival(done, { ...target, sessionId: 'other' }, [at(0)]).state).toEqual({ sessionId: 'other', insideSince: 0, detectedAt: null });
});

it('recognises the "I\'m safe" action from a SafeWalk prompt only', () => {
  const response = (data: object, actionIdentifier: string) => ({ actionIdentifier, notification: { request: { content: { data } } } }) as never;
  expect(isSafeWalkResponse(response({ opaKind: SAFEWALK_KIND, sessionId: 's' }, SAFEWALK_SAFE_ACTION))).toEqual({ action: 'SAFE', sessionId: 's' });
  expect(isSafeWalkResponse(response({ opaKind: 'opa-protection-ready' }, SAFEWALK_SAFE_ACTION))).toBeNull();
});
