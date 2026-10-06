import { getAccessToken } from "@/lib/operator-session";
import { AdminFailure, upstream } from "@/lib/super-admin-api";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const types = ["SEEN", "ACKNOWLEDGED", "DISPATCHED", "RESPONSE_PROGRESS", "ESCALATION"];
const json = (status: number) =>
  Response.json(
    { ok: status === 200 },
    {
      status,
      headers: {
        "Cache-Control": "no-store, private",
        "Referrer-Policy": "no-referrer",
      },
    },
  );

// Exactly one canonical operation endpoint; caller-supplied paths and authority are never forwarded.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ incidentId: string }> },
) {
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin)
      return json(403);
    const { incidentId } = await params;
    if (!uuid.test(incidentId)) return json(400);
    const token = await getAccessToken();
    if (!token) return json(401);
    const reader = request.body?.getReader();
    if (!reader) return json(400);
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 4096) {
        await reader.cancel();
        return json(413);
      }
      chunks.push(value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (
      !body ||
      Array.isArray(body) ||
      !types.includes(body.type) ||
      typeof body.note !== "string" ||
      !body.note.trim() ||
      body.note.length > 500 ||
      typeof body.correlationId !== "string" ||
      !uuid.test(body.correlationId) ||
      Object.keys(body).some(
        (key) => !["type", "note", "correlationId"].includes(key),
      )
    )
      return json(400);
    await upstream("/incidents/" + incidentId + "/operations", token, {
      type: body.type,
      note: body.note,
      correlationId: body.correlationId,
    });
    return json(200);
  } catch (error) {
    return json(error instanceof AdminFailure ? error.status : 400);
  }
}
