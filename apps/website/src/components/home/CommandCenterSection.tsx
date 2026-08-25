import { Activity, MapPinned, Shield, TimerReset } from "lucide-react";

const features = [
  {
    icon: Activity,
    title: "Live incident queue",
    body: "Operators receive a bounded facility-scoped view of active emergencies without exposing unrelated incidents.",
  },
  {
    icon: MapPinned,
    title: "Live tracking state",
    body: "Latest verified coordinates, location freshness, sequence state, and bounded journey history support active monitoring.",
  },
  {
    icon: Shield,
    title: "Controlled access",
    body: "Authentication and facility membership determine who can view an incident. Operational access does not imply unrestricted account access.",
  },
  {
    icon: TimerReset,
    title: "Auditable timeline",
    body: "OPA preserves a tamper-evident sequence of incident events for review, accountability, and post-incident reporting.",
  },
];

export function CommandCenterSection() {
  return (
    <section id="command-center" className="border-b border-line px-6 py-24">
      <div className="mx-auto grid max-w-6xl gap-14 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-signal">
            Institutional Command Center
          </p>

          <h2 className="mt-4 font-display text-3xl font-extrabold text-ink sm:text-5xl">
            Turn an alert into an operational incident.
          </h2>

          <p className="mt-5 text-muted">
            The OPA Command Center gives security teams a shared operational
            picture: who needs help, when the incident started, whether
            location is still arriving, and what has happened since
            activation.
          </p>

          <p className="mt-5 text-sm leading-6 text-muted-2">
            OPA is a software coordination layer. Response authority remains
            with the customer&apos;s authorized security organization and
            established emergency procedures.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="rounded-xl border border-line bg-panel p-6"
            >
              <feature.icon className="text-signal" size={21} />
              <h3 className="mt-5 font-display text-lg font-bold text-ink">
                {feature.title}
              </h3>
              <p className="mt-2 text-sm leading-6 text-muted">
                {feature.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}