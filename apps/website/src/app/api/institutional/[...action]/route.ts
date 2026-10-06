import { sameOriginSessionPost } from "@/lib/session-post-origin";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AdminFailure, upstream } from "@/lib/super-admin-api";
import {
  institutionalPath,
  institutionalProjection,
} from "@/lib/institutional-path";
import {
  INSTITUTIONAL_ACCESS as cookie,
  INSTITUTIONAL_REFRESH as refreshCookie,
  setInstitutionalSession,
  clearInstitutionalSession,
} from "@/lib/institutional-session";
import { clearOperatorSession } from "@/lib/operator-session";
async function boundedBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new AdminFailure(400);
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 16384) {
      await reader.cancel();
      throw new AdminFailure(413);
    }
    chunks.push(value);
  }
  const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new AdminFailure(400);
  return data;
}
async function handle(
  request: Request,
  { params }: { params: Promise<{ action: string[] }> },
) {
  const store = await cookies();
  const json = (body: unknown, status = 200) =>
    NextResponse.json(body, {
      status,
      headers: {
        "Cache-Control": "no-store, private",
        "Referrer-Policy": "no-referrer",
      },
    });
  const path = (await params).action.join("/");
  try {
    if (
      request.method === "POST" &&
      (["login", "logout", "refresh"].includes(path)
        ? !sameOriginSessionPost(request)
        : request.headers.get("origin") !== new URL(request.url).origin)
    )
      throw new AdminFailure(403);
    if (path === "logout" && request.method === "POST") {
      await clearInstitutionalSession();
      await clearOperatorSession();
      return json({ ok: true });
    }
    if (path === "refresh" && request.method === "POST") {
      const refreshToken = store.get(refreshCookie)?.value;
      if (!refreshToken) throw new AdminFailure(401);
      try {
        const tokens = await upstream("/auth/refresh", undefined, {
          refreshToken,
        });
        if (
          typeof tokens.accessToken !== "string" ||
          typeof tokens.refreshToken !== "string"
        )
          throw new AdminFailure(502);
        await upstream("/institutional/context", tokens.accessToken);
        await setInstitutionalSession(tokens.accessToken, tokens.refreshToken);
        return json({ ok: true });
      } catch (error) {
        if (
          error instanceof AdminFailure &&
          [401, 403].includes(error.status)
        ) {
          await clearInstitutionalSession();
          await clearOperatorSession();
        }
        throw error;
      }
    }
    if (path === "login" && request.method === "POST") {
      await clearInstitutionalSession();
      await clearOperatorSession();
      const body = await boundedBody(request);
      const tokens = await upstream("/auth/login", undefined, {
        email: body.email,
        password: body.password,
      });
      if (typeof tokens.accessToken !== "string") throw new AdminFailure(502);
      const context = await upstream(
        "/institutional/context",
        tokens.accessToken,
      );
      if (typeof tokens.refreshToken !== "string") throw new AdminFailure(502);
      await setInstitutionalSession(tokens.accessToken, tokens.refreshToken);
      return json(institutionalProjection(context));
    }
    const target = institutionalPath(path, request.method);
    if (!target) throw new AdminFailure(404);
    const query = new URL(request.url).searchParams;
    if (
      [...query.keys()].some(
        (k) => !path.endsWith("/invitation-roles") || k !== "caseReference",
      ) ||
      query.getAll("caseReference").length > 1 ||
      (query.has("caseReference") &&
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          query.get("caseReference")!,
        ))
    )
      throw new AdminFailure(400);
    const suffix = query.size ? "?" + query.toString() : "";
    const token = store.get(cookie)?.value;
    if (!token) throw new AdminFailure(401);
    const context = await upstream("/institutional/context", token);
    if (path === "context") return json(institutionalProjection(context));
    if (
      request.headers.get("x-institutional-actor") !==
      context.actor.id + ":" + context.actor.role
    )
      throw new AdminFailure(403);
    const body =
      request.method === "POST" ? await boundedBody(request) : undefined;
    return json(
      institutionalProjection(
        await upstream(
          target + suffix,
          token,
          body,
          request.headers.get("idempotency-key") ?? undefined,
        ),
      ),
    );
  } catch (error) {
    const status = error instanceof AdminFailure ? error.status : 400;
    // Scoped denials (including foreign Origin and actor mismatch) do not log out a valid session.
    // Ordinary access expiry must leave the refresh credential available for the bounded client retry.
    // Login and refresh rejections are final authentication failures.
    if (status === 401 && ["login", "refresh"].includes(path)) {
      await clearInstitutionalSession();
      await clearOperatorSession();
    }
    return json(
      {
        error:
          status === 401
            ? "Your session has ended. Sign in again."
            : status === 403
              ? "This operation is not permitted by your current authority."
              : "Operation failed. Check the request and current state.",
      },
      status,
    );
  }
}
export const GET = handle;
export const POST = handle;
