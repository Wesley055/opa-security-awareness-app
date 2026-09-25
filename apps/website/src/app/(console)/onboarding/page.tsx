import { redirect } from "next/navigation";
import { onboardingAccess } from "@/lib/onboarding-session";
import Workspace from "./workspace";
export const dynamic = "force-dynamic";
export default async function Page() {
  if (!(await onboardingAccess())) redirect("/onboarding/login");
  return (
    <main className="sa-body">
      <h1>Staff onboarding</h1>
      <p>
        Invite Facility Admins and Operators within your assigned facilities.
      </p>
      <Workspace />
    </main>
  );
}
