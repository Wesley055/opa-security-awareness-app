import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { api, ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY } from '../services/api';

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
  password: string;
}

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  forceLogout: () => void;
}

export const useAuthStore = create<AuthState>((set) => {
  registerForceLogout(() => set({ user: null, isAuthenticated: false }));

  return {
    user: null,
    isLoading: true,
    isAuthenticated: false,

    login: async (email: string, password: string) => {
      // Matches the real, verified /auth/login response shape:
      // { accessToken, refreshToken, user }
      const { data } = await api.post('/auth/login', { email, password });
      await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, data.accessToken);
      await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, data.refreshToken);
      set({ user: data.user, isAuthenticated: true, isLoading: false });
    },

    register: async (payload: RegisterPayload) => {
      // Matches the real, verified /auth/register response shape:
      // { accessToken, refreshToken, user } — identical to login.
      const { data } = await api.post('/auth/register', payload);
      await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, data.accessToken);
      await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, data.refreshToken);
      set({ user: data.user, isAuthenticated: true, isLoading: false });
    },

    logout: async () => {
      await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
      await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
      set({ user: null, isAuthenticated: false });
    },

    checkAuth: async () => {
      const token = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
      // Note: this only checks whether a token exists locally, not
      // whether it's still valid — an expired-but-present token will
      // still pass this check, and get caught by api.ts's 401 handler
      // on the first real request instead. Good enough for now; a real
      // token-validity check would need a dedicated endpoint like
      // GET /auth/me, which doesn't exist in the backend yet.
      set({ isAuthenticated: !!token, isLoading: false });
    },

    forceLogout: () => set({ user: null, isAuthenticated: false }),
  };
});

// A small side-channel so api.ts (which can't import the store
// directly without a circular import) can still notify it when a
// refresh attempt fails, keeping isAuthenticated in sync with what's
// actually left in SecureStore.
let registerForceLogoutFn: (() => void) | null = null;
function registerForceLogout(fn: () => void) {
  registerForceLogoutFn = fn;
}
export function notifyForceLogout() {
  registerForceLogoutFn?.();
}