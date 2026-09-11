import type { NotificationChannel } from "@prisma/client";
import {
  DeliveryFailureCategory as Failure,
  DeliveryStatus,
} from "@prisma/client";

export const MAX_DELIVERY_ATTEMPTS = 5;
export const ATTEMPT_TIMEOUT_MS = 5 * 60_000;
const delays = [60_000, 300_000, 900_000, 3_600_000];

export function retryDelay(number: number, retryable: boolean): number | null {
  if (!retryable || number >= MAX_DELIVERY_ATTEMPTS || number < 1) return null;
  return (
    (delays[number - 1] ?? delays[0]!) + Math.floor(Math.random() * 15_000)
  );
}

export function providerIdentity(channel: NotificationChannel) {
  const provider = {
    SMS: "AFRICASTALKING",
    EMAIL: "RESEND",
    PUSH: "PUSH",
    WHATSAPP: "WHATSAPP",
    VOICE: "VOICE",
  }[channel];
  const accountScope =
    (channel === "EMAIL"
      ? process.env.RESEND_ACCOUNT_SCOPE
      : channel === "SMS"
        ? process.env.AFRICASTALKING_ACCOUNT_SCOPE
        : undefined) || "primary";
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(accountScope))
    throw new Error("Invalid delivery provider account scope");
  return { provider, accountScope };
}

// A callback may strengthen evidence, but never erase confirmed delivery.
// Acceptance after a failure is stale; a later delivery is conclusive.
export function receiptStatus(
  current: DeliveryStatus,
  incoming: DeliveryStatus,
): DeliveryStatus {
  if (current === "DELIVERED" || incoming === "DELIVERED")
    return DeliveryStatus.DELIVERED;
  if (current === "FAILED" && incoming === "PROVIDER_ACCEPTED") return current;
  if (
    incoming === "UNKNOWN" &&
    current !== "ATTEMPTING" &&
    current !== "QUEUED"
  )
    return current;
  return incoming;
}

export function httpFailure(status: number): {
  failureCategory: Failure;
  retryable: boolean;
  uncertain?: boolean;
} {
  if (status === 401 || status === 403)
    return { failureCategory: Failure.AUTHENTICATION, retryable: false };
  if (status === 429)
    return { failureCategory: Failure.RATE_LIMITED, retryable: true };
  if (status >= 500)
    return {
      failureCategory: Failure.PROVIDER_UNAVAILABLE,
      retryable: false,
      uncertain: true,
    };
  if (status === 400 || status === 422)
    return { failureCategory: Failure.REJECTED, retryable: false };
  return { failureCategory: Failure.REJECTED, retryable: false };
}
