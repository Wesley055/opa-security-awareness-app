import Link from "next/link";
import { MobileNavigation } from "./MobileNavigation";
import { LogoMark } from "../brand/Logo";
const links = [
  ["Platform", "/platform"],
  ["Command Center", "/command-center"],
  ["OPA Shield", "/shield"],
  ["Human Risk", "/#human-risk-intelligence"],
  ["Industries", "/industries"],
  ["Trust", "/trust"],
  ["About", "/about"],
] as const;
export function Navbar() {
  return (
    <header className="m-nav">
      <div className="m-wrap m-nav-row">
        <Link className="m-brand" href="/" aria-label="OPA home">
          <span aria-hidden="true">
            <LogoMark size={34} />
          </span>
          <span>OPA</span>
        </Link>
        <nav className="m-desktop-nav" aria-label="Primary">
          {links.map(([name, href]) => (
            <Link key={href} href={href}>
              {name}
            </Link>
          ))}
        </nav>

        <MobileNavigation links={links} />
      </div>
    </header>
  );
}

