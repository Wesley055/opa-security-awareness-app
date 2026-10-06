import { sameOriginSessionPost } from "@/lib/session-post-origin";
import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
/** Compatibility entry: retain POST while moving into the canonical refresh cookie's scope. */
export async function POST(request: Request) {
  const headers = {
    "Cache-Control": "no-store, private",
    "Referrer-Policy": "no-referrer",
  };
  if (!sameOriginSessionPost(request))
    return NextResponse.json(
      { ok: false, error: "Request rejected." },
      { status: 403, headers },
    );
  return NextResponse.redirect(
    new URL("/api/institutional/operator-handoff", request.url),
    { status: 307, headers },
  );
}
