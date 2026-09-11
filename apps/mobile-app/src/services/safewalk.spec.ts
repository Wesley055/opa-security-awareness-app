import * as SecureStore from 'expo-secure-store';
import { api, backgroundApi } from './api';
import { startTracking, stopTracking } from './journey-tracker';
import { createSafeWalk, escalateSafeWalk, refreshSafeWalk, useSafeWalk } from './safewalk';
import { useAuthStore } from '../store/authStore';

jest.mock('./api', () => ({ api: { post: jest.fn() }, backgroundApi: { get: jest.fn() } }));
jest.mock('./journey-background-task', () => ({ BACKGROUND_SESSION_KEY: 'background-session' }));
jest.mock('./journey-tracker', () => ({ startTracking: jest.fn(), stopTracking: jest.fn(), trackerDebugState: () => ({ sessionId: null }) }));
jest.mock('../store/authStore', () => ({ useAuthStore: { getState: jest.fn(), subscribe: jest.fn() } }));
jest.mock('../store/activeIncidentStore', () => ({ useActiveIncidentStore: { getState: () => ({ setActiveIncident: jest.fn() }) } }));
const post = api.post as jest.Mock;
const get = backgroundApi.get as jest.Mock;
const session = { id: 'session', status: 'ACTIVE', guardianGrants: [] };
beforeEach(() => {
  (useAuthStore.getState as jest.Mock).mockReturnValue({ user: { id: 'owner' }, isAuthenticated: true, isLoading: false });
  useSafeWalk.setState({ journey: null, error: null, refreshedAt: null });
  jest.spyOn(SecureStore, 'getItemAsync').mockResolvedValue(null);
  jest.spyOn(SecureStore, 'setItemAsync').mockResolvedValue();
  jest.spyOn(SecureStore, 'deleteItemAsync').mockResolvedValue();
});

it('resumes the server-owned journey using its exact session and existing queue', async () => {
  get.mockResolvedValue({ data: session });
  await refreshSafeWalk();
  expect(startTracking).toHaveBeenCalledWith({ existingSessionId: 'session' });
  expect(post).not.toHaveBeenCalled();
});

it('does not apply a response after an account switch', async () => {
  get.mockImplementation(async () => { (useAuthStore.getState as jest.Mock).mockReturnValue({ user: { id: 'different-owner' } }); return { data: session }; });
  await refreshSafeWalk();
  expect(useSafeWalk.getState().journey).toBeNull();
  expect(startTracking).not.toHaveBeenCalled();
});

it('cleans up a cold-start background walk only after owner terminal confirmation', async () => {
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('session');
  get.mockResolvedValueOnce({ data: null }).mockResolvedValueOnce({ data: { ...session, status: 'ENDED' } });
  await refreshSafeWalk();
  expect(stopTracking).toHaveBeenCalledWith('session');
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('opa.safewalk.session.owner');
});

it('does not stop background capture when terminal state cannot be verified', async () => {
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('session');
  get.mockResolvedValueOnce({ data: null }).mockRejectedValueOnce(new Error('offline'));
  await refreshSafeWalk();
  expect(stopTracking).not.toHaveBeenCalled();
});

it('preserves last-known state and reports uncertainty when offline', async () => {
  useSafeWalk.setState({ journey: session as never });
  get.mockRejectedValue(new Error('offline'));
  await refreshSafeWalk();
  expect(useSafeWalk.getState().journey?.id).toBe('session');
  expect(useSafeWalk.getState().error).toContain('out of date');
  expect(startTracking).not.toHaveBeenCalled();
});

it('persists the key before create and retains it after an uncertain response', async () => {
  post.mockImplementation(async (url: string) => { if (url.endsWith('create-key')) return { data: { key: 'durable-key' } }; throw new Error('response lost'); });
  await expect(createSafeWalk({ destinationLabel: 'Home', destinationLatitude: 1, destinationLongitude: 2, expectedArrivalAt: '2026-09-11T12:00:00Z', guardianCodes: [] })).rejects.toThrow('response lost');
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith('opa.safewalk.create.owner', expect.stringContaining('durable-key'));
  expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
});

it('uses the existing emergency activation endpoint only after explicit action', async () => {
  useSafeWalk.setState({ journey: session as never });
  post.mockResolvedValue({ data: { incident: { id: 'incident', status: 'OPEN' } } });
  get.mockResolvedValue({ data: session });
  expect(await escalateSafeWalk()).toBe('incident');
  expect(post).toHaveBeenCalledWith('/incident-orchestrator/activate', expect.objectContaining({ safeWalkSessionId: 'session', triggerType: 'SOS_BUTTON', userConfirmed: true }));
});

it('rejects an emergency response received after an account switch', async () => {
  useSafeWalk.setState({ journey: session as never });
  post.mockImplementation(async () => {
    (useAuthStore.getState as jest.Mock).mockReturnValue({ user: { id: 'other' } });
    return { data: { incident: { id: 'incident', status: 'OPEN' } } };
  });
  await expect(escalateSafeWalk()).rejects.toThrow('account changed');
  expect(get).not.toHaveBeenCalled();
});
