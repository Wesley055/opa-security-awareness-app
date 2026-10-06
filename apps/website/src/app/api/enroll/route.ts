import { environmentApiUrl } from "@/lib/environment-api";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
const pendingCookie = "opa_enrollment_acceptance";
const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/api/enroll",
});
function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, private",
      "Referrer-Policy": "no-referrer",
    },
  });
}
class EnrollmentFailure extends Error {
  constructor(readonly status: number) {
    super("Enrollment unavailable");
  }
}
export async function GET() {
  const value = (await cookies()).get(pendingCookie)?.value;
  try {
    const pending = value ? JSON.parse(value) : null;
    return json({
      status: pending?.requestId ? "AUTHENTICATION_REQUIRED" : "VERIFY",
      requestId: pending?.requestId,
    });
  } catch {
    return json({ status: "VERIFY" });
  }
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
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          (async () => {
            const response = await fetch(base + path, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(access ? { Authorization: "Bearer " + access } : {}),
              },
              body: JSON.stringify(payload),
              cache: "no-store",
              signal: controller.signal,
            });
            if (!response.ok) throw new EnrollmentFailure(response.status);
            return response.json();
          })(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(new EnrollmentFailure(503));
            }, 10000);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    };
    const save = (
      result: { status: string; acceptanceToken?: string; role?: string },
      requestId: string,
    ) => {
      if (
        result.status === "AUTHENTICATION_REQUIRED" &&
        typeof result.acceptanceToken === "string"
      ) {
        store.set(
          pendingCookie,
          JSON.stringify({
            requestId,
            acceptanceToken: result.acceptanceToken,
          }),
          { ...cookieOptions(), maxAge: 900 },
        );
        return json({ status: "AUTHENTICATION_REQUIRED" });
      }
      if (result.status === "ACCEPTED") {
        store.set(pendingCookie, "", { ...cookieOptions(), maxAge: 0 });
        const role = [
          "ADMIN",
          "TECHNICAL_SUPPORT",
          "FACILITY_ADMIN",
          "FACILITY_OPERATOR",
          "USER",
        ].includes(result.role ?? "")
          ? result.role
          : undefined;
        return json({ status: "ACCEPTED", role });
      }
      throw new EnrollmentFailure(503);
    };
    if (body.action === "verify")
      return save(
        await call("/auth/enrollment/verify", {
          requestId: body.requestId,
          emailCode: body.emailCode,
          phoneCode: body.phoneCode,
          password: body.password,
          accept: body.accept,
        }),
        body.requestId,
      );
    if (body.action === "accept" || body.action === "resume") {
      const pending = store.get(pendingCookie)?.value;
      if (body.action === "accept" && !pending)
        return json(
          { error: "Resume the verified invitation before accepting." },
          400,
        );
      const tokens = await call("/auth/login", {
        email: body.email,
        password: body.password,
      });
      if (typeof tokens.accessToken !== "string")
        throw new EnrollmentFailure(503);
      if (body.action === "resume")
        return save(
          await call(
            "/auth/enrollment/continue",
            { requestId: body.requestId },
            tokens.accessToken,
          ),
          body.requestId,
        );
      const data = JSON.parse(pending!);
      return save(
        await call("/auth/enrollment/accept", data, tokens.accessToken),
        data.requestId,
      );
    }
    return json({ error: "Enrollment action unavailable." }, 400);
  } catch (error) {
    const status =
      error instanceof EnrollmentFailure && error.status < 500
        ? error.status
        : 503;
    return json(
      {
        status: status >= 500 ? "RESULT_UNKNOWN" : "REJECTED",
        error:
          status >= 500
            ? "The result is uncertain. Resume this invitation with your account before retrying verification."
            : "Enrollment could not be completed. Check your proofs or sign-in details. Contact your administrator if your own contact details cannot be used.",
      },
      status,
    );
  }
}
