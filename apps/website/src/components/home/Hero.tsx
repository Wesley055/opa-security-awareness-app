import { ArrowRight, Radio, ShieldCheck } from "lucide-react";

export function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-line px-6 py-24 sm:py-32">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(circle at 20% 20%, rgba(239,68,68,0.12), transparent 32%), radial-gradient(circle at 80% 30%, rgba(34,197,94,0.08), transparent 28%)",
        }}
      />

      <div className="relative mx-auto grid max-w-6xl gap-14 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-emergency/30 bg-emergency/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-emergency">
            <Radio size={13} />
            Nigeria first / Africa ready / globally extensible
          </div>

          <h1 className="mt-7 max-w-4xl font-display text-4xl font-extrabold leading-[1.04] tracking-tight text-ink sm:text-6xl">
            OPA: The Physical Incident Management Operating System
            <span className="block text-protection">
              for high-risk environments.
            </span>
          </h1>

          <p className="mt-7 max-w-2xl text-lg leading-8 text-muted">
            We protect your workforce before, during, and after an emergency.
            OPA connects Emergency SOS, Journey Protection, live location
            intelligence, institutional incident coordination, and auditable
            response in one resilient safety platform.
          </p>

          <div className="mt-9 flex flex-wrap gap-4">
            <a
              href="#pilot"
              className="inline-flex items-center gap-2 rounded-md bg-emergency px-6 py-3 text-sm font-semibold text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-protection"
            >
              Request an institutional pilot
              <ArrowRight size={16} />
            </a>

            <a
              href="#protection"
              className="rounded-md border border-line bg-panel/70 px-6 py-3 text-sm font-semibold text-ink transition hover:border-protection hover:text-protection"
            >
              Explore the platform
            </a>
          </div>

          <div className="mt-10 flex flex-wrap gap-x-7 gap-y-3 font-mono text-xs text-muted-2">
            <span>Private security</span>
            <span>Gated estates</span>
            <span>Corporate security</span>
            <span>Executive protection</span>
            <span>Lone workers</span>
            <span>Banking infrastructure</span>
            <span>Logistics &amp; CIT fleets</span>
            <span>Humanitarian NGOs</span>
          </div>
        </div>

        <div className="relative">
          <div className="rounded-2xl border border-line bg-panel p-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-line pb-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-2">
                  OPA Command Center
                </p>
                <p className="mt-1 font-display text-lg font-bold text-ink">
                  Active incident
                </p>
              </div>

              <span className="inline-flex items-center gap-2 rounded-full border border-emergency/30 bg-emergency/10 px-3 py-1 font-mono text-xs text-emergency">
                <span className="h-2 w-2 animate-pulse rounded-full bg-emergency" />
                Live
              </span>
            </div>

            <div className="mt-4 rounded-xl border border-emergency/20 bg-base p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-muted-2">
                    Emergency SOS
                  </p>
                  <h2 className="mt-2 font-display text-xl font-bold text-ink">
                    Incident received
                  </h2>
                  <p className="mt-1 font-mono text-xs text-muted">
                    Location tracking active
                  </p>
                </div>

                <ShieldCheck className="text-protection" size={24} />
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3">
                <Metric label="Incident visibility" value="~5 sec*" />
                <Metric label="Location state" value="Receiving" />
                <Metric label="Timeline" value="Integrity verified" />
                <Metric label="Operator scope" value="Facility bound" />
              </div>
            </div>

            <p className="mt-4 font-mono text-[10px] leading-5 text-muted-2">
              *Observed under normal connectivity conditions. Network and
              device conditions can affect delivery time.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-panel-2 p-3">
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-2">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-ink">{value}</p>
    </div>
  );
}