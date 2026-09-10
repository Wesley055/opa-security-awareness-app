import { NextResponse } from "next/server";
import {
  AdminFailure,
  failureMessages,
  requireAdmin,
  upstream,
} from "@/lib/super-admin-api";
import {
  adminRefresh,
  clearAdminSession,
  setAdminSession,
} from "@/lib/super-admin-session";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ action: string[] }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const allowedKeys = new Set([
  "facilities",
  "facility",
  "members",
  "invitations",
  "events",
  "nextCursor",
  "id",
  "name",
  "type",
  "isActive",
  "isVerified",
  "createdAt",
  "updatedAt",
  "role",
  "facilityId",
  "accountStatus",
  "activatedAt",
  "invitedByUserId",
  "membershipState",
  "requestId",
  "status",
  "requestedRole",
  "expiresAt",
  "verifiedAt",
  "acceptedAt",
  "acceptedUserId",
  "revokedAt",
  "lastResentAt",
  "deliveries",
  "channel",
  "attemptCount",
  "queuedAt",
  "nextAttemptAt",
  "lastAttemptAt",
  "sentAt",
  "failedAt",
  "actorUserId",
  "actorRole",
  "action",
  "resourceId",
  "previousFacilityId",
  "reason",
  "beforeState",
  "afterState",
  "userId",
  "revoked",
]);
export function project(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(project);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => allowedKeys.has(key))
        .map(([key, item]) => [key, project(item)]),
    );
  return value;
}
function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, private",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
function failure(error: unknown) {
  const status = error instanceof AdminFailure ? error.status : 503;
  return json(
    { error: failureMessages[status] ?? "Request unavailable." },
    status,
  );
}
function fields(body: Record<string, unknown>, names: string[]) {
  return Object.fromEntries(
    names.filter((n) => body[n] !== undefined).map((n) => [n, body[n]]),
  );
}
async function saveTokens(result: {
  accessToken?: unknown;
  refreshToken?: unknown;
}) {
  if (
    typeof result?.accessToken !== "string" ||
    typeof result.refreshToken !== "string"
  )
    throw new AdminFailure(502);
  await requireAdmin(result.accessToken);
  await setAdminSession(result.accessToken, result.refreshToken);
}
export async function GET(request: Request, context: Context) {
  try {
    const action = (await context.params).action;
    if (
      action[0] !== "facilities" ||
      !(
        action.length === 1 ||
        (uuid.test(action[1]) &&
          (action.length === 2 ||
            (action.length === 3 &&
              ["members", "invitations", "audit"].includes(action[2]))))
      )
    )
      throw new AdminFailure(404);
    const { access } = await requireAdmin();
    const cursor = new URL(request.url).searchParams.get("cursor");
    if (cursor && !uuid.test(cursor)) throw new AdminFailure(400);
    return json(
      project(
        await upstream(
          "/admin/" + action.join("/") + (cursor ? "?cursor=" + cursor : ""),
          access,
        ),
      ),
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin)
      throw new AdminFailure(403);
    const action = (await context.params).action,
      name = action[0];
    const simple =
      action.length === 1 &&
      [
        "login",
        "refresh",
        "logout",
        "facilities",
        "operators",
        "facility-admins",
        "residents",
      ].includes(name);
    const lifecycle =
      action.length === 5 &&
      name === "facilities" &&
      uuid.test(action[1]) &&
      uuid.test(action[3]) &&
      ((action[2] === "members" && action[4] === "access") ||
        (action[2] === "invitations" &&
          ["resend", "revoke"].includes(action[4])));
    const reveal =
      action.length === 3 &&
      name === "facilities" &&
      uuid.test(action[1]) &&
      action[2] === "reveal";
    if (!simple && !lifecycle && !reveal) throw new AdminFailure(404);
    if (simple && name === "logout") {
      await clearAdminSession();
      return json({ ok: true });
    }
    if (simple && name === "refresh") {
      const refreshToken = await adminRefresh();
      if (!refreshToken) throw new AdminFailure(401);
      try {
        await saveTokens(
          await upstream("/auth/refresh", undefined, { refreshToken }),
        );
      } catch (error) {
        if (error instanceof AdminFailure && [401, 403].includes(error.status))
          await clearAdminSession();
        throw error;
      }
      return json({ ok: true });
    }
    const auth = simple && name === "login" ? undefined : await requireAdmin();
    let body: Record<string, unknown>;
    try {
      body = await request.json();
      if (!body || typeof body !== "object" || Array.isArray(body))
        throw new Error();
    } catch {
      throw new AdminFailure(400);
    }
    if (simple && name === "login") {
      await saveTokens(
        await upstream(
          "/auth/login",
          undefined,
          fields(body, ["email", "password"]),
        ),
      );
      return json({ ok: true });
    }
    if (reveal) {
      if (
        auth!.facilityId !== action[1] ||
        typeof body.identifierId !== "string" ||
        !uuid.test(body.identifierId) ||
        typeof body.caseReference !== "string" ||
        !uuid.test(body.caseReference) ||
        !["SUPPORT_CASE", "ACCOUNT_RECOVERY"].includes(String(body.purpose))
      )
        throw new AdminFailure(403);
      const result = await upstream(
        "/protected-identities/" + body.identifierId + "/resolve",
        auth!.access,
        fields(body, ["purpose", "caseReference"]),
      );
      if (typeof result.value !== "string") throw new AdminFailure(502);
      return json({ value: result.value });
    }
    const names = lifecycle
      ? ["reason", "action"]
      : name === "facilities"
        ? ["name", "type", "address", "phoneNumber", "latitude", "longitude"]
        : ["firstName", "lastName", "email", "phoneNumber", "facilityId"];
    const key = request.headers.get("idempotency-key");
    if (
      simple &&
      ["operators", "facility-admins", "residents"].includes(name) &&
      (!key || key.length > 160)
    )
      throw new AdminFailure(400);
    const result = await upstream(
      "/admin/" + action.join("/"),
      auth!.access,
      fields(body, names),
      key ?? undefined,
    );
    return json(
      project(simple && name === "facilities" ? { facility: result } : result),
      lifecycle ? 200 : 201,
    );
  } catch (error) {
    return failure(error);
  }
}
