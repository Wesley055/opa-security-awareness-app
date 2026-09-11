'use client';
export function RetryButton() {
  return <button type="button" className="mt-4 min-h-11 rounded-md border border-line px-4 py-2 text-ink" onClick={() => window.location.reload()}>Retry</button>;
}
