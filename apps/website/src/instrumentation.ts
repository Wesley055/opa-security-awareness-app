export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { loadEndpoint } =
      await import("../../../packages/environment-policy/index.cjs");
    loadEndpoint(process.env);
    const { verifyEndpoint } =
      await import("../../../packages/environment-policy/verify-endpoint.cjs");
    await verifyEndpoint(process.env);
  }
}
