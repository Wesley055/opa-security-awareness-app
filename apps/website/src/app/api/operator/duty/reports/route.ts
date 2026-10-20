import { call, operatorRole, respond, sessionToken } from "@/lib/staff-api";
export const dynamic = "force-dynamic";
export async function GET() {
  const token = await sessionToken("operator");
  if (typeof token !== "string") return token;
  if ((await operatorRole()) !== "FACILITY_OPERATOR") return respond({ error: "Duty reports are for facility operators." }, 403);
  return call(token, "/operator/duty/reports");
}
