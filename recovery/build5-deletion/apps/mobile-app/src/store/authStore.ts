import {
  assertSession,
  clearSessionTokens,
  commitSessionTokens,
  deletedSessionOwner,
  waitForSessionWrites,
} from "../services/session-storage";
import axios from "axios";
import {
  advanceAuthSessionEpoch,
  authSessionEpoch,
} from "../services/auth-session-epoch";
import { API_BASE_URL } from "../config/api-config";
import { create } from "zustand";
import * as SecureStore from "expo-secure-store";
import { api, ACCESS_TOKEN_KEY } from "../services/api";

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
}

interface RegisterPayload {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  idempotencyKey?: string;
}

interface AuthSession {
  accessToken: string;
  refreshToken: string;
  user: User;
}

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (
    payload: RegisterPayload,
  ) => Promise<{ requestId: string; status: "VERIFICATION_PENDING" }>;
  verifyEnrollment: (payload: {
    requestId: string;
    emailCode: string;
    phoneCode: string;
    password: string;
    accept: true;
  }) => Promise<
    | { status: "ACCEPTED" }
    | { status: "AUTHENTICATION_REQUIRED"; acceptanceToken: string }
  >;
  acceptEnrollment: (
    requestId: string,
    acceptanceToken: string,
    email: string,
    password: string,
  ) => Promise<void>;
  activate: (
    token: string,
    password: string,
    reference?: string,
  ) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  forceLogout: () => void;
  isDeleting: boolean;
  deleteAccount: () => Promise<void>;
}

async function persistSession(
  data: AuthSession,
  epoch: number,
): Promise<number> {
  if (useAuthStore.getState().isDeleting)
    throw new Error("Account deletion is in progress.");
  assertSession(epoch);
  const deletedOwner = await deletedSessionOwner();
  if (deletedOwner) {
    const { clearDeletedAccountState } =
      require("../services/account-deletion-cleanup") as typeof import("../services/account-deletion-cleanup");
    await clearDeletedAccountState(deletedOwner);
  }
  assertSession(epoch);
  if (useAuthStore.getState().isDeleting)
    throw new Error("Account deletion is in progress.");
  return commitSessionTokens(epoch, data, true);
}

