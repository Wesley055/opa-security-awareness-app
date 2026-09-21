import { randomUUID } from "crypto";

export const DELIVERY_DIAGNOSTICS = [
  "DELIVERY_ACTOR_UNAVAILABLE", "DELIVERY_AUTHORIZATION_DENIED",
  "SNAPSHOT_RESOLUTION_FAILED", "CRYPTO_DECRYPTION_FAILED", "AUDIT_PERSISTENCE_FAILED",
  "PAYLOAD_VALIDATION_FAILED", "ENVIRONMENT_POLICY_DENIED", "PROVIDER_INVOCATION_FAILED",
  "PROVIDER_REQUEST_FAILED", "PROVIDER_NOT_CONFIGURED", "TRANSPORT_UNSUPPORTED",
] as const;
export type DeliveryDiagnostic = (typeof DELIVERY_DIAGNOSTICS)[number];
export type DeliveryStage = "PRE_PROVIDER" | "PROVIDER_REQUEST" | "PROVIDER_RESPONSE";
// No exception contents or arbitrary object properties cross this boundary.
const diagnostics = new WeakMap<object, DeliveryDiagnostic>();
export function markDeliveryFailure<T extends object>(error: T, code: DeliveryDiagnostic): T {
  diagnostics.set(error, code);
  return error;
}
export function deliveryDiagnostic(error: unknown, fallback: DeliveryDiagnostic): DeliveryDiagnostic {
  return typeof error === "object" && error !== null ? diagnostics.get(error) ?? fallback : fallback;
}
export function safeDiagnostic(value: unknown): DeliveryDiagnostic | undefined {
  return DELIVERY_DIAGNOSTICS.find(code => code === value);
}
// Opaque per-process identity: no hostname, environment values, PID or secrets.
export const DELIVERY_WORKER_ID = randomUUID();
