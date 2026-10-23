import { ConflictException } from "@nestjs/common";
/** Public navigation only. Proofs never belong in this URL. */
export function enrollmentDestination(
  base: string | undefined,
  requestId: string,
  environment = "production",
): string {
  try {
    const url = new URL(base?.trim() ?? "");
    const localDevelopment =
      environment === "development" &&
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      (!localDevelopment && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      throw new Error("Invalid enrollment origin");
    const destination = new URL("/enroll", url.origin);
    destination.searchParams.set("requestId", requestId);
    return destination.toString();
  } catch {
    throw new ConflictException(
      "OPA_WEB_URL must be a valid HTTPS enrollment origin (HTTP loopback is allowed only in development). No invitation was sent.",
    );
  }
}
