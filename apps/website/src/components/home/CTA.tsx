export function CTA() {
  return (
    <section id="pilot" className="px-6 py-24">
      <div className="mx-auto max-w-3xl rounded-xl border border-line bg-panel p-10 text-center sm:p-16">
        <h2 className="font-display text-3xl font-extrabold text-ink sm:text-4xl">
          Preparing for our first hospital pilot across Nigeria.
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-muted">
          OPA is preparing to pilot its emergency alerting platform
          with hospitals across Nigeria. We also welcome conversations
          with emergency response organizations, corporate security
          teams, and non-governmental organizations interested in future
          partnerships as the platform evolves.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <a href="mailto:info@opasafety.com?subject=OPA%20Pilot%20Partnership" className="rounded-md bg-emergency px-6 py-3 text-sm font-semibold text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-protection focus-visible:ring-offset-2 focus-visible:ring-offset-base">
            Become a Pilot Partner
          </a>
        </div>
        <p className="mt-6 font-mono text-xs text-muted-2">
          info@opasafety.com
        </p>
      </div>
    </section>
  );
}