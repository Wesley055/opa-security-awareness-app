import * as SecureStore from 'expo-secure-store';
import {
  ACCESS_TOKEN_KEY,
  REFRESH_TOKEN_KEY,
  api,
} from '../services/api';
import { useAuthStore } from './authStore';

jest.mock('../config/api-config', () => ({ API_BASE_URL: 'https://api.example.test' }));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

jest.mock('../services/api', () => ({
  ACCESS_TOKEN_KEY: 'opa_access_token',
  REFRESH_TOKEN_KEY: 'opa_refresh_token',
  api: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

const mockedSecureStore =
  SecureStore as jest.Mocked<typeof SecureStore>;

const mockedApi = api as jest.Mocked<typeof api>;

describe('authStore activation', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      isLoading: true,
    });
  });

  it('activates, persists the returned session, and authenticates the user', async () => {
    mockedApi.post.mockResolvedValueOnce({
      data: {
        accessToken: 'activation-access-token',
        refreshToken: 'activation-refresh-token',
        user: {
          id: 'resident-1',
          email: 'resident@example.com',
          firstName: 'Blessing',
          lastName: 'Resident',
          role: 'USER',
        },
      },
    });

    await useAuthStore
      .getState()
      .activate('raw-activation-token', 'strong-password-123');

    expect(mockedApi.post).toHaveBeenCalledWith('/auth/activate', {
      token: 'raw-activation-token',
      password: 'strong-password-123',
    });

    expect(mockedSecureStore.setItemAsync).toHaveBeenNthCalledWith(
      1,
      ACCESS_TOKEN_KEY,
      'activation-access-token',
    );

    expect(mockedSecureStore.setItemAsync).toHaveBeenNthCalledWith(
      2,
      REFRESH_TOKEN_KEY,
      'activation-refresh-token',
    );

    expect(useAuthStore.getState()).toMatchObject({
      isAuthenticated: true,
      isLoading: false,
      user: {
        id: 'resident-1',
        email: 'resident@example.com',
        firstName: 'Blessing',
        lastName: 'Resident',
        role: 'USER',
      },
    });
  });
});
describe('authStore cold-start hydration', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      isLoading: true,
    });
  });

  it('rehydrates the authenticated user from /users/me when a stored access token exists', async () => {
    mockedSecureStore.getItemAsync.mockResolvedValueOnce('stored-access-token');

    mockedApi.get.mockResolvedValueOnce({
      data: {
        id: 'resident-1',
        email: 'resident@example.com',
        firstName: 'Blessing',
        lastName: 'Resident',
        role: 'USER',
      },
    });

    await useAuthStore.getState().checkAuth();

    expect(mockedApi.get).toHaveBeenCalledWith('/users/me');

    expect(useAuthStore.getState()).toMatchObject({
      isAuthenticated: true,
      isLoading: false,
      user: {
        id: 'resident-1',
        email: 'resident@example.com',
        firstName: 'Blessing',
        lastName: 'Resident',
        role: 'USER',
      },
    });
  });

  it('finishes unauthenticated without calling /users/me when no access token exists', async () => {
    mockedSecureStore.getItemAsync.mockResolvedValueOnce(null);

    await useAuthStore.getState().checkAuth();

    expect(mockedApi.get).not.toHaveBeenCalled();

    expect(useAuthStore.getState()).toMatchObject({
      user: null,
      isAuthenticated: false,
      isLoading: false,
    });
  });

  it('releases the loading state when user hydration fails', async () => {
    mockedSecureStore.getItemAsync.mockResolvedValueOnce('stored-access-token');
    mockedApi.get.mockRejectedValueOnce(new Error('network unavailable'));

    await useAuthStore.getState().checkAuth();

    expect(mockedApi.get).toHaveBeenCalledWith('/users/me');

    expect(useAuthStore.getState()).toMatchObject({
      user: null,
      isAuthenticated: false,
      isLoading: false,
    });
  });
});
