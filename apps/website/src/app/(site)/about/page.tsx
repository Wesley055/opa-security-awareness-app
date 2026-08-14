import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About",
  description:
    "OPA's mission is to ensure no one faces an emergency alone. Built Nigeria first, designed to go anywhere.",
};

const principles = [
  "Human life comes first.",
  "Save seconds by reducing delays during emergencies.",
  "Coordinate people, not just notifications.",
  "Privacy and security by design.",
  "Nigeria first, global by design.",
  "Reliability over novelty.",
  "Build trust through accurate, secure, and dependable operation.",
];

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-24">
      <p className="font-mono text-xs uppercase tracking-widest text-flare">
        About OPA
      </p>
      <h1 className="mt-4 font-display text-4xl font-extrabold text-ink sm:text-5xl">
        No one should face an emergency alone.
      </h1>

      <div className="mt-12 grid gap-8 sm:grid-cols-2">
        <div>
          <h2 className="font-mono text-xs uppercase tracking-widest text-signal">
            Mission
          </h2>
          <p className="mt-3 text-muted">
            To intelligently coordinate emergency response for individuals
            in Nigeria by connecting victims, families, responders,
            hospitals, and trusted organizations in real time, ensuring
            that no one faces an emergency alone.
          </p>
        </div>
        <div>
          <h2 className="font-mono text-xs uppercase tracking-widest text-signal">
            Vision
          </h2>
          <p className="mt-3 text-muted">
            OPA is an emergency intelligence and coordination platform,
            designed to reduce response time by connecting the people who
            matter through a secure, real-time operational picture. We
            are building for Nigeria first, with a platform designed to
            support global expansion.
          </p>
        </div>
      </div>

      <div className="mt-16">
        <h2 className="font-mono text-xs uppercase tracking-widest text-signal">
          Guiding principles
        </h2>
        <div className="mt-4 divide-y divide-line border-t border-line">
          {principles.map((principle, index) => (
            <div
              key={principle}
              className="flex gap-6 py-4"
            >
              <span className="font-mono text-sm text-muted-2">
                {String(index + 1).padStart(2, "0")}
              </span>
              <p className="text-ink">{principle}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}