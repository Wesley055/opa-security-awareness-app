import "server-only";
import { call, respond, sessionToken, type Session } from "@/lib/staff-api";
import { clearInstitutionalSession } from "@/lib/institutional-session";
import { clearOperatorSession } from "@/lib/operator-session";

const MAX = 3 * 1024 * 1024;

export async function profileGet(session: Session, request: Request) {
  const token = await sessionToken(session, request);
  return typeof token === "string" ? call(token, "/staff/profile") : token;
}

export async function profilePost(session: Session, request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return respond({ error: "Refused." }, 403);
  const token = await sessionToken(session, request);
  if (typeof token !== "string") return token;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  let result: Response;
  if (body?.action === "password" && typeof body.currentPassword === "string" && typeof body.newPassword === "string") {
    result = await call(token, "/staff/profile/password", "POST", { currentPassword: body.currentPassword.slice(0, 200), newPassword: body.newPassword.slice(0, 200) });
  } else if (body?.action === "recovery-start") {
    return call(token, "/staff/profile/password/recovery", "POST");
  } else if (body?.action === "recovery-complete" && typeof body.smsCode === "string" && typeof body.newPassword === "string") {
    result = await call(token, "/staff/profile/password/recovery/complete", "POST", {
      smsCode: body.smsCode.slice(0, 6),
      ...(typeof body.emailCode === "string" && body.emailCode ? { emailCode: body.emailCode.slice(0, 6) } : {}),
      newPassword: body.newPassword.slice(0, 200),
    });
  } else if (body?.action === "sign-out-everywhere") {
    result = await call(token, "/staff/profile/sign-out-everywhere", "POST");
  } else return respond({ error: "Unknown action." }, 400);
  // Every session is now invalid upstream, including this one: clear the local cookies too.
  if (result.ok) {
    await clearInstitutionalSession();
    await clearOperatorSession();
  }
  return result;
}

export async function photoPost(session: Session, request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return respond({ error: "Refused." }, 403);
  const token = await sessionToken(session, request);
  if (typeof token !== "string") return token;
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob) || file.size === 0) return respond({ error: "Choose a photo." }, 400);
  if (file.size > MAX) return respond({ error: "Photo must be 3 MB or smaller." }, 413);
  const out = new FormData();
  out.append("file", file, "photo");
  return call(token, "/staff/profile/photo", "POST", out);
}
