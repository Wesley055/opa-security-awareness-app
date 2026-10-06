import { sameOriginSessionPost } from "@/lib/session-post-origin";
import { NextResponse } from "next/server";
import { operatorHandoff } from "@/lib/operator-handoff";

export const dynamic = "force-dynamic";

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store, private");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

function redirectTo(request: Request, path: string) {
  return noStore(
    NextResponse.redirect(new URL(path, request.url), {
      status: 303,
    }),
  );
}

export async function POST(request: Request) {
  if (!sameOriginSessionPost(request)) {
    return noStore(
      NextResponse.json(
        { ok: false, error: "Request rejected." },
        { status: 403 },
      ),
    );
  }

  try {
    await operatorHandoff();
    return redirectTo(request, "/operator");
  } catch (error) {
    const status =
      error &&
      typeof error === "object" &&
      "status" in error &&
      typeof error.status === "number"
        ? error.status
        : 503;

    if (status === 401) {
      return redirectTo(request, "/institutional");
    }

    if (status === 403) {
      return redirectTo(request, "/institutional");
    }

    return noStore(
      NextResponse.json(
        {
          ok: false,
          error: "Command Center is temporarily unavailable.",
        },
        { status: 503 },
      ),
    );
  }
}
