jest.mock('../config/api-config', () => ({
  API_BASE_URL: 'https://vc6.test',
}));

import axios, {
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import * as SecureStore from 'expo-secure-store';
import {
  ACCESS_TOKEN_KEY,
  backgroundApi,
  REFRESH_TOKEN_KEY,
} from './api';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const mockedSecureStore =
  SecureStore as jest.Mocked<typeof SecureStore>;

interface Vault {
  [key: string]: string | undefined;
}

function installVault(initial: Vault): Vault {
  const vault: Vault = { ...initial };

  mockedSecureStore.getItemAsync.mockImplementation(
    async (key: string) => vault[key] ?? null,
  );

  mockedSecureStore.setItemAsync.mockImplementation(
    async (key: string, value: string) => {
      vault[key] = value;
    },
  );

  mockedSecureStore.deleteItemAsync.mockImplementation(
    async (key: string) => {
      delete vault[key];
    },
  );

  return vault;
}

function okResponse(
  config: InternalAxiosRequestConfig,
): AxiosResponse {
  return {
    data: { ok: true },
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  };
}

function unauthorized(
  config: InternalAxiosRequestConfig,
) {
  return {
    name: 'AxiosError',
    isAxiosError: true,
    message: 'Request failed with status code 401',
    config,
    response: {
      data: {},
      status: 401,
      statusText: 'Unauthorized',
      headers: {},
      config,
    },
  };
}

describe('backgroundApi', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('attaches the persisted access token on a headless request', async () => {
    installVault({
      [ACCESS_TOKEN_KEY]: 'access-123',
      [REFRESH_TOKEN_KEY]: 'refresh-123',
    });

    let authorization: unknown;

    await backgroundApi.get('/journey/fixes', {
      adapter: async (config) => {
        authorization = config.headers.Authorization;
        return okResponse(config);
      },
    });

    expect(authorization).toBe('Bearer access-123');
    expect(mockedSecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });

  it('refreshes a background 401, persists rotated tokens, and retries once', async () => {
    const vault = installVault({
      [ACCESS_TOKEN_KEY]: 'expired-access',
      [REFRESH_TOKEN_KEY]: 'refresh-old',
    });

    const refreshPost = jest
      .spyOn(axios, 'post')
      .mockResolvedValue({
        data: {
          accessToken: 'access-new',
          refreshToken: 'refresh-new',
        },
      } as Awaited<ReturnType<typeof axios.post>>);

    let attempts = 0;
    const seenAuthorization: unknown[] = [];

    const adapter: AxiosAdapter = async (config) => {
      attempts += 1;
      seenAuthorization.push(config.headers.Authorization);

      if (attempts === 1) {
        return Promise.reject(unauthorized(config));
      }

      return okResponse(config);
    };

    const response = await backgroundApi.get(
      '/journey/fixes',
      { adapter },
    );

    expect(response.status).toBe(200);
    expect(attempts).toBe(2);

    expect(seenAuthorization).toEqual([
      'Bearer expired-access',
      'Bearer access-new',
    ]);

    expect(refreshPost).toHaveBeenCalledTimes(1);
    expect(refreshPost).toHaveBeenCalledWith(
      expect.stringMatching(/\/auth\/refresh$/),
      { refreshToken: 'refresh-old' },
    );

    expect(vault[ACCESS_TOKEN_KEY]).toBe('access-new');
    expect(vault[REFRESH_TOKEN_KEY]).toBe('refresh-new');

    expect(mockedSecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });

  it('retains credentials when background refresh fails', async () => {
    const vault = installVault({
      [ACCESS_TOKEN_KEY]: 'expired-access',
      [REFRESH_TOKEN_KEY]: 'refresh-dead',
    });

    jest
      .spyOn(axios, 'post')
      .mockRejectedValue(new Error('refresh unavailable'));

    const adapter: AxiosAdapter = async (config) =>
      Promise.reject(unauthorized(config));

    await expect(
      backgroundApi.get('/journey/fixes', { adapter }),
    ).rejects.toThrow('refresh unavailable');

    expect(vault[ACCESS_TOKEN_KEY]).toBe('expired-access');
    expect(vault[REFRESH_TOKEN_KEY]).toBe('refresh-dead');

    expect(mockedSecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });

  it('does not loop if the retried request also returns 401', async () => {
    installVault({
      [ACCESS_TOKEN_KEY]: 'expired-access',
      [REFRESH_TOKEN_KEY]: 'refresh-loop',
    });

    const refreshPost = jest
      .spyOn(axios, 'post')
      .mockResolvedValue({
        data: {
          accessToken: 'access-new',
          refreshToken: 'refresh-new',
        },
      } as Awaited<ReturnType<typeof axios.post>>);

    let attempts = 0;

    const adapter: AxiosAdapter = async (config) => {
      attempts += 1;
      return Promise.reject(unauthorized(config));
    };

    await expect(
      backgroundApi.get('/journey/fixes', { adapter }),
    ).rejects.toMatchObject({
      response: { status: 401 },
    });

    expect(attempts).toBe(2);
    expect(refreshPost).toHaveBeenCalledTimes(1);
    expect(mockedSecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });
});