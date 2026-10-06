import { NextResponse } from "next/server";
import { getOperatorContext } from "@/lib/operator-context";
import { consoleApi } from "@/lib/console-api";
import { parseSafeWalkProtection } from "@/lib/safewalk-protection";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const json = (body: unknown, status: number) =>
    NextResponse.json(body, {
      status,
      headers: { "Cache-Control": "no-store, private" },
    });
  if (new URL(request.url).search)
    return json({ error: "No client facility selection accepted." }, 400);
  const context = await getOperatorContext();
  if (context.state !== "READY")
    return json(
      { error: "Current facility context required." },
      context.state === "REJECTED"
        ? 401
        : context.state === "UNAVAILABLE"
          ? 503
          : 403,
    );
  if (context.context.role !== "FACILITY_OPERATOR")
    return json({ error: "Use your authorized institutional workspace." }, 403);
  const id = context.context.facility.id;
  const result = await consoleApi(
    "/institutional/facilities/" +
      encodeURIComponent(id) +
      "/safewalk-emergencies",
  );
  if (result.status !== 200)
    return json({ error: result.error }, result.status);
  try {
    return json(parseSafeWalkProtection(result.data, id), 200);
  } catch {
    return json({ error: "Emergency data temporarily unavailable." }, 503);
  }
}
