import { Activity, HeartPulse, ShieldCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";

const points: { title: string; description: string; icon: LucideIcon; status?: "in-progress" }[] = [
  {
    title: "Live incident queue",
    description:
      "Incidents routed to your facility, with location, ETA, and patient context attached.",
    icon: Activity,
    status: "in-progress",
  },
  {
    title: "Medical information on arrival",
    description:
      "Blood type, allergies, and known conditions available to your team, role-gated to authorized staff.",
    icon: HeartPulse,
  },
  {
    title: "A verified, auditable record",
    description:
      "Every incident builds a hash-chained timeline, tamper-evident by design, for internal review.",
    icon: ShieldCheck,
  },
];

export function HospitalSection() {
  return (
    <section className="border-b border-line px-6 py-24">
      <div className="mx-auto max-w-6xl">
        <div className="max-w-2xl">
          <p className="font-mono text-xs uppercase tracking-widest text-signal">
            For hospitals
          </p>
          <h2 className="mt-4 font-display text-3xl font-extrabold text-ink sm:text-4xl">
            A command center, built for your emergency department.
          </h2>
          <p className="mt-4 text-muted">
            OPA is preparing a hospital pilot experience that brings
            incident location, patient context, notifications, and the
            Survival Timeline into one coordinated view.
          </p>
        </div>

        <div className="mt-12 grid gap-6 sm:grid-cols-3">
          {points.map((point) => (
            <div
              key={point.title}
              className="rounded-lg border border-line bg-panel p-6"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-panel-2">
                <point.icon size={20} className="text-signal" />
              </div>
              <div className="mt-4 flex items-center gap-2">
                <h3 className="font-display text-base font-bold text-ink">
                  {point.title}
                </h3>
                {point.status === "in-progress" && (
                  <span className="rounded-full border border-muted-2 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-2">
                    In progress
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm text-muted">{point.description}</p>
            </div>
          ))}
        </div>

        <div className="mt-10">
          <a href="#pilot" className="inline-block rounded-md bg-signal px-6 py-3 text-sm font-semibold text-[#0A0E12] transition hover:brightness-110">
            Discuss a hospital pilot
          </a>
        </div>
      </div>
    </section>
  );
}