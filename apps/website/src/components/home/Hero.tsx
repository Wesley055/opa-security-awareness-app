export function Hero() {
  return (
    <section className="border-b border-line px-6 py-24 sm:py-32">
      <div className="mx-auto max-w-4xl text-center">
        <p className="font-mono text-xs uppercase tracking-widest text-flare">
          Nigeria first / Global by design
        </p>
        <h1 className="mt-6 font-display text-4xl font-extrabold leading-tight tracking-tight text-ink sm:text-6xl">
          OPA doesn&apos;t send an SOS.
          <br />
          <span className="text-signal">It coordinates your emergency.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted">
          One activation reaches your family, your doctor, nearby hospitals,
          and verified responders at once, with live location and a
          real-time operational picture, from the first second.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <a href="#pilot" className="rounded-md bg-flare px-6 py-3 text-sm font-semibold text-white transition hover:brightness-110">
            Partner with us
          </a>
          <a href="#how-it-works" className="rounded-md border border-line px-6 py-3 text-sm font-medium text-ink transition hover:border-signal hover:text-signal">
            See how it works
          </a>
        </div>
      </div>
    </section>
  );
}