import "server-only";
import { NextResponse } from "next/server";
import { validReportWindow } from "./insight-contract";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type ReportCaller = (
  path: string,
  method: "GET" | "POST" | "PATCH",
  body?: unknown,
) => Promise<{ status: number; data?: unknown }>;
export const reportJson = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, private" },
  });

/** Fixed operations only. Facility comes from current server session or independently verified institutional scope. */
export async function reportProxy(
  request: Request,
  facilityId: string,
  call: ReportCaller,
) {
  const params = new URL(request.url).searchParams;
  const op = params.get("op"),
    id = params.get("id") ?? "";
  if (
    !uuid.test(facilityId) ||
    [...params.keys()].some(
      (k) => !["op", "id", "from", "to", "facilityId"].includes(k),
    ) ||
    [...new Set(params.keys())].some((k) => params.getAll(k).length !== 1)
  )
    return reportJson({ error: "Invalid reporting request." }, 400);
  const scope = new URLSearchParams({ facilityId });
  let path: string, body: unknown;
  let method: "GET" | "POST" | "PATCH" = "GET";
  if (
    request.method === "GET" &&
    op === "list" &&
    validReportWindow(params.get("from") ?? "", params.get("to") ?? "")
  ) {
    scope.set("from", params.get("from")!);
    scope.set("to", params.get("to")!);
    path = "/internal/insight/reports?" + scope;
  } else if (
    request.method === "GET" &&
    uuid.test(id) &&
    ["detail", "version", "export"].includes(op ?? "")
  ) {
    path =
      op === "detail"
        ? `/internal/insight/incidents/${id}/compliance-evidence?${scope}`
        : `/internal/insight/air/${id}${op === "export" ? "/export" : ""}?${scope}`;
  } else if (
    request.method === "POST" &&
    ["approve", "generate", "create-action", "update-action"].includes(op ?? "")
  ) {
    // Bound before JSON parsing. No arbitrary caller object is forwarded.
    const reader = request.body?.getReader();
    if (!reader)
      return reportJson({ error: "Invalid reporting request." }, 400);
    let size = 0,
      text = "";
    const decoder = new TextDecoder();
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 4096) {
        await reader.cancel();
        return reportJson({ error: "Reporting request too large." }, 400);
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    let input: Record<string, unknown>;
    try {
      input = JSON.parse(text);
    } catch {
      return reportJson({ error: "Invalid reporting request." }, 400);
    }
    if (!input || typeof input !== "object" || Array.isArray(input))
      return reportJson({ error: "Invalid reporting request." }, 400);
    method = "POST";
    if (
      op === "approve" &&
      uuid.test(id) &&
      /^[a-f0-9]{64}$/.test(String(input.sourceDigest))
    ) {
      path = `/internal/insight/air/${id}/approve`;
      body = { facilityId, sourceDigest: input.sourceDigest };
    } else if (
      op === "generate" &&
      uuid.test(id) &&
      uuid.test(String(input.requestKey))
    ) {
      path = `/internal/insight/incidents/${id}/air`;
      body = { facilityId, requestKey: input.requestKey };
    } else if (op === "create-action") {
      path = "/internal/insight/corrective-actions";
      body = {
        facilityId,
        requestKey: input.requestKey,
        airId: input.airId,
        ownerId: input.ownerId,
        dueAt: input.dueAt,
        category: input.category,
        priority: input.priority,
      };
    } else if (op === "update-action" && uuid.test(id)) {
      method = "PATCH";
      path = `/internal/insight/corrective-actions/${id}`;
      body = {
        facilityId,
        expectedVersion: input.expectedVersion,
        status: input.status,
        completionEvidenceId: input.completionEvidenceId,
        ownerId: input.ownerId,
      };
    } else return reportJson({ error: "Invalid reporting request." }, 400);
  } else return reportJson({ error: "Invalid reporting request." }, 400);
  const result = await call(path, method, body);
  if (result.status !== 200)
    return reportJson(
      {
        error:
          "Reporting request unavailable. Reload after a conflict or uncertain mutation.",
      },
      [400, 401, 403, 404, 409, 422, 429].includes(result.status)
        ? result.status
        : 503,
    );
  if (op === "export")
    return new NextResponse(JSON.stringify(result.data, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": 'attachment; filename="opa-air.json"',
        "Cache-Control": "no-store, private",
      },
    });
  return reportJson(result.data);
}
