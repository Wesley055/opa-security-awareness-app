import { call, operatorRole, respond, sessionToken, UUID } from "@/lib/staff-api";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return respond({ error: "Unknown report." }, 400);
  const token = await sessionToken("operator");
  if (typeof token !== "string") return token;
  if ((await operatorRole()) !== "FACILITY_OPERATOR") return respond({ error: "Duty reports are for facility operators." }, 403);
  return call(token, `/operator/duty/reports/${id}`);
}
