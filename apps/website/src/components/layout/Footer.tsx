import Link from "next/link";
import { LogoMark } from "../brand/Logo";
import { trustHref } from "@/components/marketing/Content";
export function Footer() {
  return (
    <footer className="m-footer">
      <div className="m-wrap">
        <div className="m-footer-grid">
          <div>
            <Link className="m-brand" href="/" aria-label="OPA home">
              <span aria-hidden="true">
                <LogoMark size={34} />
              </span>
              <span>OPA</span>
            </Link>
            <p>
              Enterprise Safety &amp;
              <br />
              Operational Intelligence
            </p>
            <p className="m-note">
              OPA Technologies Limited
              <br />
              Nigeria first. Built around people.
            </p>
          </div>
          <nav aria-label="Footer platform">
            {[
              ["Platform", "/platform"],
              ["Command Center", "/command-center"],
              ["OPA Shield", "/shield"],
              ["Industries", "/industries"],
              ["Trust", "/trust"],
              ["About", "/about"],
            ].map(([name, href]) => (
              <Link key={href} href={href}>
                {name}
              </Link>
            ))}
          </nav>
          <nav aria-label="Footer contact and legal">
            {[
              ["Request a Demo", "/#pilot"],
              ["Contact", "/contact"],
              ["Privacy Policy", "/privacy"],
              ["Terms of Service", "/terms"],
              ["Delete account", "/delete-account"],
              ["Operator sign in", "/operator/login"],
            ].map(([name, href]) => (
              <Link key={href} href={href}>
                {name}
              </Link>
            ))}
          </nav>
        </div>
        <div className="m-footer-bottom">
          <p>© {new Date().getFullYear()} OPA Technologies Limited</p>
          <a href={trustHref}>Request Security and Trust Pack ↗</a>
        </div>
      </div>
    </footer>
  );
}
