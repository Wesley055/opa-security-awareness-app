import { environmentApiUrl } from "@/lib/environment-api";
import "server-only";
import { adminAccess } from "./super-admin-session";

export class AdminFailure extends Error {
  constructor(public status: number) {
    super("Super Admin request failed");
  }
}
export async function upstream(
  path: string,
  token?: string,
  body?: unknown,
  idempotencyKey?: string,
) {
  const base = environmentApiUrl();
  if (!base) throw new AdminFailure(503);
  let response: Response;
  try {
    response = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new AdminFailure(503);
  }
  if (!response.ok)
    throw new AdminFailure(
      [400, 401, 403, 404, 409, 429].includes(response.status)
        ? response.status
        : 503,
    );
  try {
    return await response.json();
  } catch {
    throw new AdminFailure(502);
  }
}
// This is a server-side presentation gate using database-backed /users/me.
// Every /admin operation still passes the backend JwtAuthGuard + AdminGuard.
export async function requireAdmin(token?: string) {
  const access = token ?? (await adminAccess());
  if (!access) throw new AdminFailure(401);
  const me = await upstream("/users/me", access);
  if (me?.role !== "ADMIN" || me?.isActive !== true)
    throw new AdminFailure(403);
  return {
    access,
    facilityId: typeof me.facilityId === "string" ? me.facilityId : null,
    name: [me.firstName, me.lastName]
      .filter((v) => typeof v === "string")
      .join(" "),
  };
}
export function projectMembers(data: unknown) {
  const value = data as {
    facility?: { id?: unknown; name?: unknown; isActive?: unknown };
    operators?: unknown[];
  };
  const f = value?.facility;
  if (
    !f ||
    typeof f.id !== "string" ||
    typeof f.name !== "string" ||
    typeof f.isActive !== "boolean" ||
    !Array.isArray(value.operators)
  )
    throw new AdminFailure(502);
  return {
    facility: { id: f.id, name: f.name, isActive: f.isActive },
    operators: value.operators.map((item) => {
      const seat = item as Record<string, unknown>;
      if (
        seat.role !== "FACILITY_OPERATOR" ||
        typeof seat.id !== "string" ||
        typeof seat.firstName !== "string" ||
        typeof seat.lastName !== "string" ||
        typeof seat.isActive !== "boolean" ||
        !["ACTIVE", "PENDING_ACTIVATION"].includes(String(seat.accountStatus))
      )
        throw new AdminFailure(502);
      return {
        id: seat.id,
        firstName: seat.firstName,
        lastName: seat.lastName,
        isActive: seat.isActive,
        accountStatus: seat.accountStatus as string,
      };
    }),
  };
}
export const failureMessages: Record<number, string> = {
  400: "Check the supplied fields and try again.",
  401: "Your session has ended. Sign in or restore your session.",
  403: "Forbidden. Active platform ADMIN access is required.",
  404: "Facility or requested resource not found.",
  409: "The requested action is not eligible or the record changed. Refresh and review before retrying.",
  429: "Too many requests. Wait before trying again.",
  502: "The service returned an unusable response.",
  503: "The service is temporarily unavailable. For a creation request, check the result before submitting again.",
};
