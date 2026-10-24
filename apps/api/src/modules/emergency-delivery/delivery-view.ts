import type { PrismaClient } from "@prisma/client";

/**
 * What a duty officer is shown about how an alert arrived (release 48).
 * Typed projection only: never the raw metadata blob.
 */
export const ACTIVATION_SELECT = {
  orderBy: { receivedAt: "asc" as const },
  take: 1,
  select: { firstChannel: true, channels: true, verification: true, pressedAt: true, receivedAt: true },
};

type ActivationRow = { firstChannel: string; channels: string[]; verification: string; pressedAt: Date | null; receivedAt: Date };

export interface DeliveryView {
  channel: string;
  channels: string[];
  verification: string;
  pressedAt: string | null;
}

/** Alerts from older apps carry no activation record: they came through the signed-in app. */
export function deliveryView(rows: ActivationRow[] | undefined): DeliveryView {
  const a = rows?.[0];
  if (!a) return { channel: "APP", channels: ["APP"], verification: "APP_SIGNED_IN", pressedAt: null };
  return { channel: a.firstChannel, channels: a.channels, verification: a.verification, pressedAt: a.pressedAt?.toISOString() ?? null };
}

export interface LocationReport {
  source: "SAVED_PLACE" | "TYPED_LANDMARK" | "LAST_APP_FIX";
  label?: string;
  description?: string | null;
  landmark?: string;
  latitude?: string | null;
  longitude?: string | null;
  recordedAt?: string;
  ageMinutes?: number;
  reportedAt: string;
}

/** USSD answers recorded on the timeline: where the person said they are, and whether security may call. */
export async function deliveryContext(prisma: Pick<PrismaClient, "incidentTimelineEvent">, incidentId: string) {
  const events = await prisma.incidentTimelineEvent.findMany({
    where: { incidentId, type: { in: ["USSD_LOCATION", "USSD_CALLBACK_PREFERENCE"] } },
    orderBy: { occurredAt: "asc" },
    select: { type: true, payload: true, occurredAt: true },
  });
  const locations: LocationReport[] = [];
  let canCall: boolean | null = null;
  for (const e of events) {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    if (e.type === "USSD_CALLBACK_PREFERENCE") canCall = p.canCall === true;
    else if (p.source === "SAVED_PLACE" || p.source === "TYPED_LANDMARK" || p.source === "LAST_APP_FIX")
      locations.push({
        source: p.source,
        ...(typeof p.label === "string" ? { label: p.label } : {}),
        ...(typeof p.description === "string" || p.description === null ? { description: p.description as string | null } : {}),
        ...(typeof p.landmark === "string" ? { landmark: p.landmark } : {}),
        ...(typeof p.latitude === "string" || p.latitude === null ? { latitude: p.latitude as string | null } : {}),
        ...(typeof p.longitude === "string" || p.longitude === null ? { longitude: p.longitude as string | null } : {}),
        ...(typeof p.recordedAt === "string" ? { recordedAt: p.recordedAt } : {}),
        ...(typeof p.ageMinutes === "number" ? { ageMinutes: p.ageMinutes } : {}),
        reportedAt: e.occurredAt.toISOString(),
      });
  }
  return { locations, canCall };
}
