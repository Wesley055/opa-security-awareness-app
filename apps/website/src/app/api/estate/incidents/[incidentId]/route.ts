import { estateApi, requireRole, respond, UUID } from "@/lib/estate-api";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ incidentId: string }> }) {
  const denied = await requireRole("FACILITY_OPERATOR");
  if (denied) return denied;
  const { incidentId } = await params;
  if (!UUID.test(incidentId)) return respond({ error: "Unknown incident." }, 400);
  return estateApi(`/estate/gate/incidents/${incidentId}/visitors`);
}
