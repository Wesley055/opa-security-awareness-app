import type { Metadata } from "next";
import { PageIntro, Section, PilotCTA } from "@/components/marketing/Content";
export const metadata: Metadata = {
  title: "About OPA",
  description:
    "OPA Technologies Limited — Enterprise Safety & Operational Intelligence.",
};
export default function Page() {
  return (
    <>
      <PageIntro
        label="OPA Technologies Limited"
        title="Protection built around people. Accountability built into operations."
      >
        <p>
          OPA connects people, organizations, identity, safety operations,
          incident response, evidence and intelligence in one enterprise
          platform.
        </p>
      </PageIntro>
      <Section
        label="Our purpose"
        title="Help people and organizations act with better context."
      >
        <div className="m-split">
          <p className="m-lead">
            Our mission is to support personal safety and institutional
            coordination before, during and after incidents. Nigeria first, with
            a long-term ambition to serve wider communities.
          </p>
          <div>
            <h3>Our principles</h3>
            <p>
              Respect personal privacy. Keep authority explicit. Preserve
              attributable evidence. Represent delivery and location truthfully.
              Build for accountable human decisions.
            </p>
            <p>
              OPA provides software and coordination. Physical response remains
              the responsibility of authorized organizations and response
              partners.
            </p>
          </div>
        </div>
      </Section>
      <PilotCTA />
    </>
  );
}
