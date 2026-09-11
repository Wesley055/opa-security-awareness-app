import { environmentApiUrl } from "@/lib/environment-api";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
const pendingCookie = "opa_enrollment_acceptance";
function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return json({ error: "Request unavailable." }, 403);
  const base = environmentApiUrl();
  if (!base) return json({ error: "Enrollment unavailable." }, 503);
  try {
    const body = await request.json();
    const store = await cookies();
    const call = async (path: string, payload: unknown, access?: string) => {
      const response = await fetch(base + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(access ? { Authorization: "Bearer " + access } : {}),
        },
        body: JSON.stringify(payload),
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error("Enrollment could not be completed.");
      return response.json();
    };
    if (body.action === "verify") {
      const result = await call("/auth/enrollment/verify", {
        requestId: body.requestId,
        emailCode: body.emailCode,
        phoneCode: body.phoneCode,
        password: body.password,
        accept: body.accept,
      });
      if (
        result.status === "AUTHENTICATION_REQUIRED" &&
        typeof result.acceptanceToken === "string"
      ) {
        store.set(
          pendingCookie,
          JSON.stringify({
            requestId: body.requestId,
            acceptanceToken: result.acceptanceToken,
          }),
          {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "strict",
            path: "/api/enroll",
            maxAge: 900,
          },
        );
        return json({ status: "AUTHENTICATION_REQUIRED" });
      }
      if (result.status === "ACCEPTED") {
        store.delete(pendingCookie);
        return json({ status: "ACCEPTED" });
      }
    }
    if (body.action === "accept") {
      const pending = store.get(pendingCookie)?.value;
      if (!pending)
        return json({ error: "Verify your invitation first." }, 400);
      const tokens = await call("/auth/login", {
        email: body.email,
        password: body.password,
      });
      if (typeof tokens.accessToken !== "string") throw new Error();
      const result = await call(
        "/auth/enrollment/accept",
        JSON.parse(pending),
        tokens.accessToken,
      );
      if (result.status === "ACCEPTED") {
        store.delete(pendingCookie);
        return json({ status: "ACCEPTED" });
      }
    }
    return json({ error: "Enrollment could not be completed." }, 400);
  } catch {
    return json(
      {
        error:
          "Enrollment could not be completed. Check your proofs or sign-in details and retry.",
      },
      400,
    );
  }
}
