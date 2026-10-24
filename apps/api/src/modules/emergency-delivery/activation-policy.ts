import type { DeliveryVerification, IncidentChannel } from "@prisma/client";

/** How an activation reached OPA, and how sure OPA is that it came from the account holder. */
export interface ActivationDelivery {
  channel: IncidentChannel;
  verification: DeliveryVerification;
}

export const APP_DELIVERY: ActivationDelivery = { channel: "APP", verification: "APP_SIGNED_IN" };

const FUTURE_TOLERANCE_MS = 2 * 60 * 1000;
const PAST_LIMIT_MS = 24 * 60 * 60 * 1000;

/**
 * The phone's press time is advisory. It is kept only inside sane bounds
 * (at most 2 minutes ahead, at most 24 hours old); otherwise the server's
 * receive time stands and the reason is recorded.
 */
export function boundPressedAt(
  value: string | undefined,
  now: Date,
): { pressedAt: Date | null; pressedAtStatus: "PHONE" | "MISSING" | "OUT_OF_BOUNDS" } {
  if (!value) return { pressedAt: null, pressedAtStatus: "MISSING" };
  const at = new Date(value);
  const t = at.getTime();
  if (Number.isNaN(t)) return { pressedAt: null, pressedAtStatus: "OUT_OF_BOUNDS" };
  if (t > now.getTime() + FUTURE_TOLERANCE_MS || t < now.getTime() - PAST_LIMIT_MS)
    return { pressedAt: null, pressedAtStatus: "OUT_OF_BOUNDS" };
  return { pressedAt: at, pressedAtStatus: "PHONE" };
}
