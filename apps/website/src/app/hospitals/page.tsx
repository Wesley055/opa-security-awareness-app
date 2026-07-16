import type { Metadata } from "next";
import { Activity, Users, ShieldCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export const metadata: Metadata = {
  title: "For Hospitals",
  description:
    "OPA is preparing a hospital pilot across Nigeria, coordinating incident location, emergency contacts, and a verified Survival Timeline in one operational view.",
};

const capabilities: { title: string; description: string; icon: LucideIcon; status?: "in-progress" }[] = [
  {
    title: "Live incident queue",
    description:
      "Incidents routed to the facility, with location, available emergency context, and status visible to authorized staff.",
    icon: Activity,
    status: "in-progress",
  },
  {
    title: "Emergency contact coordination",
    description:
      "Designated family members and trusted contacts are notified and kept informed throughout an emergency response.",
    icon: Users,
  },
  {
    title: "A verified, auditable record",
    description:
      "Every incident builds a hash-chained timeline, tamper-evident by design, useful for internal review and accountability.",
    icon: ShieldCheck,
  },
];

export default function HospitalsPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-24">
      <p className="font-mono text-xs uppercase tracking-widest text-signal">
        For hospitals
      </p>
      <h1 className="mt-4 font-display text-4xl font-extrabold text-ink sm:text-5xl">
        A command center designed for emergency coordination.
      </h1>
      <p className="mt-6 max-w-2xl text-muted">
        Emergency departments make critical decisions under severe time
        pressure. OPA is being developed to improve emergency coordination
        by securely sharing incident location, trusted-contact
        notifications, and a verified incident timeline in a single
        operational view.
      </p>

      <div className="mt-16 grid gap-6 sm:grid-cols-3">
        {capabilities.map((item) => (
          <div key={item.title} className="rounded-lg border border-line bg-panel p-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-panel-2">
              <item.icon size={20} className="text-signal" />
            </div>
            <div className="mt-4 flex items-center gap-2">
              <h3 className="font-display text-base font-bold text-ink">
                {item.title}
              </h3>
              {item.status === "in-progress" && (
                <span className="rounded-full border border-muted-2 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-2">
                  In progress
                </span>
              )}
            </div>
            <p className="mt-2 text-sm text-muted">{item.description}</p>
          </div>
        ))}
      </div>

      <div className="mt-16 rounded-xl border border-line bg-panel p-8 sm:p-10">
        <h2 className="font-display text-2xl font-bold text-ink">
          Preparing for our first hospital pilot across Nigeria.
        </h2>
        <p className="mt-3 max-w-2xl text-muted">
          If your hospital coordinates emergency response and would like
          to discuss an early pilot partnership, we would welcome the
          conversation.
        </p>
        <a href="mailto:partnerships@opasafety.com?subject=OPA%20Hospital%20Pilot" className="mt-6 inline-block rounded-md bg-flare px-6 py-3 text-sm font-semibold text-white transition hover:brightness-110">
          Become a Pilot Partner
        </a>
        <div className="mt-6 border-t border-line pt-6">
          <p className="font-mono text-xs uppercase tracking-widest text-muted-2">
            Hospital Partnerships
          </p>
          <p className="mt-2 text-sm text-muted">
            partnerships@opasafety.com
          </p>
        </div>
      </div>

      <p className="mt-10 text-xs text-muted-2">
        OPA is currently preparing its first hospital pilot program across
        Nigeria. Pilot features, timelines, and availability may evolve as
        the platform is refined in collaboration with participating
        hospitals.
      </p>
    </div>
  );
}