import { PlatformSession } from "@/components/console/platform-session";
import { redirect } from "next/navigation";
import { AdminFailure, requireAdmin } from "@/lib/super-admin-api";
import SignOut from "../sign-out";
export const dynamic = "force-dynamic";
export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let actor: Awaited<ReturnType<typeof requireAdmin>>;
  try {
    actor = await requireAdmin();
  } catch (error) {
    if (error instanceof AdminFailure && error.status === 401)
      redirect("/super-admin/renew");
    const forbidden = error instanceof AdminFailure && error.status === 403;
    return (
      <main className="sa-body">
        <div className="sa-card" role="alert">
          <h1>{forbidden ? "Access forbidden" : "Service unavailable"}</h1>
          <p>
            {forbidden
              ? "An active platform ADMIN account is required. Facility roles cannot access this console."
              : "Your session has not been cleared. Try again when the service is available."}
          </p>
          <div className="sa-actions">
            <a href="/super-admin" className="sa-button">
              Try again
            </a>
            <SignOut />
          </div>
        </div>
      </main>
    );
  }
  return (
    <>
      <a href="#admin-main" className="sr-only focus:not-sr-only">
        Skip to content
      </a>
      <PlatformSession
        initial={{ id: actor.actorId ?? "", name: actor.name, role: "ADMIN" }}
      >
        <main id="admin-main" className="sa-body">
          <nav aria-label="Super Admin">
            <a href="/super-admin/organization">Platform Overview</a>
            <a href="/super-admin">Facilities</a>
            <a href="/super-admin/facilities/new">Create facility</a>
            <a href="/super-admin/technical-support">Technical Support</a>
          </nav>
          {children}
        </main>
      </PlatformSession>
    </>
  );
}
