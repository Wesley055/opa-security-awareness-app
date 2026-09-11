import { NextResponse } from "next/server";
import { consoleApi } from "@/lib/console-api";
import { deliveryPage } from "@/lib/delivery-confirmation";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ incidentId: string }> },
) {
  const { incidentId } = await params;
  const after = new URL(request.url).searchParams.get("after");
  const headers = {
    "Cache-Control": "no-store, private",
    "Referrer-Policy": "no-referrer",
  };
  if (after !== null && !/^[0-9a-f-]{36}$/i.test(after))
    return NextResponse.json(
      { error: "Invalid delivery cursor." },
      { status: 400, headers },
    );
  const result = await consoleApi(
    "/incidents/" +
      encodeURIComponent(incidentId) +
      "/deliveries" +
      (after ? "?after=" + encodeURIComponent(after) : ""),
  );
  if (result.status !== 200)
    return NextResponse.json(
      { error: result.error },
      { status: result.status, headers },
    );
  const page = deliveryPage(result.data);
  return page
    ? NextResponse.json(page, { headers })
    : NextResponse.json(
        { error: "Delivery outcome is unavailable." },
        { status: 503, headers },
      );
}
