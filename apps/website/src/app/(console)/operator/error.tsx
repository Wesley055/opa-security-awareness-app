'use client';
export default function ErrorPage({ unstable_retry }: { unstable_retry: () => void }) {
  return <section className="p-6 text-ink"><h1 className="text-2xl font-bold">Command Center unavailable</h1><p role="alert" className="mt-3">This page could not load. Its current state is unknown.</p><button type="button" className="mt-4 min-h-11 rounded-md border border-line px-4" onClick={unstable_retry}>Retry</button></section>;
}
