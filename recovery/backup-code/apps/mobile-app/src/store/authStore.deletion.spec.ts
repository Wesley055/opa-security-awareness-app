import * as SecureStore from "expo-secure-store";
import { api } from "../services/api";
import { useAuthStore } from "./authStore";
import { authSessionEpoch } from "../services/auth-session-epoch";
import { clearDeletedAccountState } from "../services/account-deletion-cleanup";
import {
  ACCESS_TOKEN_KEY,
  REFRESH_TOKEN_KEY,
  DELETED_SESSION_KEY,
  commitSessionTokens,
  clearSessionTokens,
} from "../services/session-storage";

jest.mock("../config/api-config", () => ({ API_BASE_URL: "https://api.test" }));
jest.mock("../services/api", () => ({
  ACCESS_TOKEN_KEY: "opa_access_token",
  REFRESH_TOKEN_KEY: "opa_refresh_token",
  api: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock("../services/account-deletion-cleanup", () => ({
  clearDeletedAccountState: jest.fn(async () => undefined),
}));
const user = {
  id: "owner",
  email: "private@example.test",
  firstName: "Private",
  lastName: "Person",
  role: "USER",
};
const tokens = { accessToken: "old-access", refreshToken: "old-refresh", user };
const storage = new Map<string, string>();
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
beforeEach(() => {
  jest.clearAllMocks();
  storage.clear();
  storage.set(ACCESS_TOKEN_KEY, tokens.accessToken);
  storage.set(REFRESH_TOKEN_KEY, tokens.refreshToken);
  (SecureStore.getItemAsync as jest.Mock).mockImplementation(
    async (key) => storage.get(key) ?? null,
  );
  (SecureStore.setItemAsync as jest.Mock).mockImplementation(
    async (key, value) => {
      storage.set(key, value);
    },
  );
  (SecureStore.deleteItemAsync as jest.Mock).mockImplementation(async (key) => {
    storage.delete(key);
  });
  useAuthStore.getState().forceLogout();
  useAuthStore.setState({
    user,
    isAuthenticated: true,
    isLoading: false,
    isDeleting: false,
  });
  (api.delete as jest.Mock).mockResolvedValue({ data: { status: "DELETED" } });
});
it("clears tokens and identity, advances the epoch, and clears account-bound state after confirmed deletion", async () => {
  const before = authSessionEpoch();
  await useAuthStore.getState().deleteAccount();
  expect(api.delete).toHaveBeenCalledWith("/auth/account");
  expect(storage.has(ACCESS_TOKEN_KEY)).toBe(false);
  expect(storage.has(REFRESH_TOKEN_KEY)).toBe(false);
  expect(storage.get(DELETED_SESSION_KEY)).toBe("deleted:owner");
  expect(authSessionEpoch()).toBeGreaterThan(before);
  expect(useAuthStore.getState()).toMatchObject({
    user: null,
    isAuthenticated: false,
    isLoading: false,
  });
  expect(clearDeletedAccountState).toHaveBeenCalledWith("owner");
});
it("leaves identity and credentials intact on API failure", async () => {
  (api.delete as jest.Mock).mockRejectedValueOnce(new Error("offline"));
  await expect(useAuthStore.getState().deleteAccount()).rejects.toThrow(
    "offline",
  );
  expect(useAuthStore.getState()).toMatchObject({
    user,
    isAuthenticated: true,
    isDeleting: false,
  });
  expect(storage.get(ACCESS_TOKEN_KEY)).toBe(tokens.accessToken);
  expect(clearDeletedAccountState).not.toHaveBeenCalled();
});
it.each(["login", "activate", "verifyEnrollment"] as const)(
  "rejects late %s session data after deletion",
  async (operation) => {
    const response = deferred<{
      data: typeof tokens & { status: "ACCEPTED" };
    }>();
    (api.post as jest.Mock).mockReturnValueOnce(response.promise);
    const state = useAuthStore.getState();
    const stale =
      operation === "login"
        ? state.login("email", "password")
        : operation === "activate"
          ? state.activate("token", "password")
          : state.verifyEnrollment({
              requestId: "request",
              emailCode: "email",
              phoneCode: "phone",
              password: "password",
              accept: true,
            });
    const result = stale.catch((error) => error);
    await state.deleteAccount();
    response.resolve({ data: { ...tokens, status: "ACCEPTED" } });
    expect(await result).toBeInstanceOf(Error);
    expect(storage.has(ACCESS_TOKEN_KEY)).toBe(false);
    expect(useAuthStore.getState().user).toBeNull();
  },
);
it("ignores hydration which completes after deletion", async () => {
  const response = deferred<{ data: typeof user }>();
  (api.get as jest.Mock).mockReturnValueOnce(response.promise);
  const hydration = useAuthStore.getState().checkAuth();
  await Promise.resolve();
  await Promise.resolve();
  await useAuthStore.getState().deleteAccount();
  response.resolve({ data: user });
  await hydration;
  expect(useAuthStore.getState().isAuthenticated).toBe(false);
});
it("rejects both stale refresh epochs and refresh writes in a fresh context with the durable deletion marker", async () => {
  const before = authSessionEpoch();
  await useAuthStore.getState().deleteAccount();
  await expect(commitSessionTokens(before, tokens)).rejects.toThrow(
    "session changed",
  );
  await expect(commitSessionTokens(authSessionEpoch(), tokens)).rejects.toThrow(
    "session changed",
  );
  expect(storage.has(ACCESS_TOKEN_KEY)).toBe(false);
});
it("does not hydrate old credentials after a restart with pending deletion cleanup", async () => {
  storage.set(DELETED_SESSION_KEY, "deleted:owner");
  await useAuthStore.getState().checkAuth();
  expect(api.get).not.toHaveBeenCalled();
  expect(useAuthStore.getState().user).toBeNull();
});
it("allows an explicitly initiated new login after deletion without attaching old account state", async () => {
  await useAuthStore.getState().deleteAccount();
  (api.post as jest.Mock).mockResolvedValueOnce({
    data: {
      ...tokens,
      user: { ...user, id: "new-owner" },
      accessToken: "new-access",
    },
  });
  await useAuthStore.getState().login("new", "password");
  expect(storage.has(DELETED_SESSION_KEY)).toBe(false);
  expect(storage.get(ACCESS_TOKEN_KEY)).toBe("new-access");
  expect(useAuthStore.getState().user?.id).toBe("new-owner");
});

it("does not clear the account for an unexpected success payload", async () => {
  (api.delete as jest.Mock).mockResolvedValueOnce({ data: {} });
  await expect(useAuthStore.getState().deleteAccount()).rejects.toThrow(
    "could not be confirmed",
  );
  expect(useAuthStore.getState().user).toEqual(user);
  expect(storage.get(ACCESS_TOKEN_KEY)).toBe(tokens.accessToken);
});
it("serializes native token writes ahead of deletion cleanup so a late write cannot survive", async () => {
  const entered = deferred<void>(),
    finish = deferred<void>();
  (SecureStore.setItemAsync as jest.Mock).mockImplementationOnce(
    async (key, value) => {
      entered.resolve();
      await finish.promise;
      storage.set(key, value);
    },
  );
  const epoch = authSessionEpoch();
  const writing = commitSessionTokens(epoch, tokens).catch((error) => error);
  await entered.promise;
  const clearing = clearSessionTokens("owner");
  finish.resolve();
  await writing;
  await clearing;
  expect(storage.has(ACCESS_TOKEN_KEY)).toBe(false);
  expect(storage.has(REFRESH_TOKEN_KEY)).toBe(false);
});
