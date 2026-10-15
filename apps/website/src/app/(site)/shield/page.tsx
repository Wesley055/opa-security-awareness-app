import type { Metadata } from "next";
import { PageIntro, PilotCTA, Shield } from "@/components/marketing/Content";
export const metadata: Metadata = {
  title: "OPA Shield",
  description: "Identity, authority and accountability around every incident.",
};
export default function Page() {
  return (
    <>
      <PageIntro label="OPA Shield" title="Identity and Operational Trust">
        <p>Identity, authority and accountability around every incident.</p>
        <p>
          OPA Shield connects protected identity, organizational context and
          authorized actions to safety operations—helping organizations
          understand who had access, what happened and what can be verified.
        </p>
      </PageIntro>
      <Shield detailed />
      <div className="m-wrap">
        <p>
          Human judgment remains authoritative. OPA does not claim autonomous
          intent prediction, psychological profiling or automated disciplinary
          decision-making.
        </p>
      </div>
      <PilotCTA />
    </>
  );
}
