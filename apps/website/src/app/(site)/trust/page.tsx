import type { Metadata } from "next";
import { PageIntro, PilotCTA, Trust } from "@/components/marketing/Content";
export const metadata: Metadata = {
  title: "Trust",
  description:
    "OPA is designed around explicit authority, tenant isolation, privacy-conscious identity handling and accountable incident operations.",
};
export default function Page() {
  return (
    <>
      <PageIntro label="Trust" title="Enterprise Trust Architecture">
        <p>
          Controlled access. Protected identity. Verifiable operational history.
        </p>
        <p>
          OPA is designed around explicit authority, tenant isolation,
          privacy-conscious identity handling and accountable incident
          operations.
        </p>
      </PageIntro>
      <Trust detailed />
      <PilotCTA />
    </>
  );
}
