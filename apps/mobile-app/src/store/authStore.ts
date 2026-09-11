import axios from 'axios';
import { advanceAuthSessionEpoch } from '../services/auth-session-epoch';
import { API_BASE_URL } from '../config/api-config';
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
  register: (payload: RegisterPayload) => Promise<{ requestId: string; status: 'VERIFICATION_PENDING' }>;
  verifyEnrollment: (payload: { requestId: string; emailCode: string; phoneCode: string; password: string; accept: true }) => Promise<{ status: 'ACCEPTED' } | { status: 'AUTHENTICATION_REQUIRED'; acceptanceToken: string }>;
  acceptEnrollment: (requestId: string, acceptanceToken: string, email: string, password: string) => Promise<void>;
  activate: (token: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  forceLogout: () => void;
}

async function persistSession(data: AuthSession): Promise<void> {
  advanceAuthSessionEpoch();
  await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, data.accessToken);
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, data.refreshToken);
}

export const useAuthStore = create<AuthState>((set) => {
  registerForceLogout(() => { advanceAuthSessionEpoch(); set({ user: null, isAuthenticated: false }); });

  return {
    user: null,
    isLoading: true,
    isAuthenticated: false,

    login: async (email: string, password: string) => {
      const { data } = await api.post<AuthSession>('/auth/login', {
        email,
        password,
      });
      await persistSession(data);
      set({ user: data.user, isAuthenticated: true, isLoading: false });
    },

    register: async ({ idempotencyKey, ...payload }: RegisterPayload) => {
      const { data } = await api.post<{ requestId: string; status: 'VERIFICATION_PENDING' }>('/auth/register', payload, { headers: { 'Idempotency-Key': idempotencyKey } });
      if (data.status !== 'VERIFICATION_PENDING' || !data.requestId) throw new Error('Invalid enrollment response.');
      return data;
    },

    verifyEnrollment: async (payload) => {
      const { data } = await api.post<(AuthSession & { status: 'ACCEPTED' }) | { status: 'AUTHENTICATION_REQUIRED'; acceptanceToken: string }>('/auth/enrollment/verify', payload);
      if (data.status === 'ACCEPTED') {
        await persistSession(data);
        set({ user: data.user, isAuthenticated: true, isLoading: false });
        return { status: 'ACCEPTED' };
      }
      if (data.status !== 'AUTHENTICATION_REQUIRED' || !data.acceptanceToken) throw new Error('Invalid verification response.');
      return data;
    },

    acceptEnrollment: async (requestId, acceptanceToken, email, password) => {
      // Do not establish the UI session before authenticated enrollment acceptance succeeds.
      const { data } = await api.post<AuthSession>('/auth/login', { email, password });
      await axios.post(API_BASE_URL + '/auth/enrollment/accept', { requestId, acceptanceToken }, { headers: { Authorization: 'Bearer ' + data.accessToken }, timeout: 10000 });
      await persistSession(data);
      set({ user: data.user, isAuthenticated: true, isLoading: false });
    },

    activate: async (token: string, password: string) => {
      const { data } = await api.post<AuthSession>('/auth/activate', {
        token,
        password,
      });
      await persistSession(data);
      set({ user: data.user, isAuthenticated: true, isLoading: false });
    },

    logout: async () => {
      advanceAuthSessionEpoch();
      await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
      await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
      set({ user: null, isAuthenticated: false });
    },

    checkAuth: async () => {
      const token = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);

      if (!token) {
        set({ user: null, isAuthenticated: false, isLoading: false });
        return;
      }

      try {
        // Rehydrate identity on cold start instead of treating token presence
        // as a complete authenticated session. The foreground API client owns
        // access-token refresh and forced logout when refresh is rejected.
        const { data: user } = await api.get<User>('/users/me');

        set({
          user,
          isAuthenticated: true,
          isLoading: false,
        });
      } catch {
        // api.ts synchronizes definitive refresh failure through forceLogout.
        // Transient startup failures must still release the loading state.
        set({ isLoading: false });
      }
    },

    forceLogout: () => { advanceAuthSessionEpoch(); set({ user: null, isAuthenticated: false }); },
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