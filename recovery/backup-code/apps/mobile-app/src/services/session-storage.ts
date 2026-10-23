import * as SecureStore from "expo-secure-store";
import {
  advanceAuthSessionEpoch,
  authSessionEpoch,
} from "./auth-session-epoch";

export const ACCESS_TOKEN_KEY = "opa_access_token";
export const REFRESH_TOKEN_KEY = "opa_refresh_token";
export const DELETED_SESSION_KEY = "opa.deleted-session";
let writes: Promise<unknown> = Promise.resolve();
export class StaleSessionError extends Error {
  constructor() {
    super("Your session changed. Please sign in again.");
  }
}
function serialize<T>(work: () => Promise<T>): Promise<T> {
  const next = writes.then(work, work);
  writes = next.catch(() => undefined);
  return next;
}
export async function waitForSessionWrites(): Promise<void> {
  await writes;
}
export function assertSession(epoch: number): void {
  if (epoch !== authSessionEpoch()) throw new StaleSessionError();
}
export async function deletedSessionOwner(): Promise<string | null> {
  const marker = await SecureStore.getItemAsync(DELETED_SESSION_KEY);
  return marker?.startsWith("deleted:") ? marker.slice(8) : null;
}
export async function commitSessionTokens(
  epoch: number,
  tokens: { accessToken: string; refreshToken?: string },
  fresh = false,
  refreshedToken?: string,
): Promise<number> {
  return serialize(async () => {
    assertSession(epoch);
    if (!fresh && (await deletedSessionOwner())) throw new StaleSessionError();
    if (
      refreshedToken &&
      (await SecureStore.getItemAsync(REFRESH_TOKEN_KEY)) !== refreshedToken
    )
      throw new StaleSessionError();
    assertSession(epoch);
    await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, tokens.accessToken);
    assertSession(epoch);
    if (tokens.refreshToken)
      await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, tokens.refreshToken);
    assertSession(epoch);
    if (fresh) {
      await SecureStore.deleteItemAsync(DELETED_SESSION_KEY);
      assertSession(epoch);
      advanceAuthSessionEpoch();
    } else if (await deletedSessionOwner()) throw new StaleSessionError();
    assertSession(fresh ? authSessionEpoch() : epoch);
    return authSessionEpoch();
  });
}
/** Synchronous epoch invalidation precedes every queued native write/delete. */
export function clearSessionTokens(deletedUserId?: string): Promise<void> {
  advanceAuthSessionEpoch();
  return serialize(async () => {
    const results = await Promise.allSettled([
      ...(deletedUserId
        ? [
            SecureStore.setItemAsync(
              DELETED_SESSION_KEY,
              "deleted:" + deletedUserId,
            ),
          ]
        : []),
      SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
      SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
    ]);
    if (results.some((result) => result.status === "rejected"))
      throw new Error("Local session cleanup could not be completed.");
  });
}
