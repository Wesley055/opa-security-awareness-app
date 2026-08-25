import { Clock3, Navigation, Siren } from "lucide-react";
import type { LucideIcon } from "lucide-react";

type Mode = {
  phase: string;
  title: string;
  subtitle: string;
  description: string;
  icon: LucideIcon;
  status: "available" | "development";
};

const modes: Mode[] = [
  {
    phase: "During",
    title: "Emergency SOS",
    subtitle: "Immediate active incident response",
    description:
      "A user-triggered emergency creates an incident, preserves location context, notifies authorized parties, and gives the Command Center operational visibility as the incident develops.",
    icon: Siren,
    status: "available",
  },
  {
    phase: "Before",
    title: "Journey Protection",
    subtitle: "User-started protection for higher-risk travel",
    description:
      "OPA maintains a protected journey session with durable background location tracking and replay, creating the foundation for Journey Intelligence and higher-risk transit monitoring.",
    icon: Navigation,
    status: "available",
  },
  {
    phase: "Before",
    title: "SafeWalk",
    subtitle: "Destination and time-based arrival protection",
    description:
      "Designed for vulnerable short journeys without constant manual check-ins. A user sets an expected arrival window and OPA can escalate overdue journeys through a controlled safety workflow.",
    icon: Clock3,
    status: "development",
  },
];

export function ProtectionModes() {
  return (
    <section id="protection" className="border-b border-line px-6 py-24">
      <div className="mx-auto max-w-6xl">
        <div className="max-w-3xl">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-emergency">
            Before / During / After
          </p>

          <h2 className="mt-4 font-display text-3xl font-extrabold text-ink sm:text-5xl">
            Protection should begin before an emergency happens.
          </h2>

          <p className="mt-5 max-w-2xl font-display text-xl font-bold text-ink">
            No one should face an emergency alone.
          </p>

          <p className="mt-3 max-w-2xl text-muted">
            OPA is built around three protection modes that have to work
            together, not three separate features.
          </p>

          <p className="mt-4 max-w-2xl text-muted">
            Emergency SOS, Journey Protection, and SafeWalk work across the
            same incident lifecycle so institutional safety teams can protect
            people before, during, and after an emergency.
          </p>
        </div>

        <div className="mt-14 grid gap-6 lg:grid-cols-3">
          {modes.map((mode) => (
            <article
              key={mode.title}
              className="group relative overflow-hidden rounded-2xl border border-line bg-panel p-7 transition duration-300 hover:-translate-y-1 hover:border-protection/50"
            >
              <div className="absolute right-0 top-0 h-28 w-28 rounded-full bg-protection/5 blur-3xl" />

              <div className="relative">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-panel-2">
                    <mode.icon size={21} className="text-protection" />
                  </div>

                  <Status status={mode.status} />
                </div>

                <p className="mt-7 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-2">
                  {mode.phase}
                </p>

                <h3 className="mt-2 font-display text-2xl font-bold text-ink">
                  {mode.title}
                </h3>

                <p className="mt-2 text-sm font-semibold text-protection">
                  {mode.subtitle}
                </p>

                <p className="mt-4 text-sm leading-6 text-muted">
                  {mode.description}
                </p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function Status({ status }: { status: Mode["status"] }) {
  const available = status === "available";

  return (
    <span
      className={
        available
          ? "rounded-full border border-protection/30 bg-protection/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-protection"
          : "rounded-full border border-line bg-panel-2 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-muted"
      }
    >
      {available ? "Available" : "In development"}
    </span>
  );
}
