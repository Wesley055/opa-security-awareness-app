import { getOperatorContext } from "@/lib/operator-context";
import { consoleApi } from "@/lib/console-api";
import { reportJson, reportProxy } from "@/lib/insight-report-proxy";
export const dynamic = "force-dynamic";
async function handle(request: Request) {
  const context = await getOperatorContext();
  if (context.state !== "READY")
    return reportJson(
      { error: "Current institutional context required." },
      context.state === "REJECTED"
        ? 401
        : context.state === "UNAVAILABLE"
          ? 503
          : 403,
    );
  if (
    !["FACILITY_OPERATOR", "FACILITY_ADMIN", "ADMIN"].includes(
      context.context.role,
    )
  )
    return reportJson({ error: "Reporting access denied." }, 403);
  return reportProxy(request, context.context.facility.id, consoleApi);
}
export const GET = handle;
export const POST = handle;
