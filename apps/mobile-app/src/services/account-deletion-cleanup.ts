import * as SecureStore from "expo-secure-store";
import { stopTracking } from "./journey-tracker";
import { bootstrapJourneyQueueStore } from "./journey-queue-store";
import { useActiveIncidentStore } from "../store/activeIncidentStore";
import { useSafeWalk } from "./safewalk";
import { BACKGROUND_SESSION_KEY } from "./journey-background-task";

/** The server refuses deletion until all live emergency/journey state is terminal. */
export async function clearDeletedAccountState(owner: string): Promise<void> {
  useActiveIncidentStore.getState().clearActiveIncident();
  useSafeWalk.setState({ journey: null, error: null, refreshedAt: null });
  await stopTracking();
  await Promise.all([
    SecureStore.deleteItemAsync(BACKGROUND_SESSION_KEY),
    SecureStore.deleteItemAsync("opa.safewalk.session." + owner),
    SecureStore.deleteItemAsync("opa.safewalk.create." + owner),
    SecureStore.deleteItemAsync("opa.sms-fallback"),
    SecureStore.deleteItemAsync("opa.pending-activation"),
  ]);
  await (await bootstrapJourneyQueueStore()).clearForAccountDeletion();
}
