import { redirect } from "next/navigation";
import { getOperatorContext } from "@/lib/operator-context";
import { SafeWalkProtection } from "@/components/console/safewalk-protection";
export const dynamic = "force-dynamic";
export default async function SafeWalkPage() {
  const context = await getOperatorContext();
  if (context.state === "REJECTED") redirect("/api/operator/refresh");
  if (context.state === "READY" && context.context.role === "FACILITY_OPERATOR")
    return (
      <SafeWalkProtection
        key={context.context.userId + ":" + context.context.facility.id}
      />
    );
  return (
    <section className="p-6">
      <h1>SafeWalk Protection</h1>
      <p role="status">
        {context.state === "UNAVAILABLE"
          ? "Account context temporarily unavailable. Reload to retry."
          : "Use your authorized Institutional workspace and select a facility. No private journey visibility is provided."}
      </p>
    </section>
  );
}
