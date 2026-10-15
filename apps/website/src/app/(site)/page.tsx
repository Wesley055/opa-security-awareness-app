import { Hero } from "@/components/home/Hero";
import {
  Section,
  Lifecycle,
  Command,
  Shield,
  HumanRiskIntelligence,
  Insight,
  Connect,
  Industries,
  Trust,
  PilotCTA,
  Safety,
} from "@/components/marketing/Content";
export default function Home() {
  return (
    <>
      <Hero />
      <span id="architecture" className="m-anchor" />
      <Section
        id="platform"
        label="The OPA platform"
        title="Protection Is More Than a Panic Button."
      >
        <p className="m-lead">
          Protection should begin before an emergency happens.
        </p>
        <p>
          OPA connects personal protection, institutional response, location
          context, operational accountability and incident history into one
          coordinated safety platform.
        </p>
      </Section>
      <Lifecycle />
      <Safety />
      <Command />
      <Shield />
      <Insight />
      <Connect />
      <Industries />
      <HumanRiskIntelligence />
      <Trust />
      <PilotCTA />
    </>
  );
}





