export function Hero() {
  return (
    <section className="border-b border-line px-6 py-24 sm:py-32">
      <div className="mx-auto max-w-4xl text-center">
        <p className="font-mono text-xs uppercase tracking-widest text-emergency">
          Nigeria first / Built for what&apos;s next
        </p>
        <h1 className="mt-6 font-display text-4xl font-extrabold leading-tight tracking-tight text-ink sm:text-6xl">
          When it matters most,
          <br />
          <span className="text-protection">everyone who can help knows.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted">
          One tap instantly alerts your trusted contacts with your live
          location, so the people who care about you know you need help and
          exactly where you are. We&apos;re building toward coordinated response
          with hospitals and responders next.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <a
            href="#pilot"
            className="rounded-md bg-emergency px-6 py-3 text-sm font-semibold text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-protection focus-visible:ring-offset-2 focus-visible:ring-offset-base"
          >
            Partner with us
          </a>
          <a
            href="#how-it-works"
            className="rounded-md border border-line px-6 py-3 text-sm font-medium text-ink transition hover:border-protection hover:text-protection focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-protection focus-visible:ring-offset-2 focus-visible:ring-offset-base"
          >
            See how it works
          </a>
        </div>
      </div>
    </section>
  );
}
