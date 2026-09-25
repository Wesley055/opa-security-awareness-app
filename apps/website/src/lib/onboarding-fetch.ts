export async function onboardingFetch(
  path: string,
  init?: RequestInit,
  admin = false,
) {
  const base = admin ? "/api/onboarding-admin/" : "/api/onboarding/";
  const response = await fetch(base + path, { ...init, cache: "no-store" });
  if (response.status !== 401) return response;
  const restored = await fetch(
    admin ? "/api/super-admin/refresh" : "/api/onboarding/refresh",
    { method: "POST", cache: "no-store" },
  );
  if (!restored.ok) return restored;
  return fetch(base + path, { ...init, cache: "no-store" });
}
