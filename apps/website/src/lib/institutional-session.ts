import "server-only";
import { cookies } from "next/headers";
export const INSTITUTIONAL_ACCESS = "opa_institutional_access";
export const INSTITUTIONAL_REFRESH = "opa_institutional_refresh";
const refreshPath = "/api/institutional";
const options = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
});
export async function institutionalTokens() {
  const store = await cookies();
  return {
    accessToken: store.get(INSTITUTIONAL_ACCESS)?.value,
    refreshToken: store.get(INSTITUTIONAL_REFRESH)?.value,
  };
}
export async function setInstitutionalSession(
  accessToken: string,
  refreshToken: string,
) {
  const store = await cookies();
  store.set(INSTITUTIONAL_ACCESS, accessToken, {
    ...options(),
    path: "/",
    maxAge: 900,
  });
  store.set(INSTITUTIONAL_REFRESH, refreshToken, {
    ...options(),
    path: refreshPath,
    maxAge: 2592000,
  });
}
export async function clearInstitutionalSession() {
  const store = await cookies();
  store.delete(INSTITUTIONAL_ACCESS);
  store.set(INSTITUTIONAL_REFRESH, "", {
    ...options(),
    path: refreshPath,
    maxAge: 0,
  });
}
