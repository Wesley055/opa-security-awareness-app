import "server-only";
import { NextResponse } from "next/server";
import { apiUrl, getAccessToken } from "@/lib/operator-session";
import { getOperatorContext } from "@/lib/operator-context";
import { institutionalTokens } from "@/lib/institutional-session";
import { upstream } from "@/lib/super-admin-api";

/** Duty Reports and staff profiles proxy. Fixed upstream paths only; the facility always comes from the account. */
export function respond(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store, private" } });
}
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function message(body: unknown): string | null {
  if (body && typeof body === "object" && "message" in body) {
    const m = (body as { message: unknown }).message;
    const text = Array.isArray(m) ? m[0] : m;
    if (typeof text === "string" && text.length <= 240) return text;
  }
  return null;
}
function code(body: unknown): string | null {
  return body && typeof body === "object" && typeof (body as { code?: unknown }).code === "string" ? (body as { code: string }).code : null;
}

export type Session = "operator" | "institutional";

/** Token for the console the request came from. Institutional calls must carry the actor header. */
export async function sessionToken(session: Session, request?: Request): Promise<string | Response> {
  if (session === "operator") {
    const context = await getOperatorContext();
    if (context.state === "REJECTED") return respond({ error: "Your session ended. Sign in again." }, 401);
    if (context.state === "UNAVAILABLE") return respond({ error: "Account context is temporarily unavailable. Retry." }, 503);
    const token = await getAccessToken();
    return token ?? respond({ error: "Your session ended. Sign in again." }, 401);
  }
  const { accessToken } = await institutionalTokens();
  if (!accessToken) return respond({ error: "Your session ended. Sign in again." }, 401);
  try {
    const context = await upstream("/institutional/context", accessToken);
    if (request?.headers.get("x-institutional-actor") !== context.actor?.id + ":" + context.actor?.role)
      return respond({ error: "This operation is not permitted by your current authority." }, 403);
  } catch {
    return respond({ error: "Your session ended. Sign in again." }, 401);
  }
  return accessToken;
}

export async function operatorRole(): Promise<string | null> {
  const c = await getOperatorContext();
  return c.state === "READY" ? c.context.role : null;
}

export async function call(token: string, path: string, method: "GET" | "POST" = "GET", body?: unknown | FormData) {
  const base = apiUrl();
  if (!base) return respond({ error: "The service is temporarily unavailable." }, 503);
  const form = typeof FormData !== "undefined" && body instanceof FormData;
  try {
    const response = await fetch(base + path, {
      method,
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
      headers: { Authorization: "Bearer " + token, ...(body === undefined || form ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : form ? (body as FormData) : JSON.stringify(body),
    });
    const data = await response.json().catch(() => null);
    if (response.ok) return respond(data, 200);
    const status = [400, 401, 403, 404, 409, 413, 429].includes(response.status) ? response.status : 503;
    // A wrong current password comes back as a 401 with the API's own message. It is a
    // form error, not an ended session: return 400 so the console does not sign the person out.
    const own = message(data);
    if (status === 401 && own && own !== "Unauthorized") return respond({ error: own, code: code(data) }, 400);
    const text = status === 503 ? "The service is temporarily unavailable." : status === 401 ? "Your session ended. Sign in again." : own ?? "The request was refused.";
    return respond({ error: text, code: code(data) }, status);
  } catch {
    return respond({ error: "No connection to OPA. Check the network and refresh to see whether it was recorded.", offline: true }, 503);
  }
}
