import Link from "next/link";

export function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b border-line bg-base/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2 font-display text-lg font-extrabold text-ink">
          <span className="h-2 w-2 rounded-full bg-signal" />
          OPA
        </Link>
        <nav className="hidden items-center gap-8 text-sm text-muted sm:flex">
          <Link href="/about" className="hover:text-ink">About</Link>
          <Link href="/#how-it-works" className="hover:text-ink">How it works</Link>
          <Link href="/#trust" className="hover:text-ink">Privacy &amp; security</Link>
          <Link href="/hospitals" className="hover:text-ink">For hospitals</Link>
          <Link href="/contact" className="hover:text-ink">Contact</Link>
        </nav>
        <Link
          href="/#pilot"
          className="rounded-md bg-flare px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110"
        >
          Partner with us
        </Link>
      </div>
    </header>
  );
}