import { Lock, KeyRound, ShieldCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";

const points: { title: string; description: string; icon: LucideIcon }[] = [
  {
    title: "Encrypted evidence, hash-verified",
    description:
      "Evidence files are hashed at capture and stored in Azure Blob Storage. Every download is a short-lived, signed link, not a permanent public URL.",
    icon: Lock,
  },
  {
    title: "Role-based access",
    description:
      "Every request checks a user's current role and facility assignment directly against the database, not a cached token, before granting access to any incident.",
    icon: KeyRound,
  },
  {
    title: "A tamper-evident incident record",
    description:
      "Every incident builds a hash-chained timeline. Each entry can be independently verified against the ones before it, so tampering would be detectable, not just logged.",
    icon: ShieldCheck,
  },
];

const technologies = [
  "Microsoft Azure",
  "SHA-256 integrity verification",
  "JWT authentication",
  "Role-based access control",
  "Signed, time-limited downloads",
];

export function SecuritySection() {
  return (
    <section id="trust" className="border-b border-line px-6 py-24">
      <div className="mx-auto max-w-4xl text-center">
        <p className="font-mono text-xs uppercase tracking-widest text-flare">
          Privacy &amp; security by design
        </p>
        <h2 className="mt-4 font-display text-3xl font-extrabold text-ink sm:text-4xl">
          Coordination only works if it can be trusted.
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-muted">
          OPA is built around privacy, integrity, and accountability.
          From the moment an emergency is activated until it is resolved,
          location updates, notifications, and evidence are protected
          using modern security practices and verifiable records.
        </p>
      </div>

      <div className="mx-auto mt-16 grid max-w-6xl gap-6 sm:grid-cols-3">
        {points.map((point) => (
          <div
            key={point.title}
            className="rounded-lg border border-line bg-panel p-6"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-panel-2">
              <point.icon size={20} className="text-signal" />
            </div>
            <h3 className="mt-4 font-display text-base font-bold text-ink">
              {point.title}
            </h3>
            <p className="mt-2 text-sm text-muted">{point.description}</p>
          </div>
        ))}
      </div>

      <div className="mx-auto mt-12 max-w-4xl text-center">
        <p className="font-mono text-[11px] uppercase tracking-widest text-muted-2">
          Powered by
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
          {technologies.map((tech) => (
            <span key={tech} className="font-mono text-xs text-muted">
              {tech}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}