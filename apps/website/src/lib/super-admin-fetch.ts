export async function superAdminFetch(path: string, init?: RequestInit) {
  const response = await fetch("/api/super-admin/" + path, {
    ...init,
    cache: "no-store",
  });
  if (response.status !== 401) return response;
  const refreshed = await fetch("/api/super-admin/refresh", {
    method: "POST",
    cache: "no-store",
  });
  if (!refreshed.ok) return refreshed;
  // Only retry an authoritative 401, never a timed-out creation.
  return fetch("/api/super-admin/" + path, { ...init, cache: "no-store" });
}
