import { call, operatorRole, respond, sessionToken, UUID } from "@/lib/staff-api";
export const dynamic = "force-dynamic";

async function operator() {
  const token = await sessionToken("operator");
  if (typeof token !== "string") return token;
  if ((await operatorRole()) !== "FACILITY_OPERATOR") return respond({ error: "Duty reports are for facility operators." }, 403);
  return token;
}

export async function GET(request: Request) {
  const token = await operator();
  if (typeof token !== "string") return token;
  return new URL(request.url).searchParams.get("view") === "preview" ? call(token, "/operator/duty/preview") : call(token, "/operator/duty");
}

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return respond({ error: "Refused." }, 403);
  const token = await operator();
  if (typeof token !== "string") return token;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (body?.action === "start") return call(token, "/operator/duty/start", "POST");
  if (body?.action === "submit") {
    const notes = typeof body.notes === "string" ? body.notes.slice(0, 4000) : undefined;
    const handoverItems = Array.isArray(body.handoverItems) ? body.handoverItems.slice(0, 50) : undefined;
    const shiftId = typeof body.shiftId === "string" && UUID.test(body.shiftId) ? body.shiftId : null;
    return call(token, shiftId ? `/operator/duty/shifts/${shiftId}/submit` : "/operator/duty/submit", "POST", { notes, handoverItems });
  }
  return respond({ error: "Unknown duty action." }, 400);
}
