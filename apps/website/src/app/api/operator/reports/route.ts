import { NextResponse } from "next/server";
import { getOperatorContext } from "@/lib/operator-context";
import { consoleApi } from "@/lib/console-api";
import { parseInsight, validReportWindow } from "@/lib/insight-contract";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const respond = (body: unknown, status: number) =>
    NextResponse.json(body, {
      status,
      headers: { "Cache-Control": "no-store" },
    });
  const params = new URL(request.url).searchParams;
  const from = params.get("from") ?? "",
    to = params.get("to") ?? "";
  if (
    [...params.keys()].some((k) => !["from", "to"].includes(k)) ||
    params.getAll("from").length !== 1 ||
    params.getAll("to").length !== 1 ||
    !validReportWindow(from, to)
  )
    return respond(
      { error: "Choose a valid date range of at most 366 days." },
      400,
    );
  const context = await getOperatorContext();
  if (context.state !== "READY")
    return respond(
      { error: "Current facility context required." },
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
    return respond({ error: "Reporting access denied." }, 403);
  const query = new URLSearchParams({
    from,
    to,
    facilityId: context.context.facility.id,
  });
  const response = await consoleApi("/internal/insight/overview?" + query);
  if (response.status !== 200)
    return respond({ error: response.error }, response.status);
  try {
    return respond({ summary: parseInsight(response.data) }, 200);
  } catch {
    return respond(
      { error: "Reporting data is temporarily unavailable." },
      503,
    );
  }
}
