let refreshing: Promise<Response> | null = null;
async function bounded(path: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch("/api/super-admin/" + path, {
          ...init,
          cache: "no-store",
          signal: init?.signal
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
              "Request timed out. For a mutation, check the result before retrying.",
            ),
          );
        }, 15000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export async function superAdminFetch(path: string, init?: RequestInit) {
  let response = await bounded(path, init);
  if (init?.signal?.aborted) return new Response(null, { status: 409 });
  if (
    response.status === 401 &&
    !["login", "logout", "refresh"].includes(path)
  ) {
    if (!refreshing)
      refreshing = bounded("refresh", { method: "POST" }).finally(() => {
        refreshing = null;
      });
    const restored = await refreshing;
    if (init?.signal?.aborted) return new Response(null, { status: 409 });
    // Retry only an authoritative rejection, never an ambiguous creation.
    response = restored.ok ? await bounded(path, init) : restored.clone();
  }
  if (init?.signal?.aborted) return new Response(null, { status: 409 });
  if (
    (response.status === 401 ||
      (response.status === 403 &&
        [
          "context",
          "organization/overview",
          "support/employees",
          "refresh",
        ].includes(path))) &&
    typeof window !== "undefined"
  )
    window.dispatchEvent(new Event("opa-super-admin-authority-lost"));
  return response;
}
