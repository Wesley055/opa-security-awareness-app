import "server-only";
import { NextResponse } from "next/server";
import { AdminFailure, requireAdmin, upstream } from "./super-admin-api";
import {
  clearOnboardingSession,
  onboardingAccess,
  onboardingRefresh,
  setOnboardingSession,
} from "./onboarding-session";
const uuid =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const allowed = new Set([
  "users",
  "grants",
  "facilities",
  "invitations",
  "nextCursor",
  "id",
  "name",
  "role",
  "isActive",
  "accountStatus",
  "actorUserId",
  "approvedByUserId",
  "facilityId",
  "permission",
  "expiresAt",
  "revokedAt",
  "createdAt",
  "status",
  "revokedCount",
  "requestId",
  "requestedRole",
  "acceptedAt",
  "verifiedAt",
  "lastResentAt",
  "deliveries",
  "channel",
  "attemptCount",
  "queuedAt",
  "nextAttemptAt",
  "lastAttemptAt",
  "sentAt",
  "failedAt",
]);
export function projectOnboarding(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(projectOnboarding);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => allowed.has(key))
        .map(([key, item]) => [key, projectOnboarding(item)]),
    );
  return value;
}
export function onboardingPath(
  action: string[],
  method: string,
  admin: boolean,
): string | null {
  const path = action.join("/");
  const expression = admin
    ? method === "GET"
      ? `^(facilities|employees|employees/${uuid}/grants)$`
      : `^employees/${uuid}/(grants|revoke-all|grants/${uuid}/revoke)$`
    : method === "GET"
      ? `^(facilities|facilities/${uuid}/invitations)$`
      : `^(operators|facility-admins|facilities/${uuid}/invitations/${uuid}/(resend|revoke))$`;
  if (!new RegExp(expression).test(path)) return null;
  return (
    (admin
      ? path === "facilities"
        ? "/admin/"
        : "/admin/onboarding/"
      : "/onboarding/") + path
  );
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
async function saveTokens(result: {
  accessToken?: unknown;
  refreshToken?: unknown;
}) {
  if (
    typeof result.accessToken !== "string" ||
    typeof result.refreshToken !== "string"
  )
    throw new AdminFailure(502);
  const scope = await upstream("/onboarding/facilities", result.accessToken);
  if (!Array.isArray(scope.facilities) || !scope.facilities.length)
    throw new AdminFailure(403);
  await setOnboardingSession(result.accessToken, result.refreshToken);
}
export async function onboardingProxy(
  request: Request,
  action: string[],
  admin: boolean,
) {
  try {
    if (
      request.method === "POST" &&
      request.headers.get("origin") !== new URL(request.url).origin
    )
      throw new AdminFailure(403);
    if (
      !admin &&
      action.length === 1 &&
      request.method === "POST" &&
      ["login", "refresh", "logout"].includes(action[0])
    ) {
      if (action[0] === "logout") {
        await clearOnboardingSession();
        return json({ ok: true });
      }
      if (action[0] === "refresh") {
        const refreshToken = await onboardingRefresh();
        if (!refreshToken) throw new AdminFailure(401);
        try {
          await saveTokens(
            await upstream("/auth/refresh", undefined, { refreshToken }),
          );
        } catch (error) {
          if (
            error instanceof AdminFailure &&
            [401, 403].includes(error.status)
          )
            await clearOnboardingSession();
          throw error;
        }
      } else {
        const body = await request.json();
        await saveTokens(
          await upstream("/auth/login", undefined, {
            email: body.email,
            password: body.password,
          }),
        );
      }
      return json({ ok: true });
    }
    const path = onboardingPath(action, request.method, admin);
    if (!path) throw new AdminFailure(404);
    const access = admin
      ? (await requireAdmin()).access
      : await onboardingAccess();
    if (!access) throw new AdminFailure(401);
    const cursor = new URL(request.url).searchParams.get("cursor");
    if (cursor && !new RegExp(`^${uuid}$`).test(cursor))
      throw new AdminFailure(400);
    let body: unknown;
    if (request.method === "POST") {
      try {
        body = await request.json();
      } catch {
        throw new AdminFailure(400);
      }
    }
    return json(
      projectOnboarding(
        await upstream(
          path +
            (cursor && request.method === "GET" ? "?cursor=" + cursor : ""),
          access,
          body,
          request.headers.get("idempotency-key") ?? undefined,
        ),
      ),
    );
  } catch (error) {
    const status = error instanceof AdminFailure ? error.status : 503;
    const messages: Record<number, string> = {
      400: "Check the supplied fields.",
      401: "Your session expired. Sign in or restore your session.",
      403: "Current authority is required for this action.",
      404: "Resource unavailable.",
      409: "This invitation is not eligible. Refresh and check delivery status.",
      429: "Too many requests. Please wait.",
    };
    return json(
      {
        error:
          messages[status] ??
          "Service unavailable. Check status before retrying.",
      },
      status,
    );
  }
}
