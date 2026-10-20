import { call, respond, sessionToken, UUID } from "@/lib/staff-api";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const token = await sessionToken("institutional", request);
  if (typeof token !== "string") return token;
  return call(token, "/facility-admin/staff-photos");
}
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return respond({ error: "Refused." }, 403);
  const token = await sessionToken("institutional", request);
  if (typeof token !== "string") return token;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const userId = typeof body?.userId === "string" && UUID.test(body.userId) ? body.userId : null;
  if (!userId || !["approve", "reject"].includes(String(body?.action))) return respond({ error: "Unknown action." }, 400);
  return call(token, `/facility-admin/staff-photos/${userId}/${body!.action}`, "POST");
}
