jest.mock('../config/api-config', () => ({
  API_BASE_URL: 'https://vc6.test',
}));
import * as SecureStore from 'expo-secure-store';
import { backgroundApi } from './api';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const mockedSecureStore =
  SecureStore as jest.Mocked<typeof SecureStore>;

describe('backgroundApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('attaches the persisted access token on a headless request', async () => {
    mockedSecureStore.getItemAsync.mockResolvedValue('access-123');

    let authorization: unknown;

    await backgroundApi.get('/journey/fixes', {
      adapter: async (config) => {
        authorization = config.headers?.Authorization;

        return {
          data: {},
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        };
      },
    });

    expect(authorization).toBe('Bearer access-123');

    expect(mockedSecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });

  it('does not delete foreground credentials when a background 401 occurs', async () => {
    mockedSecureStore.getItemAsync.mockResolvedValue('access-123');

    const rejection = {
      isAxiosError: true,
      message: 'Request failed with status code 401',
      response: {
        status: 401,
      },
    };

    await expect(
      backgroundApi.get('/journey/fixes', {
        adapter: async () => Promise.reject(rejection),
      }),
    ).rejects.toBe(rejection);

    /*
     * THIS IS THE VC6 AUTH BOUNDARY.
     *
     * The ordinary foreground api client may refresh/logout. The headless
     * client must never remove the shared SecureStore credentials.
     */
    expect(mockedSecureStore.deleteItemAsync).not.toHaveBeenCalled();
    expect(mockedSecureStore.setItemAsync).not.toHaveBeenCalled();
  });
});