const phases = [
  "Protect",
  "Activate",
  "Alert",
  "Track",
  "Coordinate",
  "Close",
  "Audit",
  "Report",
];

export function LifecycleSection() {
  return (
    <section className="border-b border-line px-6 py-24">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:items-end">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-emergency">
              Full incident lifecycle
            </p>

            <h2 className="mt-4 font-display text-3xl font-extrabold text-ink sm:text-5xl">
              Before the incident. During the response. After the danger.
            </h2>
          </div>

          <p className="max-w-2xl text-muted">
            OPA is being built as the system of record for physical safety
            incidents, from proactive journey protection through emergency
            activation, live tracking, controlled closure, audit, and
            structured post-incident reporting.
          </p>
        </div>

        <div className="mt-14 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          {phases.map((phase, index) => (
            <div
              key={phase}
              className="rounded-xl border border-line bg-panel px-4 py-5"
            >
              <p className="font-mono text-[10px] text-muted-2">
                {String(index + 1).padStart(2, "0")}
              </p>
              <p className="mt-3 font-display text-sm font-bold text-ink">
                {phase}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}