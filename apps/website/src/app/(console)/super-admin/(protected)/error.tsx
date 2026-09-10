"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="sa-card" role="alert">
      <h2>Workspace unavailable</h2>
      <p>
        We could not load this view. If a creation request was in progress,
        check its result before submitting again.
      </p>
      <button onClick={reset}>Try again</button>
    </div>
  );
}
