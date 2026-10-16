import { NextResponse } from "next/server";
import { getOperatorContext } from "@/lib/operator-context";
import { consoleApi } from "@/lib/console-api";
import { validReportWindow } from "@/lib/insight-contract";
import { parseHeadOffice } from "@/lib/organization-insight";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const respond = (body: unknown, status: number) =>
    NextResponse.json(body, {
      status,
      headers: { "Cache-Control": "no-store, private" },
    });
  const params = new URL(request.url).searchParams;
  const from = params.get("from") ?? "",
    to = params.get("to") ?? "",
    region = params.get("region");
  if (
    [...params.keys()].some((k) => !["from", "to", "region"].includes(k)) ||
    params.getAll("from").length !== 1 ||
    params.getAll("to").length !== 1 ||
    params.getAll("region").length > 1 ||
    (region !== null && (!region.trim() || region.length > 80)) ||
    !validReportWindow(from, to)
  )
    return respond(
      { error: "Choose a valid date range of at most 366 days." },
      400,
    );
  const context = await getOperatorContext();
  if (context.state === "REJECTED")
    return respond({ error: "Your session ended." }, 401);
  if (context.state === "UNAVAILABLE")
    return respond({ error: "Account context is temporarily unavailable." }, 503);
  if (context.state !== "NO_FACILITY" || context.role !== "ORGANIZATION_ADMIN")
    return respond({ error: "Head Office access denied." }, 403);
  // The organization is never sent from the browser; the API derives it.
  const query = new URLSearchParams({ from, to });
  if (region) query.set("region", region);
  const response = await consoleApi("/organization/insight/overview?" + query);
  if (response.status !== 200)
    return respond({ error: response.error }, response.status);
  try {
    return respond({ summary: parseHeadOffice(response.data) }, 200);
  } catch {
    return respond(
      { error: "Head Office reporting is temporarily unavailable." },
      503,
    );
  }
}
