import "server-only";
import { cookies } from "next/headers";
const ACCESS = "opa_onboarding_access",
  REFRESH = "opa_onboarding_refresh";
export async function onboardingAccess() {
  return (await cookies()).get(ACCESS)?.value;
}
export async function onboardingRefresh() {
  return (await cookies()).get(REFRESH)?.value;
}
export async function setOnboardingSession(access: string, refresh: string) {
  const store = await cookies();
  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
  };
  store.set(ACCESS, access, { ...options, maxAge: 900 });
  store.set(REFRESH, refresh, { ...options, maxAge: 2592000 });
}
export async function clearOnboardingSession() {
  const store = await cookies();
  store.delete(ACCESS);
  store.delete(REFRESH);
}
