import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-line py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 sm:flex-row">
        <div className="flex items-center gap-2 font-display text-base font-extrabold text-ink">
          <span className="h-2 w-2 rounded-full bg-signal" />
          OPA
        </div>
        <div className="flex items-center gap-6">
          <Link href="/privacy" className="font-mono text-xs text-muted-2 hover:text-ink">
            Privacy
          </Link>
          <Link href="/terms" className="font-mono text-xs text-muted-2 hover:text-ink">
            Terms
          </Link>
          {/*
            The only route into the operator console from the public site.
            Deliberately here and not in the Navbar: a prospect who clicks
            it reaches a login wall, but a guard who has lost a bookmark
            can find it by typing opasafety.com and scrolling. robots.ts
            still disallows /operator/, so this does not make it
            crawlable - only findable by someone who knows it exists.
          */}
          <Link
            href="/operator/login"
            className="font-mono text-xs text-muted-2 hover:text-ink"
          >
            Operator sign in
          </Link>
        </div>
        <div className="flex flex-col items-center gap-1 sm:items-end">
          <p className="font-mono text-xs text-muted-2">
            Personal Safety &amp; Live Incident Awareness. Nigeria first, global by design.
          </p>
          <p className="font-mono text-xs text-muted-2">
            &copy; 2026 OPA Technologies Limited &middot; RC 9697630
          </p>
        </div>
      </div>
    </footer>
  );
}
