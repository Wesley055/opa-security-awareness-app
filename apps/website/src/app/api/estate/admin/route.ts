import { estateApi, requireRole, respond } from "@/lib/estate-api";
export const dynamic = "force-dynamic";

export async function GET() {
  return (await requireRole("FACILITY_ADMIN")) ?? estateApi("/estate/admin/overview");
}

export async function PUT(request: Request) {
  const denied = await requireRole("FACILITY_ADMIN");
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const visit = Number(body?.visitorDefaultMinutes), grace = Number(body?.overstayGraceMinutes);
  if (!Number.isInteger(visit) || visit < 15 || visit > 4320 || !Number.isInteger(grace) || grace < 0 || grace > 720)
    return respond({ error: "Visit length must be 15 minutes to 3 days; grace 0 to 12 hours." }, 400);
  return estateApi("/estate/admin/settings", "PUT", { visitorDefaultMinutes: visit, overstayGraceMinutes: grace });
}
