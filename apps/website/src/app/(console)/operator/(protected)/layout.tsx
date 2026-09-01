import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getOperatorContext } from '@/lib/operator-context';

function formatFacilityType(type: string): string {
  return type
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');
}

export default async function OperatorShellLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const result = await getOperatorContext();

  if (result.state === 'REJECTED') {
    redirect('/api/operator/refresh');
  }

  const context = result.state === 'READY' ? result.context : null;
  const viewerName = context
    ? `${context.firstName} ${context.lastName}`.trim()
    : null;
  const role = context?.role ?? (result.state === 'NO_FACILITY' ? result.role : null);
  const isFacilityAdmin = role === 'FACILITY_ADMIN';
  const isFacilityOperator = role === 'FACILITY_OPERATOR';

  const notice =
    result.state === 'NO_FACILITY'
      ? 'This account has no facility assigned. Ask an administrator to assign one.'
      : result.state === 'UNAVAILABLE'
        ? 'Facility context is temporarily unavailable. Your session is still active.'
        : null;

  return (
    <div className="flex min-h-full flex-col bg-base">
      <header className="sticky top-0 z-50 border-b border-line bg-base/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-start lg:justify-between lg:gap-8 lg:px-8">
          <div>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-display text-lg font-bold text-ink">OPA</span>
              <span className="font-mono text-xs uppercase tracking-widest text-protection">
                Viewer
              </span>
            </div>

            {context ? (
              <div className="mt-2">
                <p className="font-display text-lg font-bold text-ink sm:text-xl">
                  {context.facility.name}
                </p>
                <p className="text-xs text-muted">
                  {formatFacilityType(context.facility.type)}
                </p>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-3 lg:justify-end">
            {(isFacilityAdmin || isFacilityOperator) ? (
              <nav
                aria-label="Facility Viewer"
                className="order-first flex w-full items-center gap-1 rounded-lg border border-line bg-panel p-1 sm:order-none sm:w-auto"
              >
                {isFacilityOperator ? (
                  <>
                    <Link
                      href="/operator"
                      className="min-h-10 rounded-md px-3 py-2 text-sm text-muted transition hover:bg-panel-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-protection"
                    >
                      Incidents
                    </Link>
                    <Link
                      href="/operator/members"
                      className="min-h-10 rounded-md px-3 py-2 text-sm text-muted transition hover:bg-panel-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-protection"
                    >
                      Members
                    </Link>
                  </>
                ) : null}

                {isFacilityAdmin ? (
                  <Link
                    href="/operator/residents"
                    className="min-h-10 rounded-md px-3 py-2 text-sm text-muted transition hover:bg-panel-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-protection"
                  >
                    Residents
                  </Link>
                ) : null}
              </nav>
            ) : null}

            {viewerName ? (
              <span className="hidden text-sm text-muted md:inline">{viewerName}</span>
            ) : null}

            <form action="/api/operator/logout" method="post">
              <button
                type="submit"
                className="min-h-10 rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink transition hover:border-muted-2 hover:bg-panel-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-protection"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      {notice ? (
        <p
          role="status"
          className="border-b border-line bg-panel-2 px-4 py-3 text-sm text-ink sm:px-6 lg:px-8"
        >
          {notice}
        </p>
      ) : null}

      <main className="flex-1">{children}</main>
    </div>
  );
}
