jest.mock('../config/api-config', () => ({ API_BASE_URL: 'https://opa.example.test' }));
import { AppState, type AppStateStatus } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { api, backgroundApi } from './api';
import { useAuthStore } from '../store/authStore';
import { useActiveIncidentStore } from '../store/activeIncidentStore';
import { homeEmergencyAction } from './active-incident-ui-policy';
import { startActiveIncidentReconciliation } from './active-incident-reconciliation';
jest.mock('react-native', () => ({ AppState: { currentState: 'active', addEventListener: jest.fn() } }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn() }));
jest.mock('./api', () => ({ ACCESS_TOKEN_KEY: 'a', REFRESH_TOKEN_KEY: 'r', api: { get: jest.fn(), post: jest.fn() }, backgroundApi: { get: jest.fn() } }));
const user = { id: 'resident', firstName: 'Blessing', lastName: 'Resident', email: 'resident@example.com', role: 'USER' };
const get = backgroundApi.get as jest.Mock;
let change: (state: AppStateStatus) => void;
let stop: () => void;
let remove: jest.Mock;
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
function active() { return useActiveIncidentStore.getState().activeIncident; }
async function restore() {
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('stored-token');
  (api.get as jest.Mock).mockResolvedValue({ data: user });
  await useAuthStore.getState().checkAuth(); await settle();
}
beforeEach(() => {
  jest.resetAllMocks();
  useAuthStore.setState({ user: null, isLoading: true, isAuthenticated: false });
  useActiveIncidentStore.getState().clearActiveIncident();
  remove = jest.fn();
  (AppState.addEventListener as jest.Mock).mockImplementation((_event, listener) => { change = listener; return { remove }; });
  get.mockResolvedValue({ data: [] });
  stop = startActiveIncidentReconciliation();
});
afterEach(() => stop());
it.each([true, false])('cold restored session reconciles OPEN=%s without Home mounting', async open => {
  expect(get).not.toHaveBeenCalled();
  get.mockResolvedValue({ data: open ? [{ id: 'open', status: 'OPEN' }] : [] });
  await restore();
  expect(homeEmergencyAction(active())).toBe(open ? 'OPEN_ACTIVE_INCIDENT' : 'ACTIVATE_SOS');
  expect(active()).toEqual(open ? { id: 'open', status: 'OPEN' } : null);
  expect(useAuthStore.getState()).toMatchObject({ isAuthenticated: true, user });
  expect(get).toHaveBeenCalledTimes(1);
  expect(get).toHaveBeenCalledWith('/incidents');
  expect(api.get).toHaveBeenCalledTimes(1);
  expect(api.get).toHaveBeenCalledWith('/users/me');
});
it('reconciles a Headless-created OPEN incident on resume without activation', async () => {
  await restore(); change('background');
  get.mockResolvedValue({ data: [{ id: 'locked-open', status: 'OPEN' }] });
  change('active'); await settle();
  expect(active()?.id).toBe('locked-open'); expect(get).toHaveBeenCalledTimes(2);
  expect(api.post).not.toHaveBeenCalled();
});
it('fresh login still reconciles through the root lifecycle', async () => {
  (api.post as jest.Mock).mockResolvedValue({ data: { user, accessToken: 'a', refreshToken: 'r' } });
  get.mockResolvedValue({ data: [{ id: 'login-open', status: 'OPEN' }] });
  await useAuthStore.getState().login(user.email, 'password'); await settle();
  expect(active()?.id).toBe('login-open'); expect(get).toHaveBeenCalledTimes(1);
});
it('preserves identity and valid local state on failed reconciliation and retries on resume', async () => {
  useActiveIncidentStore.getState().setActiveIncident({ id: 'local', status: 'OPEN' });
  get.mockRejectedValue(new Error('network/auth unavailable'));
  await restore();
  expect(active()?.id).toBe('local');
  expect(useAuthStore.getState()).toMatchObject({ isAuthenticated: true, user });
  expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
  expect(useActiveIncidentStore.getState().isReconciling).toBe(false);
  get.mockResolvedValue({ data: [{ id: 'local', status: 'OPEN' }] });
  change('background'); change('active'); await settle();
  expect(get).toHaveBeenCalledTimes(2);
});
it('coalesces repeated resume transitions into one follow-up while a read is pending', async () => {
  let finish!: (value: unknown) => void;
  get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await restore();
  for (let i = 0; i < 10; i++) { change('background'); change('active'); change('active'); }
  expect(get).toHaveBeenCalledTimes(1);
  get.mockResolvedValue({ data: [{ id: 'latest', status: 'OPEN' }] });
  finish({ data: [] }); await settle();
  expect(get).toHaveBeenCalledTimes(2); expect(active()?.id).toBe('latest');
  change('active'); change('active'); await settle(); expect(get).toHaveBeenCalledTimes(2);
});
it.each(['safe', 'activation', 'logout', 'unmount'])('ignores a stale read after %s', async reason => {
  let finish!: (value: unknown) => void;
  get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await restore();
  if (reason === 'safe') useActiveIncidentStore.getState().clearActiveIncident();
  if (reason === 'activation') useActiveIncidentStore.getState().setActiveIncident({ id: 'new', status: 'OPEN' });
  if (reason === 'logout') await useAuthStore.getState().logout();
  if (reason === 'unmount') stop();
  finish({ data: reason === 'activation' ? [] : [{ id: 'old', status: 'OPEN' }] }); await settle();
  expect(active()).toEqual(reason === 'activation' ? { id: 'new', status: 'OPEN' } : null);
  if (reason === 'unmount') expect(remove).toHaveBeenCalledTimes(1);
});
