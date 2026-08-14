import { redirect } from 'next/navigation';
import { getOperatorContext } from '@/lib/operator-context';

/**
 * THE COMMAND CENTER SHELL. 14A-4, given real context in 14A-5.
 *
 * The permanent operational frame every protected operator screen hangs
 * from: 14A-6's queue, 14A-7's detail view.
 *
 * IT STILL DOES NOT GUARD, DELIBERATELY. Each protected page keeps its own
 * getSessionState() check. A layout guard looks like centralisation but has
 * the same weakness the operator page's comment rejects middleware for: it
 * only covers what it happens to wrap, and a route added outside it is
 * silently unprotected. Visual containment here, authorization in the page.
 *
 * THE ONE REDIRECT IT DOES MAKE IS RECOVERY, NOT AUTHORIZATION. A REJECTED
 * context means the access token was refused while the cookie was still
 * present - the page's own guard saw a cookie and let the render proceed,
 * and the token turned out to be dead. That is exactly what the refresh
 * route exists for. It cannot loop: rotation re-reads the user row and only
 * succeeds for a live, active account, and /users/me asks nothing stricter,
 * so a successful rotation cannot be followed by another rejection. If
 * rotation fails, the refresh route clears the cookies and sends the
 * operator to login with a reason - which suppresses further rotation.
 *
 * IT SHOWS WHAT IT KNOWS AND NOTHING MORE. The facility name and type are
 * read from the API on every render. isVerified is available and NOT shown:
 * the header answers "which facility am I monitoring", not "what is this
 * facility's standing", and OPA Demo Estate is unverified in production.
 * NO_FACILITY and UNAVAILABLE each say plainly what happened rather than
 * rendering an empty slot that reads as data.
 *
 * SIGN OUT IS A PLAIN POST FORM, no client JavaScript. It redirects to the
 * login page rather than returning JSON. Remember what it can honestly
 * claim: the API has no revocation endpoint, so this clears the cookies and
 * the access token stays valid for up to 15 minutes. It is not "signing out
 * everywhere".
 */

/** SECURITY_PROVIDER -> Security Provider. Display only. */
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
  const operatorName = context
    ? `${context.firstName} ${context.lastName}`.trim()
    : null;

  const notice =
    result.state === 'NO_FACILITY'
      ? 'This account has no facility assigned. Ask an administrator to assign one.'
      : result.state === 'UNAVAILABLE'
        ? 'Facility context is temporarily unavailable. Your session is still active.'
        : null;

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-50 border-b border-line bg-base/90 backdrop-blur">
        <div className="flex items-start justify-between gap-6 px-6 py-4">
          <div>
            <div className="flex items-baseline gap-3">
              <span className="font-display text-lg font-bold text-ink">
                OPA
              </span>
              <span className="font-mono text-xs uppercase tracking-widest text-protection">
                Command Center
              </span>
            </div>

            {context ? (
              <div className="mt-2">
                <p className="font-display text-xl font-bold text-ink">
                  {context.facility.name}
                </p>
                <p className="text-xs text-muted">
                  {formatFacilityType(context.facility.type)}
                </p>
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-4">
            {operatorName ? (
              <span className="text-sm text-muted">{operatorName}</span>
            ) : null}

            <form action="/api/operator/logout" method="post">
              <button
                type="submit"
                className="rounded-md border border-line bg-panel px-3 py-1.5 text-sm text-ink"
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
          className="border-b border-line bg-panel-2 px-6 py-3 text-sm text-ink"
        >
          {notice}
        </p>
      ) : null}

      <main className="flex-1">{children}</main>
    </div>
  );
}