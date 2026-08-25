import { Fingerprint, LockKeyhole, ShieldCheck } from "lucide-react";

const points = [
  {
    icon: LockKeyhole,
    title: "Role-based incident access",
    description:
      "Incident reads are guarded by authenticated role and current facility scope rather than by possession of a stale client-side assumption.",
    status: "Available",
  },
  {
    icon: ShieldCheck,
    title: "Tamper-evident records",
    description:
      "Incident and journey records use integrity controls designed to make unauthorized modification detectable during audit and review.",
    status: "Available",
  },
  {
    icon: Fingerprint,
    title: "OPA Protected Identity",
    description:
      "OPA's privacy architecture is being extended so operational tracking access can remain separate from unrestricted plaintext access to sensitive contact identifiers.",
    status: "Architecture in progress",
  },
];

export function SecuritySection() {
  return (
    <section id="trust" className="border-b border-line px-6 py-24">
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-3xl text-center">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-flare">
            Security &amp; Protected Identity
          </p>

          <h2 className="mt-4 font-display text-3xl font-extrabold text-ink sm:text-5xl">
            Operational visibility without unnecessary exposure.
          </h2>

          <p className="mt-5 text-muted">
            Physical safety data can be highly sensitive. OPA is designed
            around least privilege, auditability, integrity verification, and
            progressive isolation of personally identifiable information.
          </p>
        </div>

        <div className="mt-14 grid gap-6 lg:grid-cols-3">
          {points.map((point) => (
            <article
              key={point.title}
              className="rounded-2xl border border-line bg-panel p-7"
            >
              <point.icon size={23} className="text-signal" />

              <span className="mt-6 inline-flex rounded-full border border-line bg-panel-2 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-2">
                {point.status}
              </span>

              <h3 className="mt-4 font-display text-xl font-bold text-ink">
                {point.title}
              </h3>

              <p className="mt-3 text-sm leading-6 text-muted">
                {point.description}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}