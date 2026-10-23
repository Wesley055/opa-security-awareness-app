import * as SecureStore from "expo-secure-store";
import { api } from "../services/api";
import { useAuthStore } from "./authStore";
import { authSessionEpoch } from "../services/auth-session-epoch";
import { clearDeletedAccountState } from "../services/account-deletion-cleanup";

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

const user = { id: "owner", email: "private@example.test", firstName: "Private", lastName: "Person", role: "USER" };
const storage = new Map<string, string>();

beforeEach(() => {
  jest.clearAllMocks();
  storage.clear();
  storage.set("opa_access_token", "old-access");
  storage.set("opa_refresh_token", "old-refresh");
  (SecureStore.deleteItemAsync as jest.Mock).mockImplementation(async (key) => { storage.delete(key); });
  useAuthStore.setState({ user, isAuthenticated: true, isLoading: false, isDeleting: false });
  (api.delete as jest.Mock).mockResolvedValue({ data: { status: "DELETED" } });
});

it("clears tokens and identity, advances the epoch and clears account-bound state after confirmed deletion", async () => {
  const before = authSessionEpoch();
  await useAuthStore.getState().deleteAccount();
  expect(api.delete).toHaveBeenCalledWith("/auth/account");
  expect(storage.size).toBe(0);
  expect(authSessionEpoch()).toBeGreaterThan(before);
  expect(useAuthStore.getState()).toMatchObject({ user: null, isAuthenticated: false, isDeleting: false });
  expect(clearDeletedAccountState).toHaveBeenCalledWith("owner");
});

it("keeps the session when the server does not confirm deletion", async () => {
  (api.delete as jest.Mock).mockResolvedValue({ data: { status: "PENDING" } });
  await expect(useAuthStore.getState().deleteAccount()).rejects.toThrow("Deletion could not be confirmed.");
  expect(storage.size).toBe(2);
  expect(useAuthStore.getState()).toMatchObject({ user, isAuthenticated: true, isDeleting: false });
  expect(clearDeletedAccountState).not.toHaveBeenCalled();
});

it("keeps the session when the server refuses (active emergency, staff account)", async () => {
  (api.delete as jest.Mock).mockRejectedValue(Object.assign(new Error("conflict"), { response: { status: 409 } }));
  await expect(useAuthStore.getState().deleteAccount()).rejects.toThrow("conflict");
  expect(storage.size).toBe(2);
  expect(useAuthStore.getState().isAuthenticated).toBe(true);
});

it("ignores a second tap while deletion is in progress", async () => {
  useAuthStore.setState({ isDeleting: true });
  await useAuthStore.getState().deleteAccount();
  expect(api.delete).not.toHaveBeenCalled();
});
