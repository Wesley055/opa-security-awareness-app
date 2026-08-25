import { Hero } from "@/components/home/Hero";
import { ProtectionModes } from "@/components/home/ProtectionModes";
import { InfrastructureFlow } from "@/components/home/InfrastructureFlow";
import { CommandCenterSection } from "@/components/home/CommandCenterSection";
import { ConnectivitySection } from "@/components/home/ConnectivitySection";
import { SecuritySection } from "@/components/home/SecuritySection";
import { LifecycleSection } from "@/components/home/LifecycleSection";
import { CTA } from "@/components/home/CTA";

export default function Home() {
  return (
    <>
      <Hero />
      <ProtectionModes />
      <InfrastructureFlow />
      <CommandCenterSection />
      <ConnectivitySection />
      <SecuritySection />
      <LifecycleSection />
      <CTA />
    </>
  );
}