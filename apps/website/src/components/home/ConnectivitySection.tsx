import {
  Cloud,
  Database,
  RadioTower,
  Router,
  Satellite,
  Smartphone,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export function ConnectivitySection() {
  return (
    <section id="resilience" className="border-b border-line px-6 py-24">
      <div className="mx-auto max-w-6xl">
        <div className="max-w-3xl">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-protection">
            Connectivity &amp; data integrity
          </p>

          <h2 className="mt-4 font-display text-3xl font-extrabold text-ink sm:text-5xl">
            Safety systems must remain useful when networks become unreliable.
          </h2>

          <p className="mt-5 text-muted">
            OPA is designed around durable telemetry, truthful freshness
            indicators, low-bandwidth operation, and progressively layered
            communications resilience.
          </p>
        </div>

        <div className="mt-14 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-2xl border border-line bg-panel p-7">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-2">
              Resilience path
            </p>

            <div className="mt-7 space-y-3">
              <Layer
                icon={Smartphone}
                title="Field device"
                text="Live capture, durable local queue, background replay"
              />
              <Connector />
              <Layer
                icon={RadioTower}
                title="Mobile network"
                text="Primary mobile-data path with low-bandwidth design"
              />
              <Connector />
              <Layer
                icon={Cloud}
                title="OPA cloud"
                text="Incident management, journey ingestion, notification delivery, tamper-evident audit"
              />
              <Connector />
              <Layer
                icon={Router}
                title="Command Center"
                text="Physical SOC monitoring, incident queue, live tracking"
              />
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl border border-protection/30 bg-protection/5 p-7">
              <div className="flex items-center justify-between gap-4">
                <Satellite className="text-protection" size={25} />
                <span className="rounded-full border border-protection/30 bg-protection/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-protection">
                  Institutional deployment option
                </span>
              </div>

              <h3 className="mt-6 font-display text-2xl font-bold text-ink">
                Satellite Failover Shield
              </h3>

              <p className="mt-3 text-sm leading-6 text-muted">
                OPA institutional deployments can support automated dual-WAN
                failover at a Security Operations Center, command post, or
                perimeter gatehouse. Compatible network infrastructure can
                fail over from terrestrial connectivity to a secondary
                satellite service such as Starlink.
              </p>

              <p className="mt-4 text-sm leading-6 text-muted">
                This protects the Command Center&apos;s connectivity when the
                facility&apos;s primary internet path fails. It does not
                manufacture connectivity for a field handset that has lost
                all cellular service.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <SmallCard
                icon={Database}
                title="Durable replay"
                text="Captured journey fixes remain queued until acknowledged."
              />
              <SmallCard
                icon={RadioTower}
                title="Truthful telemetry"
                text="Stale or unavailable location is never presented as current."
              />
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-line bg-panel-2 px-5 py-4">
          <p className="font-mono text-xs text-muted-2">
            OPA&apos;s Connectivity Ladder is being expanded across full-data,
            low-bandwidth, SMS-assisted, and additional degraded-network paths.
            Capabilities are promoted to production only after the relevant
            delivery path has been implemented and verified.
          </p>
        </div>
      </div>
    </section>
  );
}

function Layer({
  icon: Icon,
  title,
  text,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
}) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-line bg-panel-2 p-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-base">
        <Icon size={19} className="text-protection" />
      </div>
      <div>
        <p className="font-display text-sm font-bold text-ink">{title}</p>
        <p className="mt-1 text-xs text-muted">{text}</p>
      </div>
    </div>
  );
}

function Connector() {
  return <div className="ml-5 h-4 w-px bg-line" />;
}

function SmallCard({
  icon: Icon,
  title,
  text,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-panel p-5">
      <Icon size={19} className="text-signal" />
      <p className="mt-4 font-display text-sm font-bold text-ink">{title}</p>
      <p className="mt-2 text-xs leading-5 text-muted">{text}</p>
    </div>
  );
}