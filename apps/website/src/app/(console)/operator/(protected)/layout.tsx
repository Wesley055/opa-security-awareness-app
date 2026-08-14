/**
 * THE COMMAND CENTER SHELL. 14A-4.
 *
 * The permanent operational frame every protected operator screen hangs
 * from: 14A-5's facility context, 14A-6's queue, 14A-7's detail view.
 *
 * IT DOES NOT GUARD ANYTHING, DELIBERATELY. Each protected page keeps its
 * own getSessionState() check. A layout guard looks like centralisation but
 * has the same weakness the operator page's own comment rejects middleware
 * for: it only covers what it happens to wrap, and a route added outside it
 * is silently unprotected. Visual containment here, authorization in the
 * page. If that is ever centralised it should be a deliberate security
 * change with its own reasoning, not a side effect of adding a header.
 *
 * IT SHOWS NO IDENTITY, ALSO DELIBERATELY. There is no operator name, email
 * or facility here because this app does not yet have any of them: the login
 * bridge drops the user object on purpose, and nothing has asked the API who
 * is signed in. A placeholder would read as data. This follows the rule
 * public-incident-snapshot.dto.ts set - a field OPA cannot populate honestly
 * is OMITTED, not shown empty. 14A-5 replaces this with an authoritative
 * read.
 *
 * SIGN OUT IS A PLAIN POST FORM, no client JavaScript. It moved here from
 * the page body so it survives every future screen. Remember what it can
 * honestly claim: the API has no revocation endpoint, so this clears the
 * cookies and the access token stays valid for up to 15 minutes. It is not
 * "signing out everywhere".
 */

export default function OperatorShellLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-50 border-b border-line bg-base/90 backdrop-blur">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-lg font-bold text-ink">OPA</span>
            <span className="font-mono text-xs uppercase tracking-widest text-protection">
              Command Center
            </span>
          </div>

          <form action="/api/operator/logout" method="post">
            <button
              type="submit"
              className="rounded-md border border-line bg-panel px-3 py-1.5 text-sm text-ink"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main className="flex-1">{children}</main>
    </div>
  );
}