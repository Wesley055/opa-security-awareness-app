import { AppState } from 'react-native';
import { useAuthStore } from '../store/authStore';
import { useActiveIncidentStore } from '../store/activeIncidentStore';

/** Root React lifecycle only; never bootstraps tracking or activates an incident. */
export function startActiveIncidentReconciliation(): () => void {
  let alive = true;
  let appState = AppState.currentState;
  let session: string | null = null;
  let generation = 0;
  let running = false;
  let requested = false;

  const request = (): void => {
    if (!alive || session === null || (appState !== null && appState !== 'active')) return;
    if (running) {
      requested = true;
      return;
    }
    running = true;
    requested = false;
    const currentGeneration = generation;
    void useActiveIncidentStore.getState().reconcileActiveIncident(
      () => alive && generation === currentGeneration,
    ).catch(() => {
      // Background-safe auth refresh preserves credentials and local incident state.
      console.log('[active-incident] reconciliation unavailable; retry on next resume');
    }).finally(() => {
      running = false;
      if (requested) {
        requested = false;
        request();
      }
    });
  };

  const onAuth = (): void => {
    const auth = useAuthStore.getState();
    const next = !auth.isLoading && auth.isAuthenticated ? auth.user?.id ?? null : null;
    if (next === session) return;
    session = next;
    generation++;
    requested = false;
    request();
  };

  const unsubscribe = useAuthStore.subscribe(onAuth);
  const subscription = AppState.addEventListener('change', (next) => {
    const previous = appState;
    appState = next;
    if (next === 'active' && previous !== 'active') request();
  });
  onAuth();

  return () => {
    alive = false;
    generation++;
    unsubscribe();
    subscription.remove();
  };
}
