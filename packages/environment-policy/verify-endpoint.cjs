// Node TLS verification is mandatory; redirects are not followed.
const https = require("node:https");
const { loadEndpoint, readPolicy, classify } = require("./index.cjs");
async function probeEndpoint(origin, environment, build, transport = https) {
  await new Promise((resolve, reject) => {
    const request = transport.get(
      origin + "/health/environment",
      { rejectUnauthorized: true, timeout: 10000 },
      (response) => {
        let body = "";
        response.on("data", (chunk) => {
          body += chunk;
          if (body.length > 8192) {
            response.destroy();
            reject(Error("Endpoint response too large"));
          }
        });
        response.on("error", reject);
        response.on("end", () => {
          try {
            const data = JSON.parse(body);
            if (
              response.statusCode !== 200 ||
              data.environment !== environment ||
              data.build !== build ||
              data.migrationReadiness !== "ready"
            )
              throw Error("Endpoint classification mismatch");
            resolve();
          } catch {
            reject(Error("Endpoint verification failed"));
          }
        });
      },
    );
    request.on("timeout", () =>
      request.destroy(Error("Endpoint verification timed out")),
    );
    request.on("error", reject);
  });
}
async function verifyEndpoint(env) {
  const origin = loadEndpoint(env);
  if (classify(env) === "development") return;
  const policy = readPolicy(
    env.OPA_ENDPOINT_POLICY_FILE,
    classify(env),
    "endpoint",
  );
  await probeEndpoint(origin, env.OPA_ENVIRONMENT, policy.build);
}
module.exports = { verifyEndpoint, probeEndpoint };
if (require.main === module)
  verifyEndpoint(process.env).catch(() => {
    console.error("OPA HTTPS/environment verification failed");
    process.exitCode = 1;
  });
