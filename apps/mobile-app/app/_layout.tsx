import { Stack, useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { useAuthStore } from '../src/store/authStore';
import { stopTracking } from '../src/services/journey-tracker';

export default function RootLayout() {
  const { isAuthenticated, isLoading, checkAuth } = useAuthStore();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (isAuthenticated && inAuthGroup) {
      router.replace('/');
    }
  }, [isAuthenticated, isLoading, segments]);

  // ADR-010 Decision 3: the tracker is STARTED from app/sos.tsx after a
  // successful activation. This layout only ever stops it. Keying on
  // isAuthenticated also covers forceLogout for free, and stopTracking is
  // idempotent, so the false-on-cold-start pass is harmless.
  useEffect(() => {
    if (!isAuthenticated) {
      void stopTracking();
    }
  }, [isAuthenticated]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)/login" />
      <Stack.Screen name="index" />
    </Stack>
  );
}