import {
  Activity,
  ArrowRight,
  CloudCog,
  MapPinned,
  Mic2,
  RadioTower,
  ShieldCheck,
  Siren,
  Smartphone,
  Webhook,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

type Status = "available" | "observed" | "development" | "planned";

type FlowItem = {
  label: string;
  status: Status;
};

const ingress: FlowItem[] = [
  { label: "Emergency SOS", status: "available" },
  { label: "Durable background GPS", status: "available" },
  { label: "Offline voice / Picovoice", status: "development" },
  { label: "SMS resilience path", status: "development" },
  { label: "Sensor / partner webhooks", status: "planned" },
];

const cloud: FlowItem[] = [
  { label: "Incident orchestration", status: "available" },
  { label: "Durable location ingestion", status: "available" },
  { label: "Fresh / stale telemetry truth", status: "available" },
  { label: "Tamper-evident audit chain", status: "available" },
  { label: "Protected Identity / PII Isolation", status: "development" },
  { label: "Journey & SafeWalk Protection", status: "development" },
];

const command: FlowItem[] = [
  { label: "Live incident queue", status: "available" },
  { label: "~5 sec incident visibility*", status: "observed" },
  { label: "Live tracked coordinates", status: "available" },
  { label: "Route / map visualization", status: "development" },
  { label: "Controlled incident closure", status: "planned" },
  { label: "Post-incident reporting", status: "planned" },
];

export function InfrastructureFlow() {
  return (
    <section
      id="architecture"
      className="relative overflow-hidden border-b border-line px-6 py-24"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          background:
            "radial-gradient(circle at 50% 45%, rgba(34,197,94,0.07), transparent 35%)",
        }}
      />

      <div className="relative mx-auto max-w-6xl">
        <div className="mx-auto max-w-3xl text-center">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-signal">
            Infrastructure data flow
          </p>

          <h2 className="mt-4 font-display text-3xl font-extrabold text-ink sm:text-5xl">
            From threat detection to institutional response.
          </h2>

          <p className="mt-5 text-muted">
            OPA operates as a software coordination layer between the person
            at risk, the cloud incident engine, and the organization
            responsible for monitoring and response.
          </p>
        </div>

        <div className="mt-16 grid items-stretch gap-5 lg:grid-cols-[1fr_auto_1fr_auto_1fr]">
          <FlowCard
            eyebrow="01 / Field"
            title="Threat & Field Ingress"
            description="Signals and verified telemetry entering the OPA incident boundary."
            icon={Smartphone}
            items={ingress}
          />

          <FlowArrow />

          <FlowCard
            eyebrow="02 / Cloud"
            title="OPA Incident Intelligence"
            description="Integrity, orchestration, telemetry state, and security boundaries."
            icon={CloudCog}
            items={cloud}
            featured
          />

          <FlowArrow />

          <FlowCard
            eyebrow="03 / Operations"
            title="Enterprise Command Center"
            description="Authorized institutional visibility for active physical incidents."
            icon={Activity}
            items={command}
          />
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <Capability
            icon={Siren}
            title="Emergency SOS Ingress"
            text="A one-tap SOS initializes an active incident and surfaces it to the authorized Command Center workflow with location and incident context."
          />

          <Capability
            icon={MapPinned}
            title="Location integrity"
            text="When location telemetry becomes stale or unavailable, OPA preserves the last verified position and timestamp and explicitly marks the stream state rather than presenting stale location as current."
          />

          <Capability
            icon={ShieldCheck}
            title="Institutional boundary"
            text="Facility-scoped authorization and role controls isolate incident access between organizations. OPA Protected Identity is extending this boundary to further separate operational tracking access from sensitive personal identifiers."
          />
        </div>

        <div className="mt-8 rounded-xl border border-line bg-panel-2 px-5 py-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <Legend status="available" />
            <Legend status="observed" />
            <Legend status="development" />
            <Legend status="planned" />
          </div>

          <p className="mt-3 font-mono text-[10px] leading-5 text-muted-2">
            *Approximately five seconds has been observed for SOS incident
            visibility under normal connectivity conditions. Network,
            carrier, device, and infrastructure conditions can affect
            delivery time.
          </p>
        </div>

        <div className="mt-8 flex flex-wrap justify-center gap-3 font-mono text-[10px] uppercase tracking-wider text-muted-2">
          <span className="inline-flex items-center gap-1.5">
            <Mic2 size={12} />
            Voice activation
          </span>

          <span className="inline-flex items-center gap-1.5">
            <RadioTower size={12} />
            Progressive Connectivity Ladder
          </span>

          <span className="inline-flex items-center gap-1.5">
            <Webhook size={12} />
            Partner Integration API Architecture
          </span>
        </div>
      </div>
    </section>
  );
}

function FlowCard({
  eyebrow,
  title,
  description,
  icon: Icon,
  items,
  featured = false,
}: {
  eyebrow: string;
  title: string;
  description: string;
  icon: LucideIcon;
  items: FlowItem[];
  featured?: boolean;
}) {
  return (
    <article
      className={
        featured
          ? "relative rounded-2xl border border-protection/40 bg-protection/5 p-6 shadow-2xl"
          : "relative rounded-2xl border border-line bg-panel p-6"
      }
    >
      {featured ? (
        <div className="absolute inset-x-8 top-0 h-px bg-protection" />
      ) : null}

      <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-panel-2">
        <Icon
          size={21}
          className={featured ? "text-protection" : "text-signal"}
        />
      </div>

      <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-2">
        {eyebrow}
      </p>

      <h3 className="mt-2 font-display text-xl font-bold text-ink">
        {title}
      </h3>

      <p className="mt-3 min-h-12 text-sm leading-6 text-muted">
        {description}
      </p>

      <div className="mt-6 space-y-2">
        {items.map((item) => (
          <div
            key={item.label}
            className="flex items-center justify-between gap-3 rounded-lg border border-line bg-base/60 px-3 py-2.5"
          >
            <span className="text-xs text-ink">{item.label}</span>
            <StatusPill status={item.status} />
          </div>
        ))}
      </div>
    </article>
  );
}

function FlowArrow() {
  return (
    <div className="hidden items-center justify-center lg:flex">
      <div className="flex items-center text-muted-2">
        <div className="h-px w-8 bg-line" />
        <ArrowRight size={17} />
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: Status }) {
  const label =
    status === "available"
      ? "Live"
      : status === "observed"
        ? "Observed"
        : status === "development"
          ? "Building"
          : "Planned";

  const classes =
    status === "available"
      ? "border-protection/30 bg-protection/10 text-protection"
      : status === "observed"
        ? "border-signal/30 bg-signal/10 text-signal"
        : "border-line bg-panel-2 text-muted-2";

  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${classes}`}
    >
      {label}
    </span>
  );
}

function Legend({ status }: { status: Status }) {
  return (
    <div className="flex items-center gap-2">
      <StatusPill status={status} />
      <span className="font-mono text-[10px] text-muted-2">
        {status === "available"
          ? "production capability"
          : status === "observed"
            ? "measured behavior"
            : status === "development"
              ? "active development"
              : "planned capability"}
      </span>
    </div>
  );
}

function Capability({
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
      <Icon size={19} className="text-protection" />
      <h4 className="mt-4 font-display text-sm font-bold text-ink">
        {title}
      </h4>
      <p className="mt-2 text-xs leading-5 text-muted">{text}</p>
    </div>
  );
}