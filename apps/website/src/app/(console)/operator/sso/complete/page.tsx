export default function CompleteIdentityLink() {
  return (
    <main className="mx-auto max-w-lg space-y-5 p-8">
      <h1 className="text-2xl font-semibold">
        Complete institutional sign-in linking
      </h1>
      <p>
        Your institution verified your identity. Complete the link using your
        current OPA session.
      </p>
      <form action="/api/sso/finish-link" method="post">
        <button
          className="rounded bg-slate-900 px-5 py-3 text-white"
          type="submit"
        >
          Complete identity link
        </button>
      </form>
    </main>
  );
}
