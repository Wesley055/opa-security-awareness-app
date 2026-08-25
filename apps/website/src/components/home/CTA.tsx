import { ArrowRight, Building2 } from "lucide-react";

export function CTA() {
  return (
    <section id="pilot" className="px-6 py-24">
      <div className="mx-auto max-w-6xl overflow-hidden rounded-2xl border border-line bg-panel">
        <div className="grid lg:grid-cols-[1fr_0.45fr]">
          <div className="p-8 sm:p-12">
            <div className="inline-flex items-center gap-2 rounded-full border border-protection/30 bg-protection/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-protection">
              <Building2 size={13} />
              Institutional deployments
            </div>

            <h2 className="mt-6 max-w-3xl font-display text-3xl font-extrabold text-ink sm:text-5xl">
              Build a safer operating environment before the next incident.
            </h2>

            <p className="mt-5 max-w-2xl text-muted">
              OPA is engaging private security firms, gated estates,
              corporate security teams, executive protection operations, and
              lone-worker organizations for institutional pilots and
              deployment partnerships.
            </p>

            <div className="mt-8">
              <a
                href="mailto:info@opasafety.com?subject=OPA%20Institutional%20Pilot"
                className="inline-flex items-center gap-2 rounded-md bg-emergency px-6 py-3 text-sm font-semibold text-white transition hover:brightness-110"
              >
                Request an institutional pilot
                <ArrowRight size={16} />
              </a>
            </div>

            <p className="mt-5 font-mono text-xs text-muted-2">
              info@opasafety.com
            </p>
          </div>

          <div className="border-t border-line bg-base p-8 lg:border-l lg:border-t-0 sm:p-10">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-2">
              Designed for
            </p>

            <ul className="mt-5 space-y-3 text-sm text-muted">
              <li>Private security companies</li>
              <li>Gated estates and communities</li>
              <li>Corporate security operations</li>
              <li>Executive protection programs</li>
              <li>Lone-worker organizations</li>
              <li>Future healthcare and public-safety integrations</li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}