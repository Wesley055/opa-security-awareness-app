import React from 'react';
import { Alert, Text, TouchableOpacity } from 'react-native';
import SosScreen from '../../app/sos';
import { router } from 'expo-router';
import { api } from './api';
import { useActiveIncidentStore } from '../store/activeIncidentStore';
import { getSosActivationMode } from './silent-sos';
import { startTracking, stopTracking } from './journey-tracker';
interface TestNode {
  props: { children?: unknown; touchSoundDisabled?: boolean; onPress: () => void };
  findAllByType(type: unknown): TestNode[];
}
const { create, act } = jest.requireActual('react-test-renderer') as {
  create(element: React.ReactElement): { root: TestNode; toJSON(): unknown; unmount(): void };
  act(work: () => void | Promise<void>): Promise<void>;
};
jest.mock('expo-router', () => ({ router: { replace: jest.fn(), back: jest.fn() } }));
jest.mock('./api', () => ({ api: { post: jest.fn(), patch: jest.fn() }, backgroundApi: { get: jest.fn() } }));
jest.mock('./foreground-execution', () => ({ isForegroundExecutionAllowed: () => true }));
jest.mock('./journey-tracker', () => ({ startTracking: jest.fn(async () => undefined), stopTracking: jest.fn(async () => undefined) }));
jest.mock('./silent-sos', () => ({ ...jest.requireActual('./silent-sos'), getSosActivationMode: jest.fn(() => 'SILENT') }));
jest.mock('expo-location', () => ({ Accuracy: { High: 4 }, requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted', canAskAgain: true })), getCurrentPositionAsync: jest.fn(async () => ({ coords: { latitude: 10, longitude: 20, accuracy: 5 } })) }));
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks();
  useActiveIncidentStore.getState().clearActiveIncident();
  (api.post as jest.Mock).mockResolvedValue({ data: { status: 'INCIDENT_ACTIVATED', incident: { id: 'open-1' }, notifications: { queued: 1, dispatched: false } } });
});
afterEach(() => { jest.useRealTimers(); });
it.each(['STANDARD', 'SILENT'] as const)('manual screen uses %s and creates the same incident', async mode => {
  (getSosActivationMode as jest.Mock).mockReturnValue(mode);
  let view!: ReturnType<typeof create>;
  await act(async () => { view = create(React.createElement(SosScreen)); });
  const countdown = JSON.stringify(view.toJSON());
  expect(countdown.includes('"fontSize":96')).toBe(mode === 'STANDARD');
  for (let second = 0; second < 5; second++) await act(async () => { jest.advanceTimersByTime(1000); });
  expect(api.post).toHaveBeenCalledWith('/incident-orchestrator/activate', expect.objectContaining({ triggerType: 'SOS_BUTTON', activationMode: mode, activationSource: 'MANUAL', latitude: 10, longitude: 20 }));
  expect(useActiveIncidentStore.getState().activeIncident).toMatchObject({ id: 'open-1', activationMode: mode });
  expect(startTracking).toHaveBeenCalledTimes(1);
  if (mode === 'SILENT') expect(router.replace).toHaveBeenCalledWith('/');
  else expect(router.replace).not.toHaveBeenCalled();
  for (const button of view.root.findAllByType(TouchableOpacity)) expect(button.props.touchSoundDisabled).toBe(mode === 'SILENT');
  await act(async () => view.unmount());
});
it('resumes silent safety controls and only stops tracking after confirmed resolution', async () => {
  useActiveIncidentStore.getState().setActiveIncident({ id: 'open-1', status: 'OPEN', activationMode: 'SILENT' });
  let view!: ReturnType<typeof create>;
  await act(async () => { view = create(React.createElement(SosScreen)); });
  expect(JSON.stringify(view.toJSON())).toContain('Safety controls');
  expect(api.post).not.toHaveBeenCalled();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const safe = view.root.findAllByType(TouchableOpacity).find(button => button.findAllByType(Text).some(text => text.props.children === "I'm safe"))!;
  await act(async () => safe.props.onPress());
  const confirm = alert.mock.calls[0][2]!.find(button => button.text === "I'm safe")!;
  (api.patch as jest.Mock).mockRejectedValueOnce(new Error('offline'));
  await act(async () => confirm.onPress?.());
  expect(stopTracking).not.toHaveBeenCalled();
  expect(useActiveIncidentStore.getState().activeIncident?.id).toBe('open-1');
  await act(async () => safe.props.onPress());
  (api.patch as jest.Mock).mockResolvedValueOnce({ data: { status: 'RESOLVED' } });
  await act(async () => alert.mock.calls[1][2]!.find(button => button.text === "I'm safe")!.onPress?.());
  expect(api.patch).toHaveBeenLastCalledWith('/incidents/open-1/resolve', { reason: 'USER_SAFE' });
  expect(stopTracking).toHaveBeenCalledTimes(1);
  expect(useActiveIncidentStore.getState().activeIncident).toBeNull();
  await act(async () => view.unmount());
});
