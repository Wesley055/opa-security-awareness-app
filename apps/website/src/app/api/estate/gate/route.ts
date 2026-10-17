import { estateApi, requireRole, respond, UUID } from "@/lib/estate-api";
export const dynamic = "force-dynamic";

export async function GET() {
  return (await requireRole("FACILITY_OPERATOR")) ?? estateApi("/estate/gate");
}

/** One endpoint, a closed set of actions; the facility comes from the account. */
export async function POST(request: Request) {
  const denied = await requireRole("FACILITY_OPERATOR");
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = body?.action;
  const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null);
  if (action === "verify") {
    const code = text(body?.code, 20);
    return code ? estateApi("/estate/gate/verify", "POST", { code }) : respond({ error: "Enter the six-digit visitor code." }, 400);
  }
  if (action === "admit" || action === "deny" || action === "exit") {
    const passId = typeof body?.passId === "string" && UUID.test(body.passId) ? body.passId : null;
    if (!passId) return respond({ error: "Verify the visitor code first." }, 400);
    const reason = action === "deny" ? text(body?.reason, 200) : null;
    return estateApi("/estate/gate/" + action, "POST", reason ? { passId, reason } : { passId });
  }
  if (action === "manual") {
    const note = text(body?.note, 200);
    return note && note.length >= 2 ? estateApi("/estate/gate/manual-entry", "POST", { note }) : respond({ error: "Describe the visitor and the house in a few words." }, 400);
  }
  return respond({ error: "Unknown gate action." }, 400);
}