export const useAuthStore = create<AuthState>((set) => {
  registerForceLogout(() => {
    advanceAuthSessionEpoch();
    set({ user: null, isAuthenticated: false });
  });

  return {
    user: null,
    isDeleting: false,
    isLoading: true,
    isAuthenticated: false,

    login: async (email: string, password: string) => {
      if (useAuthStore.getState().isDeleting)
        throw new Error("Account cleanup is in progress.");
      const epoch = authSessionEpoch();
      const { data } = await api.post<AuthSession>("/auth/login", {
        email,
        password,
      });
      const committedEpoch = await persistSession(data, epoch);
      assertSession(committedEpoch);
      set({ user: data.user, isAuthenticated: true, isLoading: false });
    },

    register: async ({ idempotencyKey, ...payload }: RegisterPayload) => {
      const { data } = await api.post<{
        requestId: string;
        status: "VERIFICATION_PENDING";
      }>("/auth/register", payload, {
        headers: { "Idempotency-Key": idempotencyKey },
      });
      if (data.status !== "VERIFICATION_PENDING" || !data.requestId)
        throw new Error("Invalid enrollment response.");
      return data;
    },

    verifyEnrollment: async (payload) => {
      if (useAuthStore.getState().isDeleting)
        throw new Error("Account cleanup is in progress.");
      const epoch = authSessionEpoch();
      const { data } = await api.post<
        | (AuthSession & { status: "ACCEPTED" })
        | { status: "AUTHENTICATION_REQUIRED"; acceptanceToken: string }
      >("/auth/enrollment/verify", payload);
      if (data.status === "ACCEPTED") {
        const committedEpoch = await persistSession(data, epoch);
        assertSession(committedEpoch);
        set({ user: data.user, isAuthenticated: true, isLoading: false });
        return { status: "ACCEPTED" };
      }
      if (data.status !== "AUTHENTICATION_REQUIRED" || !data.acceptanceToken)
        throw new Error("Invalid verification response.");
      return data;
    },

    acceptEnrollment: async (requestId, acceptanceToken, email, password) => {
      if (useAuthStore.getState().isDeleting)
        throw new Error("Account cleanup is in progress.");
      const epoch = authSessionEpoch();
      // Do not establish the UI session before authenticated enrollment acceptance succeeds.
      const { data } = await api.post<AuthSession>("/auth/login", {
        email,
        password,
      });
      assertSession(epoch);
      await axios.post(
        API_BASE_URL + "/auth/enrollment/accept",
        { requestId, acceptanceToken },
        {
          headers: { Authorization: "Bearer " + data.accessToken },
          timeout: 10000,
        },
      );
      const committedEpoch = await persistSession(data, epoch);
      assertSession(committedEpoch);
      set({ user: data.user, isAuthenticated: true, isLoading: false });
    },

    activate: async (token: string, password: string, reference?: string) => {
      if (useAuthStore.getState().isDeleting)
        throw new Error("Account cleanup is in progress.");
      const epoch = authSessionEpoch();
      const { data } = await api.post<AuthSession>("/auth/activate", {
        token,
        password,
        ...(reference ? { reference } : {}),
      });
      const committedEpoch = await persistSession(data, epoch);
      assertSession(committedEpoch);
      set({ user: data.user, isAuthenticated: true, isLoading: false });
    },

    logout: async () => {
      const clearing = clearSessionTokens();
      set({ user: null, isAuthenticated: false, isLoading: false });
      await clearing;
    },

    checkAuth: async () => {
      const epoch = authSessionEpoch();
      try {
        const token = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);

        if (epoch !== authSessionEpoch()) return;
        if (!token || (await deletedSessionOwner())) {
          if (epoch !== authSessionEpoch()) return;
          set({ user: null, isAuthenticated: false, isLoading: false });
          return;
        }

        // Rehydrate identity on cold start instead of treating token presence
        // as a complete authenticated session. The foreground API client owns
        // access-token refresh and forced logout when refresh is rejected.
        const { data: user } = await api.get<User>("/users/me");

        if (epoch !== authSessionEpoch()) return;
        set({
          user,
          isAuthenticated: true,
          isLoading: false,
        });
      } catch {
        // api.ts synchronizes definitive refresh failure through forceLogout.
        // Transient startup failures must still release the loading state.
        if (epoch === authSessionEpoch()) set({ isLoading: false });
      }
    },

    deleteAccount: async () => {
      const state = useAuthStore.getState();
      if (state.isDeleting) return;
      if (!state.user || !state.isAuthenticated)
        throw new Error("Sign in to delete your account.");
      const owner = state.user.id;
      set({ isDeleting: true });
      try {
        await waitForSessionWrites();
        if (useAuthStore.getState().user?.id !== owner)
          throw new Error("Your account changed.");
        const epoch = authSessionEpoch();
        const { data } = await api.delete<{ status: string }>("/auth/account");
        if (data?.status !== "DELETED")
          throw new Error("Deletion could not be confirmed.");
        assertSession(epoch);
        const clearing = clearSessionTokens(owner);
        set({ user: null, isAuthenticated: false, isLoading: false });
        await clearing;
        // Lazy loading avoids introducing a startup cycle through tracking and SafeWalk.
        const { clearDeletedAccountState } =
          require("../services/account-deletion-cleanup") as typeof import("../services/account-deletion-cleanup");
        await clearDeletedAccountState(owner);
      } finally {
        set({ isDeleting: false });
      }
    },

    forceLogout: () => {
      advanceAuthSessionEpoch();
      set({ user: null, isAuthenticated: false });
    },
  };
});

// api.ts cannot import the Zustand store directly without creating a circular
// dependency, so it uses this small callback to synchronize forced logout.
let registerForceLogoutFn: (() => void) | null = null;

function registerForceLogout(fn: () => void) {
  registerForceLogoutFn = fn;
}

export function notifyForceLogout() {
  registerForceLogoutFn?.();
}
