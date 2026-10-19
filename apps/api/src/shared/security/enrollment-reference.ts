import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";

/**
 * Short, typeable invitation reference ("OPA-3F9A1C"), derived from the
 * enrollment request id. It only *locates* a live invitation; it grants
 * nothing. Verification still needs both 4-digit codes under the
 * per-invitation 5-attempt limit. The full id (from the link) keeps working.
 */
const PREFIX_LENGTH = 6;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function enrollmentReference(requestId: string): string {
  return "OPA-" + requestId.replace(/-/g, "").slice(0, PREFIX_LENGTH).toUpperCase();
}

export type ParsedReference = { id: string } | { prefix: string } | null;

/** Accepts the full id, "OPA-3F9A1C", "opa 3f9a1c" or "3F9A1C". */
export function parseEnrollmentReference(raw: unknown): ParsedReference {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (UUID.test(text)) return { id: text.toLowerCase() };
  const compact = text.replace(/[\s-]/g, "").toUpperCase().replace(/^OPA/, "");
  return /^[0-9A-F]{6}$/.test(compact) ? { prefix: compact.toLowerCase() } : null;
}

/** Live = not revoked, not accepted, not expired. */
async function liveWithPrefix(tx: Prisma.TransactionClient, prefix: string) {
  return tx.$queryRaw<{ id: string }[]>`
    SELECT id::text AS id FROM "EnrollmentRequest"
    WHERE id::text LIKE ${prefix + "%"}
      AND "revokedAt" IS NULL AND "acceptedAt" IS NULL AND "expiresAt" > now()
    LIMIT 2`;
}

/**
 * Resolves what the person typed to one request id, or null. An ambiguous
 * short reference (two live invitations sharing it) resolves to null, so the
 * person is told to use the link; it never picks one.
 */
export async function resolveEnrollmentReference(
  tx: Prisma.TransactionClient,
  raw: unknown,
): Promise<string | null> {
  const parsed = parseEnrollmentReference(raw);
  if (!parsed) return null;
  if ("id" in parsed) return parsed.id;
  const rows = await liveWithPrefix(tx, parsed.prefix);
  return rows.length === 1 && rows[0] ? rows[0].id : null;
}

/** New request id whose short reference no live invitation already uses. */
export async function newEnrollmentRequestId(tx: Prisma.TransactionClient): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const id = randomUUID();
    const prefix = id.replace(/-/g, "").slice(0, PREFIX_LENGTH);
    if ((await liveWithPrefix(tx, prefix)).length === 0) return id;
  }
  return randomUUID();
}
