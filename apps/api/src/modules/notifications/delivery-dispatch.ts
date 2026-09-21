import { Logger } from "@nestjs/common";
import type { NotificationResponse } from "./providers/notification-provider.interface";

const logger = new Logger("DeliveryEvidence");
/** A timeout bounds worker waiting, not the lifetime of provider evidence. */
export async function dispatchWithEvidence(
  provider: string,
  send: () => Promise<NotificationResponse>,
  record: (response: NotificationResponse) => Promise<void>,
): Promise<NotificationResponse> {
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = Promise.resolve()
    .then(send)
    .catch((): NotificationResponse => ({
      success: false,
      provider,
      uncertain: true,
      failureCategory: "NETWORK",
      stage: "PROVIDER_REQUEST",
      diagnostic: "PROVIDER_INVOCATION_FAILED",
      retryable: false,
    }))
    .then(async (response) => {
      if (timedOut) {
        try {
          await record(response);
        } catch {
          logger.error(
            "Late provider evidence could not be persisted; delivery remains unresolved.",
          );
        }
      }
      return response;
    });
  let response: NotificationResponse;
  try {
    response = await Promise.race([
      work,
      new Promise<NotificationResponse>((resolve) => {
        timer = setTimeout(() => {
          timedOut = true;
          resolve({
            success: false,
            provider,
            uncertain: true,
            failureCategory: "TIMEOUT",
            stage: "PROVIDER_REQUEST",
            diagnostic: "PROVIDER_INVOCATION_FAILED",
            retryable: false,
          });
        }, 30_000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
  // Database failures propagate; the caller's worker reports them and the
  // persisted ATTEMPTING row remains recoverable without another send.
  await record(response);
  return response;
}
