import Link from "next/link";
import { LogoMark } from "../brand/Logo";

export function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b border-line bg-base/90 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link
          href="/"
          className="flex items-center gap-2.5 rounded-sm font-display text-lg font-extrabold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-protection"
        >
          <LogoMark size={28} />
          OPA
        </Link>

        <nav className="hidden items-center gap-7 text-sm text-muted lg:flex">
          <Link href="/#protection" className="transition-colors hover:text-protection">
            Protection Modes
          </Link>
          <Link href="/#architecture" className="transition-colors hover:text-protection">
            Architecture
          </Link>
          <Link href="/#command-center" className="transition-colors hover:text-protection">
            Command Center
          </Link>
          <Link href="/#resilience" className="transition-colors hover:text-protection">
            Connectivity
          </Link>
          <Link href="/#trust" className="transition-colors hover:text-protection">
            Protected Identity
          </Link>
          <Link href="/contact" className="transition-colors hover:text-protection">
            Contact
          </Link>
        </nav>

        <Link
          href="/#pilot"
          className="rounded-md bg-emergency px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110"
        >
          Request pilot
        </Link>
      </div>
    </header>
  );
}