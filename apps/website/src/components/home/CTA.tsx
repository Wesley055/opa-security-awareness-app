export function CTA() {
  return (
    <section id="pilot" className="px-6 py-24">
      <div className="mx-auto max-w-3xl rounded-xl border border-line bg-panel p-10 text-center sm:p-16">
        <h2 className="font-display text-3xl font-extrabold text-ink sm:text-4xl">
          We are preparing to pilot OPA with hospital partners in Lagos.
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-muted">
          If you run a hospital, a corporate security team, or an
          organization that coordinates emergency response, we would like
          to talk with you directly, not just add you to a list.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <a href="mailto:hello@opasafety.com" className="rounded-md bg-flare px-6 py-3 text-sm font-semibold text-white transition hover:brightness-110">
            Talk to us about a pilot
          </a>
        </div>
        <p className="mt-6 font-mono text-xs text-muted-2">
          hello@opasafety.com
        </p>
      </div>
    </section>
  );
}