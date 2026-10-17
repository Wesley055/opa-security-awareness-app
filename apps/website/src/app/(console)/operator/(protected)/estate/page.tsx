import { redirect } from "next/navigation";
import { getSessionState } from "@/lib/operator-session";
import { getOperatorContext } from "@/lib/operator-context";
import { RetryButton } from "@/components/console/retry-button";
import { EstateOverview } from "@/components/console/estate-overview";
export const dynamic = "force-dynamic";
export default async function Page() {
  const session = await getSessionState();
  if (session === "none") redirect("/operator/login");
  if (session === "refreshable") redirect("/api/operator/refresh");
  const result = await getOperatorContext();
  if (result.state === "REJECTED") redirect("/api/operator/refresh");
  if (result.state === "READY" && result.context.role === "FACILITY_ADMIN") return <EstateOverview />;
  return (
    <section className="mx-auto max-w-3xl p-6 text-ink">
      <p role="status">{result.state === "UNAVAILABLE" ? "Account context is temporarily unavailable." : "The estate overview is for estate administrators."}</p>
      {result.state === "UNAVAILABLE" ? <RetryButton /> : null}
    </section>
  );
}
