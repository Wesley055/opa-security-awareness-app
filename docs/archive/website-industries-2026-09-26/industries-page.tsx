import type { Metadata } from "next";
import {

  PilotCTA,
  Industries,
} from "@/components/marketing/Content";
export const metadata: Metadata = {
  title: "Industries",
  description:
    "OPA connects people, facilities and authorized response teams through a controlled incident lifecycle while preserving the boundaries each organization requires.",
};
export default function Page() {
  return (
    <>

      <Industries detailed />
      <PilotCTA />
    </>
  );
}
