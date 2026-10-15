import type { Metadata } from "next";
import { HospitalSection } from "@/components/home/HospitalSection";
import { PageIntro } from "@/components/marketing/Content";
export const metadata: Metadata = {
  title: "Institutional safety enquiries",
  robots: { index: false, follow: true },
  description: "Contact OPA about your institutional safety requirements.",
};
export default function Page() {
  return (
    <>
      <PageIntro
        label="Institutional enquiries"
        title="Discuss your safety requirements."
      >
        <p>
          Tell the OPA team about your people, facilities and response
          responsibilities.
        </p>
      </PageIntro>
      <HospitalSection />
    </>
  );
}
