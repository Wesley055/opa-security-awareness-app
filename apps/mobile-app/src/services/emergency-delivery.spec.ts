import * as SMS from 'expo-sms';
import { api } from './api';
import { clearPending, composeSms, createActivation, loadPending, retryPending, savePending, sendOnce } from './emergency-delivery';

const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => { mockStore.set(k, v); }),
  deleteItemAsync: jest.fn(async (k: string) => { mockStore.delete(k); }),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => '7a0f9a54-3b8e-4c47-9a39-2f8a6f1c2d11' }));
jest.mock('expo-sms', () => ({ isAvailableAsync: jest.fn(async () => true), sendSMSAsync: jest.fn(async () => ({ result: 'sent' })) }));
jest.mock('./api', () => ({ api: { post: jest.fn() } }));

const base = { activationMode: 'SILENT' as const, activationSource: 'MANUAL' as const, latitude: 6.48566, longitude: 3.36307, accuracy: 12 };

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
});

it('creates the activation at the press with its own id and press time', () => {
  const a = createActivation(base, new Date('2026-10-24T03:00:00Z'));
  expect(a).toMatchObject({ activationId: '7a0f9a54-3b8e-4c47-9a39-2f8a6f1c2d11', pressedAt: '2026-10-24T03:00:00.000Z', smsSentAt: null });
});

it('keeps the saved alert when OPA does not answer (offline, timeout)', async () => {
  const a = createActivation(base);
  await savePending(a);
  (api.post as jest.Mock).mockRejectedValueOnce(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }));
  await expect(sendOnce(a)).resolves.toEqual({ kind: 'PENDING' });
  expect(await loadPending()).toMatchObject({ activationId: a.activationId });
});

it('sends the same activation id and press time, and forgets the copy once OPA confirms', async () => {
  const a = createActivation(base);
  await savePending(a);
  (api.post as jest.Mock).mockResolvedValueOnce({ data: { status: 'INCIDENT_ACTIVATED', incident: { id: 'incident-1' } } });
  const outcome = await sendOnce(a);
  expect(outcome.kind).toBe('ACKNOWLEDGED');
  expect(api.post).toHaveBeenCalledWith('/incident-orchestrator/activate', expect.objectContaining({ activationId: a.activationId, pressedAt: a.pressedAt, latitude: 6.48566 }), { timeout: 8000 });
  expect(await loadPending()).toBeNull();
});

it('stops retrying when OPA answers with a refusal', async () => {
  const a = createActivation(base);
  await savePending(a);
  (api.post as jest.Mock).mockRejectedValueOnce({ response: { status: 400, data: { message: 'Invalid request' } } });
  await expect(sendOnce(a)).resolves.toEqual({ kind: 'REJECTED', message: 'Invalid request' });
  expect(await loadPending()).toBeNull();
});

it('drops a saved press older than a day instead of raising it silently', async () => {
  await savePending({ ...createActivation(base), pressedAt: new Date(Date.now() - 25 * 3600_000).toISOString() });
  await expect(retryPending()).resolves.toBeNull();
  expect(api.post).not.toHaveBeenCalled();
  expect(await loadPending()).toBeNull();
});

it('fills the SMS screen with the keyword and the signed message for the short code', async () => {
  mockStore.set('opa.sms-fallback', JSON.stringify({ keyId: 'ABCDEFGH', key: Buffer.alloc(32, 1).toString('base64'), shortCode: '12345', keyword: 'OPA' }));
  const a = createActivation(base);
  await savePending(a);
  await expect(composeSms(a)).resolves.toBe('SENT');
  const [to, message] = (SMS.sendSMSAsync as jest.Mock).mock.calls[0];
  expect(to).toEqual(['12345']);
  expect(message).toMatch(/^OPA OPA1 eg-aVDuOTEeaOS-KbxwtEQ 6\.48566,3\.36307 12 [0-9a-z]+ S ABCDEFGH [A-Za-z0-9_-]{16}$/);
  expect(JSON.parse(mockStore.get('opa.pending-activation')!).smsSentAt).toEqual(expect.any(String));
});

it('does not bring back an alert OPA already confirmed', async () => {
  mockStore.set('opa.sms-fallback', JSON.stringify({ keyId: 'ABCDEFGH', key: Buffer.alloc(32, 1).toString('base64'), shortCode: '12345', keyword: null }));
  const a = createActivation(base);
  await clearPending();
  await composeSms(a);
  expect(await loadPending()).toBeNull();
});

it('reports SMS unavailable without a key from OPA', async () => {
  await expect(composeSms(createActivation(base))).resolves.toBe('UNAVAILABLE');
  expect(SMS.sendSMSAsync).not.toHaveBeenCalled();
});
