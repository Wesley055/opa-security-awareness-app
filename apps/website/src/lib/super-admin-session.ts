import "server-only";
import { cookies } from "next/headers";

const ACCESS = "opa_super_admin_access";
const REFRESH = "opa_super_admin_refresh";
export async function adminAccess() {
  return (await cookies()).get(ACCESS)?.value;
}
export async function adminRefresh() {
  return (await cookies()).get(REFRESH)?.value;
}
export async function setAdminSession(
  accessToken: string,
  refreshToken: string,
) {
  const store = await cookies();
  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
  };
  store.set(ACCESS, accessToken, { ...options, maxAge: 900 });
  store.set(REFRESH, refreshToken, { ...options, maxAge: 2592000 });
}
export async function clearAdminSession() {
  const store = await cookies();
  store.delete(ACCESS);
  store.delete(REFRESH);
}
