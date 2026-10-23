import { enrollmentDestination } from "../../shared/security/enrollment-navigation";
import { ConflictException } from "@nestjs/common";
/** Presence only; this never authenticates with a provider or sends a message. */
export function providerReadiness(env: NodeJS.ProcessEnv = process.env) {
  const present = (key: string) => Boolean(env[key]?.trim());
  return {
    sms: {
      provider: "Africa's Talking",
      state:
        present("AFRICASTALKING_API_KEY") && present("AFRICASTALKING_USERNAME")
          ? "CONFIGURED"
          : "NOT_CONFIGURED",
      credentialValidity: "UNKNOWN",
    },
    email: {
      provider: "Resend",
      state:
        present("RESEND_API_KEY") && present("RESEND_FROM_ADDRESS")
          ? "CONFIGURED"
          : "NOT_CONFIGURED",
      credentialValidity: "UNKNOWN",
    },
  };
}
export function requireEnrollmentDeliveryConfiguration() {
  enrollmentDestination(process.env.OPA_WEB_URL, "configuration-check", process.env.OPA_ENVIRONMENT);
  const readiness = providerReadiness();
  if (
    readiness.sms.state !== "CONFIGURED" ||
    readiness.email.state !== "CONFIGURED"
  )
    throw new ConflictException(
      "SMS and email must be configured before sending or retrying an invitation. No external request was sent.",
    );
}
