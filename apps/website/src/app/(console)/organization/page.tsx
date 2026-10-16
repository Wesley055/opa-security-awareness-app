import { redirect } from "next/navigation";
import { getSessionState } from "@/lib/operator-session";
import { getOperatorContext } from "@/lib/operator-context";
import { RetryButton } from "@/components/console/retry-button";
import { HeadOffice } from "@/components/console/head-office";
export const dynamic = "force-dynamic";
export default async function HeadOfficePage() {
  const session = await getSessionState();
  if (session === "none") redirect("/operator/login");
  if (session === "refreshable") redirect("/api/operator/refresh");
  const result = await getOperatorContext();
  if (result.state === "REJECTED") redirect("/api/operator/refresh");
  if (result.state === "NO_FACILITY" && result.role === "ORGANIZATION_ADMIN")
    return <HeadOffice />;
  if (result.state === "READY") redirect("/operator");
  return (
    <section className="mx-auto max-w-7xl p-6 text-ink">
      <h1 className="text-2xl font-bold">Head Office</h1>
      <p role="status" className="mt-4">
        {result.state === "UNAVAILABLE"
          ? "Account context is temporarily unavailable."
          : "This account does not have Head Office access."}
      </p>
      {result.state === "UNAVAILABLE" ? <RetryButton /> : null}
    </section>
  );
}
