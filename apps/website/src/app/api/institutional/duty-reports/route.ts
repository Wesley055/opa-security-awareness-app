import { call, respond, sessionToken, UUID } from "@/lib/staff-api";
export const dynamic = "force-dynamic";
/** Facility Admin review. The API's FacilityAdminGuard fixes the facility from the account. */
export async function GET(request: Request) {
  const token = await sessionToken("institutional", request);
  if (typeof token !== "string") return token;
  return call(token, "/facility-admin/duty-reports");
}
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return respond({ error: "Refused." }, 403);
  const token = await sessionToken("institutional", request);
  if (typeof token !== "string") return token;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (body?.action === "acknowledge" && typeof body.id === "string" && UUID.test(body.id)) return call(token, `/facility-admin/duty-reports/${body.id}/acknowledge`, "POST");
  return respond({ error: "Unknown action." }, 400);
}
