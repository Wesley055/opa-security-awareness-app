import { institutionalTokens } from "@/lib/institutional-session";
import { AdminFailure, upstream } from "@/lib/super-admin-api";
import { reportJson, reportProxy } from "@/lib/insight-report-proxy";
export const dynamic = "force-dynamic";
async function handle(request: Request) {
  try {
    const { accessToken } = await institutionalTokens();
    if (!accessToken) throw new AdminFailure(401);
    const context = await upstream("/institutional/context", accessToken);
    if (
      request.headers.get("x-institutional-actor") !==
        context.actor?.id + ":" + context.actor?.role ||
      !["ADMIN", "FACILITY_ADMIN", "FACILITY_OPERATOR"].includes(
        context.actor?.role,
      )
    )
      throw new AdminFailure(403);
    const facilityId =
      new URL(request.url).searchParams.get("facilityId") ?? "";
    // Exact facility and current authority are rechecked transactionally by InsightService.
    return await reportProxy(
      request,
      facilityId,
      async (path, method, body) => ({
        status: 200,
        data: await upstream(path, accessToken, body, undefined, method),
      }),
    );
  } catch (error) {
    return reportJson(
      { error: "Reporting request unavailable." },
      error instanceof AdminFailure ? error.status : 503,
    );
  }
}
export const GET = handle;
export const POST = handle;
