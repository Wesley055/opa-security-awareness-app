import "server-only";
import { NextResponse } from "next/server";
import { apiUrl, getAccessToken } from "@/lib/operator-session";
import { getOperatorContext } from "@/lib/operator-context";

/**
 * EstateFlow proxy. Fixed upstream paths only. Unlike consoleApi it passes
 * the API's own short message through, because a guard needs to hear
 * "this pass has expired", not a generic conflict.
 */
export function respond(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store, private" } });
}

export async function requireRole(role: "FACILITY_OPERATOR" | "FACILITY_ADMIN") {
  const context = await getOperatorContext();
  if (context.state === "REJECTED") return respond({ error: "Your session ended. Sign in again." }, 401);
  if (context.state === "UNAVAILABLE") return respond({ error: "Account context is temporarily unavailable. Retry." }, 503);
  if (context.state !== "READY" || context.context.role !== role)
    return respond({ error: role === "FACILITY_OPERATOR" ? "Gate access is for estate security accounts." : "Estate overview is for estate administrators." }, 403);
  return null;
}

function message(body: unknown): string | null {
  if (body && typeof body === "object" && "message" in body) {
    const m = (body as { message: unknown }).message;
    const text = Array.isArray(m) ? m[0] : m;
    if (typeof text === "string" && text.length <= 200) return text;
  }
  return null;
}

export async function estateApi(path: string, method: "GET" | "POST" | "PUT" = "GET", body?: unknown) {
  const base = apiUrl(), token = await getAccessToken();
  if (!token) return respond({ error: "Your session ended. Sign in again." }, 401);
  if (!base) return respond({ error: "The service is temporarily unavailable." }, 503);
  try {
    const response = await fetch(base + path, {
      method,
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
      headers: { Authorization: "Bearer " + token, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => null);
    if (response.ok) return respond(data, 200);
    const known = [400, 401, 403, 404, 409, 429];
    const status = known.includes(response.status) ? response.status : 503;
    return respond(
      { error: status === 503 ? "The service is temporarily unavailable." : status === 401 ? "Your session ended. Sign in again." : message(data) ?? "The request was refused." },
      status,
    );
  } catch {
    return respond({ error: "No connection to OPA. Check the network. If you pressed a button, refresh the board to see whether it was recorded.", offline: true }, 503);
  }
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
