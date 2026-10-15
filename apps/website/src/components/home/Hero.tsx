import Link from "next/link";
import { OperationalFlow } from "@/components/marketing/OperationalFlow";
import { Pillars } from "@/components/marketing/Content";

export function Hero() {
  return (
    <section className="m-hero">
      <div className="m-wrap">
        <div className="m-hero-grid">
          <div className="m-hero-copy">
            <p className="m-eyebrow">Enterprise Safety Infrastructure</p>
            <h1>
              <span>Protect people.</span> <span>Coordinate response.</span>{" "}
              <span>Preserve accountability.</span>
            </h1>
            <p className="m-lead">
              OPA connects people, facilities and authorized response teams
              through a controlled incident lifecycle—from activation and
              location intelligence to coordination, closure and audit.
            </p>
            <div className="m-actions">
              <Link className="m-button" href="#pilot">
                Request a Demo <span aria-hidden="true">↗</span>
              </Link>
              <Link className="m-button m-secondary" href="/platform">
                Explore the Platform
              </Link>
            </div>

          </div>
          <OperationalFlow />
        </div>

        <Pillars />
      </div>
    </section>
  );
}




