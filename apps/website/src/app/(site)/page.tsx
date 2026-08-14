import { Hero } from "@/components/home/Hero";
import { HowItWorks } from "@/components/home/HowItWorks";
import { HospitalSection } from "@/components/home/HospitalSection";
import { SecuritySection } from "@/components/home/SecuritySection";
import { CTA } from "@/components/home/CTA";

export default function Home() {
  return (
    <>
      <Hero />
      <HowItWorks />
      <HospitalSection />
      <SecuritySection />
      <CTA />
    </>
  );
}