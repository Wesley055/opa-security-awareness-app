import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms governing use of the OPA platform.",
};

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-24">
      <p className="font-mono text-xs uppercase tracking-widest text-flare">
        Terms of Service
      </p>
      <h1 className="mt-4 font-display text-4xl font-extrabold text-ink sm:text-5xl">
        Terms of Service.
      </h1>
      <p className="mt-4 font-mono text-xs text-muted-2">
        Last updated: {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
      </p>

      <div className="mt-8 rounded-lg border border-line bg-panel p-6">
        <p className="text-sm text-muted">
          This is a draft prepared for legal review and has not yet been
          finalized by a qualified attorney. Do not treat this page as a
          completed legal instrument until that review is complete.
        </p>
      </div>

      <div className="mt-12 space-y-10">
        <section>
          <h2 className="font-display text-xl font-bold text-ink">
            1. Acceptance of these terms
          </h2>
          <p className="mt-3 text-muted">
            By creating an account or using the OPA platform, you agree
            to these terms. If you do not agree, do not use the service.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold text-ink">
            2. About the service
          </h2>
          <p className="mt-3 text-muted">
            OPA is an emergency coordination platform operated by OPA
            Technology Limited. OPA is currently preparing its first
            hospital pilot in Nigeria. Some features described elsewhere
            on this site are in active development and are not yet
            available to all users.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold text-ink">
            3. OPA is not a replacement for calling emergency services
          </h2>
          <p className="mt-3 text-muted">
            OPA is a coordination tool. It depends on your device having
            power and network connectivity, and on third-party providers
            successfully delivering notifications. It cannot guarantee
            that any contact, hospital, or responder will receive or act
            on an alert within any specific time, or at all. If you are
            in immediate danger, contact local emergency services
            directly. Do not rely on OPA as your only means of requesting
            help.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold text-ink">
            4. Eligibility and your account
          </h2>
          <p className="mt-3 text-muted">
            You must be at least 18 years old to create an OPA account.
            You are responsible for the accuracy of the information you
            provide, for keeping your login credentials secure, and for
            having appropriate permission to add anyone as an emergency
            contact.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold text-ink">
            5. Acceptable use
          </h2>
          <p className="mt-3 text-muted">
            You agree not to use OPA to submit false emergency
            activations, to interfere with the platform&apos;s operation,
            or to attempt to access accounts, incidents, or facility data
            that do not belong to you.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold text-ink">
            6. Third-party services
          </h2>
          <p className="mt-3 text-muted">
            OPA relies on third-party providers, including Africa&apos;s
            Talking, Resend, Meta&apos;s WhatsApp Business Platform, and
            Microsoft Azure, to deliver notifications and store data.
            OPA is not responsible for outages or failures originating
            from these providers.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold text-ink">
            7. Disclaimers and limitation of liability
          </h2>
          <p className="mt-3 text-muted">
            OPA is provided on an &ldquo;as is&rdquo; basis while the
            platform is in active development. To the fullest extent
            permitted by law, OPA Technologies Limited disclaims liability
            for indirect, incidental, or consequential damages arising
            from use of, or inability to use, the platform, including
            failure or delay of any notification.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold text-ink">
            8. Termination
          </h2>
          <p className="mt-3 text-muted">
            You may stop using OPA at any time. We may suspend or
            terminate accounts that violate these terms, including
            accounts used to submit false emergency activations.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold text-ink">
            9. Governing law
          </h2>
          <p className="mt-3 text-muted">
            These terms are governed by the laws of the Federal Republic
            of Nigeria.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold text-ink">
            10. Changes to these terms
          </h2>
          <p className="mt-3 text-muted">
            We may update these terms as the platform develops. Material
            changes will be reflected on this page with an updated date
            at the top.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold text-ink">
            11. Contact
          </h2>
          <p className="mt-3 text-muted">
            Questions about these terms can be sent to{" "}
            <a href="mailto:legal@opasafety.com" className="text-signal hover:brightness-110">
              legal@opasafety.com
            </a>.
          </p>
        </section>
      </div>
    </div>
  );
}
