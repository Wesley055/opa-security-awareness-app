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
  register: (payload: RegisterPayload) => Promise<void>;
  activate: (token: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  forceLogout: () => void;
}

async function persistSession(data: AuthSession): Promise<void> {
  await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, data.accessToken);
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, data.refreshToken);
}

export const useAuthStore = create<AuthState>((set) => {
  registerForceLogout(() => set({ user: null, isAuthenticated: false }));

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

    register: async (payload: RegisterPayload) => {
      const { data } = await api.post<AuthSession>('/auth/register', payload);
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

    forceLogout: () => set({ user: null, isAuthenticated: false }),
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