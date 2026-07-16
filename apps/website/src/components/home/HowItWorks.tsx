import { Zap, Radar, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";

type Tag = { label: string; status?: "planned" | "in-progress" };

const clusters: {
  number: string;
  title: string;
  description: string;
  icon: LucideIcon;
  tags: Tag[];
}[] = [
  {
    number: "01",
    title: "Activation",
    description: "Trigger it the way an emergency actually happens.",
    icon: Zap,
    tags: [
      { label: "SOS button" },
      { label: "Live GPS capture" },
      { label: "Voice & custom triggers", status: "planned" },
    ],
  },
  {
    number: "02",
    title: "Intelligence",
    description: "Context arrives automatically for responders.",
    icon: Radar,
    tags: [
      { label: "Live location & address" },
      { label: "Hash-chained incident timeline" },
      { label: "Nearby hospitals & responders", status: "planned" },
    ],
  },
  {
    number: "03",
    title: "Coordination",
    description: "The right people move, in the right order.",
    icon: Users,
    tags: [
      { label: "SMS live \u00b7 Push live \u00b7 WhatsApp pending approval" },
      { label: "Priority-ordered emergency contacts" },
      { label: "Acknowledgement tracking", status: "in-progress" },
    ],
  },
];

function StatusPill({ status }: { status: Tag["status"] }) {
  if (!status) return null;
  const label = status === "planned" ? "Planned" : "In progress";
  return (
    <span className="ml-1.5 rounded-full border border-muted-2 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-2">
      {label}
    </span>
  );
}

export function HowItWorks() {
  return (
    <section id="how-it-works" className="border-b border-line px-6 py-24">
      <div className="mx-auto max-w-4xl text-center">
        <p className="font-display text-2xl font-bold text-ink sm:text-3xl">
          No one should face an emergency alone.
        </p>
        <p className="mx-auto mt-4 max-w-2xl text-muted">
          OPA is built around three things that have to work together, not
          three separate features.
        </p>
      </div>

      <div className="mx-auto mt-16 grid max-w-6xl gap-6 sm:grid-cols-3">
        {clusters.map((cluster) => (
          <div
            key={cluster.number}
            className="rounded-lg border border-line bg-panel p-6"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-panel-2">
              <cluster.icon size={20} className="text-signal" />
            </div>
            <p className="mt-4 font-mono text-xs text-muted-2">{cluster.number}</p>
            <h3 className="mt-1 font-display text-lg font-bold text-ink">
              {cluster.title}
            </h3>
            <p className="mt-2 text-sm text-muted">{cluster.description}</p>
            <div className="mt-5 flex flex-col gap-2">
              {cluster.tags.map((tag) => (
                <span
                  key={tag.label}
                  className="inline-flex w-fit items-center rounded border border-line bg-panel-2 px-2.5 py-1 font-mono text-xs text-ink"
                >
                  {tag.label}
                  <StatusPill status={tag.status} />
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}