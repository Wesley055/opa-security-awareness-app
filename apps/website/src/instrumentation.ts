export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Diagnose at startup, but never crash the server: a failed endpoint
    // policy already makes every console call fail closed (503) through
    // environmentApiUrl(), while public pages keep serving.
    try {
      const { loadEndpoint } =
        await import("../../../packages/environment-policy/index.cjs");
      loadEndpoint(process.env);
      const { verifyEndpoint } =
        await import("../../../packages/environment-policy/verify-endpoint.cjs");
      await verifyEndpoint(process.env);
    } catch (error) {
      console.error(
        "[OPA-ENDPOINT] Endpoint policy verification failed; console API calls are disabled until resolved:",
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
