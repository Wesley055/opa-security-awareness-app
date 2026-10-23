import { authSessionEpoch } from "./auth-session-epoch";
import {
  assertSession,
  clearSessionTokens,
  commitSessionTokens,
  deletedSessionOwner,
  StaleSessionError,
  ACCESS_TOKEN_KEY,
  REFRESH_TOKEN_KEY,
} from "./session-storage";
import axios from "axios";
import * as SecureStore from "expo-secure-store";

// Resolved, not hardcoded - see src/config/api-config.ts. The previous
// literal was correct on one machine on one network and frozen
// everywhere else, as its own comment admitted.
//
// NOTE: API_BASE_URL is used TWICE in this file - as the axios baseURL
// below, and again in the refresh interceptor, which calls raw axios
// deliberately so the refresh request does not recurse through its own
// 401 handler. Both call sites use the resolved value.
import { API_BASE_URL } from "../config/api-config";

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
  const epoch = authSessionEpoch();
  const token = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
  if (await deletedSessionOwner()) throw new StaleSessionError();
  assertSession(epoch);
  (config as typeof config & { _opaAuthEpoch?: number })._opaAuthEpoch = epoch;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let backgroundRefreshInFlight: Promise<string> | null = null;

/**
 * The refresh token value /auth/refresh has already rejected with a 401 in
 * this process.
 *
 * Battery, not correctness - durable rows are retained either way. But a
 * permanently dead refresh token (suspended account, or 30 days elapsed)
 * would otherwise cost two network calls per TaskManager delivery, every
 * ~10 seconds, for the length of an emergency.
 *
 * Keyed on the token VALUE, not a boolean: a fresh login writes a different
 * refresh token, which no longer matches, so recovery needs no process
 * restart. A boolean would stay latched against the new user.
 */
let rejectedBackgroundRefreshToken: string | null = null;

async function refreshBackgroundAccessToken(): Promise<string> {
  if (backgroundRefreshInFlight) {
    return backgroundRefreshInFlight;
  }

  const epoch = authSessionEpoch();
  backgroundRefreshInFlight = (async () => {
    const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);

    if (!refreshToken) {
      throw new Error("No refresh token available");
    }

    if (refreshToken === rejectedBackgroundRefreshToken) {
      throw new Error("Background refresh token was previously rejected");
    }

    let data: { accessToken?: string; refreshToken?: string } | undefined;

    try {
      ({ data } = await axios.post(`${API_BASE_URL}/auth/refresh`, {
        refreshToken,
      }));
    } catch (error) {
      /*
       * ONLY a 401 from /auth/refresh itself marks this token dead.
       * Timeouts, network errors and 5xx are transient - a phone in a
       * tunnel is not a revoked account and must keep retrying.
       */
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        rejectedBackgroundRefreshToken = refreshToken;
      }

      throw error;
    }

    if (!data?.accessToken) {
      throw new Error("Refresh response missing access token");
    }

    rejectedBackgroundRefreshToken = null;

    await commitSessionTokens(
      epoch,
      { accessToken: data.accessToken, refreshToken: data.refreshToken },
      false,
      refreshToken,
    );
    assertSession(epoch);

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
      originalRequest?._opaAuthEpoch !== undefined &&
      originalRequest._opaAuthEpoch !== authSessionEpoch()
    )
      return Promise.reject(new StaleSessionError());

    if (
      error.response?.status !== 401 ||
      !originalRequest ||
      originalRequest._opaBackgroundRetry
    ) {
      return Promise.reject(error);
    }

    originalRequest._opaBackgroundRetry = true;

    try {
      const accessToken = await refreshBackgroundAccessToken();

      originalRequest.headers.Authorization = `Bearer ${accessToken}`;

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
const publicAuthPaths = new Set([
  "/auth/login",
  "/auth/register",
  "/auth/activate",
  "/auth/enrollment/verify",
  "/auth/password-reset/request",
  "/auth/password-reset/confirm",
]);
api.interceptors.request.use(async (config) => {
  if (publicAuthPaths.has(config.url?.split("?")[0] ?? "")) return config;
  const epoch = authSessionEpoch();
  const token = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
  if (await deletedSessionOwner()) throw new StaleSessionError();
  assertSession(epoch);
  (config as typeof config & { _opaAuthEpoch?: number })._opaAuthEpoch = epoch;
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
    if (
      !originalRequest ||
      originalRequest.url === "/auth/account" ||
      publicAuthPaths.has(originalRequest.url?.split("?")[0] ?? "")
    )
      return Promise.reject(error);
    const epoch = originalRequest._opaAuthEpoch ?? authSessionEpoch();
    if (epoch !== authSessionEpoch())
      return Promise.reject(new StaleSessionError());

    // A rejected local credential is not a request to restore another session.
    const credentialRequest = [
      "/auth/login",
      "/auth/register",
      "/auth/activate",
      "/auth/enrollment/verify",
      "/auth/password-reset/request",
      "/auth/password-reset/confirm",
    ].includes(originalRequest?.url?.split("?")[0] ?? "");
    if (
      error.response?.status === 401 &&
      !credentialRequest &&
      originalRequest &&
      !originalRequest._retry &&
      !isRefreshing
    ) {
      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
        if (!refreshToken) {
          throw new Error("No refresh token available");
        }

        const { data } = await axios.post(
          `${API_BASE_URL}/auth/refresh`,
          { refreshToken },
          { timeout: 10000 },
        );

        await commitSessionTokens(epoch, data, false, refreshToken);
        assertSession(epoch);

        originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
        isRefreshing = false;
        return api(originalRequest);
      } catch (refreshError) {
        isRefreshing = false;
        if (
          epoch !== authSessionEpoch() ||
          refreshError instanceof StaleSessionError
        )
          return Promise.reject(refreshError);
        await clearSessionTokens();

        // Closes the store/token drift gap: the store finds out
        // immediately that the session is dead, instead of staying
        // isAuthenticated=true against tokens that no longer exist.
        const clearedEpoch = authSessionEpoch();
        const { notifyForceLogout } = await import("../store/authStore");
        if (clearedEpoch === authSessionEpoch()) notifyForceLogout();

        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  },
);

export { ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY };
