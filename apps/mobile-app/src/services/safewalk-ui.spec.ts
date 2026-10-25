import React from 'react';
const { create, act } = jest.requireActual('react-test-renderer') as {
  create(element: React.ReactElement): { toJSON(): unknown; unmount(): void };
  act(work: () => void | Promise<void>): Promise<void>;
};
import SafeWalkScreen, { friendlyError, minutesAgo } from '../../app/safewalk';
import { useSafeWalk } from './safewalk';
import { api } from './api';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('expo-location', () => ({ getLastKnownPositionAsync: jest.fn().mockResolvedValue(null), requestForegroundPermissionsAsync: jest.fn(), Accuracy: { High: 4 } }));
jest.mock('./api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('./safewalk', () => ({ useSafeWalk: jest.fn(), refreshSafeWalk: jest.fn().mockResolvedValue(undefined), createSafeWalk: jest.fn(), confirmSafeWalk: jest.fn(), escalateSafeWalk: jest.fn() }));
jest.mock('./journey-tracker', () => ({ trackerDebugState: () => ({ running: false, durableQueued: 4, sessionId: null }) }));

const render = async () => {
  let renderer: ReturnType<typeof create>;
  await act(async () => { renderer = create(React.createElement(SafeWalkScreen)); });
  const visible = JSON.stringify(renderer!.toJSON());
  await act(async () => renderer!.unmount());
  return visible;
};

beforeEach(() => {
  (api.get as jest.Mock).mockImplementation(async (url: string) =>
    url === '/safewalk/contacts'
      ? { data: [{ contactId: 'c1', name: 'Ada Obi', relationship: 'Sister', safeWalk: 'READY' }, { contactId: 'c2', name: 'Tunde', relationship: 'Friend', safeWalk: 'NOT_ASKED' }] }
      : { data: { places: [{ label: 'Home', latitude: 6.4, longitude: 3.4 }] } },
  );
});

it('plans a journey without coordinates: search, saved places, duration buttons and contacts who said YES', async () => {
  (useSafeWalk as unknown as jest.Mock).mockReturnValue({ refreshedAt: Date.now(), error: null, journey: null });
  const visible = await render();
  expect(visible).not.toMatch(/latitude/i);
  expect(visible).toContain('Where are you going?');
  expect(visible).toContain('Landmark, bus stop or market');
  expect(visible).toContain('Home');
  expect(visible).toContain('Describe it instead');
  for (const d of ['15 min', '30 min', '1 hour', '2 hours']) expect(visible).toContain(d);
  expect(visible).toContain('Ada Obi');
  expect(visible).toContain('Not asked yet');
  expect(visible).toContain("Don't use while driving");
  expect(visible).toContain('How SafeWalk protects your privacy');
  expect(visible).not.toContain('64');
});

it('active journey: big I\'m safe, discreet SOS, the overdue warning, and no raw states', async () => {
  (useSafeWalk as unknown as jest.Mock).mockReturnValue({ refreshedAt: Date.now(), error: null, journey: { id: 'journey', status: 'ACTIVE', destinationLabel: 'Shoprite Lekki', expectedArrivalAt: '2026-09-11T12:00:00Z', lastFixReceivedAt: null, guardianGrants: [], safeWalkNotices: [], safetyChecksEnabled: true, safeWalkEscalation: { state: 'CHECK_REQUIRED', responseDueAt: '2026-09-11T12:08:00Z' }, plan: { destinationKind: 'PLACE', destinationDescription: null, arrivalRadiusMeters: 100, arrivalDetectedAt: '2026-09-11T11:58:00Z', contacts: 2, contactsTexted: 0 } } });
  const visible = await render();
  expect(visible).toContain("I'm safe");
  expect(visible).toContain('SOS');
  expect(visible).toContain("You've arrived");
  expect(visible).toContain('your contacts will be told');
  expect(visible).toContain('2 people will get a text');
  expect(visible).toContain('4 location updates are saved');
  expect(visible).not.toContain('CHECK_REQUIRED');
});

it('never shows a raw status code', () => {
  expect(friendlyError({ response: { status: 503, data: { message: 'SafeWalk is not enabled.' } } }, 'x')).toBe("SafeWalk isn't available yet. Your journey was not started.");
  expect(friendlyError({ response: { status: 400, data: { message: 'SafeWalk requires destinationLabel' } } }, 'Try again.')).toBe('Try again.');
  expect(friendlyError({ response: { status: 429, data: { message: 'Too many searches. Wait a few minutes and try again.' } } }, 'x')).toBe('Too many searches. Wait a few minutes and try again.');
  expect(friendlyError(new Error('Network Error'), 'x')).toBe('No internet connection. Check your connection and try again.');
  expect(minutesAgo(new Date(Date.now() - 3 * 60_000).toISOString())).toBe('Location updated 3 min ago');
});
