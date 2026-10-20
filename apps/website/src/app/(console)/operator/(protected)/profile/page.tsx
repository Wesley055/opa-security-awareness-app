import { redirect } from "next/navigation";
import { getSessionState } from "@/lib/operator-session";
import { ProfileClient } from "./profile-client";
export const dynamic = "force-dynamic";
export default async function ProfilePage() {
  const session = await getSessionState();
  if (session === "none") redirect("/operator/login");
  if (session === "refreshable") redirect("/api/operator/refresh");
  return (
    <div className="mx-auto max-w-3xl p-6">
      <ProfileClient />
    </div>
  );
}
