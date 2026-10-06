import { ForgotPasswordForm } from "@/components/auth/recovery-forms";
export const metadata = {
  title: "Recover OPA access",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default function Page() {
  return (
    <main className="mx-auto w-full max-w-xl px-6 py-12 space-y-6">
      <h1 className="font-display text-3xl font-bold">
        Forgot password / recover access
      </h1>
      <p>Recovery for all OPA local-password accounts.</p>
      <ForgotPasswordForm />
    </main>
  );
}
