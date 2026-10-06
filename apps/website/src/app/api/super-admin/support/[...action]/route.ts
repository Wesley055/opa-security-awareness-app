import { AdminFailure, requireAdmin, upstream } from "@/lib/super-admin-api";
import { supportProjection } from "@/lib/support-administration";
const uuid =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, private",
      "Referrer-Policy": "no-referrer",
    },
  });
async function handle(
  request: Request,
  { params }: { params: Promise<{ action: string[] }> },
) {
  try {
    const path = (await params).action.join("/");
    const invite = path === "invitations";
    if (
      request.method === "GET"
        ? !["employees", "readiness", "accounts"].includes(path) &&
          !new RegExp("^operations/" + uuid + "$").test(path)
        : request.method !== "POST" ||
          !(
            new RegExp("^accounts/" + uuid + "/recover$").test(path) || invite || new RegExp("^invitations/" + uuid + "/action$").test(path) ||
            new RegExp(
              "^employees/" + uuid + "/(employment|grants|revoke-all)$",
            ).test(path) ||
            new RegExp("^grants/" + uuid + "/revoke$").test(path)
          )
    )
      throw new AdminFailure(404);
    if (
      request.method === "POST" &&
      request.headers.get("origin") !== new URL(request.url).origin
    )
      throw new AdminFailure(403);
    const { access, actorId } = await requireAdmin();
    if (request.method === "POST" && (!actorId || request.headers.get("x-platform-actor") !== actorId))
      throw new AdminFailure(403);
    let body: Record<string, unknown> | undefined;
    let key: string | undefined;
    if (request.method === "POST") {
      const reader = request.body?.getReader();
      if (!reader) throw new AdminFailure(400);
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 8192) {
          await reader.cancel();
          throw new AdminFailure(413);
        }
        chunks.push(value);
      }
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!body || typeof body !== "object" || Array.isArray(body))
        throw new AdminFailure(400);
      const fields = [
        "reason",
        "caseReference",
        "correlationId",
        ...(invite
          ? ["firstName", "lastName", "email", "phoneNumber"]
          : path.endsWith("/employment")
            ? ["state"]
            : path.endsWith("/grants")
              ? ["capability", "facilityId", "expiresAt"]
              : path.endsWith("/action") ? ["action"] : []),
      ];
      if (
        Object.keys(body).some((k) => !fields.includes(k)) ||
        typeof body.reason !== "string" ||
        !body.reason.trim() ||
        body.reason.length > 500 ||
        !new RegExp("^" + uuid + "$").test(String(body.caseReference)) ||
        !new RegExp("^" + uuid + "$").test(String(body.correlationId))
      )
        throw new AdminFailure(400);
      if (invite) {
        key = request.headers.get("idempotency-key") ?? undefined;
        if (!key || key.length > 160) throw new AdminFailure(400);
      }
    }
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some(k => path !== "accounts" || k !== "cursor") || query.getAll("cursor").length > 1 || (query.has("cursor") && !new RegExp("^" + uuid + "$", "i").test(query.get("cursor")!))) throw new AdminFailure(400);
    const suffix = query.size ? "?" + query.toString() : "";
    return json(
      supportProjection(
        await upstream("/admin/support/" + path + suffix, access, body, key),
      ),
    );
  } catch (error) {
    const status = error instanceof AdminFailure ? error.status : 400;
    return json(
      {
        error: [401, 403].includes(status)
          ? "Current Super Admin authority is required. Sign in again."
          : "Request not completed. Check the fields and current state before retrying.",
      },
      status,
    );
  }
}
export const GET = handle;
export const POST = handle;
