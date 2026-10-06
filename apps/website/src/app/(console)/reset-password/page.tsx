import { ResetPasswordForm } from "@/components/auth/recovery-forms";
export const metadata = {
  title: "Set a new OPA password",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const params = await searchParams;
  return (
    <main className="mx-auto w-full max-w-xl px-6 py-12 space-y-6">
      <h1 className="font-display text-3xl font-bold">Set a new password</h1>
      <ResetPasswordForm
        initialToken={typeof params.token === "string" ? params.token : ""}
      />
    </main>
  );
}
