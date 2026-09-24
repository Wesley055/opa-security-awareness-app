import type { Metadata } from "next";
import {
  PageIntro,
  PilotCTA,
  Safety,
  Lifecycle,
  Command,
  Shield,
  Evidence,
  Insight,
  Connectivity,
} from "@/components/marketing/Content";
export const metadata: Metadata = {
  title: "Platform",
  description:
    "OPA brings personal protection, emergency activation, institutional response and accountable incident management into one operational system.",
};
export default function Page() {
  return (
    <>
      <PageIntro
        label="Platform"
        title="One platform. One connected safety lifecycle."
      >
        <p>
          OPA brings personal protection, emergency activation, institutional
          response and accountable incident management into one operational
          system.
        </p>
      </PageIntro>
      <Safety />
      <Lifecycle />
      <Connectivity />
      <Command />
      <Shield />
      <Evidence />
      <Insight />
      <PilotCTA />
    </>
  );
}

