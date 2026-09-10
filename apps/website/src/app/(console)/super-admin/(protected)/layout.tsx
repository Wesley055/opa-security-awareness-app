import { redirect } from "next/navigation";
import { LogoMark } from "@/components/brand/Logo";
import { AdminFailure, requireAdmin } from "@/lib/super-admin-api";
import SignOut from "../sign-out";
export const dynamic = "force-dynamic";
export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let name: string;
  try {
    name = (await requireAdmin()).name;
  } catch (error) {
    if (error instanceof AdminFailure && error.status === 401)
      redirect("/super-admin/login");
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
      <header className="sa-header">
        <a href="/super-admin" className="sa-brand">
          <LogoMark size={36} />
          <span>
            OPA <span className="sa-muted">/ Super Admin</span>
          </span>
        </a>
        <div className="sa-actions">
          <span className="sa-badge">Platform ADMIN</span>
          <span className="sa-muted">{name}</span>
          <SignOut />
        </div>
      </header>
      <main id="admin-main" className="sa-body">
        <nav aria-label="Super Admin">
          <a href="/super-admin">Facility workspace</a>
          <a href="/super-admin/facilities/new">Create facility</a>
        </nav>
        {children}
      </main>
    </>
  );
}
