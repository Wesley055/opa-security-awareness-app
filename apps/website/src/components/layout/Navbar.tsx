import Link from "next/link";

export function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b border-line bg-base/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link
          href="/"
          className="flex items-center gap-2 font-display text-lg font-extrabold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-protection focus-visible:ring-offset-2 focus-visible:ring-offset-base rounded-sm"
        >
          <span className="h-2 w-2 rounded-full bg-protection" />
          OPA
        </Link>
        <nav className="hidden items-center gap-8 text-sm text-muted sm:flex">
          <Link href="/about" className="transition-colors hover:text-protection">About</Link>
          <Link href="/#how-it-works" className="transition-colors hover:text-protection">How it works</Link>
          <Link href="/#trust" className="transition-colors hover:text-protection">Privacy &amp; security</Link>
          <Link href="/hospitals" className="transition-colors hover:text-protection">For hospitals</Link>
          <Link href="/contact" className="transition-colors hover:text-protection">Contact</Link>
        </nav>
        <Link
          href="/#pilot"
          className="rounded-md bg-emergency px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-protection focus-visible:ring-offset-2 focus-visible:ring-offset-base"
        >
          Partner with us
        </Link>
      </div>
    </header>
  );
}
