import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How OPA Technology Limited collects, uses, and protects your information.",
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-24">
      <p className="font-mono text-xs uppercase tracking-widest text-flare">
        Privacy Policy
      </p>
      <h1 className="mt-4 font-display text-4xl font-extrabold text-ink sm:text-5xl">
        Your privacy.
      </h1>
      <p className="mt-4 font-mono text-xs text-muted-2">
        Last updated: {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
      </p>

      <div className="mt-8 rounded-lg border border-line bg-panel p-6">
        <p className="text-sm text-muted">
          This policy describes what OPA actually collects and how it is
          actually used, based on the platform as built today. It is a
          draft prepared for legal review and has not yet been finalized
          by a qualified attorney. Do not treat this page as a completed
          legal instrument until that review is complete.
        </p>
      </div>

      <div className="mt-12 space-y-10">
        <section>
          <h2 className="font-display text-xl font-bold text-ink">
            Who we are
          </h2>
          <p className="mt-3 text-muted">
            OPA Technology Limited (&ldquo;OPA,&rdquo; &ldquo;we,&rdquo;
            &ldquo;us&rdquo;) operates the OPA emergency coordination
            platform. This policy applies to the OPA mobile application,
            the OPA website, and related services.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold text-ink">
            Information we collect
          </h2>

          <h3 className="mt-6 font-display text-base font-semibold text-ink">
            Account information
          </h3>
          <p className="mt-2 text-muted">
            When you create an account, we collect your email address,
            phone number, first and last name, and a securely hashed
            version of your password. We never store your password in
            readable form.
          </p>

          <h3 className="mt-6 font-display text-base font-semibold text-ink">
            Emergency contact information
          </h3>
          <p className="mt-2 text-muted">
            If you add emergency contacts, we collect their name,
            relationship to you, phone number, and, if provided, email
            address. You are responsible for having the appropriate
            permission to share a contact&apos;s information with us.
          </p>

          <h3 className="mt-6 font-display text-base font-semibold text-ink">
            Incident and location information
          </h3>
          <p className="mt-2 text-muted">
            When you activate an emergency, we collect your GPS location
            (latitude, longitude, and accuracy), the type of trigger used,
            and, where available, a resolved street address. This data is
            tied to the specific incident you activated, not collected
            continuously in the background.
          </p>

          <h3 className="mt-6 font-display text-base font-semibold text-ink">
            Evidence
          </h3>
          <p className="mt-2 text-muted">
            OPA&apos;s platform supports attaching evidence files to an
            incident. Where evidence is uploaded, it is hashed with
            SHA-256 at the point of upload and stored in encrypted Azure
            Blob Storage. Downloads use short-lived, signed links rather
            than permanent public URLs.
          </p>

          <h3 className="mt-6 font-display text-base font-semibold text-ink">
            Hospital and facility staff information
          </h3>
          <p className="mt-2 text-muted">
            If you are a hospital staff user, your account is associated
            with a specific facility, and your access to incident data is
            limited to incidents routed to that facility.
          </p>

          <h3 className="mt-6 font-display text-base font-semibold text-ink">
            What we do not currently collect
          </h3>
          <p className="mt-2 text-muted">
            OPA does not currently collect medical information such as
            blood type, allergies, or known conditions, and the mobile
            application does not currently capture audio, video, or photo
            evidence automatically. If these capabilities are added in
            the future, this policy will be updated before they are
            enabled.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold text-ink">
            How we use your information
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-muted">
            <li>To create and secure your account.</li>
            <li>
              To notify your emergency contacts and, where applicable,
              hospital staff when you activate an emergency.
            </li>
            <li>
              To build the Survival Timeline, a tamper-evident,
              hash-chained record of what happened during an incident.
            </li>
            <li>
              To route incidents to the appropriate facility, where
              facility routing applies.
            </li>
            <li>To respond to support requests you send us.</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold text-ink">
            Third-party service providers
          </h2>
          <p className="mt-3 text-muted">
            We use the following providers to operate OPA. Each receives
            only the information necessary to perform its function.
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-muted">
            <li>
              <strong className="text-ink">Africa&apos;s Talking</strong>
              {" "}&mdash; SMS and voice call delivery.
            </li>
            <li>
              <strong className="text-ink">Resend</strong> &mdash; email delivery.
            </li>
            <li>
              <strong className="text-ink">Meta (WhatsApp Business Platform)</strong>
              {" "}&mdash; WhatsApp message delivery, where enabled.
            </li>
            <li>
              <strong className="text-ink">Microsoft Azure</strong> &mdash; database
              hosting and evidence file storage.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold text-ink">
            Data security
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-muted">
            <li>Passwords are hashed and never stored in readable form.</li>
            <li>
              Authentication uses short-lived access tokens with a
              separate refresh mechanism.
            </li>
            <li>
              Access to incident data is verified against your current
              role and facility assignment on every request, not cached.
            </li>
            <li>
              Evidence files are integrity-verified with SHA-256 hashing
              and stored in encrypted cloud storage.
            </li>
            <li>
              Every incident produces a hash-chained timeline designed to
              make unauthorized modification detectable.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold text-ink">
            Data retention
          </h2>
          <p className="mt-3 text-muted">
            We are finalizing a formal data retention schedule. Until it
            is published here, incident, evidence, and account data is
            retained as needed to operate the service and is not
            automatically deleted on a fixed timeline. If you would like
            your data deleted sooner, contact us at{" "}
            <a href="mailto:privacy@opasafety.com" className="text-signal hover:brightness-110">
              privacy@opasafety.com
            </a>{" "}
            and we will process the request manually.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold text-ink">
            Your rights
          </h2>
          <p className="mt-3 text-muted">
            Depending on where you are located, you may have rights to
            access, correct, or request deletion of your personal data.
            OPA is built for Nigeria first and intends to align with the
            Nigeria Data Protection Act. We do not yet offer a
            self-service tool for these requests; in the meantime, email{" "}
            <a href="mailto:privacy@opasafety.com" className="text-signal hover:brightness-110">
              privacy@opasafety.com
            </a>{" "}
            and we will respond directly.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold text-ink">
            Children&apos;s privacy
          </h2>
          <p className="mt-3 text-muted">
            OPA is not directed at children and is not intended for
            account creation by anyone under the age of 18. A minor may
            be listed as an emergency contact by an adult user.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold text-ink">
            Changes to this policy
          </h2>
          <p className="mt-3 text-muted">
            We may update this policy as the platform develops. Material
            changes will be reflected on this page with an updated date
            at the top.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold text-ink">
            Contact us
          </h2>
          <p className="mt-3 text-muted">
            Questions about this policy or your data can be sent to{" "}
            <a href="mailto:privacy@opasafety.com" className="text-signal hover:brightness-110">
              privacy@opasafety.com
            </a>.
          </p>
        </section>
      </div>
    </div>
  );
}