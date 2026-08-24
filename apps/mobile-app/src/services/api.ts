import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

// Resolved, not hardcoded - see src/config/api-config.ts. The previous
// literal was correct on one machine on one network and frozen
// everywhere else, as its own comment admitted.
//
// NOTE: API_BASE_URL is used TWICE in this file - as the axios baseURL
// below, and again in the refresh interceptor, which calls raw axios
// deliberately so the refresh request does not recurse through its own
// 401 handler. Both call sites use the resolved value.
import { API_BASE_URL } from '../config/api-config';

const ACCESS_TOKEN_KEY = 'opa_access_token';
const REFRESH_TOKEN_KEY = 'opa_refresh_token';

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
});

/**
 * Headless-safe API client for emergency background work.
 *
 * It deliberately has the SAME request-side token attachment as `api`, but
 * NO response interceptor.
 *
 * The foreground `api` client may refresh a 401 and, if refresh fails, delete
 * both SecureStore tokens and notify the foreground auth store. That policy is
 * appropriate for an interactive foreground session. It is NOT appropriate
 * for a TaskManager headless callback: SecureStore is shared across contexts,
 * while the foreground auth-store listener is not.
 *
 * Therefore background replay gets one authenticated attempt. A 401 is
 * returned to the caller and the durable Journey rows remain queued.
 */
export const backgroundApi = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
});

backgroundApi.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let backgroundRefreshInFlight: Promise<string> | null = null;

async function refreshBackgroundAccessToken(): Promise<string> {
  if (backgroundRefreshInFlight) {
    return backgroundRefreshInFlight;
  }

  backgroundRefreshInFlight = (async () => {
    const refreshToken =
      await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);

    if (!refreshToken) {
      throw new Error('No refresh token available');
    }

    const { data } = await axios.post(
      `${API_BASE_URL}/auth/refresh`,
      { refreshToken },
    );

    if (!data?.accessToken) {
      throw new Error('Refresh response missing access token');
    }

    await SecureStore.setItemAsync(
      ACCESS_TOKEN_KEY,
      data.accessToken,
    );

    if (data.refreshToken) {
      await SecureStore.setItemAsync(
        REFRESH_TOKEN_KEY,
        data.refreshToken,
      );
    }

    return data.accessToken as string;
  })();

  try {
    return await backgroundRefreshInFlight;
  } finally {
    backgroundRefreshInFlight = null;
  }
}

backgroundApi.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (
      error.response?.status !== 401 ||
      !originalRequest ||
      originalRequest._opaBackgroundRetry
    ) {
      return Promise.reject(error);
    }

    originalRequest._opaBackgroundRetry = true;

    try {
      const accessToken =
        await refreshBackgroundAccessToken();

      originalRequest.headers.Authorization =
        `Bearer ${accessToken}`;

      // IMPORTANT: retry with the headless-safe client,
      // never the foreground api client.
      return backgroundApi(originalRequest);
    } catch (refreshError) {
      // HEADLESS SAFETY:
      // no deleteItemAsync
      // no notifyForceLogout
      // Journey replay keeps the durable rows.
      return Promise.reject(refreshError);
    }
  },
);
api.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let isRefreshing = false;

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry && !isRefreshing) {
      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
        if (!refreshToken) {
          throw new Error('No refresh token available');
        }

        const { data } = await axios.post(`${API_BASE_URL}/auth/refresh`, {
          refreshToken,
        });

        await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, data.accessToken);
        if (data.refreshToken) {
          await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, data.refreshToken);
        }

        originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
        isRefreshing = false;
        return api(originalRequest);
      } catch (refreshError) {
        isRefreshing = false;
        await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
        await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);

        // Closes the store/token drift gap: the store finds out
        // immediately that the session is dead, instead of staying
        // isAuthenticated=true against tokens that no longer exist.
        const { notifyForceLogout } = await import('../store/authStore');
        notifyForceLogout();

        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export { ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY };