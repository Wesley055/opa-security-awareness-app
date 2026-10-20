import { call, respond, sessionToken, UUID } from "@/lib/staff-api";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return respond({ error: "Unknown report." }, 400);
  const token = await sessionToken("institutional", request);
  if (typeof token !== "string") return token;
  return call(token, `/facility-admin/duty-reports/${id}`);
}
