import * as SecureStore from "expo-secure-store";
import { clearDeletedAccountState } from "./account-deletion-cleanup";
import { stopTracking } from "./journey-tracker";
import { bootstrapJourneyQueueStore } from "./journey-queue-store";
import { useActiveIncidentStore } from "../store/activeIncidentStore";
import { useSafeWalk } from "./safewalk";
jest.mock("./api", () => ({ backgroundApi: { get: jest.fn() } }));
jest.mock("expo-secure-store", () => ({
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock("./journey-tracker", () => ({
  stopTracking: jest.fn(async () => undefined),
}));
jest.mock("./journey-queue-store", () => ({
  bootstrapJourneyQueueStore: jest.fn(),
}));
jest.mock("./journey-background-task", () => ({
  BACKGROUND_SESSION_KEY: "opa-background-session-id",
}));
jest.mock("./safewalk", () => ({ useSafeWalk: { setState: jest.fn() } }));
it("stops capture before erasing disposable queued fixes and removes owner-bound storage", async () => {
  const clear = jest.fn(async () => undefined);
  (bootstrapJourneyQueueStore as jest.Mock).mockResolvedValue({
    clearForAccountDeletion: clear,
  });
  useActiveIncidentStore
    .getState()
    .setActiveIncident({ id: "old", status: "OPEN" });
  await clearDeletedAccountState("owner");
  expect(useActiveIncidentStore.getState().activeIncident).toBeNull();
  expect(useSafeWalk.setState).toHaveBeenCalledWith({
    journey: null,
    error: null,
    refreshedAt: null,
  });
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(
    "opa.safewalk.create.owner",
  );
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(
    "opa.safewalk.session.owner",
  );
  expect((stopTracking as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
    clear.mock.invocationCallOrder[0]!,
  );
});
