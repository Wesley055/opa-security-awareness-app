import { NextResponse } from "next/server";
import { institutionalTokens } from "@/lib/institutional-session";
import { AdminFailure, upstream } from "@/lib/super-admin-api";
import { parseInsight, validReportWindow } from "@/lib/insight-contract";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const json = (body: unknown, status: number) =>
    NextResponse.json(body, {
      status,
      headers: { "Cache-Control": "no-store, private" },
    });
  const query = new URL(request.url).searchParams;
  const from = query.get("from") ?? "",
    to = query.get("to") ?? "",
    facilityId = query.get("facilityId") ?? "";
  if (
    [...query.keys()].some((k) => !["from", "to", "facilityId"].includes(k)) ||
    ["from", "to", "facilityId"].some((k) => query.getAll(k).length !== 1) ||
    !validReportWindow(from, to) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      facilityId,
    )
  )
    return json({ error: "Select a facility and valid date range." }, 400);
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
    // The reporting service independently revalidates current DB membership and exact facility.
    const data = await upstream(
      "/internal/insight/overview?" +
        new URLSearchParams({ from, to, facilityId }),
      accessToken,
    );
    return json({ summary: parseInsight(data) }, 200);
  } catch (error) {
    return json(
      { error: "Reporting request could not be completed." },
      error instanceof AdminFailure ? error.status : 503,
    );
  }
}
