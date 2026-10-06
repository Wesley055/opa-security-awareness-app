import { NextResponse } from "next/server";
import { institutionalTokens } from "@/lib/institutional-session";
import { AdminFailure, upstream } from "@/lib/super-admin-api";
import { isUuid, parseSafeWalkProtection } from "@/lib/safewalk-protection";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const json = (body: unknown, status: number) =>
    NextResponse.json(body, {
      status,
      headers: { "Cache-Control": "no-store, private" },
    });
  const query = new URL(request.url).searchParams,
    facilityId = query.get("facilityId"),
    caseReference = query.get("caseReference");
  if (
    [...query.keys()].some(
      (k) => !["facilityId", "caseReference"].includes(k),
    ) ||
    query.getAll("facilityId").length !== 1 ||
    query.getAll("caseReference").length > 1 ||
    !isUuid(facilityId) ||
    (caseReference !== null && !isUuid(caseReference))
  )
    return json(
      { error: "Select an authorized facility and case where required." },
      400,
    );
  try {
    const { accessToken } = await institutionalTokens();
    if (!accessToken) throw new AdminFailure(401);
    const context = await upstream("/institutional/context", accessToken);
    if (
      request.headers.get("x-institutional-actor") !==
      context.actor?.id + ":" + context.actor?.role
    )
      throw new AdminFailure(403);
    const suffix = caseReference
      ? "?" + new URLSearchParams({ caseReference })
      : "";
    const data = await upstream(
      "/institutional/facilities/" +
        facilityId +
        "/safewalk-emergencies" +
        suffix,
      accessToken,
    );
    return json(parseSafeWalkProtection(data, facilityId), 200);
  } catch (error) {
    return json(
      {
        error:
          "SafeWalk emergency visibility is unavailable for the current context.",
      },
      error instanceof AdminFailure ? error.status : 503,
    );
  }
}
