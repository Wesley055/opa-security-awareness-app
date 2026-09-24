import { Section } from "@/components/marketing/Content";
export function HospitalSection() {
  return (
    <Section label="Contact OPA" title="Start with your organization’s needs.">
      <p className="m-lead">
        Discuss institutional safety requirements with our team.
      </p>
      <a
        className="m-button m-secondary"
        href="mailto:partnerships@opasafety.com?subject=OPA%20Hospital%20Inquiry"
      >
        Contact the OPA team
      </a>
    </Section>
  );
}
