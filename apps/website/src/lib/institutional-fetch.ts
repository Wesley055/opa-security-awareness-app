let refreshing: Promise<Response> | null = null;
async function bounded(path: string, init: RequestInit = {}) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch("/api/institutional/" + path, {
          ...init,
          cache: "no-store",
          signal: init.signal
            ? AbortSignal.any([init.signal, controller.signal])
            : controller.signal,
        });
        const body = await response.text();
        return new Response(body || null, {
          status: response.status,
          headers: response.headers,
        });
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(
            Error(
              "Request timed out. Reconcile an uncertain operation before retrying.",
            ),
          );
        }, 15000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export async function institutionalFetch(path: string, init: RequestInit = {}) {
  let response = await bounded(path, init);
  if (init.signal?.aborted) return new Response(null, { status: 409 });
  if (
    response.status === 401 &&
    !["login", "logout", "refresh"].includes(path)
  ) {
    if (!refreshing)
      refreshing = bounded("refresh", { method: "POST" }).finally(() => {
        refreshing = null;
      });
    const renewed = await refreshing;
    if (init.signal?.aborted) return new Response(null, { status: 409 });
    response = renewed.ok ? await bounded(path, init) : renewed.clone();
  }
  if (init.signal?.aborted) return new Response(null, { status: 409 });
  if (
    (response.status === 401 ||
      (response.status === 403 && path === "context")) &&
    typeof window !== "undefined"
  )
    window.dispatchEvent(new Event("opa-institutional-authority-lost"));
  return response;
}
