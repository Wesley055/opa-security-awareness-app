import axios from "axios";
import * as SecureStore from "expo-secure-store";
import { api } from "../services/api";
import { useAuthStore } from "./authStore";
jest.mock("axios", () => ({ post: jest.fn() }));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock("../services/api", () => ({
  api: { post: jest.fn() },
  ACCESS_TOKEN_KEY: "access",
  REFRESH_TOKEN_KEY: "refresh",
}));
jest.mock("../config/api-config", () => ({
  API_BASE_URL: "https://api.example.test",
}));
const session = {
  accessToken: "access-token",
  refreshToken: "refresh-token",
  user: {
    id: "user",
    email: "test@example.test",
    firstName: "Test",
    lastName: "User",
    role: "USER",
  },
};
describe("verification-first auth store", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
    });
  });
  it("returns registration receipt without persisting tokens or authenticating", async () => {
    (api.post as jest.Mock).mockResolvedValueOnce({
      data: { requestId: "request", status: "VERIFICATION_PENDING" },
    });
    expect(
      await useAuthStore
        .getState()
        .register({
          firstName: "Test",
          lastName: "User",
          email: "test@example.test",
          phoneNumber: "+2348012345678",
          idempotencyKey: "retry-key",
        }),
    ).toEqual({ requestId: "request", status: "VERIFICATION_PENDING" });
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(api.post).toHaveBeenCalledWith(
      "/auth/register",
      expect.not.objectContaining({ password: expect.anything() }),
      { headers: { "Idempotency-Key": "retry-key" } },
    );
  });
  it("persists a session only after verified new-account completion", async () => {
    (api.post as jest.Mock).mockResolvedValueOnce({
      data: { status: "ACCEPTED", ...session },
    });
    await useAuthStore
      .getState()
      .verifyEnrollment({
        requestId: "request",
        emailCode: "email-proof",
        phoneCode: "phone-proof",
        password: "StrongPassword123!",
        accept: true,
      });
    expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(2);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });
  it("ownership proofs alone never authenticate an existing account", async () => {
    (api.post as jest.Mock).mockResolvedValueOnce({
      data: { status: "AUTHENTICATION_REQUIRED", acceptanceToken: "proof" },
    });
    expect(
      await useAuthStore
        .getState()
        .verifyEnrollment({
          requestId: "request",
          emailCode: "email-proof",
          phoneCode: "phone-proof",
          password: "StrongPassword123!",
          accept: true,
        }),
    ).toEqual({ status: "AUTHENTICATION_REQUIRED", acceptanceToken: "proof" });
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
  it("uses the authenticated account token and persists only after acceptance", async () => {
    (api.post as jest.Mock).mockResolvedValueOnce({ data: session });
    (axios.post as jest.Mock).mockResolvedValueOnce({
      data: { status: "ACCEPTED" },
    });
    await useAuthStore
      .getState()
      .acceptEnrollment("request", "proof", "test@example.test", "password");
    expect(axios.post).toHaveBeenCalledWith(
      "https://api.example.test/auth/enrollment/accept",
      { requestId: "request", acceptanceToken: "proof" },
      { headers: { Authorization: "Bearer access-token" }, timeout: 10000 },
    );
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });
  it("does not establish a session when membership acceptance is refused", async () => {
    (api.post as jest.Mock).mockResolvedValueOnce({ data: session });
    (axios.post as jest.Mock).mockRejectedValueOnce(new Error("refused"));
    await expect(
      useAuthStore
        .getState()
        .acceptEnrollment("request", "proof", "test@example.test", "password"),
    ).rejects.toThrow("refused");
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
});
