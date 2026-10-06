import { superAdminFetch } from "./super-admin-fetch";
/** A deadline includes response-body parsing, not only receipt of headers. */
export async function adminJson(
  url: string,
  init: RequestInit = {},
  timeout = 15000,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const transport = url.startsWith("/api/super-admin/") ? (target: string, options: RequestInit) => superAdminFetch(target.slice("/api/super-admin/".length), options) : fetch;
        const response = await transport(url, {
          ...init,
          cache: "no-store",
          signal: init.signal
            ? AbortSignal.any([init.signal, controller.signal])
            : controller.signal,
        });
        if ([401, 403].includes(response.status))
          return { status: response.status, body: {} };
        const body = await response.json();
        return { status: response.status, body };
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("Request timed out"));
        }, timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
