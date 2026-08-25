import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-line bg-panel/30 py-12">
      <div className="mx-auto grid max-w-6xl gap-8 px-6 md:grid-cols-[1.2fr_0.8fr_1fr]">
        <div>
          <div className="flex items-center gap-2 font-display text-base font-extrabold text-ink">
            <span className="h-2 w-2 rounded-full bg-signal" />
            OPA
          </div>

          <p className="mt-3 max-w-md text-sm text-muted">
            Physical Incident Management Operating System for high-risk
            environments. Nigeria first, Africa ready, globally extensible.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted-2">
            Legal &amp; privacy
          </p>

          <Link href="/privacy" className="text-sm text-muted hover:text-ink">
            Privacy policy
          </Link>
          <Link href="/terms" className="text-sm text-muted hover:text-ink">
            Terms of service
          </Link>
          <Link href="/delete-account" className="text-sm text-muted hover:text-ink">
            Delete account
          </Link>
        </div>

        <div className="md:text-right">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-2">
            Operations
          </p>

          <Link
            href="/operator/login"
            className="mt-3 inline-block text-sm text-muted hover:text-ink"
          >
            Operator sign in
          </Link>

          <p className="mt-5 font-mono text-xs text-muted-2">
            &copy; 2026 OPA Technologies Limited
          </p>
          <p className="mt-1 font-mono text-xs text-muted-2">
            RC 9697630
          </p>
        </div>
      </div>
    </footer>
  );
}