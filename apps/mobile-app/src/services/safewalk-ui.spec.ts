import React from 'react';
const { create, act } = jest.requireActual('react-test-renderer') as {
  create(element: React.ReactElement): { toJSON(): unknown; unmount(): void };
  act(work: () => void | Promise<void>): Promise<void>;
};
import SafeWalkScreen from '../../app/safewalk';
import { useSafeWalk } from './safewalk';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('./api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('./safewalk', () => ({ useSafeWalk: jest.fn(), refreshSafeWalk: jest.fn().mockResolvedValue(undefined), createSafeWalk: jest.fn(), confirmSafeWalk: jest.fn(), escalateSafeWalk: jest.fn() }));
jest.mock('./journey-tracker', () => ({ trackerDebugState: () => ({ running: false, durableQueued: 4, sessionId: null }) }));

it('renders the owner safety prompt, unavailable tracking and explicit controls without implying delivery', async () => {
  (useSafeWalk as unknown as jest.Mock).mockReturnValue({ refreshedAt: Date.now(), error: null, journey: { id: 'journey', status: 'ACTIVE', destinationLabel: 'Home', expectedArrivalAt: '2026-09-11T12:00:00Z', lastFixReceivedAt: null, guardianGrants: [], safeWalkNotices: [], safetyChecksEnabled: true, safeWalkEscalation: { state: 'CHECK_REQUIRED', responseDueAt: '2026-09-11T12:08:00Z' } } });
  let renderer: ReturnType<typeof create>;
  await act(async () => { renderer = create(React.createElement(SafeWalkScreen)); });
  const visible = JSON.stringify(renderer!.toJSON());
  expect(visible).toContain('Please confirm you are safe');
  expect(visible).toContain('Location tracking is unavailable');
  expect(visible).toContain('queued alert does not prove delivery');
  expect(visible).toContain('I have arrived');
  expect(visible).toContain('Escalate emergency');
  await act(async () => renderer!.unmount());
}, 30000);
