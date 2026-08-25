import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Delete Your OPA Account",
  description:
    "Request deletion of your OPA account and associated personal data.",
};

export default function DeleteAccountPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-24">
      <p className="font-mono text-xs uppercase tracking-widest text-flare">
        Account deletion
      </p>

      <h1 className="mt-4 font-display text-4xl font-extrabold text-ink sm:text-5xl">
        Delete your OPA account.
      </h1>

      <p className="mt-4 text-muted">
        OPA Technologies Limited provides this page for users who want to
        request deletion of their OPA account and associated personal data.
      </p>

      <div className="mt-12 space-y-10">
        <section>
          <h2 className="font-display text-xl font-bold text-ink">
            How to request deletion
          </h2>

          <p className="mt-3 text-muted">
            Send an email from the email address associated with your OPA
            account to{" "}
            <a
              href="mailto:privacy@opasafety.com?subject=OPA%20Account%20Deletion%20Request"
              className="text-signal hover:brightness-110"
            >
              privacy@opasafety.com
            </a>{" "}
            with the subject &ldquo;OPA Account Deletion Request.&rdquo;
          </p>

          <p className="mt-3 text-muted">
            Include the email address and phone number associated with your
            account so that we can identify the correct account. Do not send
            your password, authentication token, or other secret credentials.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold text-ink">
            Identity verification
          </h2>

          <p className="mt-3 text-muted">
            We may need to verify that you are the account holder before
            completing a deletion request. This protects OPA users from
            unauthorized requests to delete their safety accounts.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold text-ink">
            Organization-managed accounts
          </h2>

          <p className="mt-3 text-muted">
            OPA is primarily provided through organizations such as security
            companies, estates, employers, and other authorized safety
            organizations. If your account was provisioned through an
            organization, deleting your OPA account may also end your access
            to safety services provided through that organization.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold text-ink">
            What will be deleted
          </h2>

          <p className="mt-3 text-muted">
            Once a valid deletion request is approved, OPA will delete or
            de-identify personal account information that is no longer
            required to provide the service or meet applicable legal,
            security, fraud-prevention, contractual, or record-keeping
            obligations.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold text-ink">
            Emergency and incident records
          </h2>

          <p className="mt-3 text-muted">
            Some emergency, incident, security, audit, or transaction records
            may need to be retained where required for legitimate security,
            legal, contractual, fraud-prevention, dispute-resolution, or
            regulatory purposes. Where retention is required, access remains
            restricted and the information will not be retained longer than
            necessary for the applicable purpose.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold text-ink">
            Uninstalling OPA
          </h2>

          <p className="mt-3 text-muted">
            Uninstalling the OPA mobile application does not automatically
            delete your OPA account or information already stored by OPA.
            Use the deletion process described on this page if you want to
            request account deletion.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold text-ink">
            Need help?
          </h2>

          <p className="mt-3 text-muted">
            For questions about account deletion or your personal data,
            contact{" "}
            <a
              href="mailto:privacy@opasafety.com"
              className="text-signal hover:brightness-110"
            >
              privacy@opasafety.com
            </a>
            .
          </p>
        </section>
      </div>
    </div>
  );
}